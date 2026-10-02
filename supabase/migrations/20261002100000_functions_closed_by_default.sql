-- Phase 10, slice 2: a function is callable over the API only if a
-- migration says so, and the membership helpers answer only about the
-- caller.
--
-- Found 2026-10-02 while planning Phase 10, not from a report. Two causes.
--
-- 1. Every function was open unless a migration had closed it. Postgres
--    grants EXECUTE on a new function to PUBLIC, and Supabase's default
--    privileges add anon and authenticated by name on top. PostgREST
--    exposes every function in `public` as /rpc/<name>. So 43 of this
--    schema's 66 functions could be called by someone who had never signed
--    in, with nothing but the anon key that ships inside the app, and 55 by
--    anyone signed in. Most check auth.uid() and refuse. One didn't:
--
--      notify_mentions(p_text, p_room_id, p_actor_id, p_data)
--
--    is SECURITY DEFINER, takes the "from" account as a parameter, and was
--    written to be called by the two mention triggers. Called directly it
--    wrote a mention notification from anyone, to any member of any Room,
--    with any payload, and the notifications webhook would then have pushed
--    it to their phone. Reproduced as the anon role inside a transaction
--    that was rolled back: a mention "from" one seed account to another
--    account, in a Room the first isn't even in. Same class of hole as
--    20260923100000 (forged pushes), through a different door.
--
-- 2. The membership helpers answered about anyone. is_room_member(),
--    is_room_moderator(), is_room_admin(), is_room_owner() and
--    is_conversation_participant() exist for RLS policies, and a policy runs
--    as the person querying, so `authenticated` has to be able to execute
--    them. That also makes them /rpc endpoints, and they took any user id.
--    Reproduced as a signed-in outsider: `room_memberships` returned zero
--    rows for a Room they aren't in (the policy holding), while
--    is_room_member() and is_room_owner() answered true about its owner and
--    false about a non-member. The member list RLS hides could be rebuilt
--    one question at a time, for any Room whose id is known, and
--    Discover lists the ids of every public, request and domain-verified
--    Room.
--
-- What changes:
--
-- * The five helpers only answer about the caller: `and user_id =
--   auth.uid()` inside each. All 38 calls in RLS policies (public and
--   storage) already pass auth.uid() as the user, so no policy's result
--   changes. Asked about anyone else, they say false.
--
-- * The four functions that have a real reason to ask about *other* people
--   move to room_rank(), the internal helper that already exists for this
--   (20260921110100: not executable by anon or authenticated, so it is no
--   endpoint): notify_mentions (is the mentioned person in the Room),
--   notify_on_join_request (who can answer a request), tag_people_in_post
--   (is the tagged person in the Room) and can_remove_content (is the actor
--   a moderator). All four are SECURITY DEFINER, so they may call it.
--   Rank: -1 not a member, 0 member, 1 mod, 2 admin, 3 owner.
--
-- * EXECUTE is revoked from PUBLIC, anon and authenticated on every
--   function in the schema, then granted back by name. anon gets one:
--   text_is_allowed(), which the signup screen calls before an account
--   exists. authenticated gets the 18 the app calls, the six helpers its
--   RLS policies evaluate, and tag_people_in_post(), which create_post()
--   (SECURITY INVOKER) calls as the caller. Trigger functions need no
--   grant: Postgres checks EXECUTE when a trigger is created, not when it
--   fires. service_role keeps everything; the Edge Functions call three.
--
-- * New functions start closed. The default privileges that opened them
--   are withdrawn, so a function added by a later migration is callable by
--   nobody over the API until that migration grants it on purpose. Same
--   rule 20260916150000 set for columns.
--
-- Closed on purpose though it has its own role check: toggle_message_pin().
-- No screen calls it. It needs a one-line grant when message pinning ships.

-- ---------------------------------------------------------------------
-- The four that ask about other people: room_rank() instead of the helpers.
-- Bodies otherwise unchanged.
-- ---------------------------------------------------------------------

