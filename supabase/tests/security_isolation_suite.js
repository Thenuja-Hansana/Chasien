// The core invariant, table by table: what a Room holds is readable by its
// approved members and by nobody else.
//
// One throwaway Room with one of everything in it (a post with media, a
// poll and tags, an event, comments, likes, a story, chat messages and a
// reaction, a sub-group, a DM between two of its members, a report, a
// moderation action, notifications). Then each table is read as:
//
//   a member            sees it
//   an outsider         sees nothing
//   a pending requester sees nothing but their own request
//   a removed member    sees nothing
//   a member the author has blocked   sees none of that author's content
//   a signed-out caller is refused outright
//
// Rows are found by ids remembered while building the Room, never by a
// subquery, because a subquery is filtered by RLS too and would make every
// table look empty to an outsider for the wrong reason.
//
//   node supabase/tests/security_isolation_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
const { U, createSuite } = require('./sqlsuite');
const { sql, as, asService, asOwner, section, check, refused, remember, g, begin, rollback, print } = createSuite();

const ROOM = g('room');
const count = (table, where) => `(select count(*) from ${table} where ${where})`;

begin();

// --- the Room -------------------------------------------------------------
// eve owns it. rui is a mod, tobi and mara members, nadia has asked to
// join, kwame was a member and has been removed. eve has blocked mara.
as('eve');
sql(`insert into rooms (slug, name, visibility, created_by, category) values ('zz-iso', 'Zz Isolation', 'request', '${U.eve}', 'Learning');`);
sql(`insert into rooms (slug, name, visibility, created_by, category) values ('zz-iso-invite', 'Zz Isolation Invite', 'invite', '${U.eve}', 'Learning');`);
remember('room', `select id from rooms where slug = 'zz-iso'`);
remember('inviteroom', `select id from rooms where slug = 'zz-iso-invite'`);
remember('general', `select id from conversations where room_id = ${ROOM} and is_default`);
asService();
sql(`insert into room_memberships (room_id, user_id, role, join_state) values
  (${ROOM}, '${U.rui}', 'mod', 'approved'), (${ROOM}, '${U.tobi}', 'member', 'approved'), (${ROOM}, '${U.mara}', 'member', 'approved'),
  (${ROOM}, '${U.kwame}', 'member', 'approved'), (${ROOM}, '${U.nadia}', 'member', 'pending');`);
sql(`insert into conversations (kind, room_id, name, visibility, is_default) values ('room_channel', ${ROOM}, 'side room', 'public', false);`);
remember('subgroup', `select id from conversations where room_id = ${ROOM} and not is_default`);
as('eve');
sql(`select block_user('${U.mara}') \\gset zz_`);
remember(
  'post',
  `select create_post(p_room_id => ${ROOM}, p_text => 'hello @tobi', p_media_paths => array[${ROOM}::text || '/${U.eve}/a.jpg'], p_poll_question => 'Q?', p_poll_options => array['a','b'], p_tagged_user_ids => array['${U.tobi}']::uuid[])`,
);
remember('event', `select create_event_post(p_room_id => ${ROOM}, p_text => 'come', p_event_title => 'Meet', p_event_starts_at => now() + interval '1 day')`);
asOwner();
remember('poll', `select id from polls where post_id = ${g('post')}`);
as('eve');
sql(`insert into comments (post_id, author_id, text) values (${g('post')}, '${U.eve}', 'first');`);
sql(`insert into stories (room_id, author_id, media_url, caption) values (${ROOM}, '${U.eve}', ${ROOM}::text || '/${U.eve}/s.jpg', 'a story');`);
sql(`insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.eve}', 'hello Room');`);
asOwner();
remember('msg', `select id from messages where conversation_id = ${g('general')} and author_id = '${U.eve}'`);
as('tobi');
sql(`insert into post_likes (post_id, user_id) values (${g('post')}, '${U.tobi}');`);
sql(`select vote_poll(${g('poll')}, (select id from poll_options where poll_id = ${g('poll')} order by position limit 1)) \\gset zz_`);
sql(`insert into comments (post_id, author_id, text) values (${g('post')}, '${U.tobi}', 'second');`);
sql(`insert into message_reactions (message_id, user_id, emoji) values (${g('msg')}, '${U.tobi}', '👍');`);
sql(`insert into hidden_posts (post_id, user_id) values (${g('event')}, '${U.tobi}');`);
sql(`insert into reports (reporter_id, target_type, target_id, reason) values ('${U.tobi}', 'post', ${g('post')}, 'spam');`);
sql(`select register_push_token('ExponentPushToken[zz-iso]', 'android') \\gset zz_`);
sql(`insert into friendships (user_a, user_b, requested_by) values ('${U.tobi}', '${U.rui}', '${U.tobi}');`);
as('rui');
sql(`update friendships set status = 'accepted' where user_a = '${U.tobi}' and user_b = '${U.rui}';`);
sql(`select remove_comment(p_comment_id => (select id from comments where post_id = ${g('post')} and author_id = '${U.tobi}'), p_reason => 'off topic') \\gset zz_`);
as('tobi');
// A second friend request, left pending (mara < tobi, so she is user_a).
sql(`insert into friendships (user_a, user_b, requested_by) values ('${U.mara}', '${U.tobi}', '${U.tobi}');`);
remember('dm', `select start_dm('${U.rui}')`);
sql(`insert into messages (conversation_id, author_id, text) values (${g('dm')}, '${U.tobi}', 'psst');`);
asService();
sql(`delete from room_memberships where room_id = ${ROOM} and user_id = '${U.kwame}';`);

