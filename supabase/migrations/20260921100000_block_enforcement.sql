-- Phase 9, slice 1: blocking, enforced by the server in both directions.
--
-- `blocks` has existed since Phase 1 (20260813051229_trust_and_safety.sql)
-- but nothing enforced it: the only reader was the tag picker. The anon key
-- ships inside every build, so a block that only hides things in the UI
-- protects no one — the blocked person could still read the blocker's posts
-- straight from the REST API. So the rules live here:
--
--   * posts, comments and stories are hidden between the two people, both
--     ways, in the SELECT policies themselves. Likes follow, so the blocker
--     doesn't see who they blocked in a likes list or count.
--   * because comments and post_likes check the post through a subquery on
--     `posts` in their INSERT policies, and that subquery is itself subject
--     to posts' RLS, the blocked person also can't comment on or like the
--     blocker's posts — no separate check needed.
--   * DMs are cut off both ways: no new DM, no messages or reactions in an
--     existing one, and no friend requests (a DM needs a friendship).
--   * notifications between the two are dropped before they're inserted,
--     which also stops the push, since push fires from that insert.
--
-- Deliberately NOT here: Room group-chat messages. A blocked person's
-- messages in a shared Room channel are collapsed on the blocker's device
-- only, not hidden by the server — hiding them leaves gaps and replies to
-- messages nobody can see (decision-log, 2026-09-21). Profiles also stay
-- readable, since names appear everywhere a shared Room shows its members;
-- the profile *screen* checks block_status() instead.

-- ── Helpers ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the blocked person must be affected by a row
-- they can't read: blocks' SELECT policy only shows your own blocks.
--
-- Two functions rather than one: blocked_pair() takes any two users, which
-- would let anyone probe whether two *other* people have blocked each other
-- if it were callable over the API. So it isn't — only other definer
-- functions and triggers call it — and RLS uses is_blocked_with(), which
-- only ever answers about the caller.
create function blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke execute on function blocked_pair(uuid, uuid) from public, anon, authenticated;

-- A null p_other (content whose author deleted their account) is never
-- blocked: `blocker_id = null` matches nothing.
create function is_blocked_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select blocked_pair(auth.uid(), p_other);
$$;

revoke execute on function is_blocked_with(uuid) from public, anon;
grant execute on function is_blocked_with(uuid) to authenticated;

-- What the profile and chat screens need to know about one other person.
-- 'blocking' wins when both have blocked each other, so the caller is
-- offered Unblock rather than a dead end.
create function block_status(p_other uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from blocks where blocker_id = auth.uid() and blocked_id = p_other) then 'blocking'
    when exists (select 1 from blocks where blocker_id = p_other and blocked_id = auth.uid()) then 'blocked_by'
    else 'none'
  end;
$$;

revoke execute on function block_status(uuid) from public, anon;
grant execute on function block_status(uuid) to authenticated;

-- ── Blocking ──────────────────────────────────────────────────────────────
-- One call does everything a block implies, atomically: there's no client
-- rollback if a later step failed, and friendships/tags/notifications
-- belonging to the *other* person aren't deletable by the caller anyway.
create function block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated.';
  end if;
  if p_user_id = v_me then
    raise exception 'You can''t block yourself.';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;

  insert into blocks (blocker_id, blocked_id)
  values (v_me, p_user_id)
  on conflict do nothing;

  -- Ends the friendship, or a pending request in either direction.
  -- friendships stores the pair ordered (friendship_pair_ordered).
  delete from friendships
  where user_a = least(v_me, p_user_id) and user_b = greatest(v_me, p_user_id);

  -- Neither stays tagged in the other's posts.
  delete from post_tags t
  using posts p
  where t.post_id = p.id
    and ((t.user_id = v_me and p.author_id = p_user_id)
      or (t.user_id = p_user_id and p.author_id = v_me));

  -- Clears notifications either one already has about the other; the
  -- trigger below stops new ones.
  delete from notifications
  where (user_id = v_me and actor_id = p_user_id)
     or (user_id = p_user_id and actor_id = v_me);
end;
$$;

revoke execute on function block_user(uuid) from public, anon;
grant execute on function block_user(uuid) to authenticated;

-- Writes to `blocks` now go through block_user() only, so created_at is
-- the server's (closing one of the client-written timestamps on Phase 10's
-- list) and a block can't be created without its side effects. Unblocking
-- stays a direct DELETE: it's one row and the existing policy already
-- limits it to your own blocks.
revoke insert, update on blocks from anon, authenticated;
revoke delete on blocks from anon;
drop policy "users can block as themselves" on blocks;

-- ── Hiding content both ways ──────────────────────────────────────────────
-- Each policy keeps its existing expression exactly and adds one clause.
-- The membership check stays first: it's the line between Rooms, and
-- nothing here should loosen it.
alter policy "room members can read posts, minus soft-deleted content" on posts
using (
  is_room_member(room_id, auth.uid())
  and (deleted_at is null or author_id = auth.uid() or is_room_moderator(room_id, auth.uid()))
  and not is_blocked_with(author_id)
);

