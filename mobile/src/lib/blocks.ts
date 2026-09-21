import { supabase } from '@/lib/supabase';

/**
 * Blocking (Phase 9). Enforcement is entirely server-side —
 * 20260921100000_block_enforcement.sql hides posts, comments, stories and
 * likes between the two people in RLS, cuts DMs and friend requests off
 * both ways, and drops notifications between them. Nothing here needs to
 * filter content itself; screens just refetch after a block.
 *
 * The one exception is Room group chats, which the server deliberately
 * leaves alone (hiding messages there leaves gaps and orphaned replies):
 * the blocker's chat collapses the blocked person's messages using
 * fetchBlockedIds().
 */

/** 'blocking' = I blocked them (wins if it's mutual); 'blocked_by' = they blocked me. */
export type BlockStatus = 'none' | 'blocking' | 'blocked_by';

export type BlockedUser = { id: string; handle: string; name: string; blockedAt: string };

/** block_user() also ends the friendship, removes tags between the two and clears their notifications, atomically. */
export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_user_id: userId });
  if (error) throw error;
}

/**
 * A direct delete rather than an RPC: it's one row, and the blocks DELETE
 * policy already limits it to the caller's own blocks. Nothing a block
 * removed (friendship, tags, notifications) comes back.
 */
export async function unblockUser(myId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', myId).eq('blocked_id', userId);
  if (error) throw error;
}

/** Only ever answers about the caller — see block_status() and why blocked_pair() isn't callable. */
export async function fetchBlockStatus(userId: string): Promise<BlockStatus> {
  const { data, error } = await supabase.rpc('block_status', { p_other: userId });
  if (error) throw error;
  return data as BlockStatus;
}

/** People the viewer has blocked, newest first. RLS returns only the viewer's own blocks. */
export async function fetchBlockedUsers(myId: string): Promise<BlockedUser[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id, created_at, profile:profiles!blocks_blocked_id_fkey(handle, name)')
    .eq('blocker_id', myId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = row.profile as unknown as { handle: string; name: string } | null;
    return {
      id: row.blocked_id as string,
      handle: profile?.handle ?? 'unknown',
      name: profile?.name ?? 'Deleted user',
      blockedAt: row.created_at as string,
    };
  });
}

/** Just the ids, for collapsing a blocked person's messages in a Room group chat. */
export async function fetchBlockedIds(myId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', myId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.blocked_id as string));
}
