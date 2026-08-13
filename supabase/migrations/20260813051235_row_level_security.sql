-- Phase 1: Row Level Security. Deny-by-default on every table — RLS is
-- enabled everywhere, and a table with no matching policy for an
-- operation means that operation is refused, full stop. See
-- docs/phase/phase01.md for the reasoning behind each table's policy
-- set, and two deliberate scope boundaries called out inline below
-- (blocks not yet wired into content visibility; the moderation queue
-- read path) rather than left as silent gaps.

-- ── helpers ─────────────────────────────────────────────────────────────
-- Centralizes the one check nearly every policy below needs, so there's
-- one place to get it right instead of a dozen hand-copied EXISTS
-- subqueries. security definer + stable: these only ever answer "is
-- THIS caller (auth.uid()) a member/mod/owner of THIS room" — never
-- return row contents — so bypassing RLS internally to compute that
-- doesn't leak anything beyond what the caller is already entitled to
-- know about themselves.

create function is_room_member(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id and join_state = 'approved'
  );
$$;

create function is_room_moderator(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id
      and join_state = 'approved' and role in ('owner', 'mod')
  );
$$;

create function is_room_owner(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id
      and join_state = 'approved' and role = 'owner'
  );
$$;

-- Same reasoning as the three helpers above, and not optional here the
-- way it might look: a policy on conversation_participants that queries
-- conversation_participants inline (not through a security definer
-- function) triggers RLS on that inner query too, which needs this same
-- policy evaluated again, which queries the table again — Postgres
-- detects the cycle and raises "infinite recursion detected in policy"
-- rather than looping forever. Confirmed by actually hitting that exact
-- error against a live database, not theoretical.
create function is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id
  );
$$;

-- ── profiles ────────────────────────────────────────────────────────────
-- Handles/names/bios are app-public to any signed-in user (Discover,
-- Search, and post/message authorship all need to resolve a profile by
-- id) — not gated per-Room. Writing your own profile is the only
-- self-service write; the insert-on-signup path runs as the table owner
-- via handle_new_user() and is unaffected by these policies.

alter table profiles enable row level security;

create policy "profiles are readable by any authenticated user"
on profiles for select
to authenticated
using (true);

create policy "users can update their own profile"
on profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- ── rooms ───────────────────────────────────────────────────────────────
-- public/request rooms are listed even to non-members ("Listed, but mods
-- approve" per the mock); invite rooms are hidden unless you already
-- have a room_memberships row (member, pending, or invited).

alter table rooms enable row level security;

create policy "public and request rooms are listable; invite rooms only to members"
on rooms for select
to authenticated
using (
  visibility in ('public', 'request')
  or exists (
    select 1 from room_memberships rm
    where rm.room_id = rooms.id and rm.user_id = auth.uid()
  )
);

create policy "any authenticated user can create a room they own"
on rooms for insert
to authenticated
with check (created_by = auth.uid());

create policy "owners and mods can update their room"
on rooms for update
to authenticated
using (is_room_moderator(id, auth.uid()))
with check (is_room_moderator(id, auth.uid()));

create policy "only the owner can delete their room"
on rooms for delete
to authenticated
using (is_room_owner(id, auth.uid()));

-- ── room_memberships ───────────────────────────────────────────────────
-- The most sensitive table in the schema: nearly everything else's
-- access control derives from it, directly or via the chat sync
-- triggers. Deliberately closed to ALL direct client writes — joining,
-- approving a request, inviting, changing roles, and leaving all go
-- through Edge Functions using the service role (Phase 2/4 work), which
-- apply the actual business rules (e.g. "an owner can't leave without
-- transferring ownership first") in code that's easy to test, rather
-- than as a single complex RLS boolean expression on the one table
-- where getting that expression wrong means a real privacy leak. The
-- owner's initial row is the one exception, created atomically by the
-- add_owner_membership_on_room_created trigger, not by client insert.
-- Reads are still governed by RLS below, same as everywhere else.

alter table room_memberships enable row level security;

create policy "members see their own membership row"
on room_memberships for select
to authenticated
using (user_id = auth.uid());

create policy "moderators see every membership row in their room"
on room_memberships for select
to authenticated
using (is_room_moderator(room_id, auth.uid()));

-- ── conversations ──────────────────────────────────────────────────────

alter table conversations enable row level security;

create policy "participants can see their conversations"
on conversations for select
to authenticated
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = conversations.id and cp.user_id = auth.uid()
  )
);

create policy "a user can start a dm they are part of"
on conversations for insert
to authenticated
with check (
  kind = 'dm' and (dm_user_a = auth.uid() or dm_user_b = auth.uid())
);

create policy "moderators can create channels in their room"
on conversations for insert
to authenticated
with check (
  kind = 'room_channel' and is_room_moderator(room_id, auth.uid())
);

create policy "moderators can rename channels in their room"
on conversations for update
to authenticated
using (kind = 'room_channel' and is_room_moderator(room_id, auth.uid()))
with check (kind = 'room_channel' and is_room_moderator(room_id, auth.uid()));