create or replace function notify_mentions(p_text text, p_room_id uuid, p_actor_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text;
  v_user_id uuid;
begin
  for v_handle in
    select distinct lower(m[1])
    from regexp_matches(p_text, '@([a-zA-Z0-9_]+)', 'g') as m
  loop
    select id into v_user_id from profiles where lower(handle) = v_handle;
    if v_user_id is null or v_user_id = p_actor_id then
      continue;
    end if;
    if room_rank(p_room_id, v_user_id) < 0 then
      continue;
    end if;
    if exists (
      select 1 from room_memberships
      where room_id = p_room_id and user_id = v_user_id and notifications_muted
    ) then
      continue;
    end if;

    insert into notifications (user_id, type, actor_id, room_id, data)
    values (v_user_id, 'mention', p_actor_id, p_room_id, p_data);
  end loop;
end;
$$;

-- 20261001100000 moved this from a list of role names to
-- is_room_moderator(), so the people told about a request are the people
-- who can answer it. room_rank() >= 1 is the same question, asked through
-- the helper that may be asked about someone other than the caller: this
-- runs as the service role (the room-membership Edge Function inserts the
-- request), where auth.uid() is null.
create or replace function notify_on_join_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.join_state <> 'pending' then
    return new;
  end if;

  insert into notifications (user_id, type, actor_id, room_id, data)
  select rm.user_id, 'join_request', new.user_id, new.room_id, jsonb_build_object('targetUserId', new.user_id)
  from room_memberships rm
  where rm.room_id = new.room_id
    and room_rank(rm.room_id, rm.user_id) >= 1
    and not rm.notifications_muted;

  return new;
end;
$$;

create or replace function tag_people_in_post(p_post_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_author_id uuid;
  v_requested uuid[];
  v_existing int;
begin
  select room_id, author_id into v_room_id, v_author_id
  from posts
  where id = p_post_id and deleted_at is null;

  if v_room_id is null or v_author_id is distinct from auth.uid() then
    raise exception 'post not found';
  end if;

  select coalesce(array_agg(distinct u), '{}')
  into v_requested
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where u is not null and u <> v_author_id;

  if coalesce(array_length(v_requested, 1), 0) = 0 then
    return;
  end if;

  -- Counted on what was asked for, before any silent filtering, so the limit
  -- can't be used to probe who got filtered out.
  select count(*) into v_existing from post_tags where post_id = p_post_id;
  if v_existing + array_length(v_requested, 1) > 20 then
    raise exception 'a post can tag at most 20 people';
  end if;

  insert into post_tags (post_id, user_id)
  select p_post_id, u
  from unnest(v_requested) as u
  where room_rank(v_room_id, u) >= 0
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = v_author_id and b.blocked_id = u)
         or (b.blocker_id = u and b.blocked_id = v_author_id)
    )
  on conflict (post_id, user_id) do nothing;
end;
$$;

create or replace function can_remove_content(p_room_id uuid, p_actor uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_actor = p_author, false)
    or (room_rank(p_room_id, p_actor) >= 1 and room_rank(p_room_id, p_actor) > room_rank(p_room_id, p_author))
    or is_app_admin(p_actor);
$$;

-- ---------------------------------------------------------------------
-- The five helpers: only about the caller.
--
-- `create or replace` with the same signature keeps each function's
-- identity, so every policy that references it keeps pointing at it. The
-- added condition sits inside the `exists`, so a mismatch (or a null
-- auth.uid(): anon, the service role) is a plain false, never null.
-- ---------------------------------------------------------------------

create or replace function is_room_member(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id and user_id = auth.uid()
      and join_state = 'approved'
  );
$$;

create or replace function is_room_moderator(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id and user_id = auth.uid()
      and join_state = 'approved' and role in ('owner', 'admin', 'mod')
  );
$$;

create or replace function is_room_admin(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id and user_id = auth.uid()
      and join_state = 'approved' and role in ('owner', 'admin')
  );
$$;

create or replace function is_room_owner(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id and user_id = auth.uid()
      and join_state = 'approved' and role = 'owner'
  );
$$;

create or replace function is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id and user_id = auth.uid()
      and not banned and join_state = 'approved'
  );
$$;

-- ---------------------------------------------------------------------
-- Closed, then opened by name.
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

-- The Edge Functions' own client. Some of these were reaching it only
-- through the PUBLIC grant just withdrawn.
grant execute on all functions in schema public to service_role;

-- Signed out: the signup screen checks a name and handle against the
-- content filter before the account exists.
grant execute on function text_is_allowed(text) to anon;

grant execute on function
  -- called by the app (mobile/src/lib/*.ts)
  account_deletion_preview(),
  block_status(uuid),
  block_user(uuid),
  create_event_post(uuid, text, text, timestamptz, text, timestamptz, text),
  create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[], jsonb),
  current_user_is_app_admin(),
  delete_post(uuid, text),
  register_push_token(text, text),
  remove_comment(uuid, text),
  remove_message(uuid, text),
  remove_story(uuid, text),
  resolve_report(uuid, report_status),
  search_profiles(text),
  set_room_notifications_muted(uuid, boolean),
  start_dm(uuid),
  text_is_allowed(text),
  toggle_post_pin(uuid, boolean),
  vote_poll(uuid, uuid),
  -- evaluated by RLS policies, which run as the person querying
  is_blocked_with(uuid),
  is_conversation_participant(uuid, uuid),
  is_room_admin(uuid, uuid),
  is_room_member(uuid, uuid),
  is_room_moderator(uuid, uuid),
  is_room_owner(uuid, uuid),
  -- called by create_post(), which is SECURITY INVOKER
  tag_people_in_post(uuid, uuid[])
to authenticated;

-- ---------------------------------------------------------------------
-- New functions start closed.
--
-- PUBLIC's EXECUTE is a global default and can only be withdrawn globally
-- (a per-schema default can add to it, not subtract). The anon and
-- authenticated grants are Supabase's per-schema defaults for `public`.
-- Both are for objects created by `postgres`, the role migrations run as.
-- ---------------------------------------------------------------------

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
