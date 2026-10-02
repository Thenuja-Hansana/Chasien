// Phase 10 slice 3: the doors left by the old blanket grants.
//
//  - a DM could be opened with anyone by inserting the conversation row,
//    around start_dm()'s "must be friends" and "not blocked" rules
//  - a Room admin could write a sub-group row directly, with any member
//    count or creation date, skipping the Edge Function
//  - likes, reactions, hidden posts and push tokens took client-written
//    timestamps
//  - several tables carried write grants nothing could use
//
// Then everything the app itself writes directly, which must still work.
// Run it before the migration to see the failures, after to see them gone.
//
//   node supabase/tests/phase10_slice3_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
const { U, createSuite } = require('./sqlsuite');
const { sql, as, asService, asOwner, section, check, refused, allowed, remember, g, begin, rollback, print } = createSuite();

const DENIED = 'permission denied';

begin();

// A Room of seed accounts to work in: eve owns it, tobi and kwame are
// members, with one post, one chat message and one sub-group.
as('eve');
sql(`insert into rooms (slug, name, visibility, created_by, category) values ('zz-slice3', 'Zz Slice 3', 'request', '${U.eve}', 'Learning');`);
remember('room', `select id from rooms where slug = 'zz-slice3'`);
remember('general', `select id from conversations where room_id = ${g('room')} and is_default`);
asService();
sql(`insert into room_memberships (room_id, user_id, role, join_state) values (${g('room')}, '${U.tobi}', 'member', 'approved'), (${g('room')}, '${U.kwame}', 'member', 'approved');`);
sql(`insert into conversations (kind, room_id, name, visibility, is_default) values ('room_channel', ${g('room')}, 'side room', 'public', false);`);
remember('subgroup', `select id from conversations where room_id = ${g('room')} and not is_default`);
as('eve');
remember('post', `select create_post(p_room_id => ${g('room')}, p_text => 'a post to like, with @tobi', p_tagged_user_ids => array['${U.tobi}']::uuid[], p_poll_question => 'Yes?', p_poll_options => array['yes','no'])`);
sql(`insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.eve}', 'a message to react to');`);
remember('msg', `select id from messages where conversation_id = ${g('general')} and author_id = '${U.eve}'`);

section('the DM door: start_dm() is the only way in');
as('tobi');
refused('tobi, not a friend of kwame, calling start_dm', `perform start_dm('${U.kwame}')`, 'must be friends');
refused('tobi inserting the DM row himself', `insert into conversations (kind, dm_user_a, dm_user_b) values ('dm', '${U.tobi}', '${U.kwame}')`, DENIED);
sql(`insert into friendships (user_a, user_b, requested_by) values ('${U.tobi}', '${U.kwame}', '${U.tobi}');`);
refused('still refused while the request is only pending', `perform start_dm('${U.kwame}')`, 'must be friends');
as('kwame');
sql(`update friendships set status = 'accepted' where user_a = '${U.tobi}' and user_b = '${U.kwame}';`);
as('tobi');
remember('dm', `select start_dm('${U.kwame}')`);
check('once friends, start_dm opens the DM and returns the same one a second time', `${g('dm')} = start_dm('${U.kwame}')`);
allowed('tobi sends into it', `insert into messages (conversation_id, author_id, text) values (${g('dm')}, '${U.tobi}', 'hello')`);
as('kwame');
check('kwame sees the DM and its message', `(select count(*) from conversations where id = ${g('dm')}) = 1 and (select count(*) from messages where conversation_id = ${g('dm')}) = 1`);
check('kwame gets the same DM from his side', `${g('dm')} = start_dm('${U.tobi}')`);
as('outsider');
check('an outsider sees neither', `(select count(*) from conversations where id = ${g('dm')}) = 0 and (select count(*) from messages where conversation_id = ${g('dm')}) = 0`);
refused('an outsider cannot open a DM on tobi\'s behalf', `insert into conversations (kind, dm_user_a, dm_user_b) values ('dm', '${U.tobi}', '${U.eve}')`, DENIED);
as('kwame');
sql(`select block_user('${U.tobi}') \\gset zz_`);
as('tobi');
refused('after a block, start_dm refuses', `perform start_dm('${U.kwame}')`, 'can.t message this person');

