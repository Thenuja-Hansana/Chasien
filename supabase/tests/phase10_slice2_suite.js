// Phase 10 slice 2: does everything still work once functions are closed by
// default and the membership helpers only answer about the caller?
//
// Prints one SQL script. Every statement runs the way PostgREST runs a
// request (role + JWT claims set for one account), inside a single
// transaction that is rolled back, so nothing is left behind and no push is
// sent (pg_net only sends on commit).
//
//   node supabase/tests/phase10_slice2_suite.js | docker exec -i supabase_db_chasien psql -U postgres -d postgres -X -q -t -A
const U = {
  tobi: '22222222-2222-2222-2222-222222222222',
  nadia: '33333333-3333-3333-3333-333333333333',
  kwame: '44444444-4444-4444-4444-444444444444',
  rui: '55555555-5555-5555-5555-555555555555',
  eve: '66666666-6666-6666-6666-666666666666',
  outsider: '77777777-7777-7777-7777-777777777777',
};
const out = [];
const sql = (s) => out.push(s.trim());
const as = (who) =>
  sql(`reset role; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U[who]}","role":"authenticated"}', true) \\gset zz_`);
const asService = () => sql(`reset role; set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true) \\gset zz_`);
const asOwner = () => sql(`reset role; select set_config('request.jwt.claims', '', true) \\gset zz_`);
const section = (t) => sql(`\\echo\n\\echo == ${t}`);
/** One line: PASS/FAIL + label, from a boolean SQL expression. */
const check = (label, expr) => sql(`select case when (${expr}) then 'PASS  ' else 'FAIL  ' end || '${label.replace(/'/g, "''")}';`);
/** A statement that must be refused. Prints the reason, so a refusal for the wrong reason is visible. */
const refused = (label, stmt) =>
  sql(`do $$ begin ${stmt}; raise notice 'FAIL  ${label.replace(/'/g, "''")} (was allowed)'; exception when others then raise notice 'PASS  ${label.replace(/'/g, "''")}  [refused: %]', sqlerrm; end $$;`);
const remember = (name, expr) => sql(`select set_config('zz.${name}', (${expr})::text, true) \\gset zz_`);
const R = `current_setting('zz.room')::uuid`;
const g = (name) => `current_setting('zz.${name}')::uuid`;

sql(`\\set QUIET on\n\\set ON_ERROR_STOP off\nset client_min_messages = notice;\nbegin;`);
asOwner();
remember('n0', `select count(*) from notifications`);

section('a Room is created by a signed-in person; the owner trigger and General channel follow');
as('eve');
sql(`insert into rooms (slug, name, visibility, created_by, category) values ('zz-slice2', 'Zz Slice 2', 'request', '${U.eve}', 'Learning');`);
remember('room', `select id from rooms where slug = 'zz-slice2'`);
check('eve owns the Room she created', `select role = 'owner' and join_state = 'approved' from room_memberships where room_id = ${R} and user_id = '${U.eve}'`);
check('its General channel exists and eve is in it', `exists (select 1 from conversations c where c.room_id = ${R} and c.is_default) and is_conversation_participant((select id from conversations where room_id = ${R} and is_default), '${U.eve}')`);
remember('general', `select id from conversations where room_id = ${R} and is_default`);

section('join requests, written the way the room-membership Edge Function writes them (service role)');
asService();
sql(`insert into room_memberships (room_id, user_id, role, join_state) values
  (${R}, '${U.kwame}', 'admin', 'approved'), (${R}, '${U.rui}', 'mod', 'approved'), (${R}, '${U.tobi}', 'member', 'approved');`);
sql(`insert into room_memberships (room_id, user_id, role, join_state) values (${R}, '${U.nadia}', 'member', 'pending');`);
asOwner();
check(
  'the request notified exactly owner, admin and mod (not the member, not the requester)',
  `(select array_agg(p.handle order by p.handle) from notifications n join profiles p on p.id = n.user_id where n.room_id = ${R} and n.type = 'join_request' and n.actor_id = '${U.nadia}') = array['eve','kwame','rui']`,
);

