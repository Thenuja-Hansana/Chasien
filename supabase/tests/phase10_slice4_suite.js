// Phase 10 slice 4: what a post is gets decided in one place.
//
// create_post() and create_event_post() used to run with the caller's own
// rights, so the caller could also write posts, post_media, polls,
// poll_options and events directly and skip them. This checks that the
// only way to make a post, or anything attached to one, is the two
// functions; that the limits the app applies are applied by the server;
// and that who may post is exactly who could before.
//
// Run it before the migration to see the failures, after to see them gone.
//
//   node supabase/tests/phase10_slice4_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
const { U, createSuite } = require('./sqlsuite');
const { sql, as, asService, asOwner, section, check, refused, allowed, remember, g, begin, rollback, print } = createSuite();

const DENIED = 'permission denied';
const NOT_HERE = 'can.t post in this Room';
const ROOM = g('room');
/** n media paths in this Room's folder, under `who`. */
const media = (who, n) => `(select array_agg(${ROOM}::text || '/${U[who]}/' || i || '.jpg') from generate_series(1, ${n}) i)`;
const options = (n) => `(select array_agg('option ' || i) from generate_series(1, ${n}) i)`;

begin();

// eve owns the Room; rui is a mod, tobi a member, nadia has asked to join.
as('eve');
sql(`insert into rooms (slug, name, visibility, created_by, category) values ('zz-slice4', 'Zz Slice 4', 'request', '${U.eve}', 'Learning');`);
remember('room', `select id from rooms where slug = 'zz-slice4'`);
asService();
sql(`insert into room_memberships (room_id, user_id, role, join_state) values
  (${ROOM}, '${U.rui}', 'mod', 'approved'), (${ROOM}, '${U.tobi}', 'member', 'approved'), (${ROOM}, '${U.nadia}', 'member', 'pending');`);
asOwner();
sql(`select set_config('zz.term', (select term from blocked_terms order by length(term) desc limit 1), true) \\gset zz_`);

section('the two functions still make every kind of post');
as('eve');
remember('plain', `select create_post(p_room_id => ${ROOM}, p_text => '  a plain post  ')`);
remember('polled', `select create_post(p_room_id => ${ROOM}, p_text => 'a poll post', p_poll_question => 'Which?', p_poll_options => array['a', '  ', 'b'], p_poll_allow_multiple => true)`);
remember(
  'withmedia',
  `select create_post(p_room_id => ${ROOM}, p_media_paths => ${media('eve', 2)}, p_location => 'Colombo',
     p_media_framing => '[{"shape":"square","zoom":1.5,"focusX":0.5,"focusY":0.5}, {"videoAspect":0.5625}]'::jsonb, p_tagged_user_ids => array['${U.tobi}','${U.outsider}']::uuid[])`,
);
remember('event', `select create_event_post(p_room_id => ${ROOM}, p_text => 'come along', p_event_title => 'Meet', p_event_starts_at => now() + interval '1 day', p_event_location => 'Park')`);
asOwner();
check('a plain post: text trimmed, the caller is the author', `(select text = 'a plain post' and author_id = '${U.eve}' from posts where id = ${g('plain')})`);
check('a poll post: blank options dropped, multiple answers kept', `(select count(*) from poll_options o join polls pl on pl.id = o.poll_id where pl.post_id = ${g('polled')}) = 2 and (select allow_multiple from polls where post_id = ${g('polled')})`);
check(
  'a media post: two items in order, framing and location kept, the member tagged and the outsider dropped',
  `(select array_agg(position order by position) = array[0, 1]::smallint[] from post_media where post_id = ${g('withmedia')})
   and (select crop_shape = 'square' and crop_zoom = 1.5 from post_media where post_id = ${g('withmedia')} and position = 0)
   and (select video_aspect = 0.5625::real from post_media where post_id = ${g('withmedia')} and position = 1)
   and (select location = 'Colombo' from posts where id = ${g('withmedia')})
   and (select array_agg(user_id) = array['${U.tobi}']::uuid[] from post_tags where post_id = ${g('withmedia')})`,
);
check('an event post', `(select title = 'Meet' and location = 'Park' from events where post_id = ${g('event')})`);
as('eve');
allowed('exactly 10 media and exactly 4 options are fine', `
  perform create_post(p_room_id => ${ROOM}, p_media_paths => ${media('eve', 10)});
  perform create_post(p_room_id => ${ROOM}, p_text => 'four', p_poll_question => 'Q?', p_poll_options => ${options(4)})`);

