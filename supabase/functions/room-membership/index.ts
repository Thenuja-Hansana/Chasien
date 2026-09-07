// Every mutation against room_memberships routes through here — that
// table has zero client write policies by design (see
// supabase/migrations/20260813051235_row_level_security.sql, "── room_memberships").
// Business rules (who can approve a request, ownership-transfer ordering,
// etc.) live here as code, not as RLS boolean expressions on the one
// table where getting that wrong is a real privacy leak.
//
// Sub-group membership (conversation_participants for a non-default
// room_channel conversation) follows the exact same discipline, for the
// same reason — see the 20260905140xxx/150000 migrations for why that
// table also has no insert/delete policy for regular users. A sub-group
// visibility ('public' | 'request' | 'invite') mirrors rooms.visibility
// on purpose, so its join/invite/request flows below are the same
// shape as the Room ones already proven out.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type RoomRole = 'owner' | 'admin' | 'mod' | 'member';
type Visibility = 'public' | 'request' | 'invite';

type Action =
  | { action: 'join'; room_id: string }
  | { action: 'respond_to_request'; room_id: string; target_user_id: string; approve: boolean }
  | { action: 'invite'; room_id: string; handle: string }
  | { action: 'respond_to_invite'; room_id: string; accept: boolean }
  | { action: 'change_role'; room_id: string; target_user_id: string; new_role: RoomRole }
  | { action: 'leave'; room_id: string }
  | { action: 'remove_from_room'; room_id: string; target_user_id: string }
  | { action: 'create_subgroup'; room_id: string; name: string; description?: string; visibility: Visibility }
  | { action: 'update_subgroup'; room_id: string; conversation_id: string; name?: string; description?: string; visibility?: Visibility }
  | { action: 'delete_subgroup'; room_id: string; conversation_id: string }
  | { action: 'join_subgroup'; conversation_id: string }
  | { action: 'leave_subgroup'; conversation_id: string }
  | { action: 'invite_to_subgroup'; conversation_id: string; handle: string }
  | { action: 'respond_to_subgroup_request'; conversation_id: string; target_user_id: string; approve: boolean }
  | { action: 'respond_to_subgroup_invite'; conversation_id: string; accept: boolean }
  | { action: 'remove_from_subgroup'; conversation_id: string; target_user_id: string; ban?: boolean }
  | { action: 'mute_in_conversation'; conversation_id: string; target_user_id: string; muted: boolean };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identifies the caller from their own JWT — never trusted from the
  // request body, since a client could otherwise claim to be anyone.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  // Bypasses RLS entirely — every write below is gated by the business
  // logic in this function instead, not by a policy on the table.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: Action;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  switch (body.action) {
    case 'join':
      return handleJoin(admin, user.id, body.room_id);
    case 'respond_to_request':
      return handleRespondToRequest(admin, user.id, body.room_id, body.target_user_id, body.approve);
    case 'invite':
      return handleInvite(admin, user.id, body.room_id, body.handle);
    case 'respond_to_invite':
      return handleRespondToInvite(admin, user.id, body.room_id, body.accept);
    case 'change_role':
      return handleChangeRole(admin, user.id, body.room_id, body.target_user_id, body.new_role);
    case 'leave':
      return handleLeave(admin, user.id, body.room_id);
    case 'remove_from_room':
      return handleRemoveFromRoom(admin, user.id, body.room_id, body.target_user_id);
    case 'create_subgroup':
      return handleCreateSubgroup(admin, user.id, body.room_id, body.name, body.description, body.visibility);
    case 'update_subgroup':
      return handleUpdateSubgroup(admin, user.id, body.room_id, body.conversation_id, body);
    case 'delete_subgroup':
      return handleDeleteSubgroup(admin, user.id, body.room_id, body.conversation_id);
    case 'join_subgroup':
      return handleJoinSubgroup(admin, user.id, body.conversation_id);
    case 'leave_subgroup':
      return handleLeaveSubgroup(admin, user.id, body.conversation_id);
    case 'invite_to_subgroup':
      return handleInviteToSubgroup(admin, user.id, body.conversation_id, body.handle);
    case 'respond_to_subgroup_request':
      return handleRespondToSubgroupRequest(admin, user.id, body.conversation_id, body.target_user_id, body.approve);
    case 'respond_to_subgroup_invite':
      return handleRespondToSubgroupInvite(admin, user.id, body.conversation_id, body.accept);
    case 'remove_from_subgroup':
      return handleRemoveFromSubgroup(admin, user.id, body.conversation_id, body.target_user_id, !!body.ban);
    case 'mute_in_conversation':
      return handleMuteInConversation(admin, user.id, body.conversation_id, body.target_user_id, body.muted);
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});