section('the helpers: truthful about the caller, false about anyone else');
as('tobi');
check('tobi about tobi: member', `is_room_member(${R}, '${U.tobi}')`);
check('tobi about tobi: not a moderator', `not is_room_moderator(${R}, '${U.tobi}')`);
check('tobi about eve (who IS the owner): false', `not is_room_member(${R}, '${U.eve}') and not is_room_owner(${R}, '${U.eve}')`);
check('tobi reads the member list through the table (he is a member)', `(select count(*) from room_memberships where room_id = ${R} and join_state = 'approved') = 4`);
as('rui');
check('rui about rui: moderator, not admin', `is_room_moderator(${R}, '${U.rui}') and not is_room_admin(${R}, '${U.rui}')`);
as('kwame');
check('kwame about kwame: admin, not owner', `is_room_admin(${R}, '${U.kwame}') and not is_room_owner(${R}, '${U.kwame}')`);
as('eve');
check('eve about eve: owner', `is_room_owner(${R}, '${U.eve}')`);
as('outsider');
check('outsider about outsider: not a member', `not is_room_member(${R}, '${U.outsider}')`);
check('outsider about tobi (who IS a member): false', `not is_room_member(${R}, '${U.tobi}')`);
check('outsider reads zero memberships of the Room', `(select count(*) from room_memberships where room_id = ${R}) = 0`);
refused('outsider calling notify_mentions', `perform notify_mentions('@tobi', ${R}, '${U.eve}', '{}'::jsonb)`);
refused('outsider calling room_rank', `perform room_rank(${R}, '${U.tobi}')`);

section('posting with mentions, tags and a poll (create_post -> tag_people_in_post, mention trigger -> notify_mentions)');
as('eve');
remember(
  'post1',
  `select create_post(p_room_id => ${R}, p_text => 'hello @tobi and @kwame and @outsider_test', p_poll_question => 'Best?', p_poll_options => array['a','b'], p_tagged_user_ids => array['${U.tobi}','${U.outsider}']::uuid[])`,
);
asOwner();
check('the post exists with its poll and two options', `(select count(*) from poll_options o join polls pl on pl.id = o.poll_id where pl.post_id = ${g('post1')}) = 2`);
check('tagged: tobi only (the outsider is silently dropped)', `(select array_agg(p.handle) from post_tags t join profiles p on p.id = t.user_id where t.post_id = ${g('post1')}) = array['tobi']`);
check(
  'mentioned: tobi and kwame, not the outsider',
  `(select array_agg(p.handle order by p.handle) from notifications n join profiles p on p.id = n.user_id where n.room_id = ${R} and n.type = 'mention' and n.actor_id = '${U.eve}') = array['kwame','tobi']`,
);
check('tobi got a tag notification', `exists (select 1 from notifications where type = 'tag' and user_id = '${U.tobi}' and actor_id = '${U.eve}')`);
as('outsider');
check('outsider cannot read the post, its poll or its tags', `(select count(*) from posts where id = ${g('post1')}) = 0 and (select count(*) from polls where post_id = ${g('post1')}) = 0 and (select count(*) from post_tags where post_id = ${g('post1')}) = 0`);
refused('outsider posting into the Room', `perform create_post(p_room_id => ${R}, p_text => 'let me in')`);

