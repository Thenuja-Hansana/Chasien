// Every Edge Function action, called by someone who shouldn't be able to.
//
// The Edge Functions run as the service role, so nothing in the database
// stops them: the check that the caller may do this lives in each
// function's own code. This calls each action as an outsider, a plain
// member and a mod, and expects a refusal with a status and a sentence,
// then confirms nothing actually changed.
//
// Uses seed accounts with no devices. Leaves a Room `zz-edge` behind;
// delete it afterwards (README.md).
//   node supabase/tests/security_edge_live.js
const API = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
};
const call = async (path, { token, method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
};
const service = (path, opts = {}) => call(path, { ...opts, token: SERVICE, headers: { apikey: SERVICE, ...(opts.headers ?? {}) } });
const signIn = async (email) => {
  const r = await call('/auth/v1/token?grant_type=password', { token: ANON, method: 'POST', body: { email, password: 'password123' } });
  if (!r.json?.access_token) throw new Error(`sign-in failed for ${email}: ${r.text}`);
  return { token: r.json.access_token, id: r.json.user.id };
};
const fn = (name, token, body) => call(`/functions/v1/${name}`, { token, method: 'POST', body });
const short = (r) => `${r.status} ${r.text.slice(0, 90)}`;
/** A refusal: a 4xx with a message, not a 2xx and not a crash. */
const refusedBy = (r) => r.status >= 400 && r.status < 500 && typeof (r.json?.error ?? r.json?.message) === 'string';

(async () => {
  const eve = await signIn('eve@example.com');
  const rui = await signIn('rui@example.com');
  const tobi = await signIn('tobi@example.com');
  const outsider = await signIn('outsider@example.com');
  const nobody = '00000000-0000-0000-0000-000000000000';

  // eve's request-to-join Room, with tobi as a member and rui as a mod,
  // all made through the function the way the app does.
  const room = await call('/rest/v1/rooms', {
    token: eve.token,
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { slug: 'zz-edge', name: 'Zz Edge', visibility: 'request', created_by: eve.id, category: 'Learning' },
  });
  const roomId = room.json?.[0]?.id;
  check('a Room to work in', room.status === 201 && !!roomId, short(room));
  for (const who of [tobi, rui]) {
    await fn('room-membership', who.token, { action: 'join', room_id: roomId });
    await fn('room-membership', eve.token, { action: 'respond_to_request', room_id: roomId, target_user_id: who.id, approve: true });
  }
  const promoted = await fn('room-membership', eve.token, { action: 'change_role', room_id: roomId, target_user_id: rui.id, new_role: 'mod' });
  const sub = await fn('room-membership', eve.token, { action: 'create_subgroup', room_id: roomId, name: 'Side room', visibility: 'request' });
  const subId = sub.json?.subgroup?.id;
  check('tobi a member, rui a mod, one sub-group', promoted.status === 200 && !!subId, `${short(promoted)} | ${short(sub)}`);
  const general = (await service(`/rest/v1/conversations?room_id=eq.${roomId}&is_default=is.true&select=id`)).json?.[0]?.id;

  console.log('\n== no key at all: the gateway refuses before any function runs');
  // Truly nothing: no Authorization and no apikey header. (The anon key is
  // a key. The three functions the database calls are built to be safe with
  // it, since they act only on rows they read themselves; the four the app
  // calls go on to demand a real session, which is the next block.)
  const GATED = ['room-membership', 'moderate', 'delete-account', 'request-room-verification', 'notify-activity', 'notify-new-message', 'cleanup-expired-stories', 'cleanup-unused-media'];
  for (const name of GATED) {
    const res = await fetch(`${API}/functions/v1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check(`${name}, no key`, res.status === 401, `${res.status} ${(await res.text()).slice(0, 70)}`);
  }
  const open = await fetch(`${API}/functions/v1/verify-room-email`);
  check('verify-room-email is the one public function, and without a token does nothing', open.status === 400, `${open.status}`);

  console.log('\n== the anon key but no session: the four functions the app calls refuse');
  for (const name of ['room-membership', 'moderate', 'delete-account', 'request-room-verification']) {
    const r = await fn(name, ANON, {});
    check(`${name}, anon key`, r.status === 401, short(r));
  }

  // Each: [label, who, function, body]. Every one must be refused.
  const attempts = [
    // room-membership, as someone outside the Room
    ['outsider: approve a join request', outsider, 'room-membership', { action: 'respond_to_request', room_id: roomId, target_user_id: outsider.id, approve: true }],
    ['outsider: invite someone', outsider, 'room-membership', { action: 'invite', room_id: roomId, handle: 'nadia' }],
    ['outsider: make themselves owner', outsider, 'room-membership', { action: 'change_role', room_id: roomId, target_user_id: outsider.id, new_role: 'owner' }],
    ['outsider: remove the owner', outsider, 'room-membership', { action: 'remove_from_room', room_id: roomId, target_user_id: eve.id }],
    ['outsider: create a sub-group', outsider, 'room-membership', { action: 'create_subgroup', room_id: roomId, name: 'mine', visibility: 'public' }],
    ['outsider: rename a sub-group', outsider, 'room-membership', { action: 'update_subgroup', room_id: roomId, conversation_id: subId, name: 'taken over' }],
    ['outsider: delete a sub-group', outsider, 'room-membership', { action: 'delete_subgroup', room_id: roomId, conversation_id: subId }],
    ['outsider: join a sub-group of a Room they are not in', outsider, 'room-membership', { action: 'join_subgroup', conversation_id: subId }],
    ['outsider: mute someone in the Room chat', outsider, 'room-membership', { action: 'mute_in_conversation', conversation_id: general, target_user_id: tobi.id, muted: true }],
    ['outsider: accept an invite that was never sent', outsider, 'room-membership', { action: 'respond_to_invite', room_id: roomId, accept: true }],
    // room-membership, as a plain member
    ['member: approve a join request', tobi, 'room-membership', { action: 'respond_to_request', room_id: roomId, target_user_id: outsider.id, approve: true }],
    ['member: promote themselves to admin', tobi, 'room-membership', { action: 'change_role', room_id: roomId, target_user_id: tobi.id, new_role: 'admin' }],
    ['member: remove the owner', tobi, 'room-membership', { action: 'remove_from_room', room_id: roomId, target_user_id: eve.id }],
    ['member: remove a mod', tobi, 'room-membership', { action: 'remove_from_room', room_id: roomId, target_user_id: rui.id }],
    ['member: create a sub-group', tobi, 'room-membership', { action: 'create_subgroup', room_id: roomId, name: 'mine', visibility: 'public' }],
    ['member: delete a sub-group', tobi, 'room-membership', { action: 'delete_subgroup', room_id: roomId, conversation_id: subId }],
    ['member: approve their own request to a sub-group', tobi, 'room-membership', { action: 'respond_to_subgroup_request', conversation_id: subId, target_user_id: tobi.id, approve: true }],
    ['member: remove someone from a sub-group', tobi, 'room-membership', { action: 'remove_from_subgroup', conversation_id: subId, target_user_id: eve.id }],
    ['member: invite someone to a sub-group', tobi, 'room-membership', { action: 'invite_to_subgroup', conversation_id: subId, handle: 'rui' }],
    ['member: mute a mod in the Room chat', tobi, 'room-membership', { action: 'mute_in_conversation', conversation_id: general, target_user_id: rui.id, muted: true }],
    // room-membership, as a mod: may moderate, may not administer or outrank
    ['mod: promote themselves to owner', rui, 'room-membership', { action: 'change_role', room_id: roomId, target_user_id: rui.id, new_role: 'owner' }],
    ['mod: demote the owner', rui, 'room-membership', { action: 'change_role', room_id: roomId, target_user_id: eve.id, new_role: 'member' }],
    ['mod: remove the owner', rui, 'room-membership', { action: 'remove_from_room', room_id: roomId, target_user_id: eve.id }],
    ['mod: delete a sub-group', rui, 'room-membership', { action: 'delete_subgroup', room_id: roomId, conversation_id: subId }],
    ['mod: mute the owner in the Room chat', rui, 'room-membership', { action: 'mute_in_conversation', conversation_id: general, target_user_id: eve.id, muted: true }],
    // moderate and delete-account: app admins only
    ['not an app admin: suspend someone', tobi, 'moderate', { action: 'suspend_user', user_id: eve.id, reason: 'no' }],
    ['not an app admin: lift a suspension', tobi, 'moderate', { action: 'unsuspend_user', user_id: eve.id }],
    ['not an app admin: sign a report\'s media', tobi, 'moderate', { action: 'sign_report_media', report_id: nobody }],
    ['a Room owner is not an app admin: suspend someone', eve, 'moderate', { action: 'suspend_user', user_id: tobi.id, reason: 'no' }],
    ['not an app admin: look an account up by email', tobi, 'delete-account', { action: 'lookup', email: 'eve@example.com' }],
    ['not an app admin: delete someone else\'s account', tobi, 'delete-account', { action: 'delete_user', user_id: eve.id }],
    // request-room-verification
    ['a verification link for a Room that doesn\'t use them', outsider, 'request-room-verification', { room_id: roomId, email: 'outsider@example.com' }],
    ['a verification link for a Room that doesn\'t exist', outsider, 'request-room-verification', { room_id: nobody, email: 'outsider@example.com' }],
    // nonsense
    ['an action that doesn\'t exist', tobi, 'room-membership', { action: 'make_me_owner', room_id: roomId }],
  ];

  console.log('\n== every action, by someone who may not');
  for (const [label, who, name, body] of attempts) {
    const r = await fn(name, who.token, body);
    check(label, refusedBy(r), short(r));
  }

  console.log('\n== and nothing changed');
  const members = await service(`/rest/v1/room_memberships?room_id=eq.${roomId}&select=user_id,role,join_state&order=role`);
  const roles = Object.fromEntries((members.json ?? []).map((m) => [m.user_id, `${m.role}/${m.join_state}`]));
  check(
    'the Room has exactly its three members, in their roles',
    members.json?.length === 3 && roles[eve.id] === 'owner/approved' && roles[rui.id] === 'mod/approved' && roles[tobi.id] === 'member/approved',
    JSON.stringify(roles),
  );
  const subs = await service(`/rest/v1/conversations?room_id=eq.${roomId}&is_default=is.false&select=name`);
  check('the sub-group is still there under its own name', subs.json?.length === 1 && subs.json[0].name === 'Side room', short(subs));
  const muted = await service(`/rest/v1/conversation_participants?conversation_id=eq.${general}&posting_disabled=is.true&select=user_id`);
  check('nobody was muted', muted.status === 200 && muted.json.length === 0, short(muted));
  const suspended = await service(`/rest/v1/account_suspensions?user_id=in.(${eve.id},${tobi.id})&select=user_id`);
  check('nobody was suspended', suspended.status === 200 && suspended.json.length === 0, short(suspended));
  const still = await service(`/rest/v1/profiles?id=eq.${eve.id}&select=id`);
  check('the owner\'s account still exists', still.json?.length === 1);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}  (room ${roomId})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(2);
});
