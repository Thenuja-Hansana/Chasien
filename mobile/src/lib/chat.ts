import { supabase } from '@/lib/supabase';

// Appended to every postgres_changes channel's name below (never to
// subscribeToTyping's — that one's a Broadcast channel and its name has
// to stay deterministic so sender and receiver rendezvous on it). React
// double-invoking an effect on mount is normal in dev builds; the
// cleanup's removeChannel() call is async, so a same-named channel can
// otherwise get reused by the second invocation's channel() call before
// the first one finishes tearing down, and Supabase rejects a second
// .on() after that channel already called .subscribe(). A unique name
// per call makes that collision impossible rather than racing it.
let channelSeq = 0;
function uniqueSuffix() {
  channelSeq += 1;
  return channelSeq;
}

export type ConversationKind = 'room_channel' | 'dm';

export type InboxRow = {
  conversation_id: string;
  kind: ConversationKind;
  room_id: string | null;
  channel_name: string | null;
  room_name: string | null;
  room_accent_color: string | null;
  dm_user_a: string | null;
  dm_user_b: string | null;
  dm_user_a_handle: string | null;
  dm_user_a_name: string | null;
  dm_user_b_handle: string | null;
  dm_user_b_name: string | null;
  muted: boolean;
  pinned: boolean;
  last_read_at: string | null;
  last_message_id: string | null;
  last_message_text: string | null;
  last_message_image_url: string | null;
  last_message_voice_url: string | null;
  last_message_author_id: string | null;
  last_message_created_at: string | null;
  unread_count: number;
};

/** What the inbox row's kind-specific fields resolve to for display, from the current user's point of view. */
export type InboxItem = InboxRow & {
  title: string;
  otherUserId: string | null;
};

/** my_inbox (20260815003801_inbox_view.sql) does the "latest message per
 * conversation" aggregation in SQL — not expressible as a single
 * supabase-js embed, and not something to fake with N+1 queries. */
export async function fetchInbox(myUserId: string): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('my_inbox')
    .select('*')
    .order('last_message_created_at', { ascending: false, nullsFirst: false });
  if (error) throw error;

  return (data as InboxRow[]).map((row) => toInboxItem(row, myUserId));
}

function toInboxItem(row: InboxRow, myUserId: string): InboxItem {
  if (row.kind === 'room_channel') {
    return { ...row, title: row.room_name ?? 'Room', otherUserId: null };
  }
  const otherIsA = row.dm_user_a !== myUserId;
  return {
    ...row,
    title: (otherIsA ? row.dm_user_a_name : row.dm_user_b_name) ?? 'Unknown',
    otherUserId: otherIsA ? row.dm_user_a : row.dm_user_b,
  };
}

/** One row from the same view fetchInbox() reads, for the chat header — avoids a second, differently-shaped query. */
export async function fetchConversationSummary(conversationId: string, myUserId: string): Promise<InboxItem | null> {
  const { data, error } = await supabase.from('my_inbox').select('*').eq('conversation_id', conversationId).maybeSingle();
  if (error) throw error;
  return data ? toInboxItem(data as InboxRow, myUserId) : null;
}

export type Message = {
  id: string;
  conversation_id: string;
  author_id: string | null;
  text: string | null;
  image_url: string | null;
  voice_url: string | null;
  reply_to_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  author: { handle: string; name: string } | null;
  reactions: { emoji: string; user_id: string }[];
};

const MESSAGE_SELECT = `
  id, conversation_id, author_id, text, image_url, voice_url, reply_to_id, created_at, edited_at, deleted_at,
  profiles!messages_author_id_fkey(handle, name),
  message_reactions(emoji, user_id)
` as const;

const MESSAGES_PAGE_SIZE = 30;

function mapMessageRow(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversation_id: row.conversation_id as string,
    author_id: row.author_id as string | null,
    text: row.text as string | null,
    image_url: row.image_url as string | null,
    voice_url: row.voice_url as string | null,
    reply_to_id: row.reply_to_id as string | null,
    created_at: row.created_at as string,
    edited_at: row.edited_at as string | null,
    deleted_at: row.deleted_at as string | null,
    author: row.profiles as Message['author'],
    reactions: (row.message_reactions ?? []) as Message['reactions'],
  };
}

/** Newest-first pages, `before` is a message's created_at cursor — matches the feed's pagination shape (Phase 5). */
export async function fetchMessages(conversationId: string, before?: string): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapMessageRow);
}

export async function sendMessage(params: {
  conversationId: string;
  authorId: string;
  text?: string;
  imageUrl?: string;
  voiceUrl?: string;
  replyToId?: string;
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: params.conversationId,
      author_id: params.authorId,
      text: params.text ?? null,
      image_url: params.imageUrl ?? null,
      voice_url: params.voiceUrl ?? null,
      reply_to_id: params.replyToId ?? null,
    })
    .select(MESSAGE_SELECT)
    .single();
  if (error) throw error;
  return mapMessageRow(data);
}