type AdminClient = ReturnType<typeof createClient>;

// owner > admin > mod > member — used for "can caller act on this
// target/assign this role" rank comparisons, rather than hardcoded
// role-name checks, so a future custom-role system only has to change
// this map, not every call site.
const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, mod: 1, member: 0 };

async function getMembership(admin: AdminClient, roomId: string, userId: string) {
  const { data } = await admin
    .from('room_memberships')
    .select('role, join_state')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  return data as { role: RoomRole; join_state: string } | null;
}

async function requireMember(admin: AdminClient, roomId: string, userId: string) {
  const membership = await getMembership(admin, roomId, userId);
  return !!membership && membership.join_state === 'approved';
}

async function requireModerator(admin: AdminClient, roomId: string, userId: string) {
  const membership = await getMembership(admin, roomId, userId);
  return !!membership && membership.join_state === 'approved' && ['owner', 'admin', 'mod'].includes(membership.role);
}

async function requireAdmin(admin: AdminClient, roomId: string, userId: string) {
  const membership = await getMembership(admin, roomId, userId);
  return !!membership && membership.join_state === 'approved' && ['owner', 'admin'].includes(membership.role);
}

// Sub-group moderation (mute, remove/ban) inherits Community rank, same
// as everything else about a sub-group — a mod passes requireModerator
// but must still not be able to act on an admin or the owner; an admin
// must still not be able to act on another admin or the owner.
async function callerOutranksTarget(admin: AdminClient, roomId: string, callerId: string, targetId: string) {
  const caller = await getMembership(admin, roomId, callerId);
  const target = await getMembership(admin, roomId, targetId);
  if (!caller || !target) return false;
  return ROLE_RANK[caller.role] > ROLE_RANK[target.role];
}

// mute_member/kick_member/ban_user/role_change already exist on
// moderation_action_type (20260813051229_trust_and_safety.sql) — this
// just starts writing to a table that was anticipating exactly this.
// Best-effort: a logging failure shouldn't undo an otherwise-successful
// moderation action, so its error is swallowed rather than propagated.
async function logModerationAction(
  admin: AdminClient,
  params: { roomId: string; actorId: string; actionType: string; targetUserId: string; reason?: string },
) {
  await admin.from('moderation_actions').insert({
    room_id: params.roomId,
    actor_id: params.actorId,
    action_type: params.actionType,
    target_user_id: params.targetUserId,
    reason: params.reason ?? null,
  });
}

async function handleJoin(admin: AdminClient, userId: string, roomId: string) {
  const { data: room } = await admin.from('rooms').select('id, visibility').eq('id', roomId).maybeSingle();
  if (!room) return json({ error: 'Room not found.' }, 404);

  const existing = await getMembership(admin, roomId, userId);
  if (existing) {
    return json({ error: `Already ${existing.join_state} for this Room.`, membership: existing }, 409);
  }

  if (room.visibility === 'invite') {
    return json({ error: 'This Room is invite-only — ask a member for an invite.' }, 403);
  }

  const join_state = room.visibility === 'public' ? 'approved' : 'pending';
  const { data, error } = await admin
    .from('room_memberships')
    .insert({ room_id: roomId, user_id: userId, role: 'member', join_state })
    .select('role, join_state')
    .single();

  if (error) return json({ error: error.message }, 400);
  return json({ membership: data });
}

