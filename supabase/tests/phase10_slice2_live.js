// Phase 10 slice 2, the paths a rolled-back transaction can't cover: real
// signup, the Edge Functions (service role), storage signing, and the
// service-role RPCs behind account deletion. Uses a throwaway account and a
// throwaway Room owned by a seed account with no devices, so nothing is
// pushed to a real phone. Cleans up after itself.
//   node supabase/tests/phase10_slice2_live.js
const API = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'zz-slice2@example.com';
const PASSWORD = 'zz-slice2-password';
const HANDLE = 'zz_slice2';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
};
const call = async (path, { token = ANON, method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
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
const signIn = async (email, password = 'password123') => {
  const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!r.json?.access_token) throw new Error(`sign-in failed for ${email}: ${r.text}`);
  return { token: r.json.access_token, id: r.json.user.id };
};
const short = (r) => `${r.status} ${r.text.slice(0, 110)}`;

(async () => {
  console.log('== signup: the profile is created by the handle_new_user trigger');
  const signup = await call('/auth/v1/signup', { method: 'POST', body: { email: EMAIL, password: PASSWORD, data: { handle: HANDLE, name: 'Zz Slice Two' } } });
  const newId = signup.json?.id ?? signup.json?.user?.id;
  check('signup accepted', signup.status === 200 && !!newId, short(signup));
  const profile = await call(`/rest/v1/profiles?id=eq.${newId}&select=handle,name`, { token: SERVICE, headers: { apikey: SERVICE } });
  check('a profile row exists with the chosen handle', profile.json?.[0]?.handle === HANDLE, short(profile));
  // Local signups need the emailed confirmation; confirm it the way the link would.
  const confirm = await call(`/auth/v1/admin/users/${newId}`, { token: SERVICE, method: 'PUT', body: { email_confirm: true }, headers: { apikey: SERVICE } });
  check('account confirmed', confirm.status === 200, `${confirm.status}`);
  const me = await signIn(EMAIL, PASSWORD);
  const eve = await signIn('eve@example.com');
  const outsider = await signIn('outsider@example.com');

  console.log('\n== a throwaway request-to-join Room, created over the API by a seed account');
  const room = await call('/rest/v1/rooms', {
    token: eve.token,
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { slug: 'zz-live2', name: 'Zz Live 2', visibility: 'request', created_by: eve.id, category: 'Learning' },
  });
  const roomId = room.json?.[0]?.id;
  check('Room created', room.status === 201 && !!roomId, short(room));

  console.log('\n== room-membership Edge Function: join, then approve (service role writes, triggers fire)');
  const join = await call('/functions/v1/room-membership', { token: me.token, method: 'POST', body: { action: 'join', room_id: roomId } });
  check('join request accepted', join.status === 200, short(join));
  const asked = await call(`/rest/v1/notifications?room_id=eq.${roomId}&type=eq.join_request&select=user_id,actor_id`, { token: eve.token });
  check('the owner was notified of the request', asked.json?.length === 1 && asked.json[0].user_id === eve.id && asked.json[0].actor_id === me.id, short(asked));
  const feedBefore = await call(`/rest/v1/room_memberships?room_id=eq.${roomId}&select=user_id`, { token: me.token });
  check('while pending, the requester sees only their own membership row', (feedBefore.json ?? []).every((m) => m.user_id === me.id), short(feedBefore));
  const approve = await call('/functions/v1/room-membership', {
    token: eve.token,
    method: 'POST',
    body: { action: 'respond_to_request', room_id: roomId, target_user_id: me.id, approve: true },
  });
  check('owner approved through the Edge Function', approve.status === 200, short(approve));
  const wrongRole = await call('/functions/v1/room-membership', {
    token: me.token,
    method: 'POST',
    body: { action: 'change_role', room_id: roomId, target_user_id: me.id, new_role: 'admin' },
  });
  check('a plain member cannot promote themselves', wrongRole.status >= 400, short(wrongRole));

  console.log('\n== the new member posts over the API with a mention');
  const post = await call('/rest/v1/rpc/create_post', { token: me.token, method: 'POST', body: { p_room_id: roomId, p_text: 'hello @eve from the new account' } });
  check('create_post works for the new member', post.status === 200 && typeof post.json === 'string', short(post));
  const mention = await call(`/rest/v1/notifications?room_id=eq.${roomId}&type=eq.mention&select=user_id,actor_id`, { token: eve.token });
  check('eve was mentioned', mention.json?.length === 1 && mention.json[0].actor_id === me.id, short(mention));
  const outsiderFeed = await call(`/rest/v1/posts?room_id=eq.${roomId}&select=id`, { token: outsider.token });
  check('an outsider reads zero posts of the Room', outsiderFeed.status === 200 && outsiderFeed.json.length === 0, short(outsiderFeed));
  const memberFeed = await call(`/rest/v1/posts?room_id=eq.${roomId}&select=id`, { token: eve.token });
  check('a member reads the post', memberFeed.json?.length === 1, short(memberFeed));

  console.log('\n== storage: uploading and signing a Room file calls the helpers from storage policies');
  // Its own file, not one already in the local data: the unused-media
  // cleanup (slice 6) removes files nothing points at, so a path borrowed
  // from the seed data isn't guaranteed to be there next week.
  const file = `${roomId}/${me.id}/zzslice2.jpg`;
  const upload = async (token, path) => {
    const res = await fetch(`${API}/storage/v1/object/post-media/${path}`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    return { status: res.status, text: await res.text() };
  };
  const memberUpload = await upload(me.token, file);
  check('a member uploads into the Room\'s folder under their own id', memberUpload.status === 200, short(memberUpload));
  const outsiderUpload = await upload(outsider.token, `${roomId}/${outsider.id}/zzslice2.jpg`);
  check('an outsider cannot upload there', outsiderUpload.status >= 400, short(outsiderUpload));
  const memberSign = await call(`/storage/v1/object/sign/post-media/${file}`, { token: eve.token, method: 'POST', body: { expiresIn: 60 } });
  check('another member of the Room can sign that file', memberSign.status === 200 && !!memberSign.json?.signedURL, short(memberSign));
  const outsiderSign = await call(`/storage/v1/object/sign/post-media/${file}`, { token: outsider.token, method: 'POST', body: { expiresIn: 60 } });
  check('an outsider cannot', outsiderSign.status >= 400, short(outsiderSign));

  console.log('\n== delete-account Edge Function: the service-role RPCs still run');
  const fresh = await signIn(EMAIL, PASSWORD);
  const del = await call('/functions/v1/delete-account', { token: fresh.token, method: 'POST', body: {} });
  check('the throwaway account deleted itself', del.status === 200, short(del));
  const gone = await call(`/rest/v1/profiles?id=eq.${newId}&select=id`, { token: SERVICE, headers: { apikey: SERVICE } });
  check('its profile is gone', gone.json?.length === 0, short(gone));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}  (room ${roomId})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(2);
});
