// Phase 10 slice 6: limits, so one account can't fill the database or the
// file store.
//
//  - how long text can be (20261002140000)
//  - how often one person can do something, per minute or hour and per day
//    (20261002140100)
//  - how many files a person can upload in a day (20261002140200)
//  - which stored files count as unused, and which notifications are old
//    enough to delete (20261002140300, 20261002140100)
//
// A transaction's now() doesn't move, so everything a suite does lands in
// one minute, one hour and one day: "the 31st message this minute" needs
// no waiting. Run it before the migrations to see the failures.
//
//   node supabase/tests/phase10_slice6_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
const { U, createSuite } = require('./sqlsuite');
const { sql, as, asService, asOwner, section, check, refused, allowed, remember, g, begin, rollback, print } = createSuite();

const TOO_LONG = 'violates check constraint';
const TOO_OFTEN = 'too often';
const DENIED = 'permission denied';
const ROOM = g('room');
const x = (n) => `repeat('x', ${n})`;
/** Run a statement n times. `i` is the loop counter, for statements that need distinct values. */
const times = (n, stmt) => `for i in 1..${n} loop ${stmt}; end loop`;

begin();

// A Room of seed accounts: eve owns it, tobi and kwame are members.
as('eve');
sql(`insert into rooms (slug, name, visibility, created_by, category) values ('zz-slice6', 'Zz Slice 6', 'request', '${U.eve}', 'Learning');`);
remember('room', `select id from rooms where slug = 'zz-slice6'`);
remember('general', `select id from conversations where room_id = ${ROOM} and is_default`);
asService();
sql(`insert into room_memberships (room_id, user_id, role, join_state) values (${ROOM}, '${U.tobi}', 'member', 'approved'), (${ROOM}, '${U.kwame}', 'member', 'approved');`);
as('eve');
remember('post', `select create_post(p_room_id => ${ROOM}, p_text => 'a post', p_poll_question => 'Q?', p_poll_options => array['a','b'])`);
sql(`insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.eve}', 'a message');`);
remember('msg', `select id from messages where conversation_id = ${g('general')} and author_id = '${U.eve}'`);