async function handleRespondToRequest(
  admin: AdminClient,
  callerId: string,
  roomId: string,
  targetUserId: string,
  approve: boolean,
) {
  if (!(await requireModerator(admin, roomId, callerId))) {
    return json({ error: 'Only an owner, admin, or mod can respond to join requests.' }, 403);
  }

  const target = await getMembership(admin, roomId, targetUserId);
  if (!target || target.join_state !== 'pending') {
    return json({ error: 'No pending request from that user.' }, 404);
  }

  if (approve) {
    const { error } = await admin
      .from('room_memberships')
      .update({ join_state: 'approved' })
      .eq('room_id', roomId)
      .eq('user_id', targetUserId);
    if (error) return json({ error: error.message }, 400);
  } else {
    const { error } = await admin
      .from('room_memberships')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', targetUserId);
    if (error) return json({ error: error.message }, 400);
  }

  return json({ ok: true });
}

async function handleInvite(admin: AdminClient, callerId: string, roomId: string, handle: string) {
  if (!(await requireModerator(admin, roomId, callerId))) {
    return json({ error: 'Only an owner, admin, or mod can invite people.' }, 403);
  }

  const { data: target } = await admin.from('profiles').select('id').eq('handle', handle).maybeSingle();
  if (!target) return json({ error: `No user with handle "${handle}".` }, 404);

  const existing = await getMembership(admin, roomId, target.id);
  if (existing) {
    return json({ error: `That user is already ${existing.join_state} for this Room.` }, 409);
  }

  const { data, error } = await admin
    .from('room_memberships')
    .insert({ room_id: roomId, user_id: target.id, role: 'member', join_state: 'invited', invited_by: callerId })
    .select('role, join_state')
    .single();

  if (error) return json({ error: error.message }, 400);
  return json({ membership: data });
}

async function handleRespondToInvite(admin: AdminClient, userId: string, roomId: string, accept: boolean) {
  const membership = await getMembership(admin, roomId, userId);
  if (!membership || membership.join_state !== 'invited') {
    return json({ error: 'No pending invite to this Room.' }, 404);
  }

  if (accept) {
    const { error } = await admin
      .from('room_memberships')
      .update({ join_state: 'approved' })
      .eq('room_id', roomId)
      .eq('user_id', userId);
    if (error) return json({ error: error.message }, 400);
  } else {
    const { error } = await admin.from('room_memberships').delete().eq('room_id', roomId).eq('user_id', userId);
    if (error) return json({ error: error.message }, 400);
  }

  return json({ ok: true });
}

