-- Phase 10, slice 5: a blocked person can't read your bio, banner or
-- "last active".
--
-- Found in Phase 9's block slice (decision-log, 2026-09-21) and left open:
-- `profiles` has one SELECT policy, "readable by any authenticated user",
-- and RLS filters rows, not columns. That's deliberate for handles and
-- names, which appear wherever Room members are shown, including between
-- two people who have blocked each other in a Room they share. But the
-- same policy handed out bio, banner_url and last_active_at (presence).
-- The profile screen hides those three once there's a block; the API
-- didn't. Reproduced on the local stack before this migration: the
-- blocked account read the blocker's bio, banner and last_active_at
-- straight from the table, and could sort every profile by
-- last_active_at to see who was online.
--
-- What changes:
--
-- * The table gives out only what is shown everywhere: SELECT on id,
--   handle, name, avatar_url and created_at. The policy is unchanged (any
--   signed-in person, every row); the grant is now by column. A hidden
--   column can't be selected, filtered on or sorted by.
--
-- * get_profile(p_user_id) returns one whole profile. It is SECURITY
--   DEFINER, and blanks bio, banner_url and last_active_at when there is a
--   block between the caller and that person in either direction: the
--   same blocked_pair() every other block rule uses. Handle, name and
--   avatar always come back. Nobody at all: zero rows.
--
-- * anon loses SELECT on the table. No policy ever let a signed-out
--   caller read a row; now the grant says so.
--
-- Writes are untouched: UPDATE stays on name, bio, avatar_url, banner_url
-- and last_active_at for your own row (20260916150000), and an UPDATE's
-- WHERE only needs to read id.
--
-- Why column grants and a function, not a second policy or a second
-- table: a policy that hid whole rows between blocked people would hide
-- their names in the Rooms and chats they share, which 2026-09-21 decided
-- against. Moving the three columns into their own table would do the
-- job, but it's a data migration and a second write path for something
-- two call sites read.
--
-- App change that goes with this (mobile/src/lib/profiles.ts): the two
-- places that read these columns call get_profile() instead of selecting
-- them from the table. Every embed of profiles elsewhere asks for id,
-- handle and name only.
--
-- Not covered: the banner *file*. profile-media is readable by any
-- signed-in person who knows a file's path (20260908140000's policy), so
-- someone who saved the path before being blocked could still fetch it.
-- They can no longer learn the path.

create function get_profile(p_user_id uuid)
returns table (
  id uuid,
  handle text,
  name text,
  avatar_url text,
  bio text,
  banner_url text,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.handle,
    p.name,
    p.avatar_url,
    case when b.blocked then null else p.bio end,
    case when b.blocked then null else p.banner_url end,
    case when b.blocked then null else p.last_active_at end
  from profiles p
  cross join lateral (select blocked_pair(auth.uid(), p.id) as blocked) b
  where p.id = p_user_id
    and auth.uid() is not null;
$$;

-- New functions start closed (20261002100000); this one is for the app.
revoke execute on function get_profile(uuid) from public, anon;
grant execute on function get_profile(uuid) to authenticated;

-- Revoking at table level takes every column-level SELECT with it.
revoke select on profiles from authenticated, anon;
grant select (id, handle, name, avatar_url, created_at) on profiles to authenticated;