alter policy "room members can read comments, minus soft-deleted content" on comments
using (
  exists (
    select 1 from posts p
    where p.id = comments.post_id and is_room_member(p.room_id, auth.uid())
  )
  and (
    deleted_at is null
    or author_id = auth.uid()
    or exists (
      select 1 from posts p
      where p.id = comments.post_id and is_room_moderator(p.room_id, auth.uid())
    )
  )
  and not is_blocked_with(author_id)
);

alter policy "room members can see active stories" on stories
using (
  is_room_member(room_id, auth.uid())
  and expires_at > now()
  and not is_blocked_with(author_id)
);

alter policy "room members can see likes on posts they can read" on post_likes
using (
  exists (
    select 1 from posts p
    where p.id = post_likes.post_id and is_room_member(p.room_id, auth.uid())
  )
  and not is_blocked_with(user_id)
);

-- ── DMs and friendships ───────────────────────────────────────────────────
-- Checked explicitly as well: start_dm() needs a friendship, which
-- block_user() deletes, but a clear message beats "you must be friends".
create or replace function start_dm(other_user_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
  conv_id uuid;
begin
  if caller is null then
    raise exception 'Not authenticated.';
  end if;
  if other_user_id = caller then
    raise exception 'Cannot start a DM with yourself.';
  end if;
  if is_blocked_with(other_user_id) then
    raise exception 'You can''t message this person.';
  end if;
  if caller < other_user_id then
    v_user_a := caller;
    v_user_b := other_user_id;
  else
    v_user_a := other_user_id;
    v_user_b := caller;
  end if;
  if not exists (
    select 1 from friendships
    where user_a = v_user_a and user_b = v_user_b and status = 'accepted'
  ) then
    raise exception 'You must be friends to start a conversation.';
  end if;
  select id into conv_id
  from conversations
  where kind = 'dm' and dm_user_a = v_user_a and dm_user_b = v_user_b;
  if conv_id is not null then
    return conv_id;
  end if;
  begin
    insert into conversations (kind, dm_user_a, dm_user_b)
    values ('dm', v_user_a, v_user_b)
    returning id into conv_id;
  exception when unique_violation then
    -- The other participant's own start_dm() call won the race between
    -- this function's SELECT above and its INSERT — use their row.
    select id into conv_id
    from conversations
    where kind = 'dm' and dm_user_a = v_user_a and dm_user_b = v_user_b;
  end;
  return conv_id;
end;
$$;

-- Triggers rather than edits to the messages/reactions INSERT policies, so
-- the muted/banned/approved participant rules in those policies are left
-- exactly as they are. Only DMs are affected: in a Room channel both
-- people are still members of the Room.
create function reject_dm_message_between_blocked_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
begin
  select case when c.dm_user_a = new.author_id then c.dm_user_b else c.dm_user_a end
  into v_other
  from conversations c
  where c.id = new.conversation_id and c.kind = 'dm';

  if v_other is not null and blocked_pair(new.author_id, v_other) then
    raise exception 'You can''t message this person.';
  end if;
  return new;
end;
$$;

create trigger reject_dm_message_between_blocked_users
before insert on messages
for each row execute function reject_dm_message_between_blocked_users();

create function reject_dm_reaction_between_blocked_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
begin
  select case when c.dm_user_a = new.user_id then c.dm_user_b else c.dm_user_a end
  into v_other
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.id = new.message_id and c.kind = 'dm';

  if v_other is not null and blocked_pair(new.user_id, v_other) then
    raise exception 'You can''t react in this conversation.';
  end if;
  return new;
end;
$$;

create trigger reject_dm_reaction_between_blocked_users
before insert on message_reactions
for each row execute function reject_dm_reaction_between_blocked_users();

create function reject_friend_request_between_blocked_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if blocked_pair(new.user_a, new.user_b) then
    raise exception 'You can''t send a friend request to this person.';
  end if;
  return new;
end;
$$;

create trigger reject_friend_request_between_blocked_users
before insert on friendships
for each row execute function reject_friend_request_between_blocked_users();

-- ── Search ────────────────────────────────────────────────────────────────
create or replace function search_profiles(q text)
returns table (id uuid, handle text, name text)
language sql
stable
set search_path = public
as $$
  select id, handle, name
  from profiles
  where id <> auth.uid()
    and (handle ilike '%' || q || '%' or name ilike '%' || q || '%')
    and not is_blocked_with(id)
  order by name
  limit 20;
$$;

-- ── Notifications ─────────────────────────────────────────────────────────
-- One gate in front of every notification trigger (new post, story,
-- comment reply, mention, tag, like, join request) instead of a check in
-- each. Returning null skips the insert, so the AFTER INSERT push webhook
-- never fires either.
create function suppress_notifications_between_blocked_users()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_id is not null and blocked_pair(new.user_id, new.actor_id) then
    return null;
  end if;
  return new;
end;
$$;

create trigger suppress_notifications_between_blocked_users
before insert on notifications
for each row execute function suppress_notifications_between_blocked_users();