section('sub-groups: only through the Edge Function (service role)');
as('eve');
refused(
  'the owner inserting a sub-group row herself, with a made-up member count',
  `insert into conversations (kind, room_id, name, is_default, member_count, created_at) values ('room_channel', ${g('room')}, 'direct', false, 9999, '2020-01-01')`,
  DENIED,
);
refused('the owner updating a sub-group row herself', `update conversations set member_count = 9999 where id = ${g('subgroup')}`, DENIED);
refused('the owner deleting a sub-group row herself', `delete from conversations where id = ${g('subgroup')}`, DENIED);
check('she still sees every channel of her Room', `(select count(*) from conversations where room_id = ${g('room')}) = 2`);
asService();
allowed('the service role still creates, renames and deletes one', `
  insert into conversations (kind, room_id, name, visibility, is_default) values ('room_channel', ${g('room')}, 'made by the function', 'public', false);
  update conversations set name = 'renamed' where room_id = ${g('room')} and name = 'made by the function';
  delete from conversations where room_id = ${g('room')} and name = 'renamed'`);

section('timestamps come from the server');
as('tobi');
refused('a like dated 2020', `insert into post_likes (post_id, user_id, created_at) values (${g('post')}, '${U.tobi}', '2020-01-01')`, DENIED);
allowed('a like the way the app sends it', `insert into post_likes (post_id, user_id) values (${g('post')}, '${U.tobi}')`);
refused('re-dating the like afterwards', `update post_likes set created_at = '2020-01-01' where post_id = ${g('post')} and user_id = '${U.tobi}'`, DENIED);
refused('a reaction dated 2020', `insert into message_reactions (message_id, user_id, emoji, created_at) values (${g('msg')}, '${U.tobi}', '👍', '2020-01-01')`, DENIED);
allowed('a reaction the way the app sends it', `insert into message_reactions (message_id, user_id, emoji) values (${g('msg')}, '${U.tobi}', '👍')`);
refused('a hidden post dated 2020', `insert into hidden_posts (post_id, user_id, hidden_at) values (${g('post')}, '${U.tobi}', '2020-01-01')`, DENIED);
allowed('hiding a post the way the app does', `insert into hidden_posts (post_id, user_id) values (${g('post')}, '${U.tobi}')`);
refused('a push token inserted directly', `insert into push_tokens (user_id, token, platform, created_at) values ('${U.tobi}', 'ExponentPushToken[zz-direct]', 'android', '2020-01-01')`, DENIED);
allowed('a push token through register_push_token()', `perform register_push_token('ExponentPushToken[zz-slice3]', 'android')`);
refused('re-dating his own push token', `update push_tokens set created_at = '2020-01-01' where user_id = '${U.tobi}'`, DENIED);
asOwner();
check(
  'the like, the reaction, the hide and the token are all dated now',
  `(select created_at > now() - interval '1 minute' from post_likes where post_id = ${g('post')} and user_id = '${U.tobi}')
   and (select created_at > now() - interval '1 minute' from message_reactions where message_id = ${g('msg')} and user_id = '${U.tobi}')
   and (select hidden_at > now() - interval '1 minute' from hidden_posts where post_id = ${g('post')} and user_id = '${U.tobi}')
   and (select created_at > now() - interval '1 minute' from push_tokens where token = 'ExponentPushToken[zz-slice3]')`,
);

section('grants that nothing could use: refused outright now, not filtered to nothing');
as('tobi');
refused('inserting his own membership', `insert into room_memberships (room_id, user_id, role, join_state) values (${g('room')}, '${U.tobi}', 'owner', 'approved')`, DENIED);
refused('promoting himself', `update room_memberships set role = 'owner' where room_id = ${g('room')} and user_id = '${U.tobi}'`, DENIED);
refused('deleting a membership', `delete from room_memberships where room_id = ${g('room')} and user_id = '${U.kwame}'`, DENIED);
// A write to my_inbox is refused for being a non-updatable view before its
// grants are ever consulted, so read the grants themselves.
check(
  'the my_inbox view carries no write grant, and still reads',
  `not has_table_privilege('authenticated', 'my_inbox', 'INSERT') and not has_table_privilege('authenticated', 'my_inbox', 'UPDATE')
   and not has_table_privilege('authenticated', 'my_inbox', 'DELETE') and (select count(*) from my_inbox) >= 1`,
);
refused('deleting a post row', `delete from posts where id = ${g('post')}`, DENIED);
refused('deleting a message row', `delete from messages where id = ${g('msg')}`, DENIED);
refused('deleting a comment row', `delete from comments where post_id = ${g('post')}`, DENIED);
refused('deleting his own profile row', `delete from profiles where id = '${U.tobi}'`, DENIED);
refused('deleting a chat participant row', `delete from conversation_participants where conversation_id = ${g('general')} and user_id = '${U.tobi}'`, DENIED);

