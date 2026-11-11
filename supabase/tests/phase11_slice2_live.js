// Phase 11 slice 2, over the real Auth API: signup confirmation and password
// reset by a 6-digit code typed into the app, not a link.
//
//  - the confirmation and reset emails carry a code and no link
//  - logging in before confirming is refused as "Email not confirmed"
//  - a wrong code is refused (otp_expired), a right one signs in, and no code
//    works twice
//  - asking for a reset answers the same whether or not the address exists
//  - after a reset the old password stops working and the new one works
//
// Creates zz-code@example.com and deletes it again (also at the start, if a
// failed run left it behind). Its emails are cleared by run.js.
//   node supabase/tests/phase11_slice2_live.js
const API = 'http://127.0.0.1:54321';
const MAILPIT = 'http://127.0.0.1:54324';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'zz-code@example.com';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
};
const auth = async (path, body, { method = 'POST', token = ANON } = {}) => {
  const res = await fetch(`${API}/auth/v1${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
const findUser = async () => {
  const res = await fetch(`${API}/auth/v1/admin/users?per_page=200`, { headers: admin });
  const users = (await res.json()).users ?? [];
  return users.find((u) => u.email === EMAIL)?.id ?? null;
};
const deleteUser = async () => {
  const id = await findUser();
  if (id) await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin });
  return id;
};
// The newest email to EMAIL with this subject, and the code in it.
const latestEmail = async (subject) => {
  for (let i = 0; i < 10; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json();
    const m = list.messages.find((x) => x.To.some((t) => t.Address === EMAIL) && x.Subject === subject);
    if (m) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
      const text = full.Text || '';
      return { subject: m.Subject, code: (/\b(\d{6})\b/.exec(text) || [])[1], hasLink: /https?:\/\//.test(text) };
    }
    await sleep(700);
  }
  return null;
};

(async () => {
  await deleteUser();

  console.log('== signup: the email carries a code, not a link');
  const signup = await auth('/signup', { email: EMAIL, password: 'oldpass1', data: { handle: 'zz_code', name: 'Zz Code' } });
  check('signup accepted, no session yet', signup.status === 200 && !signup.json?.access_token, `${signup.status}`);
  const conf = await latestEmail('Your Chasien code');
  check('the confirmation email arrived', !!conf, conf?.subject);
  check('it holds a 6-digit code and no link', !!conf?.code && !conf.hasLink);

  const early = await auth('/token?grant_type=password', { email: EMAIL, password: 'oldpass1' });
  check('logging in before confirming is refused as "Email not confirmed"', early.status === 400 && /not confirmed/i.test(early.text), `${early.status}`);

  const wrongCode = conf?.code === '000000' ? '111111' : '000000';
  const wrong = await auth('/verify', { type: 'email', email: EMAIL, token: wrongCode });
  check('a wrong code is refused with otp_expired', wrong.status >= 400 && wrong.json?.error_code === 'otp_expired', `${wrong.status} ${wrong.json?.error_code}`);
  const right = await auth('/verify', { type: 'email', email: EMAIL, token: conf?.code });
  check('the right code confirms the account and signs in', right.status === 200 && !!right.json?.access_token, `${right.status}`);
  const reuse = await auth('/verify', { type: 'email', email: EMAIL, token: conf?.code });
  check('the same code does not work twice', reuse.status >= 400, `${reuse.status}`);

  console.log('\n== password reset by code');
  const unknown = await auth('/recover', { email: 'zz-nobody@example.com' });
  const recover = await auth('/recover', { email: EMAIL });
  check('a reset request answers the same for an address with no account', unknown.status === recover.status, `${unknown.status} vs ${recover.status}`);
  const rec = await latestEmail('Reset your Chasien password');
  check('the reset email holds a 6-digit code and no link', !!rec?.code && !rec.hasLink);
  const signedIn = await auth('/verify', { type: 'recovery', email: EMAIL, token: rec?.code });
  check('the reset code signs in', signedIn.status === 200 && !!signedIn.json?.access_token, `${signedIn.status}`);
  const change = await auth('/user', { password: 'newpass2' }, { method: 'PUT', token: signedIn.json?.access_token });
  check('the new password is set', change.status === 200, `${change.status}`);
  const oldLogin = await auth('/token?grant_type=password', { email: EMAIL, password: 'oldpass1' });
  check('the old password no longer works', oldLogin.status === 400, `${oldLogin.status}`);
  const newLogin = await auth('/token?grant_type=password', { email: EMAIL, password: 'newpass2' });
  check('the new one does', newLogin.status === 200 && !!newLogin.json?.access_token, `${newLogin.status}`);

  const deleted = await deleteUser();
  check('the test account is deleted again', !!deleted && !(await findUser()));

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