section('how long text can be: the limit itself is accepted, one more is not');
as('kwame');
allowed('a 2,000-character post', `perform create_post(p_room_id => ${ROOM}, p_text => ${x(2000)})`);
refused('a 2,001-character post', `perform create_post(p_room_id => ${ROOM}, p_text => ${x(2001)})`, TOO_LONG);
allowed('a 1,000-character comment', `insert into comments (post_id, author_id, text) values (${g('post')}, '${U.kwame}', ${x(1000)})`);
refused('a 1,001-character comment', `insert into comments (post_id, author_id, text) values (${g('post')}, '${U.kwame}', ${x(1001)})`, TOO_LONG);
allowed('a 4,000-character message', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.kwame}', ${x(4000)})`);
refused('a 4,001-character message', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.kwame}', ${x(4001)})`, TOO_LONG);
allowed('a 160-character bio and a 50-character name', `update profiles set bio = ${x(160)}, name = ${x(50)} where id = '${U.kwame}'`);
refused('a 161-character bio', `update profiles set bio = ${x(161)} where id = '${U.kwame}'`, TOO_LONG);
refused('a 51-character name', `update profiles set name = ${x(51)} where id = '${U.kwame}'`, TOO_LONG);
refused('an empty name', `update profiles set name = '' where id = '${U.kwame}'`, TOO_LONG);
allowed('a 200-character story caption', `insert into stories (room_id, author_id, media_url, caption) values (${ROOM}, '${U.kwame}', ${ROOM}::text || '/${U.kwame}/a.jpg', ${x(200)})`);
refused('a 201-character story caption', `insert into stories (room_id, author_id, media_url, caption) values (${ROOM}, '${U.kwame}', ${ROOM}::text || '/${U.kwame}/b.jpg', ${x(201)})`, TOO_LONG);
allowed('a 150-character poll question with 60-character options', `perform create_post(p_room_id => ${ROOM}, p_poll_question => ${x(150)}, p_poll_options => array[${x(60)}, 'b'])`);
refused('a 151-character poll question', `perform create_post(p_room_id => ${ROOM}, p_poll_question => ${x(151)}, p_poll_options => array['a', 'b'])`, TOO_LONG);
refused('a 61-character poll option', `perform create_post(p_room_id => ${ROOM}, p_poll_question => 'Q?', p_poll_options => array[${x(61)}, 'b'])`, TOO_LONG);
allowed('an event with a 100-character title and location and a 500-character link', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => ${x(100)}, p_event_starts_at => now() + interval '1 day', p_event_location => ${x(100)}, p_event_link => ${x(500)})`);
refused('a 101-character event title', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => ${x(101)}, p_event_starts_at => now() + interval '1 day')`, TOO_LONG);
refused('a 501-character event link', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'x', p_event_starts_at => now() + interval '1 day', p_event_link => ${x(501)})`, TOO_LONG);
refused('a 17-character reaction', `insert into message_reactions (message_id, user_id, emoji) values (${g('msg')}, '${U.kwame}', ${x(17)})`, TOO_LONG);
as('eve');
allowed('a 300-character Room description', `update rooms set description = ${x(300)} where id = ${ROOM}`);
refused('a 301-character Room description', `update rooms set description = ${x(301)} where id = ${ROOM}`, TOO_LONG);
refused('a 51-character Room name', `insert into rooms (slug, name, visibility, created_by, category) values ('zz-slice6-long', ${x(51)}, 'public', '${U.eve}', 'Learning')`, TOO_LONG);
asService();
allowed('a sub-group with a 50-character name and 300-character description (written by the Edge Function)', `insert into conversations (kind, room_id, name, description, visibility, is_default) values ('room_channel', ${ROOM}, ${x(50)}, ${x(300)}, 'public', false)`);
refused('a sub-group with a 51-character name', `insert into conversations (kind, room_id, name, visibility, is_default) values ('room_channel', ${ROOM}, ${x(51)}, 'public', false)`, TOO_LONG);

section('how often: chat messages, 30 a minute and 2,000 a day');
as('tobi');
allowed('30 messages in a minute', times(30, `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'message ' || i)`));
refused('the 31st', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'one too many')`, TOO_OFTEN);
refused('and the one after: a refusal doesn\'t reset anything', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'still too many')`, TOO_OFTEN);
as('kwame');
allowed('someone else in the same chat is not affected', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.kwame}', 'hello')`);
asService();
allowed('nor is the service role: 40 in one go', times(40, `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'from a function ' || i)`));
asOwner();
check('the counter stopped at the limit, and counted only what tobi sent himself', `(select count from rate_limit_counters where user_id = '${U.tobi}' and action = 'message' and bucket = 'minute') = 30`);
// The daily cap, without sending 2,000 messages: move today's counter to
// one short of it, in a new minute.
sql(`update rate_limit_counters set count = 1999 where user_id = '${U.tobi}' and action = 'message' and bucket = 'day';`);
sql(`delete from rate_limit_counters where user_id = '${U.tobi}' and action = 'message' and bucket = 'minute';`);
as('tobi');
allowed('with 1,999 sent today, the 2,000th goes', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'number 2000')`);
refused('the 2,001st does not, though this minute has room', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'number 2001')`, TOO_OFTEN);