// --- what each table holds for this Room, by remembered id -----------------
const ROOM_TABLES = [
  ['posts', `room_id = ${ROOM}`],
  ['post_media', `post_id = ${g('post')}`],
  ['polls', `post_id = ${g('post')}`],
  ['poll_options', `poll_id = ${g('poll')}`],
  ['poll_votes', `poll_id = ${g('poll')}`],
  ['events', `post_id = ${g('event')}`],
  ['post_tags', `post_id = ${g('post')}`],
  ['post_likes', `post_id = ${g('post')}`],
  ['comments', `post_id = ${g('post')}`],
  ['stories', `room_id = ${ROOM}`],
  ['messages', `conversation_id = ${g('general')}`],
  ['message_reactions', `message_id = ${g('msg')}`],
  ['conversations', `room_id = ${ROOM}`],
  ['conversation_participants', `conversation_id = ${g('general')}`],
  ['room_memberships', `room_id = ${ROOM}`],
  ['moderation_actions', `room_id = ${ROOM}`],
];

asOwner();
section('the Room really holds one of everything');
for (const [table, where] of ROOM_TABLES) check(`${table}: rows exist`, `${count(table, where)} > 0`);

section('a member reads the Room');
as('tobi');
for (const [table, where] of ROOM_TABLES.filter(([t]) => t !== 'moderation_actions')) check(`member: ${table}`, `${count(table, where)} > 0`);
as('rui');
check('mod: the moderation log', `${count('moderation_actions', `room_id = ${ROOM}`)} > 0`);

for (const [who, label] of [
  ['outsider', 'an outsider'],
  ['kwame', 'a removed member'],
  ['nadia', 'a pending requester'],
]) {
  section(`${label} reads none of it`);
  as(who);
  for (const [table, where] of ROOM_TABLES) {
    if (who === 'nadia' && table === 'room_memberships') {
      check(`${label}: room_memberships shows only their own request`, `(select array_agg(user_id) from room_memberships where room_id = ${ROOM}) = array['${U.nadia}']::uuid[]`);
    } else {
      check(`${label}: ${table}`, `${count(table, where)} = 0`);
    }
  }
  check(`${label}: the request-to-join Room is listed, the invite-only one is not`, `${count('rooms', `id = ${ROOM}`)} = 1 and ${count('rooms', `id = ${g('inviteroom')}`)} = 0`);
  refused(`${label}: posting into it`, `perform create_post(p_room_id => ${ROOM}, p_text => 'let me in')`, 'can.t post in this Room');
  refused(`${label}: chatting in it`, `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U[who]}', 'hello?')`, 'row-level security');
  refused(`${label}: adding a story`, `insert into stories (room_id, author_id, media_url) values (${ROOM}, '${U[who]}', ${ROOM}::text || '/${U[who]}/x.jpg')`, 'row-level security');
  refused(`${label}: commenting`, `insert into comments (post_id, author_id, text) values (${g('post')}, '${U[who]}', 'hi')`, 'row-level security');
  refused(`${label}: liking`, `insert into post_likes (post_id, user_id) values (${g('post')}, '${U[who]}')`, 'row-level security');
}

