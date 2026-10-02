// Phase 10 slice 6, over the real API: the limits that live outside a plain
// table insert.
//
//  - the verification email: one a minute per Room, refused with a
//    sentence people can read, and the link already sent keeps working
//  - uploads: counted per person, capped at 50 a day, and a video over
//    25 MB refused by the bucket
//  - a rate limit as the app meets it: the 11th comment in a minute
//
// Uses seed accounts with no devices. Leaves a Room `zz-live6`, one
// Mailpit email and some counters behind; clean up afterwards (README.md).
//   node supabase/tests/phase10_slice6_live.js
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
const service = (path, opts = {}) => call(path, { ...opts, token: SERVICE, headers: { apikey: SERVICE, ...(opts.headers ?? {}) } });
const signIn = async (email) => {
  const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: 'password123' } });
  if (!r.json?.access_token) throw new Error(`sign-in failed for ${email}: ${r.text}`);
  return { token: r.json.access_token, id: r.json.user.id };
};
const short = (r) => `${r.status} ${r.text.slice(0, 120)}`;
const upload = async (token, bucket, path, bytes, type) => {
  const res = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': type },
    body: bytes,
  });
  return { status: res.status, text: await res.text() };
};
const counter = async (userId, action, bucket) => {
  const r = await service(`/rest/v1/rate_limit_counters?user_id=eq.${userId}&action=eq.${encodeURIComponent(action)}&bucket=eq.${bucket}&select=count,window_start&order=window_start.desc&limit=1`);
  return r.json?.[0] ?? null;
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

(async () => {
  const eve = await signIn('eve@example.com');
  const tobi = await signIn('tobi@example.com');

  // A domain-verified Room for the email, and tobi as a member through its
  // verification link, so the same Room serves the upload and comment checks.
  const room = await call('/rest/v1/rooms', {
    token: eve.token,
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { slug: 'zz-live6', name: 'Zz Live 6', visibility: 'domain_verified', required_email_domain: 'example.com', created_by: eve.id, category: 'Learning' },
  });
  const roomId = room.json?.[0]?.id;
  check('a domain-verified Room was created', room.status === 201 && !!roomId, short(room));

  console.log('\n== the verification email: one a minute per Room');
  const ask = () => call('/functions/v1/request-room-verification', { token: tobi.token, method: 'POST', body: { room_id: roomId, email: 'tobi@example.com' } });
  const first = await ask();
  check('the first request sends', first.status === 200, short(first));
  const tokenBefore = await service(`/rest/v1/room_email_verifications?room_id=eq.${roomId}&user_id=eq.${tobi.id}&select=token`);
  const second = await ask();
  check('a second one straight away is refused, with a sentence for people', second.status === 429 && /too often/.test(second.text), short(second));
  const tokenAfter = await service(`/rest/v1/room_email_verifications?room_id=eq.${roomId}&user_id=eq.${tobi.id}&select=token`);
  check('and it didn\'t replace the link already sent', tokenBefore.json?.[0]?.token && tokenBefore.json[0].token === tokenAfter.json?.[0]?.token);
  const perRoom = await counter(tobi.id, `verify_email:${roomId}`, 'minute');
  const perHour = await counter(tobi.id, 'verify_email', 'hour');
  check('counted once against the Room\'s minute and once against the hour', perRoom?.count === 1 && perHour?.count === 1, JSON.stringify({ perRoom, perHour }));
  const verify = await fetch(`${API}/functions/v1/verify-room-email?token=${tokenAfter.json?.[0]?.token}`);
  check('the emailed link still joins the Room', verify.status === 200 && /verified/i.test(await verify.text()), `${verify.status}`);

  console.log('\n== uploads: sized, and capped at 50 files in 24 hours');
  const tooBig = await upload(tobi.token, 'post-media', `${roomId}/${tobi.id}/zzslice6big.mp4`, new Uint8Array(26 * 1024 * 1024), 'video/mp4');
  check('a 26 MB video is refused by the bucket', tooBig.status >= 400 && /size|large|exceed/i.test(tooBig.text), short(tooBig));
  // Fifty real uploads of four bytes each. tobi has no other files, so the
  // 50th is the last one allowed.
  const paths = [];
  let allowed = 0;
  for (let i = 1; i <= 50; i++) {
    const path = `${roomId}/${tobi.id}/zzslice6-${i}.jpg`;
    const r = await upload(tobi.token, 'post-media', path, JPEG, 'image/jpeg');
    if (r.status === 200) {
      allowed++;
      paths.push(path);
    }
  }
  check('50 uploads go through', allowed === 50, `${allowed} of 50`);
  const over = await upload(tobi.token, 'post-media', `${roomId}/${tobi.id}/zzslice6-51.jpg`, JPEG, 'image/jpeg');
  check('the 51st is refused', over.status >= 400, short(over));
  const elsewhere = await upload(tobi.token, 'story-media', `${roomId}/${tobi.id}/zzslice6-story.jpg`, JPEG, 'image/jpeg');
  check('in any bucket', elsewhere.status >= 400, short(elsewhere));
  const eveUpload = await upload(eve.token, 'post-media', `${roomId}/${eve.id}/zzslice6-eve.jpg`, JPEG, 'image/jpeg');
  check('someone else\'s upload still goes through', eveUpload.status === 200, short(eveUpload));
  const removed = await call('/storage/v1/object/post-media', { token: tobi.token, method: 'DELETE', body: { prefixes: paths } });
  check('deleting his own files', removed.status === 200 && removed.json?.length === 50, `${removed.status} ${removed.json?.length ?? removed.text.slice(0, 80)}`);
  const again = await upload(tobi.token, 'post-media', `${roomId}/${tobi.id}/zzslice6-again.jpg`, JPEG, 'image/jpeg');
  check('gives the allowance back: the limit is on what is stored', again.status === 200, short(again));
  await call('/storage/v1/object/post-media', { token: tobi.token, method: 'DELETE', body: { prefixes: [`${roomId}/${tobi.id}/zzslice6-again.jpg`] } });
  await call('/storage/v1/object/post-media', { token: eve.token, method: 'DELETE', body: { prefixes: [`${roomId}/${eve.id}/zzslice6-eve.jpg`] } });
  check('the counters aren\'t readable by the person they count', (await call(`/rest/v1/rate_limit_counters?select=count`, { token: tobi.token })).status >= 400);

  console.log('\n== a rate limit as the app meets it');
  const post = await call('/rest/v1/rpc/create_post', { token: eve.token, method: 'POST', body: { p_room_id: roomId, p_text: 'comment on me' } });
  const comment = (n) => call('/rest/v1/comments', { token: tobi.token, method: 'POST', body: { post_id: post.json, author_id: tobi.id, text: `comment ${n}` } });
  // Ten in the same minute. If the minute turns over mid-run the count
  // starts again, so do it twice if the first eleven all pass.
  let eleventh;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 1; i <= 10; i++) await comment(i);
    eleventh = await comment(11);
    if (eleventh.status !== 201) break;
  }
  check('the 11th comment in a minute: HTTP 400, code P0001, the sentence the app shows', eleventh.status === 400 && eleventh.json?.code === 'P0001' && /too often/.test(eleventh.json?.message ?? ''), short(eleventh));
  const tooLong = await call('/rest/v1/rpc/create_post', { token: eve.token, method: 'POST', body: { p_room_id: roomId, p_text: 'x'.repeat(2001) } });
  check('a 2,001-character post over the API is refused', tooLong.status === 400 && /posts_text_length/.test(tooLong.text), short(tooLong));

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}  (room ${roomId})`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(2);
});