section('how often: everything else');
as('tobi');
allowed('10 comments in a minute', times(10, `insert into comments (post_id, author_id, text) values (${g('post')}, '${U.tobi}', 'comment ' || i)`));
refused('the 11th comment', `insert into comments (post_id, author_id, text) values (${g('post')}, '${U.tobi}', 'one too many')`, TOO_OFTEN);
allowed('60 likes in a minute (like, unlike, like...)', times(60, `insert into post_likes (post_id, user_id) values (${g('post')}, '${U.tobi}'); delete from post_likes where post_id = ${g('post')} and user_id = '${U.tobi}'`));
refused('the 61st like', `insert into post_likes (post_id, user_id) values (${g('post')}, '${U.tobi}')`, TOO_OFTEN);
allowed('60 reactions in a minute', times(60, `insert into message_reactions (message_id, user_id, emoji) values (${g('msg')}, '${U.tobi}', '👍'); delete from message_reactions where message_id = ${g('msg')} and user_id = '${U.tobi}'`));
refused('the 61st reaction', `insert into message_reactions (message_id, user_id, emoji) values (${g('msg')}, '${U.tobi}', '👍')`, TOO_OFTEN);
allowed('10 posts in an hour, events included', `${times(8, `perform create_post(p_room_id => ${ROOM}, p_text => 'post ' || i)`)}; ${times(2, `perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'event ' || i, p_event_starts_at => now() + interval '1 day')`)}`);
refused('the 11th post', `perform create_post(p_room_id => ${ROOM}, p_text => 'one too many')`, TOO_OFTEN);
refused('the 11th, as an event', `perform create_event_post(p_room_id => ${ROOM}, p_event_title => 'one too many', p_event_starts_at => now() + interval '1 day')`, TOO_OFTEN);
allowed('10 stories in an hour', times(10, `insert into stories (room_id, author_id, media_url) values (${ROOM}, '${U.tobi}', ${ROOM}::text || '/${U.tobi}/' || i || '.jpg')`));
refused('the 11th story', `insert into stories (room_id, author_id, media_url) values (${ROOM}, '${U.tobi}', ${ROOM}::text || '/${U.tobi}/11.jpg')`, TOO_OFTEN);
allowed('10 reports in an hour', times(10, `insert into reports (reporter_id, target_type, target_id, reason) select '${U.tobi}', 'post', id, 'spam' from posts where room_id = ${ROOM} and author_id = '${U.tobi}' order by created_at, id offset i - 1 limit 1`));
refused('the 11th report', `insert into reports (reporter_id, target_type, target_id, reason) values ('${U.tobi}', 'post', ${g('post')}, 'spam')`, TOO_OFTEN);
allowed('20 friend requests in an hour (ask, withdraw, ask...)', times(20, `insert into friendships (user_a, user_b, requested_by) values ('${U.tobi}', '${U.kwame}', '${U.tobi}'); delete from friendships where user_a = '${U.tobi}' and user_b = '${U.kwame}'`));
refused('the 21st friend request', `insert into friendships (user_a, user_b, requested_by) values ('${U.tobi}', '${U.kwame}', '${U.tobi}')`, TOO_OFTEN);
allowed('5 Rooms in a day', times(5, `insert into rooms (slug, name, visibility, created_by, category) values ('zz-slice6-t' || i, 'Zz T ' || i, 'public', '${U.tobi}', 'Learning')`));
refused('the 6th Room', `insert into rooms (slug, name, visibility, created_by, category) values ('zz-slice6-t6', 'Zz T 6', 'public', '${U.tobi}', 'Learning')`, TOO_OFTEN);
asOwner();
check(
  'nothing refused was written',
  `not exists (select 1 from messages where text in ('one too many', 'still too many', 'number 2001'))
   and not exists (select 1 from comments where text = 'one too many')
   and not exists (select 1 from posts where text = 'one too many')
   and not exists (select 1 from rooms where slug = 'zz-slice6-t6')
   and (select count(*) from posts where room_id = ${ROOM} and author_id = '${U.tobi}') = 10`,
);

section('uploads: 50 files in any 24 hours, counted from what is stored');
// Rows as the Storage service records them: owner_id is the uploader.
asOwner();
sql(`insert into storage.objects (bucket_id, name, owner_id, created_at)
  select 'post-media', ${ROOM}::text || '/${U.kwame}/quota-' || i || '.jpg', '${U.kwame}', now() - interval '1 hour' from generate_series(1, 49) i;`);
sql(`insert into storage.objects (bucket_id, name, owner_id, created_at)
  select 'post-media', ${ROOM}::text || '/${U.kwame}/yesterday-' || i || '.jpg', '${U.kwame}', now() - interval '25 hours' from generate_series(1, 30) i;`);