section('a member the author has blocked reads none of that author\'s content');
as('mara');
for (const [table, where] of [
  ['posts', `room_id = ${ROOM} and author_id = '${U.eve}'`],
  ['post_media', `post_id = ${g('post')}`],
  ['polls', `post_id = ${g('post')}`],
  ['poll_options', `poll_id = ${g('poll')}`],
  ['poll_votes', `poll_id = ${g('poll')}`],
  ['events', `post_id = ${g('event')}`],
  ['post_tags', `post_id = ${g('post')}`],
  ['post_likes', `post_id = ${g('post')}`],
  ['comments', `post_id = ${g('post')} and author_id = '${U.eve}'`],
  ['stories', `room_id = ${ROOM} and author_id = '${U.eve}'`],
]) {
  check(`blocked: ${table}`, `${count(table, where)} = 0`);
}
check('blocked: the Room, its members and its channels are still there (she is a member)', `${count('rooms', `id = ${ROOM}`)} = 1 and ${count('room_memberships', `room_id = ${ROOM}`)} > 0 and ${count('conversations', `room_id = ${ROOM}`)} > 0`);
check('blocked: Room chat is the deliberate exception, readable and collapsed on the device', `${count('messages', `conversation_id = ${g('general')} and author_id = '${U.eve}'`)} = 1`);
check('blocked: she cannot see that she is blocked by reading the table', `${count('blocks', `blocked_id = '${U.mara}'`)} = 0`);

section('a DM belongs to its two people');
as('rui');
check('the other person reads it', `${count('messages', `conversation_id = ${g('dm')}`)} = 1 and ${count('conversations', `id = ${g('dm')}`)} = 1`);
for (const who of ['eve', 'outsider']) {
  as(who);
  check(`${who}: reads no message, conversation or participant of it`, `${count('messages', `conversation_id = ${g('dm')}`)} = 0 and ${count('conversations', `id = ${g('dm')}`)} = 0 and ${count('conversation_participants', `conversation_id = ${g('dm')}`)} = 0`);
  refused(`${who}: writing into it`, `insert into messages (conversation_id, author_id, text) values (${g('dm')}, '${U[who]}', 'hi')`, 'row-level security');
}

section('what is one person\'s own stays theirs');
as('tobi');
check('tobi sees his own hidden posts, push token, and both his friendships', `${count('hidden_posts', `user_id = '${U.tobi}'`)} = 1 and ${count('push_tokens', `user_id = '${U.tobi}'`)} >= 1 and ${count('friendships', `user_a = '${U.tobi}' or user_b = '${U.tobi}'`)} = 2`);
as('eve');
check('eve, owner of the Room, sees none of tobi\'s hidden posts, push tokens or notifications', `${count('hidden_posts', `user_id = '${U.tobi}'`)} = 0 and ${count('push_tokens', `user_id = '${U.tobi}'`)} = 0 and ${count('notifications', `user_id = '${U.tobi}'`)} = 0`);
// Friends lists are shown on profiles, so an accepted friendship is public
// on purpose (lib/friends.ts). A request that hasn't been answered is not.
check('an accepted friendship is public by design; a pending request is its two people\'s only', `${count('friendships', `user_a = '${U.tobi}' and user_b = '${U.rui}'`)} = 1 and ${count('friendships', `user_a = '${U.mara}' and user_b = '${U.tobi}'`)} = 0`);
check('nor the report about her own post', `${count('reports', `target_id = ${g('post')}`)} = 0`);
check('she sees only her own notifications', `${count('notifications', `user_id <> '${U.eve}'`)} = 0 and ${count('notifications', `user_id = '${U.eve}'`)} > 0`);
check('account_suspensions: nothing for someone who isn\'t an app admin', `${count('account_suspensions', 'true')} = 0`);
for (const table of ['app_admins', 'rate_limit_counters', 'blocked_terms']) refused(`${table}: not readable at all`, `perform * from ${table}`, 'permission denied');
refused('the verification token: not readable', `perform token from room_email_verifications`, 'permission denied');

section('signed out: every table and view is refused outright');
sql(`reset role; set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true) \\gset zz_`);
for (const table of [
  'rooms', 'room_memberships', 'profiles', 'posts', 'post_media', 'polls', 'poll_options', 'poll_votes', 'events', 'post_tags', 'post_likes', 'comments',
  'stories', 'conversations', 'conversation_participants', 'messages', 'message_reactions', 'notifications', 'friendships', 'blocks', 'hidden_posts',
  'reports', 'moderation_actions', 'push_tokens', 'room_email_verifications', 'account_suspensions', 'app_admins', 'blocked_terms', 'rate_limit_counters', 'my_inbox',
]) {
  refused(`signed out: ${table}`, `perform * from ${table}`, 'permission denied');
}

section('everything above is rolled back');
rollback();
sql(`select 'after rollback: ' || (select count(*) from rooms) || ' rooms, ' || (select count(*) from posts) || ' posts, ' || (select count(*) from messages) || ' messages, ' || (select count(*) from notifications) || ' notifications, ' || (select count(*) from blocks) || ' blocks, ' || (select count(*) from friendships) || ' friendships, ' || (select count(*) from reports) || ' reports';`);

print();
