import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type RoomVisibility = 'public' | 'request' | 'invite';
export type RoomRole = 'owner' | 'mod' | 'member';
export type JoinState = 'pending' | 'approved' | 'invited';

export type Room = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: RoomVisibility;
  accent_color: string | null;
  members_can_post: boolean;
  created_by: string | null;
};

export type Membership = {
  role: RoomRole;
  join_state: JoinState;
};

export type RoomMember = Membership & {
  user_id: string;
  handle: string;
  name: string;
};

// RLS already scopes every query below to what the caller's allowed to
// see (supabase/migrations/20260813051235_row_level_security.sql) — no
// extra filtering needed here beyond what the query itself asks for.

export async function fetchDiscoverRooms() {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, slug, name, description, visibility, accent_color, members_can_post, created_by')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Room[];
}

export async function fetchRoomBySlug(slug: string) {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, slug, name, description, visibility, accent_color, members_can_post, created_by')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data as Room | null;
}

// Takes userId from the caller (already available from useAuth()'s session)
// rather than calling supabase.auth.getUser() internally — that re-verifies
// the JWT against the server on every call, an unnecessary round-trip when
// the session is already known good.
export async function fetchMyMembership(roomId: string, userId: string) {
  const { data, error } = await supabase
    .from('room_memberships')
    .select('role, join_state')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Membership | null;
}

/** Keyed by room_id — one query for every room the caller has any membership
 * row in (approved, pending, or invited), so a room list can look up each
 * room's state without an N+1 query per row. */
export async function fetchMyMembershipMap() {
  const { data, error } = await supabase.from('room_memberships').select('room_id, role, join_state');
  if (error) throw error;
  const map = new Map<string, Membership>();
  for (const row of data ?? []) {
    map.set(row.room_id, { role: row.role, join_state: row.join_state });
  }
  return map;
}

export async function fetchMyRooms() {
  const { data, error } = await supabase
    .from('room_memberships')
    .select('role, join_state, rooms(id, slug, name, description, visibility, accent_color, members_can_post, created_by)')
    .eq('join_state', 'approved');
  if (error) throw error;
  return (data ?? [])
    .map((row) => (row.rooms ? { ...(row.rooms as unknown as Room), myRole: row.role as RoomRole } : null))
    .filter((r): r is Room & { myRole: RoomRole } => r !== null);
}

// Only owners/mods can actually see every row here (RLS: "moderators see
// every membership row in their room") — a plain member's query just
// comes back with their own single row.
export async function fetchRoomMembers(roomId: string) {
  const { data, error } = await supabase
    .from('room_memberships')
    // room_memberships has two FKs to profiles (user_id, invited_by) — a
    // bare `profiles(...)` embed is ambiguous and PostgREST rejects it
    // (PGRST201) regardless of data; naming the FK constraint picks the
    // right one.
    .select('role, join_state, user_id, profiles!room_memberships_user_id_fkey(handle, name)')
    .eq('room_id', roomId)
    .order('role', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    role: row.role,
    join_state: row.join_state,
    user_id: row.user_id,
    handle: (row.profiles as unknown as { handle: string; name: string } | null)?.handle ?? '',
    name: (row.profiles as unknown as { handle: string; name: string } | null)?.name ?? '',
  })) as RoomMember[];
}

export async function createRoom(params: {
  slug: string;
  name: string;
  description: string;
  visibility: RoomVisibility;
  accent_color: string;
}) {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  const { data, error } = await supabase
    .from('rooms')
    .insert({ ...params, created_by: userId })
    .select('id, slug, name, description, visibility, accent_color, members_can_post, created_by')
    .single();
  if (error) throw error;
  return data as Room;
}

export async function updateRoomSettings(
  roomId: string,
  params: Partial<Pick<Room, 'description' | 'visibility' | 'accent_color' | 'members_can_post'>>,
) {
  const { error } = await supabase.from('rooms').update(params).eq('id', roomId);
  if (error) throw error;
}

// Everything below mutates room_memberships, which has no client write
// policies at all — routed through the room-membership Edge Function,
// which applies the actual business rules as code instead. See
// supabase/functions/room-membership/index.ts.

async function callRoomMembership(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('room-membership', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  return data;
}

export function joinRoom(roomId: string) {
  return callRoomMembership({ action: 'join', room_id: roomId });
}

export function respondToRequest(roomId: string, targetUserId: string, approve: boolean) {
  return callRoomMembership({ action: 'respond_to_request', room_id: roomId, target_user_id: targetUserId, approve });
}

export function inviteToRoom(roomId: string, handle: string) {
  return callRoomMembership({ action: 'invite', room_id: roomId, handle });
}

export function respondToInvite(roomId: string, accept: boolean) {
  return callRoomMembership({ action: 'respond_to_invite', room_id: roomId, accept });
}

export function changeRole(roomId: string, targetUserId: string, newRole: RoomRole) {
  return callRoomMembership({ action: 'change_role', room_id: roomId, target_user_id: targetUserId, new_role: newRole });
}
