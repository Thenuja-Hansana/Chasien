-- Phase 8: the trigger-based fan-out that actually populates
-- `notifications` (20260813051224_notifications.sql defined the shape;
-- this migration is what fills it). Every function here is `security
-- definer`, the same pattern already established by
-- add_owner_membership_on_room_created() (20260813051204_identity_and_rooms.sql)
-- for exactly the same reason: `notifications` has no client INSERT
-- policy at all (by design — a client-writable notifications table
-- would let anyone spoof a notification into someone else's feed), so
-- these triggers need to bypass RLS to write on a *different* user's
-- behalf than whoever's actual INSERT fired them.
--
-- Every trigger below checks room_memberships.notifications_muted
-- before inserting — muting a Room is enforced once, here, rather than
-- trusting every future notification type's trigger to remember it
-- independently.

-- ── reply ───────────────────────────────────────────────────────────────

create function notify_on_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_author_id uuid;
  v_room_id uuid;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  select author_id into v_parent_author_id from comments where id = new.parent_comment_id;
  select room_id into v_room_id from posts where id = new.post_id;

  -- No self-notification, and no notification for a since-deleted
  -- parent-comment author (author_id went null via ON DELETE SET NULL).
  if v_parent_author_id is null or v_parent_author_id = new.author_id then
    return new;
  end if;

  if exists (
    select 1 from room_memberships
    where room_id = v_room_id and user_id = v_parent_author_id and notifications_muted
  ) then
    return new;
  end if;

  insert into notifications (user_id, type, actor_id, room_id, data)
  values (
    v_parent_author_id, 'reply', new.author_id, v_room_id,
    jsonb_build_object('postId', new.post_id, 'commentId', new.id, 'preview', left(new.text, 140))
  );

  return new;
end;
$$;

create trigger notify_on_comment_reply
after insert on comments
for each row execute function notify_on_comment_reply();

-- ── mentions ────────────────────────────────────────────────────────────
-- Shared by posts and comments rather than duplicated per table. Only
-- ever notifies an actual approved member of the Room the mention
-- happened in — the notification's `data` is a snapshot that would
-- otherwise leak a Room's existence/content to someone who was
-- @mentioned but isn't a member, which is exactly the kind of
-- cross-Room leak Phase 1/4 spent real effort proving can't happen.

create function notify_mentions(
  p_text text, p_room_id uuid, p_actor_id uuid, p_data jsonb
)
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
    if not is_room_member(p_room_id, v_user_id) then
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

create function notify_mentions_in_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.text is not null then
    perform notify_mentions(
      new.text, new.room_id, new.author_id,
      jsonb_build_object('postId', new.id, 'preview', left(new.text, 140))
    );
  end if;
  return new;
end;
$$;

create trigger notify_mentions_in_post
after insert on posts
for each row execute function notify_mentions_in_post();

create function notify_mentions_in_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  select room_id into v_room_id from posts where id = new.post_id;
  perform notify_mentions(
    new.text, v_room_id, new.author_id,
    jsonb_build_object('postId', new.post_id, 'commentId', new.id, 'preview', left(new.text, 140))
  );
  return new;
end;
$$;

create trigger notify_mentions_in_comment
after insert on comments
for each row execute function notify_mentions_in_comment();

-- ── like (aggregated) ───────────────────────────────────────────────────
-- Matches the mock's "nadia and 4 others liked your post" — not one row
-- per like. Rolls a new like into the most recent *unread* like
-- notification for the same post/recipient (bumping created_at so it
-- reads as "just happened" and re-surfaces at the top), rather than
-- creating a fresh row every time, which would flood the feed with one
-- line per liker instead of one aggregated line. Deliberately doesn't
-- handle unliking (removing/decrementing) — no such interaction exists
-- in the mock, and it's not required by Phase 8's exit condition.

create function notify_on_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_id uuid;
  v_room_id uuid;
  v_existing_id uuid;
  v_liker_ids jsonb;
begin
  select author_id, room_id into v_author_id, v_room_id from posts where id = new.post_id;

  if v_author_id is null or v_author_id = new.user_id then
    return new;
  end if;

  if exists (
    select 1 from room_memberships
    where room_id = v_room_id and user_id = v_author_id and notifications_muted
  ) then
    return new;
  end if;

  select id, data->'likerIds' into v_existing_id, v_liker_ids
  from notifications
  where user_id = v_author_id and type = 'like' and read_at is null
    and data->>'postId' = new.post_id::text
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    if not (v_liker_ids ? new.user_id::text) then
      v_liker_ids := v_liker_ids || to_jsonb(new.user_id::text);
    end if;
    update notifications
    set actor_id = new.user_id, created_at = now(), data = jsonb_set(data, '{likerIds}', v_liker_ids)
    where id = v_existing_id;
  else
    insert into notifications (user_id, type, actor_id, room_id, data)
    values (
      v_author_id, 'like', new.user_id, v_room_id,
      jsonb_build_object('postId', new.post_id, 'likerIds', jsonb_build_array(new.user_id::text))
    );
  end if;

  return new;
end;
$$;

create trigger notify_on_post_like
after insert on post_likes
for each row execute function notify_on_post_like();

-- ── join request ────────────────────────────────────────────────────────
-- Fans out to every approved owner/mod, not just the Room's creator —
-- any moderator can act on a join request (room-membership Edge
-- Function's handleRespondToRequest already allows this), so all of
-- them should hear about it.

create function notify_on_join_request()
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
    and rm.join_state = 'approved'
    and rm.role in ('owner', 'mod')
    and not rm.notifications_muted;

  return new;
end;
$$;

create trigger notify_on_join_request
after insert on room_memberships
for each row execute function notify_on_join_request();

-- ── pinned post ─────────────────────────────────────────────────────────
-- Fired by toggle_post_pin() (20260902100000_notification_preferences_and_pin.sql),
-- the only path that can set posts.pinned. auth.uid() still resolves to
-- the real caller here despite running inside a security definer
-- function's UPDATE — it reads request.jwt.claims, a session-level
-- setting untouched by SECURITY DEFINER's role switch, the same
-- assumption every is_room_member(..., auth.uid()) call in this schema
-- already relies on.

create function notify_on_post_pinned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pinned = true and old.pinned is distinct from true then
    insert into notifications (user_id, type, actor_id, room_id, data)
    select rm.user_id, 'pinned_post', auth.uid(), new.room_id, jsonb_build_object('postId', new.id)
    from room_memberships rm
    where rm.room_id = new.room_id
      and rm.join_state = 'approved'
      and rm.user_id <> auth.uid()
      and not rm.notifications_muted;
  end if;
  return new;
end;
$$;

create trigger notify_on_post_pinned
after update on posts
for each row execute function notify_on_post_pinned();
