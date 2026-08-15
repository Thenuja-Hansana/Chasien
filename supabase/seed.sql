-- Local dev seed data, ported from app_reference/src/data/mock.js so the
-- backend and the UI reference agree on who these people and Rooms are.
-- Reloaded every `supabase db reset`. Never run against a real project —
-- password123 for every account, only meaningful on localhost.
--
-- Deliberately not a 1:1 port of every array in mock.js — enough of each
-- domain (Rooms at every visibility level, chat, posts, a poll, a story,
-- a notification, a report) to exercise the schema and RLS for real, plus
-- one account (`outsider`) that belongs to nothing, specifically for
-- verifying Room isolation.

-- ── users ───────────────────────────────────────────────────────────────
-- Inserting into auth.users fires handle_new_user() (identity_and_rooms
-- migration), which creates the matching profiles row from
-- raw_user_meta_data automatically.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'mara@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"handle":"maraclimbs","name":"Mara Oyelaran"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'tobi@example.com',  crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"handle":"tobi","name":"Tobi Andersen"}',       now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'nadia@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"handle":"nadia","name":"Nadia Ruiz"}',         now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'kwame@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"handle":"kwame","name":"Kwame Boateng"}',      now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'rui@example.com',   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"handle":"rui","name":"Rui"}',                  now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'eve@example.com',   crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"handle":"eve","name":"Eve"}',                  now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'outsider@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"handle":"outsider_test","name":"Outside Tester"}', now(), now(), '', '', '', '');

update profiles set bio = 'Structural engineer. Climbs badly, photographs worse. Berlin → Lisbon most winters.'
where id = '11111111-1111-1111-1111-111111111111';

-- ── rooms ───────────────────────────────────────────────────────────────
-- One of each visibility so RLS's per-visibility branch actually gets
-- exercised: public (grit-club, ilford-nights) and request (sourdough,
-- deliberately with no members besides eve — the isolation check target).

insert into rooms (id, slug, name, description, visibility, accent_color, created_by) values
  ('a0000000-0000-0000-0000-000000000001', 'grit-club', 'Grit Club', 'Berlin boulderers, all grades. Session plans, beta, and far too many photos of the same overhang.', 'public', '#e08c4e', '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-000000000002', 'ilford-nights', 'Ilford Nights', 'Film photographers who develop at 2am.', 'public', '#a3b585', '55555555-5555-5555-5555-555555555555'),
  ('a0000000-0000-0000-0000-000000000003', 'sourdough-sunday', 'Sourdough Sunday', 'Starters, crumb shots, and gentle Sunday-morning bread chat.', 'request', '#c0b6a5', '66666666-6666-6666-6666-666666666666');

-- Owner rows for each room's creator already exist — inserted by
-- add_owner_membership_on_room_created when the rooms above were
-- created. Only the additional members need inserting here.
insert into room_memberships (room_id, user_id, role, join_state) values
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member', 'approved'), -- tobi in grit-club
  ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'member', 'approved'), -- nadia in grit-club
  ('a0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'member', 'approved'), -- kwame in grit-club
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'member', 'approved'); -- mara in ilford-nights
-- sourdough-sunday intentionally has only its owner, eve — nobody else,
-- including `outsider`, belongs here. This is the room the isolation
-- check (docs/phase/phase01.md) targets.

-- ── chat ────────────────────────────────────────────────────────────────
-- conversation_participants for these are populated automatically by
-- seed_participants_on_conversation_created (chat.sql) — nothing to
-- insert there directly.

-- add_owner_membership_on_room_created (identity_and_rooms.sql, extended
-- in Phase 6) already auto-created a 'general' channel for every room
-- above the moment it was inserted. grit-club's explicit row below
-- would collide with that (room_channel_name_unique) with a random,
-- non-deterministic id; ilford-nights doesn't collide on name but would
-- end up with an unwanted extra empty 'general' alongside the seeded
-- 'darkroom'. Clearing both first lets the fixed, deterministic ids this
-- file actually references (in the messages/reactions below) win.
-- sourdough-sunday has no explicit row here, so its auto-created
-- 'general' is left alone — that's the intended real behavior, not a
-- gap seed.sql needs to work around.
delete from conversations
where kind = 'room_channel'
  and room_id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002');

