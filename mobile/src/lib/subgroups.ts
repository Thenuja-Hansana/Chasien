import { callRoomMembership } from '@/lib/rooms';
import { supabase } from '@/lib/supabase';

export type SubgroupVisibility = 'public' | 'request' | 'invite';
export type SubgroupJoinState = 'pending' | 'approved' | 'invited';

export type Subgroup = {
  id: string;
  room_id: string;
  name: string;
  description: string | null;
  visibility: SubgroupVisibility;
  member_count: number;
};

export type SubgroupParticipation = {
  join_state: SubgroupJoinState;
  banned: boolean;
  posting_disabled: boolean;
};

/**
 * Every sub-group in a Room, joined or not — "sub-group visibility is
 * independent of sub-group membership" (Discover/All Groups), backed by
 * the RLS policy letting any approved Room member see every channel in
 * their Room (20260907120000_inbox_subgroup_columns.sql). Sorted by
 * size, same convention as rooms.member_count-backed lists.
 */
export async function fetchRoomSubgroups(roomId: string): Promise<Subgroup[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, room_id, name, description, visibility, member_count')
    .eq('room_id', roomId)
    .eq('kind', 'room_channel')
    .eq('is_default', false)
    .order('member_count', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data as Subgroup[];
}

/**
 * The caller's own participation row for each of the given sub-groups,
 * keyed by conversation_id — including a pending request or an
 * unaccepted invite, neither of which my_inbox surfaces (it only
 * includes approved, non-banned rows). Discover needs this to render
 * "Join" vs "Requested" vs "Invited" vs "Joined" per row.
 */
export async function fetchMySubgroupParticipations(
  subgroupIds: string[],
  userId: string,
): Promise<Map<string, SubgroupParticipation>> {
  const map = new Map<string, SubgroupParticipation>();
  if (subgroupIds.length === 0) return map;

  const { data, error } = await supabase
    .from('conversation_participants')
    .select('conversation_id, join_state, banned, posting_disabled')
    .eq('user_id', userId)
    .in('conversation_id', subgroupIds);
  if (error) throw error;

  for (const row of data ?? []) {
    map.set(row.conversation_id, { join_state: row.join_state, banned: row.banned, posting_disabled: row.posting_disabled });
  }
  return map;
}

// Everything below mutates conversation_participants/conversations for a
// sub-group, neither of which has a client write policy for this —
// routed through the same room-membership Edge Function room_memberships
// itself uses, which applies the actual business rules as code. See
// supabase/functions/room-membership/index.ts.

export function createSubgroup(roomId: string, name: string, visibility: SubgroupVisibility, description?: string) {
  return callRoomMembership({ action: 'create_subgroup', room_id: roomId, name, visibility, description });
}

export function joinSubgroup(conversationId: string) {
  return callRoomMembership({ action: 'join_subgroup', conversation_id: conversationId });
}

export function respondToSubgroupInvite(conversationId: string, accept: boolean) {
  return callRoomMembership({ action: 'respond_to_subgroup_invite', conversation_id: conversationId, accept });
}