section('every direct write the app makes still works (mobile/src/lib)');
as('tobi');
allowed('posts.ts: comment', `insert into comments (post_id, author_id, text) values (${g('post')}, '${U.tobi}', 'nice')`);
allowed('posts.ts: unlike', `delete from post_likes where post_id = ${g('post')} and user_id = '${U.tobi}'`);
allowed('posts.ts: remove my own tag', `delete from post_tags where post_id = ${g('post')} and user_id = '${U.tobi}'`);
allowed('posts.ts: vote, then retract (vote_poll deletes as the caller)', `
  perform vote_poll((select id from polls where post_id = ${g('post')}), (select o.id from poll_options o join polls pl on pl.id = o.poll_id where pl.post_id = ${g('post')} order by o.position limit 1));
  perform vote_poll((select id from polls where post_id = ${g('post')}), (select o.id from poll_options o join polls pl on pl.id = o.poll_id where pl.post_id = ${g('post')} order by o.position limit 1))`);
allowed('chat.ts: message into the Room chat', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'hi')`);
allowed('chat.ts: remove my reaction', `delete from message_reactions where message_id = ${g('msg')} and user_id = '${U.tobi}' and emoji = '👍'`);
allowed('chat.ts: mark the chat read', `update conversation_participants set last_read_at = now() where conversation_id = ${g('general')} and user_id = '${U.tobi}'`);
allowed('notifications.ts: mark read, then delete', `
  update notifications set read_at = now() where user_id = '${U.tobi}';
  delete from notifications where user_id = '${U.tobi}'`);
allowed('profiles.ts: edit bio, and the presence heartbeat', `
  update profiles set bio = 'zz' where id = '${U.tobi}';
  update profiles set last_active_at = now() where id = '${U.tobi}'`);
allowed('reports.ts: report a post', `insert into reports (reporter_id, target_type, target_id, reason) values ('${U.tobi}', 'post', ${g('post')}, 'spam')`);
allowed('stories.ts: add a story', `insert into stories (room_id, author_id, media_url, caption) values (${g('room')}, '${U.tobi}', ${g('room')}::text || '/${U.tobi}/zz.jpg', 'zz')`);
allowed('friends.ts: unfriend', `delete from friendships where user_a = '${U.tobi}' and user_b = '${U.kwame}'`);
as('kwame');
allowed('blocks.ts: unblock', `delete from blocks where blocker_id = '${U.kwame}' and blocked_id = '${U.tobi}'`);
as('eve');
allowed('rooms.ts: change Room settings', `update rooms set description = 'zz', members_can_post = false where id = ${g('room')}`);
asOwner();
check(
  'and each of those landed',
  `(select count(*) from comments where post_id = ${g('post')} and author_id = '${U.tobi}') = 1
   and (select count(*) from post_likes where post_id = ${g('post')}) = 0
   and (select count(*) from post_tags where post_id = ${g('post')}) = 0
   and (select count(*) from poll_votes v join polls pl on pl.id = v.poll_id where pl.post_id = ${g('post')}) = 0
   and (select count(*) from message_reactions where message_id = ${g('msg')}) = 0
   and (select bio from profiles where id = '${U.tobi}') = 'zz'
   and (select count(*) from friendships where user_a = '${U.tobi}' and user_b = '${U.kwame}') = 0
   and (select count(*) from blocks where blocker_id = '${U.kwame}') = 0
   and (select not members_can_post from rooms where id = ${g('room')})
   and (select count(*) from stories where room_id = ${g('room')}) = 1`,
);

section('everything above is rolled back');
rollback();
sql(`select 'after rollback: ' || (select count(*) from rooms) || ' rooms, ' || (select count(*) from conversations) || ' conversations, ' || (select count(*) from notifications) || ' notifications, ' || (select count(*) from posts) || ' posts, ' || (select count(*) from messages) || ' messages, ' || (select count(*) from push_tokens) || ' push tokens, ' || (select count(*) from friendships) || ' friendships, ' || (select count(*) from blocks) || ' blocks';`);

print();