section('the limits the app applies, applied by the server');
refused('11 media items', `perform create_post(p_room_id => ${ROOM}, p_media_paths => ${media('eve', 11)})`, 'at most 10');
refused('a 5-option poll', `perform create_post(p_room_id => ${ROOM}, p_text => 'five', p_poll_question => 'Q?', p_poll_options => ${options(5)})`, 'at most 4');
refused('a 1-option poll', `perform create_post(p_room_id => ${ROOM}, p_text => 'one', p_poll_question => 'Q?', p_poll_options => array['only', ' '])`, 'at least two');
refused('a post with nothing in it', `perform create_post(p_room_id => ${ROOM}, p_text => '   ', p_location => 'somewhere')`, 'needs text');
refused(
  'media from another Room\'s folder',
  `perform create_post(p_room_id => ${ROOM}, p_media_paths => array['a0000000-0000-0000-0000-000000000001/${U.eve}/x.jpg'])`,
  'uploaded to this Room',
);
refused('media uploaded by someone else', `perform create_post(p_room_id => ${ROOM}, p_media_paths => array[${ROOM}::text || '/${U.tobi}/x.jpg'])`, 'uploaded to this Room');
refused('a media path that climbs out of the folder', `perform create_post(p_room_id => ${ROOM}, p_media_paths => array[${ROOM}::text || '/${U.eve}/../../other/x.jpg'])`, 'uploaded to this Room');
refused('an event with no title', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => '  ', p_event_starts_at => now())`, 'needs a title');
refused('an event that ends before it starts', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'x', p_event_starts_at => now(), p_event_ends_at => now() - interval '1 hour')`, 'end time');
refused('a post the content filter refuses', `perform create_post(p_room_id => ${ROOM}, p_text => 'well ' || current_setting('zz.term') || ' then')`, '');

section('nothing can be attached, changed or made around the functions');
refused('a post row inserted directly', `insert into posts (room_id, author_id, text) values (${ROOM}, '${U.eve}', 'direct')`, DENIED);
refused('a poll attached to an existing post', `insert into polls (post_id, question) values (${g('plain')}, 'added later')`, DENIED);
refused('an option added to a live poll', `insert into poll_options (poll_id, label, position) values ((select id from polls where post_id = ${g('polled')}), 'late', 9)`, DENIED);
refused('a poll question reworded', `update polls set question = 'changed' where post_id = ${g('polled')}`, DENIED);
refused('a poll deleted', `delete from polls where post_id = ${g('polled')}`, DENIED);
refused('an event attached to a poll post', `insert into events (post_id, title, starts_at) values (${g('polled')}, 'late event', now())`, DENIED);
refused('an event moved', `update events set starts_at = now() + interval '9 days' where post_id = ${g('event')}`, DENIED);
refused('media added to an old post', `insert into post_media (post_id, url, position) values (${g('plain')}, ${ROOM}::text || '/${U.eve}/late.jpg', 0)`, DENIED);
refused('media removed from a published post', `delete from post_media where post_id = ${g('withmedia')}`, DENIED);
refused('people tagged on a post after the fact', `perform tag_people_in_post(${g('plain')}, array['${U.tobi}']::uuid[])`, DENIED);
asOwner();
check('and none of it happened', `(select count(*) from polls where post_id = ${g('plain')}) = 0 and (select count(*) from post_media where post_id = ${g('withmedia')}) = 2 and (select count(*) from post_tags where post_id = ${g('plain')}) = 0`);

