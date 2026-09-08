import { supabase } from '@/lib/supabase';

export type FriendshipStatus = 'none' | 'pending_sent' | 'pending_received' | 'friends';

export type Friend = { id: string; handle: string; name: string };

/** friendships.user_a/user_b are stored in canonical sorted order (user_a < user_b), same convention conversations.dm_user_a/dm_user_b already uses. */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * `myId` isn't the caller's session id by construction — every call site
 * already has it from useAuth(), and passing it explicitly keeps this
 * module free of any auth dependency of its own.
 */
export async function fetchFriendshipStatus(myId: string, otherId: string): Promise<FriendshipStatus> {
  const [user_a, user_b] = orderedPair(myId, otherId);
  const { data, error } = await supabase.from('friendships').select('status, requested_by').eq('user_a', user_a).eq('user_b', user_b).maybeSingle();
  if (error) throw error;
  if (!data) return 'none';
  if (data.status === 'accepted') return 'friends';
  return data.requested_by === myId ? 'pending_sent' : 'pending_received';
}

export async function sendFriendRequest(myId: string, otherId: string): Promise<void> {
  const [user_a, user_b] = orderedPair(myId, otherId);
  const { error } = await supabase.from('friendships').insert({ user_a, user_b, requested_by: myId });
  if (error) throw error;
}

/** Accept a pending request the other person sent you — rejected by RLS if you were the one who sent it. */
export async function acceptFriendRequest(myId: string, otherId: string): Promise<void> {
  const [user_a, user_b] = orderedPair(myId, otherId);
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('user_a', user_a).eq('user_b', user_b);
  if (error) throw error;
}

/** Same delete covers three different actions depending on the row's current state: cancelling your own pending request, declining someone else's, or unfriending an accepted one. */
export async function removeFriendship(myId: string, otherId: string): Promise<void> {
  const [user_a, user_b] = orderedPair(myId, otherId);
  const { error } = await supabase.from('friendships').delete().eq('user_a', user_a).eq('user_b', user_b);
  if (error) throw error;
}

const FRIEND_SELECT = 'user_a, user_b, a:profiles!friendships_user_a_fkey(id, handle, name), b:profiles!friendships_user_b_fkey(id, handle, name)';

/** Every accepted friendship a profile has — visible for any profile, not just your own (accepted rows are public, see the friendships RLS policy). */
export async function fetchFriends(userId: string): Promise<Friend[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select(FRIEND_SELECT)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('status', 'accepted');
  if (error) throw error;

  return ((data ?? []) as unknown as { user_a: string; a: Friend; b: Friend }[]).map((row) => (row.user_a === userId ? row.b : row.a));
}

export async function fetchFriendCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('friendships')
    .select('user_a', { count: 'exact', head: true })
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .eq('status', 'accepted');
  if (error) throw error;
  return count ?? 0;
}
