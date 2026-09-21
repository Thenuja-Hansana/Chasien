-- Phase 9, slice 2: moderation tools.
--
-- Before this, a Room's owner could remove other people's posts
-- (delete_post, 20260915140100) and nothing else: admins and mods couldn't
-- remove anything, and nobody — not even authors — could remove a comment,
-- a chat message or someone else's story. (The comments/messages UPDATE
-- policies exist, but 20260916150000 granted no columns, so they're dead.)
--
-- Every removal now goes through one rule, can_remove_content(): authors
-- can always remove their own content; otherwise the actor must be an
-- owner/admin/mod who strictly outranks the author in that Room. That's the
-- same rule the room-membership Edge Function already applies to kicking,
-- muting and role changes (callerOutranksTarget), so a mod can't remove an
-- admin's post any more than they could kick that admin.
--
-- Removals are soft (deleted_at/removed_by/removal_reason) — the SELECT
-- policies already hide removed rows from everyone but the author and the
-- Room's mods, and the client already filters them out of every list.
-- Stories are removed by expiring them now: RLS hides expired stories
-- immediately, and the hourly cleanup job (cleanup-expired-stories) deletes
-- the row and its media, so nothing is left orphaned in storage.
--
-- Whenever the actor isn't the author, the removal is logged to
-- moderation_actions with a snapshot of what was removed.

-- ── Rank ──────────────────────────────────────────────────────────────────
-- Mirrors ROLE_RANK in supabase/functions/room-membership/index.ts. A
-- non-member (or a deleted account, p_user_id null) is -1, below everyone,
-- so any mod can remove content whose author has left or been deleted.
create function room_rank(p_room_id uuid, p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case role when 'owner' then 3 when 'admin' then 2 when 'mod' then 1 else 0 end
      from room_memberships
      where room_id = p_room_id and user_id = p_user_id and join_state = 'approved'
    ),
    -1
  );
$$;

create function can_remove_content(p_room_id uuid, p_actor uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_actor = p_author, false)
    or (is_room_moderator(p_room_id, p_actor) and room_rank(p_room_id, p_actor) > room_rank(p_room_id, p_author));
$$;

-- Internal to the removal functions below: callable over the API they'd
-- just be a way to read other people's roles and relationships.
revoke execute on function room_rank(uuid, uuid) from public, anon, authenticated;
revoke execute on function can_remove_content(uuid, uuid, uuid) from public, anon, authenticated;

