import { supabase } from '@/lib/supabase';

/**
 * Phase 8. Every row here is created by a database trigger
 * (supabase/migrations/20260902100100_notification_triggers.sql) —
 * `notifications` has no client INSERT policy at all, deliberately, so
 * nothing here ever writes a new notification directly, only reads,
 * marks read, or clears the caller's own rows (all three already have
 * real RLS policies from Phase 1).
 */

export type NotificationType = 'reply' | 'like' | 'mention' | 'join_request' | 'pinned_post' | 'message';

export type AppNotification = {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  actorHandle: string;
  actorName: string;
  room_id: string | null;
  roomSlug: string | null;
  roomName: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  room_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  profiles: { handle: string; name: string } | null;
  rooms: { slug: string; name: string } | null;
};

function toAppNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    actor_id: row.actor_id,
    actorHandle: row.profiles?.handle ?? '',
    actorName: row.profiles?.name ?? 'Someone',
    room_id: row.room_id,
    roomSlug: row.rooms?.slug ?? null,
    roomName: row.rooms?.name ?? null,
    data: row.data,
    read_at: row.read_at,
    created_at: row.created_at,
  };
}

/**
 * `notifications` has TWO foreign keys to `profiles` (user_id the
 * recipient, actor_id who did it) — the same ambiguous-embed trap
 * `posts`/`comments` already hit (see lib/posts.ts's POST_SELECT
 * comment): a bare `profiles(...)` embed is rejected outright by
 * PostgREST with PGRST201, so the constraint must be named.
 */
const NOTIFICATION_SELECT =
  'id, type, actor_id, room_id, data, read_at, created_at, profiles!notifications_actor_id_fkey(handle, name), rooms(slug, name)';

/** Most recent 50 — this is an activity feed, not paginated history; matches the mock's own scope. */
export async function fetchNotifications(userId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as unknown as NotificationRow[]).map(toAppNotification);
}

export async function fetchUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

/** Dismissing a join_request notification (Skip) is separate from clearing it — see respondToRequest in lib/rooms.ts for the actual membership decision. */
export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Live badge count and feed updates — one unfiltered `notifications`
 * INSERT/UPDATE subscription, RLS-gated the same way every other
 * postgres_changes channel in this app already is (see
 * subscribeToInbox()'s comment, lib/chat.ts): a row that isn't the
 * caller's own never fires this, so no `eq('user_id', ...)` filter is
 * needed in the subscription itself.
 */
export function subscribeToNotifications(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`notifications:${userId}:${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => onChange())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, () => onChange())
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/** Mirrors post-media/message-media's pattern: security definer RPC, not a widened posts UPDATE policy — see 20260902100000_notification_preferences_and_pin.sql. */
export async function togglePostPin(postId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.rpc('toggle_post_pin', { p_post_id: postId, p_pinned: pinned });
  if (error) throw error;
}

export async function setRoomNotificationsMuted(roomId: string, userId: string, muted: boolean): Promise<void> {
  const { error } = await supabase
    .from('room_memberships')
    .update({ notifications_muted: muted })
    .eq('room_id', roomId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function fetchRoomNotificationsMuted(roomId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('room_memberships')
    .select('notifications_muted')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.notifications_muted ?? false;
}
