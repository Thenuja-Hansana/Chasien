// Every mutation against room_memberships routes through here — that
// table has zero client write policies by design (see
// supabase/migrations/20260813051235_row_level_security.sql, "── room_memberships").
// Business rules (who can approve a request, ownership-transfer ordering,
// etc.) live here as code, not as RLS boolean expressions on the one
// table where getting that wrong is a real privacy leak.

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

type Action =
  | { action: 'join'; room_id: string }
  | { action: 'respond_to_request'; room_id: string; target_user_id: string; approve: boolean }
  | { action: 'invite'; room_id: string; handle: string }
  | { action: 'respond_to_invite'; room_id: string; accept: boolean }
  | { action: 'change_role'; room_id: string; target_user_id: string; new_role: 'owner' | 'mod' | 'member' };

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
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});

type AdminClient = ReturnType<typeof createClient>;

async function getMembership(admin: AdminClient, roomId: string, userId: string) {
  const { data } = await admin
    .from('room_memberships')
    .select('role, join_state')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  return data as { role: string; join_state: string } | null;
}

async function requireModerator(admin: AdminClient, roomId: string, userId: string) {
  const membership = await getMembership(admin, roomId, userId);
  if (!membership || membership.join_state !== 'approved' || !['owner', 'mod'].includes(membership.role)) {
    return false;
  }
  return true;
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
    return json({ error: 'Only an owner or mod can respond to join requests.' }, 403);
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
    return json({ error: 'Only an owner or mod can invite people.' }, 403);
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
  newRole: 'owner' | 'mod' | 'member',
) {
  const caller = await getMembership(admin, roomId, callerId);
  if (!caller || caller.join_state !== 'approved' || caller.role !== 'owner') {
    return json({ error: 'Only the Room owner can change roles.' }, 403);
  }

  const target = await getMembership(admin, roomId, targetUserId);
  if (!target || target.join_state !== 'approved') {
    return json({ error: 'That user is not an approved member of this Room.' }, 404);
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

    return json({ ok: true });
  }

  if (targetUserId === callerId) {
    return json({ error: "Transfer ownership to demote yourself — you can't demote the only owner." }, 400);
  }

  const { error } = await admin
    .from('room_memberships')
    .update({ role: newRole })
    .eq('room_id', roomId)
    .eq('user_id', targetUserId);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}