section('a member reads, likes, comments with a mention, votes');
as('tobi');
check('tobi reads the post', `(select count(*) from posts where id = ${g('post1')}) = 1`);
sql(`insert into post_likes (post_id, user_id) values (${g('post1')}, '${U.tobi}');`);
sql(`insert into comments (post_id, author_id, text) values (${g('post1')}, '${U.tobi}', '@eve nice one');`);
remember('comment1', `select id from comments where post_id = ${g('post1')} and author_id = '${U.tobi}'`);
sql(`select vote_poll((select id from polls where post_id = ${g('post1')}), (select o.id from poll_options o join polls pl on pl.id = o.poll_id where pl.post_id = ${g('post1')} order by o.position limit 1)) \\gset zz_`);
asOwner();
check('eve was told about the like', `exists (select 1 from notifications where type = 'like' and user_id = '${U.eve}' and actor_id = '${U.tobi}')`);
check('eve was mentioned by the comment', `exists (select 1 from notifications where type = 'mention' and user_id = '${U.eve}' and actor_id = '${U.tobi}')`);
check('the vote landed', `(select count(*) from poll_votes v join polls pl on pl.id = v.poll_id where pl.post_id = ${g('post1')} and v.user_id = '${U.tobi}') = 1`);
as('eve');
remember('event1', `select create_event_post(p_room_id => ${R}, p_text => 'come along', p_event_title => 'Meet', p_event_starts_at => now() + interval '1 day', p_event_location => 'Park')`);
asOwner();
check('an event post was created', `exists (select 1 from events where post_id = ${g('event1')})`);

section('removal and pinning: rank decides (can_remove_content -> room_rank)');
as('tobi');
remember('post2', `select create_post(p_room_id => ${R}, p_text => 'tobi was here')`);
refused('member tobi deleting owner eve\'s post', `perform delete_post(p_post_id => ${g('post1')})`);
refused('member tobi pinning a post', `perform toggle_post_pin(${g('post1')}, true)`);
as('rui');
refused('mod rui deleting owner eve\'s post (does not outrank her)', `perform delete_post(p_post_id => ${g('post1')})`);
sql(`select delete_post(p_post_id => ${g('post2')}, p_reason => 'off topic') \\gset zz_`);
sql(`select toggle_post_pin(${g('post1')}, true) \\gset zz_`);
asOwner();
check('mod rui removed member tobi\'s post, and it was logged', `(select deleted_at is not null from posts where id = ${g('post2')}) and exists (select 1 from moderation_actions where actor_id = '${U.rui}' and room_id = ${R})`);
check('mod rui pinned the post', `(select pinned from posts where id = ${g('post1')})`);
as('eve');
sql(`select remove_comment(p_comment_id => ${g('comment1')}) \\gset zz_`);
asOwner();
check('owner eve removed tobi\'s comment', `(select deleted_at is not null from comments where id = ${g('comment1')})`);

section('group chat, stories');
as('tobi');
sql(`insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.tobi}', 'hi all');`);
remember('msg1', `select id from messages where conversation_id = ${g('general')} and author_id = '${U.tobi}'`);
sql(`insert into stories (room_id, author_id, media_url, caption) values (${R}, '${U.tobi}', ${R}::text || '/${U.tobi}/zz.jpg', 'zz');`);
remember('story1', `select id from stories where room_id = ${R} and author_id = '${U.tobi}'`);
as('kwame');
check('admin kwame reads the message and the story', `(select count(*) from messages where id = ${g('msg1')}) = 1 and (select count(*) from stories where id = ${g('story1')}) = 1`);
as('outsider');
check('outsider reads neither', `(select count(*) from messages where conversation_id = ${g('general')}) = 0 and (select count(*) from stories where room_id = ${R}) = 0`);
refused('outsider sending into the Room chat', `insert into messages (conversation_id, author_id, text) values (${g('general')}, '${U.outsider}', 'hello?')`);
as('rui');
sql(`select remove_message(p_message_id => ${g('msg1')}) \\gset zz_`);
sql(`select remove_story(p_story_id => ${g('story1')}) \\gset zz_`);
asOwner();
check('mod rui removed the message and the story', `(select deleted_at is not null from messages where id = ${g('msg1')}) and (select expires_at <= now() from stories where id = ${g('story1')})`);