async function handleChangeRole(
  admin: AdminClient,
  callerId: string,
  roomId: string,
  targetUserId: string,
  newRole: RoomRole,
) {
  const caller = await getMembership(admin, roomId, callerId);
  if (!caller || caller.join_state !== 'approved' || !['owner', 'admin'].includes(caller.role)) {
    return json({ error: 'Only an owner or admin can change roles.' }, 403);
  }

  const target = await getMembership(admin, roomId, targetUserId);
  if (!target || target.join_state !== 'approved') {
    return json({ error: 'That user is not an approved member of this Room.' }, 404);
  }

  // An admin can only appoint/demote strictly below their own rank, and
  // can't touch another admin's (or the owner's) role at all — only the
  // owner can assign 'admin' or transfer ownership.
  if (caller.role === 'admin') {
    if (newRole === 'owner' || newRole === 'admin') {
      return json({ error: 'Only the owner can assign the admin role or transfer ownership.' }, 403);
    }
    if (ROLE_RANK[target.role] >= ROLE_RANK.admin) {
      return json({ error: "An admin can't change another admin's or the owner's role." }, 403);
    }
  }

  if (newRole === 'owner') {
    if (targetUserId === callerId) return json({ error: 'You already own this Room.' }, 400);

    // one_owner_per_room is a partial unique index, not a deferrable
    // constraint (see the migration's comment) — the old owner MUST be
    // demoted in its own statement before the new owner is promoted, or
    // the promote step violates the index while both rows are 'owner'.
    const { error: demoteError } = await admin
      .from('room_memberships')
      .update({ role: 'member' })
      .eq('room_id', roomId)
      .eq('user_id', callerId);
    if (demoteError) return json({ error: demoteError.message }, 400);

    const { error: promoteError } = await admin
      .from('room_memberships')
      .update({ role: 'owner' })
      .eq('room_id', roomId)
      .eq('user_id', targetUserId);
    if (promoteError) return json({ error: promoteError.message }, 400);

    await logModerationAction(admin, { roomId, actorId: callerId, actionType: 'role_change', targetUserId, reason: 'ownership transfer' });
    return json({ ok: true });
  }

  // Only owner-uniqueness makes self-demotion special-cased — an admin
  // demoting themselves to mod/member doesn't threaten anything, so it's
  // allowed through the same path as any other target.
  if (targetUserId === callerId && caller.role === 'owner') {
    return json({ error: "Transfer ownership to demote yourself — you can't demote the only owner." }, 400);
  }

  const { error } = await admin
    .from('room_memberships')
    .update({ role: newRole })
    .eq('room_id', roomId)
    .eq('user_id', targetUserId);
  if (error) return json({ error: error.message }, 400);

  await logModerationAction(admin, { roomId, actorId: callerId, actionType: 'role_change', targetUserId, reason: `role set to ${newRole}` });
  return json({ ok: true });
}

// Deleting the row is enough on its own — promote_next_owner_on_owner_
// departure (20260905140500) auto-succeeds an owner's departure, and
// sync_channel_participants_on_membership_change's DELETE branch
// (20260813051209_chat.sql) already clears every one of the Room's
// channels, General and every sub-group alike.
async function handleLeave(admin: AdminClient, userId: string, roomId: string) {
  const membership = await getMembership(admin, roomId, userId);
  if (!membership || membership.join_state !== 'approved') {
    return json({ error: 'You are not a member of this Room.' }, 404);
  }

  if (membership.role === 'owner') {
    const { count } = await admin
      .from('room_memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('room_id', roomId)
      .eq('join_state', 'approved')
      .neq('user_id', userId);
    if (!count) {
      return json({ error: "You're the only member — delete the Room instead of leaving it." }, 400);
    }
  }

  const { error } = await admin.from('room_memberships').delete().eq('room_id', roomId).eq('user_id', userId);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

// Community-level removal (not just one sub-group) — Admin-and-above
// only, per 5.2's Admin description ("remove members"); a Moderator's
// removal power (matrix 5.3) only ever reaches as far as a sub-group,
// via remove_from_subgroup below.
async function handleRemoveFromRoom(admin: AdminClient, callerId: string, roomId: string, targetUserId: string) {
  if (!(await requireAdmin(admin, roomId, callerId))) {
    return json({ error: 'Only an owner or admin can remove someone from the Community.' }, 403);
  }
  if (targetUserId === callerId) {
    return json({ error: 'Use "leave" to remove yourself.' }, 400);
  }

  const target = await getMembership(admin, roomId, targetUserId);
  if (!target || target.join_state !== 'approved') {
    return json({ error: 'That user is not an approved member of this Room.' }, 404);
  }
  if (target.role === 'owner') {
    return json({ error: "The owner can't be removed." }, 403);
  }
  // An admin can't remove another admin — same rank rule change_role uses.
  if ((await getMembership(admin, roomId, callerId))!.role === 'admin' && target.role === 'admin') {
    return json({ error: "An admin can't remove another admin." }, 403);
  }

  const { error } = await admin.from('room_memberships').delete().eq('room_id', roomId).eq('user_id', targetUserId);
  if (error) return json({ error: error.message }, 400);

  await logModerationAction(admin, { roomId, actorId: callerId, actionType: 'kick_member', targetUserId });
  return json({ ok: true });
}

// ── sub-groups ──────────────────────────────────────────────────────────

async function getSubgroup(admin: AdminClient, conversationId: string) {
  const { data } = await admin
    .from('conversations')
    .select('id, room_id, kind, is_default, visibility, name')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || data.kind !== 'room_channel' || data.is_default) return null;
  return data as { id: string; room_id: string; kind: string; is_default: boolean; visibility: Visibility; name: string };
}

// Broader than getSubgroup — used only by mute_in_conversation, the one
// action that legitimately applies to General too (muting someone from
// posting in General doesn't remove them from the Community, unlike
// remove_from_room above).
async function getRoomChannel(admin: AdminClient, conversationId: string) {
  const { data } = await admin
    .from('conversations')
    .select('id, room_id, kind')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || data.kind !== 'room_channel') return null;
  return data as { id: string; room_id: string; kind: string };
}

