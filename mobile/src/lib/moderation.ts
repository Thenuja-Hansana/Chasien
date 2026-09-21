import { supabase } from '@/lib/supabase';
import { callRoomMembership, type RoomRole } from '@/lib/rooms';

/**
 * Moderation (Phase 9). Every removal goes through a SECURITY DEFINER
 * function in 20260921110100_moderation_tools.sql that applies one rule,
 * can_remove_content(): authors can always remove their own content;
 * otherwise the caller must be an owner/admin/mod who strictly outranks the
 * author in that Room. Removals are soft, and removing someone else's
 * content is logged to moderation_actions with a snapshot.
 *
 * Posts still go through posts.ts's deletePost() (delete_post), which now
 * follows the same rule.
 */

/** Mirrors ROLE_RANK in supabase/functions/room-membership and room_rank() in SQL. */
const ROLE_RANK: Record<RoomRole, number> = { owner: 3, admin: 2, mod: 1, member: 0 };

/**
 * Whether to *offer* a remove option on someone else's content. The server
 * makes the real decision; this just keeps the menus from offering actions
 * that would be refused. An author who isn't a member any more (or a
 * deleted account) has no role and ranks below everyone.
 */
export function outranks(viewerRole: RoomRole | null | undefined, authorRole: RoomRole | null | undefined): boolean {
  if (!viewerRole || ROLE_RANK[viewerRole] < ROLE_RANK.mod) return false;
  return ROLE_RANK[viewerRole] > (authorRole ? ROLE_RANK[authorRole] : -1);
}

export async function removeComment(commentId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_comment', { p_comment_id: commentId });
  if (error) throw error;
}

/** Your own message anywhere (DMs included); someone else's only in a Room chat you moderate. */
export async function removeMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_message', { p_message_id: messageId });
  if (error) throw error;
}

/**
 * Expires the story immediately (RLS then hides it); the hourly
 * cleanup-expired-stories job deletes the row and its media.
 */
export async function removeStory(storyId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_story', { p_story_id: storyId });
  if (error) throw error;
}

/**
 * Stops (or lets again) someone post in one Room chat. The room-membership
 * Edge Function checks the caller is a mod who outranks the target, and logs
 * a mute. The client never had a way to reach this action until Phase 9.
 */
export function setMutedInChat(conversationId: string, targetUserId: string, muted: boolean) {
  return callRoomMembership({ action: 'mute_in_conversation', conversation_id: conversationId, target_user_id: targetUserId, muted });
}

/**
 * Who is muted in one chat (posting_disabled). A participant can see every
 * participant of their conversations under RLS, so this works for anyone
 * in the chat — mods use it for Mute/Unmute, and the viewer's own id being
 * in it means their composer should say so rather than let sends fail.
 */
export async function fetchMutedInChat(conversationId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('posting_disabled', true);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.user_id as string));
}

export type ModerationActionType =
  | 'remove_post'
  | 'remove_comment'
  | 'remove_message'
  | 'remove_story'
  | 'mute_member'
  | 'kick_member'
  | 'ban_user'
  | 'role_change';

export type ModerationEntry = {
  id: string;
  actionType: ModerationActionType;
  actorName: string;
  targetName: string | null;
  /** What was removed, as the server captured it at the time. */
  excerpt: string | null;
  reason: string | null;
  createdAt: string;
};

/** Newest first. RLS lets a Room's owner/admins/mods read its log, and anyone read the actions they took themselves. */
export async function fetchModerationLog(roomId: string): Promise<ModerationEntry[]> {
  const { data, error } = await supabase
    .from('moderation_actions')
    .select(
      'id, action_type, reason, content_snapshot, created_at, actor:profiles!moderation_actions_actor_id_fkey(name), target:profiles!moderation_actions_target_user_id_fkey(name)',
    )
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const actor = row.actor as unknown as { name: string } | null;
    const target = row.target as unknown as { name: string } | null;
    const snapshot = row.content_snapshot as { text?: string | null; caption?: string | null } | null;
    return {
      id: row.id as string,
      actionType: row.action_type as ModerationActionType,
      actorName: actor?.name ?? 'Deleted user',
      targetName: target?.name ?? null,
      excerpt: snapshot?.text ?? snapshot?.caption ?? null,
      reason: row.reason as string | null,
      createdAt: row.created_at as string,
    };
  });
}
