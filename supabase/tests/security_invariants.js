// The rules this schema is supposed to keep, read back from the database's
// own catalogs. Nothing here looks at data; each check asks "does anything
// break this rule?" and names what does. A migration that grants too much,
// adds a function nobody meant to expose, or forgets a limit fails here
// without anyone having to remember to test for it.
//
// Where a rule has exceptions they are listed in this file, with the
// reason. Adding to a list is a decision; do it on purpose, in the same
// change as the thing being added.
//
//   node supabase/tests/security_invariants.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
const { createSuite } = require('./sqlsuite');
const { sql, section, invariant, print } = createSuite();

// An empty list still has to be valid inside `in (...)`.
const list = (names) => (names.length ? names.map((n) => `'${n}'`).join(', ') : `''`);
const PUBLIC_TABLES = `select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`;
/** Does `authenticated` hold `priv` on any column of the table? (Column grants don't show as table privileges.) */
const anyColumn = (priv) =>
  `exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and has_column_privilege('authenticated', t.oid, a.attnum, '${priv}'))`;

// --- the lists -------------------------------------------------------------

/** Callable with no session. Signup checks a name against the content filter before an account exists. */
const ANON_FUNCTIONS = ['text_is_allowed'];

/** Callable signed in: what the app calls (mobile/src/lib), and what RLS policies evaluate as the person querying. */
const AUTHENTICATED_FUNCTIONS = [
  // called by the app
  'account_deletion_preview', 'block_status', 'block_user', 'create_event_post', 'create_post', 'current_user_is_app_admin',
  'delete_post', 'get_profile', 'register_push_token', 'remove_comment', 'remove_message', 'remove_story', 'resolve_report',
  'search_profiles', 'set_room_notifications_muted', 'start_dm', 'text_is_allowed', 'toggle_post_pin', 'vote_poll',
  // evaluated by policies
  'is_blocked_with', 'is_conversation_participant', 'is_room_admin', 'is_room_member', 'is_room_moderator', 'is_room_owner',
  'within_upload_quota',
];

/** Text nobody outside the database writes, so it carries no length rule. */
const UNLIMITED_TEXT = [
  'blocked_terms.pattern', // the content filter's own list, from migrations
  'rate_limit_counters.action', // set by triggers and the Edge Function, from constants
  'room_email_verifications.token', // a UUID the Edge Function generates
];

/** Tables people insert into with no rate limit. None: every one has a trigger. */
const UNLIMITED_INSERTS = [];

/** Written only by triggers, SECURITY DEFINER functions or Edge Functions. */
const SERVER_WRITTEN = [
  'rate_limit_counters', 'app_admins', 'account_suspensions', 'blocked_terms', 'moderation_actions', 'room_email_verifications',
  'room_memberships', 'conversations', 'posts', 'post_media', 'polls', 'poll_options', 'events',
];

/**
 * Columns that must never reach a client. The verification token is the
 * proof that someone received an email: readable, it let anyone into a
 * domain-verified Room without the email (found and closed 2026-10-02).
 */
const SECRET_COLUMNS = ['room_email_verifications.token'];

/** Published to Realtime. Realtime applies RLS, so each needs it on; a new one is a new way to read, and belongs here on purpose. */
const REALTIME_TABLES = ['conversation_participants', 'message_reactions', 'messages'];

const CRON_JOBS = ['cleanup-expired-stories-hourly', 'cleanup-unused-media-daily', 'purge-old-notifications-daily', 'purge-rate-limit-counters-hourly'];

// --- the rules -------------------------------------------------------------

sql(`\\set QUIET on\nset client_min_messages = notice;`);