async function getConversationParticipant(admin: AdminClient, conversationId: string, userId: string) {
  const { data } = await admin
    .from('conversation_participants')
    .select('join_state, banned, posting_disabled')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();
  return data as { join_state: string; banned: boolean; posting_disabled: boolean } | null;
}

async function handleCreateSubgroup(
  admin: AdminClient,
  callerId: string,
  roomId: string,
  name: string,
  description: string | undefined,
  visibility: Visibility,
) {
  if (!(await requireAdmin(admin, roomId, callerId))) {
    return json({ error: 'Only an owner or admin can create a sub-group.' }, 403);
  }
  const trimmed = name?.trim();
  if (!trimmed) {
    return json({ error: 'A sub-group needs a name.' }, 400);
  }

  const { data: conversation, error } = await admin
    .from('conversations')
    .insert({ kind: 'room_channel', room_id: roomId, name: trimmed, description: description ?? null, visibility, is_default: false })
    .select('id, name, description, visibility, member_count')
    .single();
  if (error) {
    if (error.code === '23505') return json({ error: `A sub-group named "${trimmed}" already exists in this Room.` }, 409);
    return json({ error: error.message }, 400);
  }

  // The creator becomes the sub-group's first participant here,
  // atomically — a plain client insert can't do this itself (RLS's
  // read-back of the row it just created would fail, since nobody is a
  // participant of a brand-new sub-group yet).
  const { error: participantError } = await admin
    .from('conversation_participants')
    .insert({ conversation_id: conversation.id, user_id: callerId, join_state: 'approved' });
  if (participantError) return json({ error: participantError.message }, 400);

  // conversation was fetched before the participant insert above (the
  // trigger that bumps member_count hadn't run yet), so it still reads
  // 0 — the creator is the sub-group's first member, so 1 is what the
  // row actually holds now.
  return json({ subgroup: { ...conversation, member_count: 1 } });
}

async function handleUpdateSubgroup(
  admin: AdminClient,
  callerId: string,
  roomId: string,
  conversationId: string,
  updates: { name?: string; description?: string; visibility?: Visibility },
) {
  if (!(await requireAdmin(admin, roomId, callerId))) {
    return json({ error: 'Only an owner or admin can update a sub-group.' }, 403);
  }
  const subgroup = await getSubgroup(admin, conversationId);
  if (!subgroup || subgroup.room_id !== roomId) {
    return json({ error: 'Sub-group not found in this Room.' }, 404);
  }

  const patch: Record<string, unknown> = {};
  if (updates.name !== undefined) patch.name = updates.name.trim();
  if (updates.description !== undefined) patch.description = updates.description;
  if (updates.visibility !== undefined) patch.visibility = updates.visibility;

  const { error } = await admin.from('conversations').update(patch).eq('id', conversationId);
  if (error) {
    if (error.code === '23505') return json({ error: 'A sub-group with that name already exists in this Room.' }, 409);
    return json({ error: error.message }, 400);
  }
  return json({ ok: true });
}