insert into conversations (id, kind, room_id, name) values
  ('b0000000-0000-0000-0000-000000000001', 'room_channel', 'a0000000-0000-0000-0000-000000000001', 'general'),
  ('b0000000-0000-0000-0000-000000000002', 'room_channel', 'a0000000-0000-0000-0000-000000000002', 'darkroom');

insert into conversations (id, kind, dm_user_a, dm_user_b) values
  ('b0000000-0000-0000-0000-000000000003', 'dm', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'); -- mara <-> tobi

insert into messages (conversation_id, author_id, text) values
  ('b0000000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'Pushed the HP5 to 1600 last night. Grain is enormous and I love it.'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Stand development? Or did you push the chemistry too'),
  ('b0000000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'Rodinal 1:100, one hour, no agitation after the first minute.');

insert into message_reactions (message_id, user_id, emoji)
select id, '11111111-1111-1111-1111-111111111111', '🔥'
from messages
where conversation_id = 'b0000000-0000-0000-0000-000000000002' and text like 'Rodinal%';

-- ── feed ────────────────────────────────────────────────────────────────

insert into posts (id, room_id, author_id, text, tag) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Finally topped the blue overhang. Fourth week on it. Beta in the comments if anyone wants it.', '#blueproject'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Anyone up for a Thursday 7pm session? Two spots in the car from Kreuzberg.', null);

insert into comments (post_id, author_id, parent_comment_id, text) values
  ('c0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', null, 'that heel hook at the third hold is the whole crux, right?');

insert into comments (post_id, author_id, parent_comment_id, text)
select 'c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', id, 'yes — and keep your hips in. I filmed it, sending the clip.'
from comments where post_id = 'c0000000-0000-0000-0000-000000000001' limit 1;

insert into comments (post_id, author_id, parent_comment_id, text) values
  ('c0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', null, 'four weeks is nothing, I''ve been on the red slab since March 😤');

insert into post_likes (post_id, user_id)
select 'c0000000-0000-0000-0000-000000000001', id from profiles
where id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444');

insert into polls (id, post_id, question) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Coming?');

insert into poll_options (id, poll_id, label, position) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Yes, driving', 0),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'Next week', 1);

insert into poll_votes (poll_id, poll_option_id, user_id) values
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444'),
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222');

-- ── stories ─────────────────────────────────────────────────────────────

insert into stories (room_id, author_id, media_url, caption) values
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'https://placehold.co/720x1280', 'Session 4. It goes. 🧗'),
  ('a0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'https://placehold.co/720x1280', 'Chalk everywhere, no regrets.');

-- ── notifications ──────────────────────────────────────────────────────

insert into notifications (user_id, type, actor_id, room_id, data) values
  ('22222222-2222-2222-2222-222222222222', 'like', '33333333-3333-3333-3333-333333333333', 'a0000000-0000-0000-0000-000000000001', jsonb_build_object('post_id', 'c0000000-0000-0000-0000-000000000001')),
  ('11111111-1111-1111-1111-111111111111', 'join_request', '44444444-4444-4444-4444-444444444444', 'a0000000-0000-0000-0000-000000000001', '{}'::jsonb);

-- ── trust & safety smoke test ──────────────────────────────────────────
-- Proves validate_polymorphic_content_target and content_snapshot both
-- work end to end, not just that the migration applied cleanly.

insert into reports (reporter_id, target_type, target_id, reason, content_snapshot) values
  ('44444444-4444-4444-4444-444444444444', 'post', 'c0000000-0000-0000-0000-000000000001', 'test report — not real, seed data', jsonb_build_object('text', 'Finally topped the blue overhang. Fourth week on it. Beta in the comments if anyone wants it.'));