section('who may post: exactly who could before');
as('tobi');
allowed('a member, while the Room lets members post', `perform create_post(p_room_id => ${ROOM}, p_text => 'tobi here'); perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'tobi event', p_event_starts_at => now() + interval '2 days')`);
as('outsider');
refused('an outsider: create_post', `perform create_post(p_room_id => ${ROOM}, p_text => 'let me in')`, NOT_HERE);
refused('an outsider: create_event_post', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'x', p_event_starts_at => now())`, NOT_HERE);
as('nadia');
refused('someone whose join request is still pending', `perform create_post(p_room_id => ${ROOM}, p_text => 'pending')`, NOT_HERE);
as('tobi');
refused('a Room that does not exist gets the same answer', `perform create_post(p_room_id => '00000000-0000-0000-0000-000000000000', p_text => 'nowhere')`, NOT_HERE);
as('eve');
sql(`update rooms set members_can_post = false where id = ${ROOM};`);
as('tobi');
refused('a member, once only moderators can post: create_post', `perform create_post(p_room_id => ${ROOM}, p_text => 'not now')`, NOT_HERE);
refused('a member, once only moderators can post: create_event_post', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'x', p_event_starts_at => now())`, NOT_HERE);
as('rui');
allowed('a mod still can', `perform create_post(p_room_id => ${ROOM}, p_text => 'mod post'); perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'mod event', p_event_starts_at => now() + interval '3 days')`);
as('eve');
allowed('the owner still can', `perform create_post(p_room_id => ${ROOM}, p_text => 'owner post')`);
sql(`update rooms set members_can_post = true where id = ${ROOM};`);
asService();
sql(`delete from room_memberships where room_id = ${ROOM} and user_id = '${U.tobi}';`);
as('tobi');
refused('a member who has been removed', `perform create_post(p_room_id => ${ROOM}, p_text => 'still here?')`, NOT_HERE);
sql(`reset role; set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true) \\gset zz_`);
refused('signed out: create_post', `perform create_post(p_room_id => ${ROOM}, p_text => 'anon')`, DENIED);
refused('signed out: create_event_post', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'x', p_event_starts_at => now())`, DENIED);
asOwner();
check(
  'every post in the Room is authored by whoever called the function',
  `(select array_agg(distinct p.handle order by p.handle) from posts po join profiles p on p.id = po.author_id where po.room_id = ${ROOM}) = array['eve','rui','tobi']
   and not exists (select 1 from posts where room_id = ${ROOM} and text in ('let me in', 'pending', 'not now', 'still here?', 'anon', 'direct'))`,
);

section('reading is unchanged: members read, outsiders read nothing');
as('rui');
check('a member reads the posts, the poll, the event and the media', `(select count(*) from posts where room_id = ${ROOM}) >= 4 and (select count(*) from polls where post_id = ${g('polled')}) = 1 and (select count(*) from events where post_id = ${g('event')}) = 1 and (select count(*) from post_media where post_id = ${g('withmedia')}) = 2`);
allowed('and votes', `perform vote_poll((select id from polls where post_id = ${g('polled')}), (select o.id from poll_options o join polls pl on pl.id = o.poll_id where pl.post_id = ${g('polled')} order by o.position limit 1))`);
as('outsider');
check('an outsider reads none of them', `(select count(*) from posts where room_id = ${ROOM}) = 0 and (select count(*) from polls where post_id = ${g('polled')}) = 0 and (select count(*) from events where post_id = ${g('event')}) = 0 and (select count(*) from post_media where post_id = ${g('withmedia')}) = 0`);

section('everything above is rolled back');
rollback();
sql(`select 'after rollback: ' || (select count(*) from rooms) || ' rooms, ' || (select count(*) from posts) || ' posts, ' || (select count(*) from post_media) || ' media, ' || (select count(*) from polls) || ' polls, ' || (select count(*) from events) || ' events, ' || (select count(*) from notifications) || ' notifications';`);

print();