async function handleDeleteSubgroup(admin: AdminClient, callerId: string, roomId: string, conversationId: string) {
  if (!(await requireAdmin(admin, roomId, callerId))) {
    return json({ error: 'Only an owner or admin can delete a sub-group.' }, 403);
  }
  const subgroup = await getSubgroup(admin, conversationId);
  if (!subgroup || subgroup.room_id !== roomId) {
    return json({ error: 'Sub-group not found in this Room.' }, 404);
  }
  const { error } = await admin.from('conversations').delete().eq('id', conversationId);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function handleJoinSubgroup(admin: AdminClient, userId: string, conversationId: string) {
  const subgroup = await getSubgroup(admin, conversationId);
  if (!subgroup) return json({ error: 'Sub-group not found.' }, 404);

  if (!(await requireMember(admin, subgroup.room_id, userId))) {
    return json({ error: 'You must be a Community member to join its sub-groups.' }, 403);
  }

  const existing = await getConversationParticipant(admin, conversationId, userId);
  if (existing) {
    if (existing.banned) return json({ error: "You've been removed from this sub-group and can't rejoin." }, 403);
    return json({ error: `Already ${existing.join_state} in this sub-group.`, participant: existing }, 409);
  }

  if (subgroup.visibility === 'invite') {
    return json({ error: 'This sub-group is invite-only — ask a member for an invite.' }, 403);
  }

  const join_state = subgroup.visibility === 'public' ? 'approved' : 'pending';
  const { data, error } = await admin
    .from('conversation_participants')
    .insert({ conversation_id: conversationId, user_id: userId, join_state })
    .select('join_state')
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ participant: data });
}

async function handleLeaveSubgroup(admin: AdminClient, userId: string, conversationId: string) {
  const subgroup = await getSubgroup(admin, conversationId);
  if (!subgroup) return json({ error: 'Sub-group not found.' }, 404);

  const { error } = await admin
    .from('conversation_participants')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function handleInviteToSubgroup(admin: AdminClient, callerId: string, conversationId: string, handle: string) {
  const subgroup = await getSubgroup(admin, conversationId);
  if (!subgroup) return json({ error: 'Sub-group not found.' }, 404);
  if (!(await requireModerator(admin, subgroup.room_id, callerId))) {
    return json({ error: 'Only an owner, admin, or moderator can invite people to a sub-group.' }, 403);
  }

  const { data: target } = await admin.from('profiles').select('id').eq('handle', handle).maybeSingle();
  if (!target) return json({ error: `No user with handle "${handle}".` }, 404);

  if (!(await requireMember(admin, subgroup.room_id, target.id))) {
    return json({ error: 'That user must be a Community member before they can be invited to a sub-group.' }, 400);
  }

  const existing = await getConversationParticipant(admin, conversationId, target.id);
  if (existing) {
    return json({ error: `That user is already ${existing.join_state} for this sub-group.` }, 409);
  }

  const { data, error } = await admin
    .from('conversation_participants')
    .insert({ conversation_id: conversationId, user_id: target.id, join_state: 'invited' })
    .select('join_state')
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ participant: data });
}

