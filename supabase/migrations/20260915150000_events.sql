-- The Event tab in the create-post modal (Post/Clip/Poll/Event). Deliberately
-- the smallest version of "an event" that still earns its own tab: a title,
-- a start time, and an optional location — no RSVP/guest list, no reminder
-- scheduling, no call link. Those are real product surfaces (RSVPs need
-- their own table and notification wiring) intentionally deferred rather
-- than half-built here.
--
-- Modeled 1:1 on `polls` (post_id uuid unique references posts), not as a
-- freestanding table with its own feed query: a Room's feed already reads
-- one reverse-chronological `posts` list (posts_room_feed_idx), and an
-- event needing its own separate feed merge would duplicate that ordering
-- logic for no benefit an event-goer would notice. So an event is just a
-- post with an attached `events` row, the same way a poll is a post with
-- an attached `polls` row — it shows up in the feed for free.

create table events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references posts (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  location text,
  created_at timestamptz not null default now()
);

alter table events enable row level security;

create policy "events are readable wherever the post is"
on events for select
to authenticated
using (
  exists (select 1 from posts p where p.id = events.post_id and is_room_member(p.room_id, auth.uid()))
);

create policy "post authors attach their own event"
on events for insert
to authenticated
with check (
  exists (select 1 from posts p where p.id = events.post_id and p.author_id = auth.uid())
);
