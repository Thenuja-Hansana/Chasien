// Phase 10 slice 3, over the real API: the DM door is shut, friends can
// still DM, and sub-groups still work through the room-membership Edge
// Function now that nobody can write `conversations` directly.
//
// Uses seed accounts with no devices. Leaves a Room `zz-live3` and one DM
// between tobi and kwame behind; delete both afterwards (README.md).
//   node supabase/tests/phase10_slice3_live.js
const API = 'http://127.0.0.1:54321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

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
const signIn = async (email) => {
  const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: 'password123' } });
  if (!r.json?.access_token) throw new Error(`sign-in failed for ${email}: ${r.text}`);
  return { token: r.json.access_token, id: r.json.user.id };
};
const short = (r) => `${r.status} ${r.text.slice(0, 120)}`;
const fn = (token, body) => call('/functions/v1/room-membership', { token, method: 'POST', body });

(async () => {
  const eve = await signIn('eve@example.com');
  const tobi = await signIn('tobi@example.com');
  const kwame = await signIn('kwame@example.com');
  const [a, b] = [tobi.id, kwame.id].sort();

  console.log('== DMs');
  const direct = await call('/rest/v1/conversations', { token: tobi.token, method: 'POST', body: { kind: 'dm', dm_user_a: a, dm_user_b: b } });
  check('inserting the DM row directly is refused', direct.status === 403 && /permission denied/.test(direct.text), short(direct));
  const notFriends = await call('/rest/v1/rpc/start_dm', { token: tobi.token, method: 'POST', body: { other_user_id: kwame.id } });
  check('start_dm refuses non-friends, with the message people are meant to read', notFriends.status === 400 && /must be friends/.test(notFriends.text), short(notFriends));
  const request = await call('/rest/v1/friendships', { token: tobi.token, method: 'POST', body: { user_a: a, user_b: b, requested_by: tobi.id } });
  check('friend request sent', request.status === 201, short(request));
  const accept = await call(`/rest/v1/friendships?user_a=eq.${a}&user_b=eq.${b}`, { token: kwame.token, method: 'PATCH', body: { status: 'accepted' } });
  check('friend request accepted', accept.status === 204, short(accept));
  const dm = await call('/rest/v1/rpc/start_dm', { token: tobi.token, method: 'POST', body: { other_user_id: kwame.id } });
  const dmId = dm.json;
  check('start_dm opens the DM for friends', dm.status === 200 && typeof dmId === 'string', short(dm));
  const sent = await call('/rest/v1/messages', { token: tobi.token, method: 'POST', body: { conversation_id: dmId, author_id: tobi.id, text: 'hello over the API' } });
  check('a message goes in', sent.status === 201, short(sent));
  const read = await call(`/rest/v1/messages?conversation_id=eq.${dmId}&select=text`, { token: kwame.token });
  check('the friend reads it', read.json?.length === 1, short(read));
  const inbox = await call(`/rest/v1/my_inbox?conversation_id=eq.${dmId}&select=conversation_id`, { token: kwame.token });
  check('and sees the DM in the inbox view', inbox.json?.length === 1, short(inbox));
  const stranger = await call(`/rest/v1/messages?conversation_id=eq.${dmId}&select=text`, { token: eve.token });
  check('a third person reads nothing of it', stranger.status === 200 && stranger.json.length === 0, short(stranger));

  console.log('\n== sub-groups, through the Edge Function');
  const room = await call('/rest/v1/rooms', {
    token: eve.token,
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { slug: 'zz-live3', name: 'Zz Live 3', visibility: 'public', created_by: eve.id, category: 'Learning' },
  });
  const roomId = room.json?.[0]?.id;
  check('Room created', room.status === 201 && !!roomId, short(room));
  const joined = await fn(tobi.token, { action: 'join', room_id: roomId });
  check('tobi joined the public Room', joined.status === 200, short(joined));
  const directSub = await call('/rest/v1/conversations', { token: eve.token, method: 'POST', body: { kind: 'room_channel', room_id: roomId, name: 'direct', is_default: false, member_count: 9999 } });
  check('the owner inserting a sub-group row directly is refused', directSub.status === 403 && /permission denied/.test(directSub.text), short(directSub));
  const memberCreate = await fn(tobi.token, { action: 'create_subgroup', room_id: roomId, name: 'not allowed', visibility: 'public' });
  check('a plain member cannot create one through the function either', memberCreate.status >= 400, short(memberCreate));
  const created = await fn(eve.token, { action: 'create_subgroup', room_id: roomId, name: 'Side room', visibility: 'public' });
  check('the owner creates one through the function', created.status === 200, short(created));
  const list = await call(`/rest/v1/conversations?room_id=eq.${roomId}&is_default=is.false&select=id,name,member_count`, { token: tobi.token });
  const subId = list.json?.[0]?.id;
  check('a member sees it, with the real member count', list.json?.length === 1 && list.json[0].member_count === 1, short(list));
  const directRename = await call(`/rest/v1/conversations?id=eq.${subId}`, { token: eve.token, method: 'PATCH', body: { member_count: 9999 } });
  check('the owner patching the row directly is refused', directRename.status === 403, short(directRename));
  const renamed = await fn(eve.token, { action: 'update_subgroup', room_id: roomId, conversation_id: subId, name: 'Renamed room' });
  check('the owner renames it through the function', renamed.status === 200, short(renamed));
  const joinSub = await fn(tobi.token, { action: 'join_subgroup', conversation_id: subId });
  check('the member joins it', joinSub.status === 200, short(joinSub));
  const deleted = await fn(eve.token, { action: 'delete_subgroup', room_id: roomId, conversation_id: subId });
  check('the owner deletes it through the function', deleted.status === 200, short(deleted));

  console.log('\n== likes carry the server\'s time');
  const post = await call('/rest/v1/rpc/create_post', { token: eve.token, method: 'POST', body: { p_room_id: roomId, p_text: 'like me' } });
  const dated = await call('/rest/v1/post_likes', { token: tobi.token, method: 'POST', body: { post_id: post.json, user_id: tobi.id, created_at: '2020-01-01T00:00:00Z' } });
  check('a like dated 2020 is refused', dated.status === 403, short(dated));
  const like = await call('/rest/v1/post_likes', { token: tobi.token, method: 'POST', headers: { Prefer: 'return=representation' }, body: { post_id: post.json, user_id: tobi.id } });
  check('a like the way the app sends it is dated now', like.status === 201 && Date.now() - new Date(like.json[0].created_at).getTime() < 60000, short(like));

  // Tidy what a client can tidy; the Room and the DM go with SQL afterwards.
  await call(`/rest/v1/friendships?user_a=eq.${a}&user_b=eq.${b}`, { token: tobi.token, method: 'DELETE' });

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}  (room ${roomId}, dm ${dmId})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(2);
});