async function handleRespondToSubgroupRequest(
  admin: AdminClient,
  callerId: string,
  conversationId: string,
  targetUserId: string,
  approve: boolean,
) {
  const subgroup = await getSubgroup(admin, conversationId);
  if (!subgroup) return json({ error: 'Sub-group not found.' }, 404);
  if (!(await requireModerator(admin, subgroup.room_id, callerId))) {
    return json({ error: 'Only an owner, admin, or moderator can respond to a sub-group join request.' }, 403);
  }

  const target = await getConversationParticipant(admin, conversationId, targetUserId);
  if (!target || target.join_state !== 'pending') {
    return json({ error: 'No pending request from that user.' }, 404);
  }

  if (approve) {
    const { error } = await admin
      .from('conversation_participants')
      .update({ join_state: 'approved' })
      .eq('conversation_id', conversationId)
      .eq('user_id', targetUserId);
    if (error) return json({ error: error.message }, 400);
  } else {
    const { error } = await admin
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', targetUserId);
    if (error) return json({ error: error.message }, 400);
  }
  return json({ ok: true });
}

async function handleRespondToSubgroupInvite(admin: AdminClient, userId: string, conversationId: string, accept: boolean) {
  const membership = await getConversationParticipant(admin, conversationId, userId);
  if (!membership || membership.join_state !== 'invited') {
    return json({ error: 'No pending invite to this sub-group.' }, 404);
  }

  if (accept) {
    const { error } = await admin
      .from('conversation_participants')
      .update({ join_state: 'approved' })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) return json({ error: error.message }, 400);
  } else {
    const { error } = await admin
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) return json({ error: error.message }, 400);
  }
  return json({ ok: true });
}

async function handleRemoveFromSubgroup(
  admin: AdminClient,
  callerId: string,
  conversationId: string,
  targetUserId: string,
  ban: boolean,
) {
  const subgroup = await getSubgroup(admin, conversationId);
  if (!subgroup) return json({ error: 'Sub-group not found.' }, 404);
  if (!(await requireModerator(admin, subgroup.room_id, callerId))) {
    return json({ error: 'Only an owner, admin, or moderator can remove someone from a sub-group.' }, 403);
  }
  if (!(await callerOutranksTarget(admin, subgroup.room_id, callerId, targetUserId))) {
    return json({ error: "You can't remove a member with an equal or higher Community role." }, 403);
  }

  const target = await getConversationParticipant(admin, conversationId, targetUserId);
  if (!target) return json({ error: 'That user is not in this sub-group.' }, 404);

  if (ban) {
    const { error } = await admin
      .from('conversation_participants')
      .update({ banned: true })
      .eq('conversation_id', conversationId)
      .eq('user_id', targetUserId);
    if (error) return json({ error: error.message }, 400);
  } else {
    const { error } = await admin
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', targetUserId);
    if (error) return json({ error: error.message }, 400);
  }

  await logModerationAction(admin, {
    roomId: subgroup.room_id,
    actorId: callerId,
    actionType: ban ? 'ban_user' : 'kick_member',
    targetUserId,
  });
  return json({ ok: true });
}

// The one moderation action that applies to General as well as a
// sub-group — see getRoomChannel's comment above.
async function handleMuteInConversation(
  admin: AdminClient,
  callerId: string,
  conversationId: string,
  targetUserId: string,
  muted: boolean,
) {
  const channel = await getRoomChannel(admin, conversationId);
  if (!channel) return json({ error: 'Conversation not found.' }, 404);
  if (!(await requireModerator(admin, channel.room_id, callerId))) {
    return json({ error: 'Only an owner, admin, or moderator can mute someone here.' }, 403);
  }
  if (!(await callerOutranksTarget(admin, channel.room_id, callerId, targetUserId))) {
    return json({ error: "You can't mute a member with an equal or higher Community role." }, 403);
  }

  const target = await getConversationParticipant(admin, conversationId, targetUserId);
  if (!target) return json({ error: 'That user is not in this conversation.' }, 404);

  const { error } = await admin
    .from('conversation_participants')
    .update({ posting_disabled: muted })
    .eq('conversation_id', conversationId)
    .eq('user_id', targetUserId);
  if (error) return json({ error: error.message }, 400);

  if (muted) {
    await logModerationAction(admin, { roomId: channel.room_id, actorId: callerId, actionType: 'mute_member', targetUserId });
  }
  return json({ ok: true });
}