section('rows: every table is behind row-level security');
invariant('every table in public has RLS enabled', `select c.relname::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity`);
invariant(
  'every policy names a role (none is for PUBLIC, which would include signed-out callers)',
  `select schemaname || '.' || tablename || ' "' || policyname || '"' from pg_policies where schemaname in ('public', 'storage') and roles = '{public}'`,
);
invariant(
  'every membership-helper call in a policy asks about auth.uid()',
  `select p.schemaname || '.' || p.tablename || ' "' || p.policyname || '"'
   from (select schemaname, tablename, policyname, regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '\\s+', ' ', 'g') body from pg_policies) p
   where (select count(*) from regexp_matches(p.body, '(is_room_member|is_room_admin|is_room_moderator|is_room_owner|is_conversation_participant)\\(', 'g'))
      <> (select count(*) from regexp_matches(p.body, '(is_room_member|is_room_admin|is_room_moderator|is_room_owner|is_conversation_participant)\\([^,()]+, (auth\\.uid\\(\\)|\\( ?SELECT auth\\.uid\\(\\) AS uid\\))\\)', 'g'))`,
);
invariant('every view runs as the person querying (security_invoker)', `select c.relname::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') <> 'true'`);

section('grants: they say what is true');
invariant(
  'signed-out callers hold no privilege on any table or view',
  `select distinct table_name::text from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon'`,
);
invariant(
  'signed-in callers hold no TRUNCATE, REFERENCES or TRIGGER',
  `select distinct table_name || ':' || privilege_type from information_schema.table_privileges where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`,
);
invariant(
  'no client may set a column the server sets (a default of now() or a generated id)',
  `select c.relname || '.' || a.attname from pg_class c
   join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and pg_get_expr(d.adbin, d.adrelid) ~ '(now\\(\\)|gen_random_uuid\\(\\))'
     and (has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT') or has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE'))`,
);
invariant(
  'every write grant has a policy behind it (otherwise the write succeeds and touches nothing)',
  `select x from (
     select t.relname || ':INSERT' x from (${PUBLIC_TABLES}) t where ${anyColumn('INSERT')} and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname and p.cmd in ('INSERT', 'ALL'))
     union all select t.relname || ':UPDATE' from (${PUBLIC_TABLES}) t where ${anyColumn('UPDATE')} and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname and p.cmd in ('UPDATE', 'ALL'))
     union all select t.relname || ':DELETE' from (${PUBLIC_TABLES}) t where has_table_privilege('authenticated', t.oid, 'DELETE') and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname and p.cmd in ('DELETE', 'ALL'))
   ) q`,
);
invariant(
  'every write policy has a grant behind it (otherwise it reads as a path that one stray grant would open)',
  `select p.tablename || ':' || p.cmd || ' "' || p.policyname || '"' from pg_policies p
   join pg_class t on t.relname = p.tablename and t.relnamespace = 'public'::regnamespace
   where p.schemaname = 'public' and p.cmd in ('INSERT', 'UPDATE', 'DELETE') and not (
     case p.cmd when 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
                when 'INSERT' then ${anyColumn('INSERT')}
                else ${anyColumn('UPDATE')} end)`,
);
invariant(
  'new tables, sequences and functions start closed (no default grant to anon, authenticated or PUBLIC)',
  `select case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' else d.defaclobjtype::text end
          || ' in ' || coalesce(d.defaclnamespace::regnamespace::text, 'every schema') || ' -> ' || coalesce(pg_get_userbyid(a.grantee), 'PUBLIC')
   from pg_default_acl d, aclexplode(d.defaclacl) a
   where pg_get_userbyid(d.defaclrole) = 'postgres' and (d.defaclnamespace = 'public'::regnamespace or d.defaclnamespace = 0)
     and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
   union all
   -- With no global entry for functions, Postgres's built-in default applies: EXECUTE to PUBLIC.
   select 'functions in every schema -> PUBLIC (built-in default never withdrawn)'
   where not exists (select 1 from pg_default_acl d where pg_get_userbyid(d.defaclrole) = 'postgres' and d.defaclnamespace = 0 and d.defaclobjtype = 'f')`,
);