export async function markConversationRead(conversationId: string, userId: string) {
  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * DM-only read receipts (see subscribeToMessages's onUpdate note on why
 * per-message read state isn't shown in Room channels — "read by N of M
 * members" is a different, unbuilt feature, not this one degraded).
 * Returns null if the row doesn't exist yet (the other participant has
 * never opened the conversation).
 */
export async function fetchOtherParticipantLastRead(conversationId: string, otherUserId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('last_read_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', otherUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.last_read_at ?? null;
}

export function subscribeToReadReceipt(conversationId: string, otherUserId: string, onChange: (lastReadAt: string | null) => void) {
  const channel = supabase
    .channel(`read-receipt:${conversationId}:${otherUserId}:${uniqueSuffix()}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (payload.new.user_id === otherUserId) onChange(payload.new.last_read_at as string | null);
      },
    )
    .subscribe();

  return () => {
    // Not `return () => supabase.removeChannel(channel)` — that resolves
    // to a Promise, which useEffect's cleanup type (void | Destructor)
    // rejects.
    supabase.removeChannel(channel);
  };
}

/**
 * Keeps the inbox list's previews, ordering, and unread badges live —
 * without this, fetchInbox() only reflects reality when the screen
 * re-focuses (a plain useFocusEffect re-fetch), which is why a new
 * message showed up instantly inside a conversation but not in the list
 * of conversations until navigating away and back.
 *
 * One unfiltered `messages` INSERT subscription, RLS-gated the same way
 * subscribeToMessages() below is — a conversation the caller isn't in
 * never fires this. Triggers a full inbox re-fetch rather than patching
 * one row in place, since a single new message can change both the
 * preview text and the sort order (most-recent-first) at once.
 */
export function subscribeToInbox(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`inbox:${userId}:${uniqueSuffix()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => onChange())
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function addReaction(messageId: string, userId: string, emoji: string) {
  const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
}

export async function removeReaction(messageId: string, userId: string, emoji: string) {
  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji);
  if (error) throw error;
}

/** get-or-create — see start_dm() (20260815001826_start_dm_rpc.sql) for why this needs to be one atomic call. */
export async function startDm(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_dm', { other_user_id: otherUserId });
  if (error) throw error;
  return data as string;
}

/**
 * One Postgres Changes subscription for a conversation's messages, plus
 * message_reactions filtered client-side to that conversation's message
 * ids (Realtime's filter grammar can't express a join, so
 * message_reactions can't be filtered by conversation_id directly the
 * way messages can by conversation_id).
 *
 * RLS gates this the same way it gates a plain SELECT — Supabase
 * authorizes every postgres_changes event against the subscribing
 * user's own policies before delivery, confirmed against current docs
 * before relying on it (see 20260815002450_realtime_publication.sql).
 * A non-participant subscribing to a real conversation id receives
 * nothing, not an error — there's no ack to withhold, since Realtime
 * doesn't tell a subscriber which ids exist.
 */
export function subscribeToMessages(
  conversationId: string,
  handlers: {
    onInsert?: (message: Message) => void;
    onUpdate?: (message: Message) => void;
    onDelete?: (messageId: string) => void;
    onReactionChange?: () => void;
  },
) {
  const channel = supabase
    .channel(`messages:${conversationId}:${uniqueSuffix()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      async (payload) => {
        if (!handlers.onInsert) return;
        // The change payload is the bare row — re-fetch through
        // MESSAGE_SELECT so the author/reactions embeds are populated,
        // same shape as fetchMessages() returns.
        const { data } = await supabase.from('messages').select(MESSAGE_SELECT).eq('id', payload.new.id).single();
        if (data) handlers.onInsert(mapMessageRow(data));
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      async (payload) => {
        if (!handlers.onUpdate) return;
        const { data } = await supabase.from('messages').select(MESSAGE_SELECT).eq('id', payload.new.id).single();
        if (data) handlers.onUpdate(mapMessageRow(data));
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'message_reactions' },
      () => handlers.onReactionChange?.(),
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message_reactions' },
      () => handlers.onReactionChange?.(),
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'message_reactions' },
      () => handlers.onReactionChange?.(),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Typing indicators are Realtime Broadcast, not a table — nothing about
 * "X is typing" is worth persisting or replaying. Deliberately not a
 * `private: true` channel with a realtime.messages RLS policy: per
 * Supabase's current Realtime Authorization docs, Broadcast is public
 * (any authenticated client can send/receive on any channel name) unless
 * a project explicitly disables that — Chasien's local stack uses the
 * default. The leak surface if that default ever changed is small and
 * self-limiting regardless: a channel name is `typing:{conversationId}`,
 * so guessing one still only reveals that *someone* is typing in a
 * conversation whose UUID you'd already have to know, and only while a
 * real participant is actively typing — not the same risk class as
 * `postgres_changes`, which is why that path does still need (and has)
 * table RLS.
 */
export function subscribeToTyping(conversationId: string, onTyping: (userId: string) => void) {
  const channel = supabase
    .channel(`typing:${conversationId}`)
    .on('broadcast', { event: 'typing' }, (payload) => onTyping(payload.payload.userId))
    .subscribe();

  return {
    broadcastTyping: (userId: string) => channel.send({ type: 'broadcast', event: 'typing', payload: { userId } }),
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}