as('kwame');
check('with 49 files in the last day (and 30 older ones), one more is allowed', `within_upload_quota()`);
asOwner();
sql(`insert into storage.objects (bucket_id, name, owner_id, created_at) values ('post-media', ${ROOM}::text || '/${U.kwame}/quota-50.jpg', '${U.kwame}', now());`);
as('kwame');
check('with 50, the next is not', `not within_upload_quota()`);
as('tobi');
check('someone else still is', `within_upload_quota()`);

section('the counters are nobody\'s to read or reset');
as('tobi');
refused('reading the counters', `perform * from rate_limit_counters`, DENIED);
refused('clearing your own counters', `delete from rate_limit_counters where user_id = '${U.tobi}'`, DENIED);
refused('calling hit_rate_limit directly', `perform hit_rate_limit('${U.kwame}', 'message', 'minute', 1)`, DENIED);
refused('listing unused files', `perform * from unused_media()`, DENIED);
refused('purging notifications', `perform purge_old_notifications()`, DENIED);

section('cleanup: old notifications, and which stored files count as unused');
asOwner();
sql(`insert into notifications (user_id, type, actor_id, room_id, created_at) values
  ('${U.tobi}', 'like', '${U.eve}', ${ROOM}, now() - interval '91 days'),
  ('${U.tobi}', 'like', '${U.eve}', ${ROOM}, now() - interval '89 days');`);
sql(`select purge_old_notifications() \\gset zz_`);
check('a 91-day-old notification is deleted, an 89-day-old one kept', `(select count(*) from notifications where user_id = '${U.tobi}' and room_id = ${ROOM} and created_at < now() - interval '80 days') = 1`);
// Five files in eve's folder in post-media, as the Storage API would have
// recorded them. (kwame's old unattached files from the upload check above
// are unused too, and rightly listed; these two checks look at eve's only.)
sql(`insert into storage.objects (bucket_id, name, created_at) values
  ('post-media', ${ROOM}::text || '/${U.eve}/live.jpg', now() - interval '3 days'),
  ('post-media', ${ROOM}::text || '/${U.eve}/never-attached-old.jpg', now() - interval '25 hours'),
  ('post-media', ${ROOM}::text || '/${U.eve}/never-attached-new.jpg', now() - interval '1 hour'),
  ('post-media', ${ROOM}::text || '/${U.eve}/removed-8-days.jpg', now() - interval '30 days'),
  ('post-media', ${ROOM}::text || '/${U.eve}/removed-2-days.jpg', now() - interval '30 days');`);
as('eve');
remember('live', `select create_post(p_room_id => ${ROOM}, p_media_paths => array[${ROOM}::text || '/${U.eve}/live.jpg'])`);
remember('gone8', `select create_post(p_room_id => ${ROOM}, p_media_paths => array[${ROOM}::text || '/${U.eve}/removed-8-days.jpg'])`);
remember('gone2', `select create_post(p_room_id => ${ROOM}, p_media_paths => array[${ROOM}::text || '/${U.eve}/removed-2-days.jpg'])`);
asOwner();
sql(`update posts set deleted_at = now() - interval '8 days' where id = ${g('gone8')};`);
sql(`update posts set deleted_at = now() - interval '2 days' where id = ${g('gone2')};`);
check(
  'unused: the upload never attached (25 hours old) and the media of the post removed 8 days ago',
  `(select array_agg(split_part(path, '/', 3) order by path) from unused_media() where path like ${ROOM}::text || '/${U.eve}/%') = array['never-attached-old.jpg', 'removed-8-days.jpg']`,
);
check('not unused: a live post\'s file, an hour-old upload, and media removed 2 days ago', `not exists (select 1 from unused_media() where path like ${ROOM}::text || '/${U.eve}/%' and split_part(path, '/', 3) in ('live.jpg', 'never-attached-new.jpg', 'removed-2-days.jpg'))`);

section('everything above is rolled back');
rollback();
sql(`select 'after rollback: ' || (select count(*) from rooms) || ' rooms, ' || (select count(*) from posts) || ' posts, ' || (select count(*) from messages) || ' messages, ' || (select count(*) from notifications) || ' notifications, ' || (select count(*) from storage.objects) || ' files, ' || (select count(*) from profiles where bio is not null) || ' bios';`);

print();