create policy "moderators can delete channels in their room"
on conversations for delete
to authenticated
using (kind = 'room_channel' and is_room_moderator(room_id, auth.uid()));

-- ── conversation_participants ─────────────────────────────────────────
-- Room-channel rows are system-maintained (see the sync triggers in
-- chat.sql) and never written directly by clients — no insert/delete
-- policy for regular users. A user can always update their own
-- preferences (muted/pinned/last_read_at) on a row they're already in.

alter table conversation_participants enable row level security;

create policy "a participant can see every participant in their conversations"
on conversation_participants for select
to authenticated
using (
  user_id = auth.uid()
  or is_conversation_participant(conversation_id, auth.uid())
);

create policy "a participant can update their own preferences"
on conversation_participants for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ── messages ────────────────────────────────────────────────────────────
-- Soft-deleted messages stay visible to their author (so they can see
-- what they wrote was removed) and to room moderators (for the
-- moderation trail); hidden from everyone else.

alter table messages enable row level security;

create policy "participants can read messages, minus soft-deleted content"
on messages for select
to authenticated
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
  )
  and (
    deleted_at is null
    or author_id = auth.uid()
    or exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.room_id is not null
        and is_room_moderator(c.room_id, auth.uid())
    )
  )
);

create policy "participants can send messages as themselves"
on messages for insert
to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
  )
);

create policy "authors can edit their own, not-yet-removed messages"
on messages for update
to authenticated
using (author_id = auth.uid() and deleted_at is null)
with check (author_id = auth.uid());

-- ── message_reactions ──────────────────────────────────────────────────

alter table message_reactions enable row level security;

create policy "participants can see reactions on messages they can read"
on message_reactions for select
to authenticated
using (
  exists (
    select 1 from messages m
    join conversation_participants cp on cp.conversation_id = m.conversation_id
    where m.id = message_reactions.message_id and cp.user_id = auth.uid()
  )
);

create policy "participants can react as themselves"
on message_reactions for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from messages m
    join conversation_participants cp on cp.conversation_id = m.conversation_id
    where m.id = message_reactions.message_id and cp.user_id = auth.uid()
  )
);

create policy "users can remove their own reaction"
on message_reactions for delete
to authenticated
using (user_id = auth.uid());

-- ── posts ───────────────────────────────────────────────────────────────

alter table posts enable row level security;

create policy "room members can read posts, minus soft-deleted content"
on posts for select
to authenticated
using (
  is_room_member(room_id, auth.uid())
  and (
    deleted_at is null
    or author_id = auth.uid()
    or is_room_moderator(room_id, auth.uid())
  )
);

create policy "members can post if the room allows it, mods always can"
on posts for insert
to authenticated
with check (
  author_id = auth.uid()
  and is_room_member(room_id, auth.uid())
  and (
    is_room_moderator(room_id, auth.uid())
    or (select members_can_post from rooms where id = room_id)
  )
);

create policy "authors can edit their own, not-yet-removed posts"
on posts for update
to authenticated
using (author_id = auth.uid() and deleted_at is null)
with check (author_id = auth.uid());

-- ── post_media ──────────────────────────────────────────────────────────

alter table post_media enable row level security;

create policy "post_media is readable wherever the post is"
on post_media for select
to authenticated
using (
  exists (
    select 1 from posts p
    where p.id = post_media.post_id
      and is_room_member(p.room_id, auth.uid())
      and (p.deleted_at is null or p.author_id = auth.uid() or is_room_moderator(p.room_id, auth.uid()))
  )
);

create policy "post authors attach their own media"
on post_media for insert
to authenticated
with check (
  exists (select 1 from posts p where p.id = post_media.post_id and p.author_id = auth.uid())
);

create policy "post authors remove their own media"
on post_media for delete
to authenticated
using (
  exists (select 1 from posts p where p.id = post_media.post_id and p.author_id = auth.uid())
);

-- ── comments ────────────────────────────────────────────────────────────

alter table comments enable row level security;

create policy "room members can read comments, minus soft-deleted content"
on comments for select
to authenticated
using (
  exists (
    select 1 from posts p
    where p.id = comments.post_id and is_room_member(p.room_id, auth.uid())
  )
  and (
    deleted_at is null
    or author_id = auth.uid()
    or exists (
      select 1 from posts p where p.id = comments.post_id and is_room_moderator(p.room_id, auth.uid())
    )
  )
);

create policy "room members can comment as themselves"
on comments for insert
to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1 from posts p where p.id = comments.post_id and is_room_member(p.room_id, auth.uid())
  )
);

create policy "authors can edit their own, not-yet-removed comments"
on comments for update
to authenticated
using (author_id = auth.uid() and deleted_at is null)
with check (author_id = auth.uid());

-- ── post_likes ──────────────────────────────────────────────────────────

alter table post_likes enable row level security;

create policy "room members can see likes on posts they can read"
on post_likes for select
to authenticated
using (
  exists (select 1 from posts p where p.id = post_likes.post_id and is_room_member(p.room_id, auth.uid()))
);