section('functions: an endpoint only if a migration says so');
invariant(
  `callable signed out: exactly ${ANON_FUNCTIONS.join(', ')}`,
  `select coalesce(p.proname::text, w.n) || case when p.proname is null then ' (expected, not callable)' else ' (callable, not expected)' end
   from (select distinct proname from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')) p
   full join (select unnest(array[${list(ANON_FUNCTIONS)}]) n) w on w.n = p.proname where p.proname is null or w.n is null`,
);
invariant(
  `callable signed in: exactly the ${AUTHENTICATED_FUNCTIONS.length} the app calls or its policies evaluate`,
  `select coalesce(p.proname::text, w.n) || case when p.proname is null then ' (expected, not callable)' else ' (callable, not expected)' end
   from (select distinct proname from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', oid, 'execute')) p
   full join (select unnest(array[${list(AUTHENTICATED_FUNCTIONS)}]) n) w on w.n = p.proname where p.proname is null or w.n is null`,
);
invariant(
  'every SECURITY DEFINER function pins its search_path',
  `select p.proname::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
);
invariant(
  'no function has more than one signature (an overload is a second endpoint nobody listed)',
  `select proname::text from pg_proc where pronamespace = 'public'::regnamespace group by proname having count(*) > 1`,
);

section('limits: nothing people write is unbounded');
invariant(
  'every text column has a length or pattern rule',
  `select c.relname || '.' || a.attname from pg_class c
   join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.atttypid in ('text'::regtype, 'varchar'::regtype)
     and c.relname || '.' || a.attname not in (${list(UNLIMITED_TEXT)})
     and not exists (
       select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'c' and (
            pg_get_constraintdef(k.oid) ~ ('char_length\\(\\(?' || a.attname || '\\)?\\)')
         or pg_get_constraintdef(k.oid) ~ ('\\(\\(?' || a.attname || '\\)? ~ ')
         or pg_get_constraintdef(k.oid) ~ ('\\(' || a.attname || ' = ANY')))`,
);
invariant(
  'every table people insert into has a rate limit',
  `select t.relname::text from (${PUBLIC_TABLES}) t where ${anyColumn('INSERT')}
     and t.relname not in (${list(UNLIMITED_INSERTS)})
     and not exists (select 1 from pg_trigger g where g.tgrelid = t.oid and g.tgname = 'rate_limit')`,
);
invariant(
  'the tables only the server writes grant clients no write, and the counters and the filter list no read',
  `select t.relname::text from (${PUBLIC_TABLES}) t
   where t.relname in (${list(SERVER_WRITTEN)})
     and (${anyColumn('INSERT')} or ${anyColumn('UPDATE')} or has_table_privilege('authenticated', t.oid, 'DELETE')
          or (t.relname in ('rate_limit_counters', 'blocked_terms') and ${anyColumn('SELECT')}))`,
);
invariant(
  'no client can read a secret column',
  `select s.col from (select unnest(array[${list(SECRET_COLUMNS)}]) col) s
   where has_column_privilege('authenticated', split_part(s.col, '.', 1)::regclass, split_part(s.col, '.', 2), 'SELECT')
      or has_column_privilege('anon', split_part(s.col, '.', 1)::regclass, split_part(s.col, '.', 2), 'SELECT')`,
);

section('files and realtime');
invariant('no storage bucket is public', `select id::text from storage.buckets where public`);
invariant('every bucket limits file size and file type', `select id::text from storage.buckets where file_size_limit is null or allowed_mime_types is null`);
invariant('uploads are capped by a restrictive policy', `select 'storage.objects has no restrictive INSERT policy' where not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT' and permissive = 'RESTRICTIVE')`);
invariant(
  `Realtime publishes exactly ${REALTIME_TABLES.join(', ')}`,
  `select coalesce(p.tablename::text, w.n) || case when p.tablename is null then ' (expected, not published)' else ' (published, not expected)' end
   from (select tablename from pg_publication_tables where pubname = 'supabase_realtime') p
   full join (select unnest(array[${list(REALTIME_TABLES)}]) n) w on w.n = p.tablename where p.tablename is null or w.n is null`,
);

section('cleanup: what accumulates has a job that removes it');
invariant(
  'the four scheduled jobs exist and are active',
  `select w.n || ' (missing or inactive)' from (select unnest(array[${list(CRON_JOBS)}]) n) w where not exists (select 1 from cron.job j where j.jobname = w.n and j.active)`,
);

print();
