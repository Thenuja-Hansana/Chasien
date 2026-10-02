// Shared by the SQL suites in this folder. Each suite builds one psql script
// in which every statement runs the way PostgREST runs a request: the role
// and the JWT claims are set for one account, then the statement. The whole
// script is a single transaction that ends in a rollback, so nothing is
// left behind and no push is sent (pg_net only sends on commit).
//
// A suite prints its script; pipe it to psql:
//   node supabase/tests/<suite>.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A

/** The seed accounts (supabase/seed.sql). */
const U = {
  mara: '11111111-1111-1111-1111-111111111111',
  tobi: '22222222-2222-2222-2222-222222222222',
  nadia: '33333333-3333-3333-3333-333333333333',
  kwame: '44444444-4444-4444-4444-444444444444',
  rui: '55555555-5555-5555-5555-555555555555',
  eve: '66666666-6666-6666-6666-666666666666',
  outsider: '77777777-7777-7777-7777-777777777777',
};

function createSuite() {
  const out = [];
  const quote = (s) => s.replace(/'/g, "''");
  const sql = (s) => out.push(s.trim());

  /** Become one signed-in account, as PostgREST would for its request. */
  const as = (who) =>
    sql(`reset role; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U[who]}","role":"authenticated"}', true) \\gset zz_`);
  /** Become the service role, as an Edge Function's admin client is. */
  const asService = () => sql(`reset role; set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zz_`);
  /** Back to the database owner, to look at what happened without RLS in the way. */
  const asOwner = () => sql(`reset role; select set_config('request.jwt.claims', '', true) \\gset zz_`);

  const section = (title) => sql(`\\echo\n\\echo == ${title}`);

  /** One line, PASS or FAIL, from a boolean SQL expression. */
  const check = (label, expr) => sql(`select case when (${expr}) then 'PASS  ' else 'FAIL  ' end || '${quote(label)}';`);

  /**
   * A statement that must be refused. The reason is printed, and with
   * `because` (a regex) the refusal only passes if the reason matches: a
   * refusal for the wrong reason is a failure that looks like a pass. A
   * statement that runs but touches no row counts as allowed, which is what
   * an UPDATE or DELETE that RLS filters to nothing looks like.
   */
  const refused = (label, stmt, because = null) => {
    const l = quote(label);
    const reasonOk = because ? `sqlerrm ~* '${quote(because)}'` : 'true';
    sql(`do $$ declare n int; begin ${stmt}; get diagnostics n = row_count;
  raise notice 'FAIL  ${l}  [was allowed, % row(s)]', n;
exception when others then
  if ${reasonOk} then raise notice 'PASS  ${l}  [refused: %]', sqlerrm;
  else raise notice 'FAIL  ${l}  [refused, but for another reason: %]', sqlerrm; end if;
end $$;`);
  };

  /** A statement that must go through. */
  const allowed = (label, stmt) => {
    const l = quote(label);
    sql(`do $$ begin ${stmt}; raise notice 'PASS  ${l}'; exception when others then raise notice 'FAIL  ${l}  [refused: %]', sqlerrm; end $$;`);
  };

  /** Keep a value for later statements, readable by any role: g('name'). */
  const remember = (name, expr) => sql(`select set_config('zz.${name}', (${expr})::text, true) \\gset zz_`);
  const g = (name) => `current_setting('zz.${name}')::uuid`;

  const begin = () => sql(`\\set QUIET on\n\\set ON_ERROR_STOP off\nset client_min_messages = notice;\nbegin;`);
  const rollback = () => sql(`rollback;`);
  const print = () => console.log(out.join('\n'));

  return { U, sql, as, asService, asOwner, section, check, refused, allowed, remember, g, begin, rollback, print };
}

module.exports = { U, createSuite };