-- ── Posts ─────────────────────────────────────────────────────────────────
-- Same signature and behaviour as before, with two changes: the rank rule
-- instead of "owner only", and `is distinct from` in place of `<>` — with a
-- deleted author (author_id null), `auth.uid() <> null` is null, so the old
-- version skipped the moderation log for exactly those posts.
create or replace function delete_post(p_post_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_author_id uuid;
  v_snapshot jsonb;
begin
  select room_id, author_id, jsonb_build_object('text', text, 'tag', tag, 'created_at', created_at)
  into v_room_id, v_author_id, v_snapshot
  from posts
  where id = p_post_id and deleted_at is null;

  if v_room_id is null then
    raise exception 'post not found';
  end if;

  if not can_remove_content(v_room_id, auth.uid(), v_author_id) then
    raise exception 'You can only remove posts by members below your role.';
  end if;

  update posts
  set deleted_at = now(), removed_by = auth.uid(), removal_reason = p_reason
  where id = p_post_id;

  if auth.uid() is distinct from v_author_id then
    insert into moderation_actions (room_id, actor_id, action_type, target_user_id, target_type, target_id, content_snapshot, reason)
    values (v_room_id, auth.uid(), 'remove_post', v_author_id, 'post', p_post_id, v_snapshot, p_reason);
  end if;
end;
$$;

-- ── Comments ──────────────────────────────────────────────────────────────
create function remove_comment(p_comment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_author_id uuid;
  v_snapshot jsonb;
begin
  select p.room_id, c.author_id, jsonb_build_object('text', c.text, 'post_id', c.post_id, 'created_at', c.created_at)
  into v_room_id, v_author_id, v_snapshot
  from comments c
  join posts p on p.id = c.post_id
  where c.id = p_comment_id and c.deleted_at is null;

  if v_room_id is null then
    raise exception 'comment not found';
  end if;

  if not can_remove_content(v_room_id, auth.uid(), v_author_id) then
    raise exception 'You can only remove comments by members below your role.';
  end if;

  update comments
  set deleted_at = now(), removed_by = auth.uid(), removal_reason = p_reason
  where id = p_comment_id;

  if auth.uid() is distinct from v_author_id then
    insert into moderation_actions (room_id, actor_id, action_type, target_user_id, target_type, target_id, content_snapshot, reason)
    values (v_room_id, auth.uid(), 'remove_comment', v_author_id, 'comment', p_comment_id, v_snapshot, p_reason);
  end if;
end;
$$;

-- ── Chat messages ─────────────────────────────────────────────────────────
-- Authors can remove their own message anywhere, DMs included. Removing
-- someone else's is a Room thing only: a DM has no moderators.
create function remove_message(p_message_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_kind conversation_kind;
  v_author_id uuid;
  v_snapshot jsonb;
  v_found boolean := false;
begin
  select true, c.room_id, c.kind, m.author_id,
         jsonb_build_object('text', m.text, 'image_url', m.image_url, 'voice_url', m.voice_url,
                            'conversation_id', m.conversation_id, 'created_at', m.created_at)
  into v_found, v_room_id, v_kind, v_author_id, v_snapshot
  from messages m
  join conversations c on c.id = m.conversation_id
  where m.id = p_message_id and m.deleted_at is null;

  if not coalesce(v_found, false) then
    raise exception 'message not found';
  end if;

  if auth.uid() is distinct from v_author_id then
    if v_kind <> 'room_channel' then
      raise exception 'You can only remove your own messages in a direct message.';
    end if;
    if not can_remove_content(v_room_id, auth.uid(), v_author_id) then
      raise exception 'You can only remove messages by members below your role.';
    end if;
  end if;

  update messages
  set deleted_at = now(), removed_by = auth.uid(), removal_reason = p_reason
  where id = p_message_id;

  if auth.uid() is distinct from v_author_id then
    insert into moderation_actions (room_id, actor_id, action_type, target_user_id, target_type, target_id, content_snapshot, reason)
    values (v_room_id, auth.uid(), 'remove_message', v_author_id, 'message', p_message_id, v_snapshot, p_reason);
  end if;
end;
$$;

-- ── Stories ───────────────────────────────────────────────────────────────
create function remove_story(p_story_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_author_id uuid;
  v_snapshot jsonb;
begin
  select room_id, author_id, jsonb_build_object('caption', caption, 'media_url', media_url, 'created_at', created_at)
  into v_room_id, v_author_id, v_snapshot
  from stories
  where id = p_story_id and expires_at > now();

  if v_room_id is null then
    raise exception 'story not found';
  end if;

  if not can_remove_content(v_room_id, auth.uid(), v_author_id) then
    raise exception 'You can only remove stories by members below your role.';
  end if;

  update stories set expires_at = now() where id = p_story_id;

  if auth.uid() is distinct from v_author_id then
    insert into moderation_actions (room_id, actor_id, action_type, target_user_id, target_type, target_id, content_snapshot, reason)
    values (v_room_id, auth.uid(), 'remove_story', v_author_id, 'story', p_story_id, v_snapshot, p_reason);
  end if;
end;
$$;

revoke execute on function remove_comment(uuid, text) from public, anon;
revoke execute on function remove_message(uuid, text) from public, anon;
revoke execute on function remove_story(uuid, text) from public, anon;
grant execute on function remove_comment(uuid, text) to authenticated;
grant execute on function remove_message(uuid, text) to authenticated;
grant execute on function remove_story(uuid, text) to authenticated;

-- ── Target validation learns about stories ────────────────────────────────
-- The CASE has no ELSE, so a target_type it doesn't list raises
-- "case not found" — 'story' has to be added here before anything logs one.
create or replace function validate_polymorphic_content_target()
returns trigger
language plpgsql
as $$
declare
  target_exists boolean;
begin
  if new.target_type is null then
    return new;
  end if;

  case new.target_type
    when 'post' then
      select exists (select 1 from posts where id = new.target_id) into target_exists;
    when 'comment' then
      select exists (select 1 from comments where id = new.target_id) into target_exists;
    when 'message' then
      select exists (select 1 from messages where id = new.target_id) into target_exists;
    when 'user' then
      select exists (select 1 from profiles where id = new.target_id) into target_exists;
    when 'story' then
      select exists (select 1 from stories where id = new.target_id) into target_exists;
  end case;

  if not target_exists then
    raise exception 'target % of type % does not exist', new.target_id, new.target_type;
  end if;

  return new;
end;
$$;

-- ── The moderation log is written by the server only ──────────────────────
-- There's no INSERT/UPDATE/DELETE policy, so RLS already refused client
-- writes; this removes the table-wide privileges from grants.sql too, now
-- that the log is something moderators act on. The room-membership Edge
-- Function writes with the service role and these functions are
-- SECURITY DEFINER, so neither is affected.
revoke insert, update, delete on moderation_actions from anon, authenticated;
