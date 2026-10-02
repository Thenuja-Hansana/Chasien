// Runs every check in this folder against the local stack and prints one
// summary. This is the "full security re-check": run it after any change to
// a migration, a policy, a grant or an Edge Function.
//
//   node supabase/tests/run.js           the SQL suites (nothing is left behind)
//   node supabase/tests/run.js --live    those, then the scripts that use the real API
//
// The SQL suites each run in one transaction that is rolled back. The live
// scripts create a throwaway Room each and are cleaned up after here: Rooms
// named zz-*, the DM they open, their emails in Mailpit, and the rate-limit
// counters (a live script is rate-limited like anyone else, and four of
// them in a row would run a seed account into the Rooms-per-day limit).
//
// Needs `supabase start` and the seed data (docs/running-locally.md).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DB = ['exec', '-i', 'supabase_db_chasien', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A'];
const MAILPIT = 'http://127.0.0.1:54324';

const SQL_SUITES = [
  ['security_invariants.js', 'the rules the schema keeps'],
  ['security_isolation_suite.js', 'who can read what, table by table'],
  ['phase10_slice2_suite.js', 'functions closed by default'],
  ['phase10_slice3_suite.js', 'grants and the DM door'],
  ['phase10_slice4_suite.js', 'posts only through create_post'],
  ['phase10_slice5_suite.js', 'profile details'],
  ['phase10_slice6_suite.js', 'limits'],
];
const LIVE_SCRIPTS = [
  ['security_edge_live.js', 'Edge Functions, wrong role'],
  ['phase10_slice2_live.js', 'signup, Edge Functions, storage'],
  ['phase10_slice3_live.js', 'DMs and sub-groups'],
  ['phase10_slice6_live.js', 'email, upload and rate limits'],
];

const node = (file) => spawnSync(process.execPath, [path.join(HERE, file)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const psql = (input) => spawnSync('docker', DB, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = (out) => out.split(/\r?\n/).map((l) => l.replace(/^NOTICE:\s+/, '')).filter((l) => l.trim());
const tally = (ls) => ({
  pass: ls.filter((l) => l.startsWith('PASS')).length,
  fail: ls.filter((l) => l.startsWith('FAIL')),
  error: ls.filter((l) => /^(ERROR|psql:)/.test(l)),
});

let failed = 0;
let total = 0;
const report = (name, what, t) => {
  const bad = t.fail.length + t.error.length;
  total += t.pass + bad;
  failed += bad;
  console.log(`${bad === 0 ? 'ok  ' : 'FAIL'}  ${name.padEnd(30)} ${String(t.pass).padStart(3)} passed${bad ? `, ${bad} failed` : ''}   ${what}`);
  for (const l of [...t.fail, ...t.error]) console.log(`        ${l.slice(0, 220)}`);
};

function cleanUpAfterLive() {
  psql(`
    delete from rooms where slug like 'zz-%';
    delete from conversations where kind = 'dm' and dm_user_a = '22222222-2222-2222-2222-222222222222' and dm_user_b = '44444444-4444-4444-4444-444444444444';
    delete from notifications where type in ('friend_request', 'friend_accept') and created_at > now() - interval '1 hour';
    delete from rate_limit_counters;
  `);
}
async function clearMailpit() {
  // Only the emails these scripts cause: to zz-* addresses, or about a zz Room.
  try {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
    const { messages = [] } = await res.json();
    const ids = messages.filter((m) => /Zz /.test(m.Subject) || m.To.some((t) => t.Address.startsWith('zz-'))).map((m) => m.ID);
    if (ids.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
  } catch {
    /* Mailpit not reachable: nothing to clear */
  }
}

(async () => {
  const up = psql('select 1;');
  if (up.status !== 0) {
    console.error('The local database is not reachable (docker exec supabase_db_chasien). Is `supabase start` running?');
    process.exit(2);
  }
  const before = lines(psql(`select (select count(*) from rooms) || ' rooms, ' || (select count(*) from posts) || ' posts, ' || (select count(*) from messages) || ' messages, ' || (select count(*) from notifications) || ' notifications, ' || (select count(*) from storage.objects) || ' files, ' || (select count(*) from auth.users) || ' accounts';`).stdout)[0];

  console.log('SQL suites (each rolled back)');
  for (const [file, what] of SQL_SUITES) {
    const script = node(file);
    if (script.status !== 0) {
      report(file, what, { pass: 0, fail: [], error: [`ERROR the suite itself failed to build: ${script.stderr.trim().split('\n').pop()}`] });
      continue;
    }
    const run = psql(script.stdout);
    report(file, what, tally(lines(run.stdout + '\n' + run.stderr)));
  }

  // One rule lives in a file, not the database: which functions skip the gateway's JWT check.
  const toml = fs.readFileSync(path.join(HERE, '..', 'config.toml'), 'utf8');
  const open = [...toml.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\r?\n(?:(?!\[).*\r?\n)*?verify_jwt\s*=\s*false/gm)].map((m) => m[1]);
  const okOpen = open.length === 1 && open[0] === 'verify-room-email';
  report('config.toml', 'only verify-room-email skips the JWT check', { pass: okOpen ? 1 : 0, fail: okOpen ? [] : [`FAIL  functions with verify_jwt = false: ${open.join(', ') || 'none'}`], error: [] });

  if (process.argv.includes('--live')) {
    console.log('\nLive scripts (real API; cleaned up after)');
    for (const [file, what] of LIVE_SCRIPTS) {
      cleanUpAfterLive();
      const run = node(file);
      const t = tally(lines(run.stdout));
      if (run.status === 2) t.error.push(`ERROR ${run.stderr.trim().split('\n').pop()}`);
      report(file, what, t);
    }
    cleanUpAfterLive();
    await clearMailpit();
  }

  const after = lines(psql(`select (select count(*) from rooms) || ' rooms, ' || (select count(*) from posts) || ' posts, ' || (select count(*) from messages) || ' messages, ' || (select count(*) from notifications) || ' notifications, ' || (select count(*) from storage.objects) || ' files, ' || (select count(*) from auth.users) || ' accounts';`).stdout)[0];
  console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}: ${total - failed} of ${total} checks`);
  console.log(`data before: ${before}`);
  console.log(`data after:  ${after}${before === after ? '' : '   <-- differs: something was left behind'}`);
  process.exit(failed === 0 && before === after ? 0 : 1);
})();
