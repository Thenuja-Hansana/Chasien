// Phase 10 slice 5: a blocked person can't read your bio, banner or "last
// active", while names, handles and avatars stay readable by everyone
// signed in (they appear wherever Room members are shown).
//
// The table used to let any signed-in person read every column of every
// profile; the screens hid the three fields between blocked people, the API
// didn't. Now the table gives out only id, handle, name and avatar, and
// get_profile() returns the rest, blanked when there is a block in either
// direction.
//
// Run it before the migration to see the failures, after to see them gone.
//
//   node supabase/tests/phase10_slice5_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
const { U, createSuite } = require('./sqlsuite');
const { sql, as, asOwner, section, check, refused, allowed, begin, rollback, print } = createSuite();

const DENIED = 'permission denied';
/** One row of get_profile() as a single boolean expression over its columns. */
const profile = (who, expr) => `(select ${expr} from get_profile('${U[who]}'))`;

begin();

// kwame has a bio, a banner and a recent heartbeat, and blocks tobi.
as('kwame');
sql(`update profiles set bio = 'kwame''s bio', banner_url = '${U.kwame}/banner.jpg', last_active_at = now() where id = '${U.kwame}';`);
sql(`select block_user('${U.tobi}') \\gset zz_`);
as('tobi');
sql(`update profiles set bio = 'tobi''s bio', last_active_at = now() where id = '${U.tobi}';`);

section('the table gives out names, not details');
as('eve');
check('anyone signed in reads id, handle, name and avatar', `(select handle = 'kwame' and name is not null from (select id, handle, name, avatar_url from profiles where id = '${U.kwame}') p)`);
// The rest as tobi, the person kwame blocked: this is the read that mattered.
as('tobi');
check('so does the blocked person: names show wherever Room members do', `(select handle = 'kwame' from (select id, handle, name, avatar_url from profiles where id = '${U.kwame}') p)`);
refused('reading bio from the table', `perform bio from profiles where id = '${U.kwame}'`, DENIED);
refused('reading last_active_at from the table', `perform last_active_at from profiles where id = '${U.kwame}'`, DENIED);
refused('reading banner_url from the table', `perform banner_url from profiles where id = '${U.kwame}'`, DENIED);
refused('select * from the table', `perform * from profiles where id = '${U.kwame}'`, DENIED);
refused('filtering on a hidden column to guess it', `perform id from profiles where bio like 'kwame%'`, DENIED);
refused('sorting by last_active_at to see who is online', `perform id from profiles order by last_active_at desc`, DENIED);

section('get_profile(): everything for people who aren\'t blocked');
as('eve');
check('eve sees kwame\'s bio, banner and last active', profile('kwame', `handle = 'kwame' and bio = 'kwame''s bio' and banner_url is not null and last_active_at is not null`));
as('kwame');
check('kwame sees his own', profile('kwame', `bio = 'kwame''s bio' and banner_url is not null and last_active_at is not null`));
check('a person who doesn\'t exist is zero rows, not an error', `(select count(*) from get_profile('00000000-0000-0000-0000-000000000000')) = 0`);

section('get_profile(): blanks between blocked people, both ways');
as('tobi');
check('tobi, blocked by kwame, still gets his handle and name', profile('kwame', `handle = 'kwame' and name is not null`));
check('but not his bio, banner or last active', profile('kwame', `bio is null and banner_url is null and last_active_at is null`));
as('kwame');
check('kwame, who did the blocking, doesn\'t see tobi\'s either', profile('tobi', `handle = 'tobi' and bio is null and last_active_at is null`));
sql(`delete from blocks where blocker_id = '${U.kwame}' and blocked_id = '${U.tobi}';`);
as('tobi');
check('after the unblock, tobi sees them again', profile('kwame', `bio = 'kwame''s bio' and last_active_at is not null`));

section('signed out');
sql(`reset role; set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true) \\gset zz_`);
refused('get_profile', `perform * from get_profile('${U.kwame}')`, DENIED);
refused('reading the table', `perform handle from profiles`, DENIED);

section('what the app does to its own profile still works');
as('tobi');
allowed('edit name and bio (profiles.ts)', `update profiles set name = 'Tobi Two', bio = 'new bio' where id = '${U.tobi}'`);
allowed('the presence heartbeat (auth-context.tsx)', `update profiles set last_active_at = now() where id = '${U.tobi}'`);
refused('changing his handle', `update profiles set handle = 'someone_else' where id = '${U.tobi}'`, DENIED);
// Not an error: RLS filters someone else's row out, so this touches nothing.
sql(`update profiles set bio = 'defaced' where id = '${U.kwame}';`);
asOwner();
check('his edits landed, and an edit aimed at someone else\'s profile changed nothing',`(select name = 'Tobi Two' and bio = 'new bio' from profiles where id = '${U.tobi}') and (select bio = 'kwame''s bio' from profiles where id = '${U.kwame}')`);

section('everything that shows a name still reads it');
as('tobi');
check('a join from posts to their authors (the feed\'s embed)', `(select count(*) from posts p join profiles pr on pr.id = p.author_id where p.room_id = (select id from rooms where slug = 'grit-club')) > 0`);
check('search_profiles', `exists (select 1 from search_profiles('eve') where handle = 'eve')`);
check('the inbox view, which joins profiles for DM names', `(select count(*) from my_inbox) >= 0`);
allowed('reporting a person, whose target check reads profiles', `insert into reports (reporter_id, target_type, target_id, reason) values ('${U.tobi}', 'user', '${U.kwame}', 'spam')`);
asOwner();
check('and the report\'s snapshot, taken by a trigger, still has the bio', `(select content_snapshot::text like '%kwame''s bio%' from reports where reporter_id = '${U.tobi}' and target_id = '${U.kwame}')`);

section('everything above is rolled back');
rollback();
sql(`select 'after rollback: ' || (select count(*) from profiles) || ' profiles, ' || (select count(*) filter (where bio is not null) from profiles) || ' with a bio, ' || (select count(*) from blocks) || ' blocks, ' || (select count(*) from reports) || ' reports, ' || (select count(*) from notifications) || ' notifications';`);

print();