section('friends, a DM, and who may ask who is in it');
as('tobi');
sql(`insert into friendships (user_a, user_b, requested_by) values ('${U.tobi}', '${U.kwame}', '${U.tobi}');`);
as('kwame');
sql(`update friendships set status = 'accepted' where user_a = '${U.tobi}' and user_b = '${U.kwame}';`);
as('tobi');
remember('dm', `select start_dm('${U.kwame}')`);
sql(`insert into messages (conversation_id, author_id, text) values (${g('dm')}, '${U.tobi}', 'psst');`);
check('tobi about tobi in the DM: participant', `is_conversation_participant(${g('dm')}, '${U.tobi}')`);
check('tobi about kwame in the DM (who IS in it): false', `not is_conversation_participant(${g('dm')}, '${U.kwame}')`);
as('kwame');
check('kwame reads the DM message', `(select count(*) from messages where conversation_id = ${g('dm')}) = 1`);
as('outsider');
check('outsider reads nothing of the DM and gets false about its participants', `(select count(*) from messages where conversation_id = ${g('dm')}) = 0 and not is_conversation_participant(${g('dm')}, '${U.tobi}')`);
asOwner();
check('friend request and acceptance notified both ways', `exists (select 1 from notifications where type = 'friend_request' and user_id = '${U.kwame}') and exists (select 1 from notifications where type = 'friend_accept' and user_id = '${U.tobi}')`);

section('blocking (block_user, block_status, is_blocked_with inside search_profiles and start_dm)');
as('kwame');
sql(`select block_user('${U.tobi}') \\gset zz_`);
as('tobi');
check('tobi no longer finds kwame in search', `not exists (select 1 from search_profiles('kwame') where handle = 'kwame')`);
check('block_status answers', `(select block_status('${U.kwame}')) is not null`);
refused('tobi messaging kwame after the block', `insert into messages (conversation_id, author_id, text) values (${g('dm')}, '${U.tobi}', 'still there?')`);
as('eve');
check('eve still finds kwame in search', `exists (select 1 from search_profiles('kwame') where handle = 'kwame')`);

section('reports, app admin, the rest of what the app calls');
as('tobi');
sql(`insert into reports (reporter_id, target_type, target_id, reason) values ('${U.tobi}', 'post', ${g('post1')}, 'spam');`);
check('tobi is not an app admin', `not current_user_is_app_admin()`);
refused('tobi resolving a report', `perform resolve_report((select id from reports where reporter_id = '${U.tobi}' limit 1), 'dismissed')`);
sql(`select register_push_token('ExponentPushToken[zz-slice2]', 'android') \\gset zz_`);
sql(`select set_room_notifications_muted(${R}, true) \\gset zz_`);
check('account_deletion_preview answers', `(select account_deletion_preview()) is not null`);
check('text_is_allowed answers', `text_is_allowed('hello there')`);
asOwner();
check('the report captured its snapshot and reached the app admin', `(select content_snapshot is not null from reports where reporter_id = '${U.tobi}' and target_id = ${g('post1')}) and exists (select 1 from notifications n join app_admins a on a.user_id = n.user_id where n.type = 'report_filed')`);
check('the push token was registered to tobi', `exists (select 1 from push_tokens where token = 'ExponentPushToken[zz-slice2]' and user_id = '${U.tobi}')`);
check('tobi muted the Room', `(select notifications_muted from room_memberships where room_id = ${R} and user_id = '${U.tobi}')`);

section('everything above is rolled back');
sql(`select 'notifications written inside the transaction: ' || (count(*) - current_setting('zz.n0')::int) from notifications;`);
sql(`rollback;`);
sql(`select 'after rollback: ' || (select count(*) from rooms) || ' rooms, ' || (select count(*) from room_memberships) || ' memberships, ' || (select count(*) from notifications) || ' notifications, ' || (select count(*) from posts) || ' posts, ' || (select count(*) from messages) || ' messages, ' || (select count(*) from push_tokens) || ' push tokens, ' || (select count(*) from friendships) || ' friendships';`);

console.log(out.join('\n'));