create policy "room members can like as themselves"
on post_likes for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from posts p where p.id = post_likes.post_id and is_room_member(p.room_id, auth.uid()))
);

create policy "users can remove their own like"
on post_likes for delete
to authenticated
using (user_id = auth.uid());

-- ── polls / poll_options / poll_votes ─────────────────────────────────

alter table polls enable row level security;

create policy "polls are readable wherever the post is"
on polls for select
to authenticated
using (
  exists (select 1 from posts p where p.id = polls.post_id and is_room_member(p.room_id, auth.uid()))
);

create policy "post authors attach their own poll"
on polls for insert
to authenticated
with check (
  exists (select 1 from posts p where p.id = polls.post_id and p.author_id = auth.uid())
);

alter table poll_options enable row level security;

create policy "poll options are readable wherever the poll is"
on poll_options for select
to authenticated
using (
  exists (
    select 1 from polls pl
    join posts p on p.id = pl.post_id
    where pl.id = poll_options.poll_id and is_room_member(p.room_id, auth.uid())
  )
);

create policy "post authors attach their own poll options"
on poll_options for insert
to authenticated
with check (
  exists (
    select 1 from polls pl
    join posts p on p.id = pl.post_id
    where pl.id = poll_options.poll_id and p.author_id = auth.uid()
  )
);

alter table poll_votes enable row level security;

create policy "poll votes are readable wherever the poll is"
on poll_votes for select
to authenticated
using (
  exists (
    select 1 from polls pl
    join posts p on p.id = pl.post_id
    where pl.id = poll_votes.poll_id and is_room_member(p.room_id, auth.uid())
  )
);

create policy "room members can vote as themselves"
on poll_votes for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from polls pl
    join posts p on p.id = pl.post_id
    where pl.id = poll_votes.poll_id and is_room_member(p.room_id, auth.uid())
  )
);

create policy "users can retract their own vote"
on poll_votes for delete
to authenticated
using (user_id = auth.uid());

-- ── stories ─────────────────────────────────────────────────────────────

alter table stories enable row level security;

create policy "room members can see active stories"
on stories for select
to authenticated
using (is_room_member(room_id, auth.uid()) and expires_at > now());

create policy "room members can post stories as themselves"
on stories for insert
to authenticated
with check (author_id = auth.uid() and is_room_member(room_id, auth.uid()));

create policy "authors can delete their own story early"
on stories for delete
to authenticated
using (author_id = auth.uid());

-- ── notifications ──────────────────────────────────────────────────────
-- No insert policy for regular users, deliberately — notifications are
-- only ever created by the system (trigger/Edge Function fan-out, Phase
-- 8), never by a client directly, which would otherwise allow spoofing
-- an arbitrary notification into someone else's feed.

alter table notifications enable row level security;

create policy "users read their own notifications"
on notifications for select
to authenticated
using (user_id = auth.uid());

create policy "users mark their own notifications read"
on notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users clear their own notifications"
on notifications for delete
to authenticated
using (user_id = auth.uid());

-- ── reports ─────────────────────────────────────────────────────────────
-- Deliberately narrow: a report's relevant room isn't a direct column
-- (it depends on target_type — post/comment resolve through posts,
-- message resolves through conversations, user has no room at all), so
-- rather than a multi-branch RLS policy on the one table most likely to
-- need a careful audit trail, the moderation review queue is served by
-- a service-role Edge Function that does the join in application code.
-- Regular users can only see and file their own reports here.

alter table reports enable row level security;

create policy "users see their own reports"
on reports for select
to authenticated
using (reporter_id = auth.uid());

create policy "users can file a report as themselves"
on reports for insert
to authenticated
with check (reporter_id = auth.uid());

-- ── blocks ──────────────────────────────────────────────────────────────
-- Scope boundary, stated explicitly rather than left implicit: this
-- table enforces who can read/write block relationships, but blocking
-- someone does not yet filter their content out of posts/comments/
-- messages queries — that cross-cutting filter is Phase 9 work
-- (docs/roadmap.md), not wired into every content policy above yet.

alter table blocks enable row level security;

create policy "users see their own blocks"
on blocks for select
to authenticated
using (blocker_id = auth.uid());

create policy "users can block as themselves"
on blocks for insert
to authenticated
with check (blocker_id = auth.uid());

create policy "users can unblock"
on blocks for delete
to authenticated
using (blocker_id = auth.uid());

-- ── moderation_actions ─────────────────────────────────────────────────
-- Immutable audit log. No insert policy for regular users — every row
-- is written by a service-role Edge Function that performs the actual
-- action (soft-delete, mute, kick) and logs it in the same transaction.
-- No update/delete policy for anyone: the log doesn't get edited.

alter table moderation_actions enable row level security;

create policy "actors and room moderators can read the moderation log"
on moderation_actions for select
to authenticated
using (
  actor_id = auth.uid()
  or (room_id is not null and is_room_moderator(room_id, auth.uid()))
);
