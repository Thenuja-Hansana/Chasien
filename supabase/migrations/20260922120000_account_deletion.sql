-- Phase 9, slice 6: deleting an account for real (Apple 5.1.1(v), Google
-- Play's User Data policy). Decided with the user:
--   * everything the person posted is deleted: posts, comments, chat
--     messages, stories (the SET NULL foreign keys would otherwise keep it
--     as "Deleted user")
--   * each Room they own passes to the next role down, the longest-standing
--     admin, then mod, then member; a Room with nobody else in it is deleted
--   * a DM with them disappears for the other person too (conversations'
--     dm_user_a/b already CASCADE; a DM needs both people to exist)
--   * reports and the moderation log are kept, as safety records: reports
--     they filed lose their name (SET NULL), reports about them keep the
--     snapshot of what was reported
--
-- The `delete-account` Edge Function runs this, because deleting the
-- Supabase Auth user needs the service role: account_storage_paths()
-- first, then delete_account_data(), then the Auth user (whose deletion
-- cascades everything else: likes, reactions, votes, tags, memberships,
-- friendships, blocks, notifications, push tokens), then the files.

-- ── Who takes over a Room ─────────────────────────────────────────────────
-- The rule promote_next_owner_on_owner_departure (20260905140500) already
-- applied, now in one place so the preview below can never disagree with
-- what actually happens. user_id breaks a tie between people who joined at
-- the same moment, which used to be arbitrary.
create function room_successor(p_room_id uuid, p_leaving uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id
  from room_memberships
  where room_id = p_room_id
    and user_id <> p_leaving
    and join_state = 'approved'
  order by
    case role when 'admin' then 1 when 'mod' then 2 when 'member' then 3 else 4 end,
    created_at asc,
    user_id asc
  limit 1;
$$;

revoke execute on function room_successor(uuid, uuid) from public, anon, authenticated;
grant execute on function room_successor(uuid, uuid) to service_role;

create or replace function promote_next_owner_on_owner_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_user_id uuid;
begin
  if old.role != 'owner' then
    return old;
  end if;

  v_next_user_id := room_successor(old.room_id, old.user_id);

  if v_next_user_id is not null then
    update room_memberships set role = 'owner'
    where room_id = old.room_id and user_id = v_next_user_id;
  end if;

  return old;
end;
$$;

-- ── What the person sees before deleting ─────────────────────────────────
-- Their own Rooms only, and who each one would go to (null = the Room is
-- deleted, because nobody else is in it).
create function account_deletion_preview()
returns table (room_id uuid, room_name text, successor_handle text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.name, (select p.handle from profiles p where p.id = room_successor(r.id, auth.uid()))
  from room_memberships m
  join rooms r on r.id = m.room_id
  where m.user_id = auth.uid() and m.role = 'owner' and m.join_state = 'approved'
  order by r.name;
$$;

revoke execute on function account_deletion_preview() from public, anon;
grant execute on function account_deletion_preview() to authenticated;

-- ── The files to remove ───────────────────────────────────────────────────
-- Run before delete_account_data(), while the Rooms and conversations that
-- are about to go still exist. Every upload path is `{scope}/{uploader}/…`
-- (profile pictures: `{user}/…`), so:
--   * everything they uploaded to posts, stories and chats (second folder)
--   * their profile pictures (first folder)
--   * everything in a Room that's about to be deleted, and in its chats
--   * everything in their DMs, the other person's files too, since those
--     conversations are deleted whole
-- Room pictures they uploaded for a Room that survives are kept: they
-- belong to the Room now.
create function account_storage_paths(p_user uuid)
returns table (bucket text, path text)
language sql
stable
security definer
set search_path = public, storage
as $$
  with doomed_rooms as (
    select m.room_id::text as id
    from room_memberships m
    where m.user_id = p_user and m.role = 'owner' and m.join_state = 'approved'
      and room_successor(m.room_id, p_user) is null
  ),
  doomed_conversations as (
    select c.id::text as id from conversations c where c.room_id::text in (select id from doomed_rooms)
    union
    select c.id::text from conversations c where c.kind = 'dm' and p_user in (c.dm_user_a, c.dm_user_b)
  )
  select o.bucket_id, o.name
  from storage.objects o
  where (o.bucket_id in ('post-media', 'story-media', 'message-media') and (storage.foldername(o.name))[2] = p_user::text)
     or (o.bucket_id = 'profile-media' and (storage.foldername(o.name))[1] = p_user::text)
     or (o.bucket_id in ('post-media', 'story-media', 'room-media') and (storage.foldername(o.name))[1] in (select id from doomed_rooms))
     or (o.bucket_id = 'message-media' and (storage.foldername(o.name))[1] in (select id from doomed_conversations));
$$;

-- ── Deleting the data ─────────────────────────────────────────────────────
-- One transaction. Rooms first: a Room nobody else is in is deleted (its
-- content goes with it); otherwise their owner membership is deleted, and
-- promote_next_owner_on_owner_departure hands the Room to room_successor(),
-- logged here so the Room's mods can see what happened. Then their own
-- content, which the SET NULL foreign keys would otherwise keep. Deleting a
-- post or comment takes other people's comments and replies on it along,
-- as deleting a post always does. Safe to run twice: a retry after the
-- Auth step failed finds nothing left to do.
create function delete_account_data(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_successor uuid;
  v_handed_over int := 0;
  v_rooms_deleted int := 0;
  v_posts int;
  v_comments int;
  v_messages int;
  v_stories int;
begin
  for v_room_id in
    select m.room_id from room_memberships m
    where m.user_id = p_user and m.role = 'owner' and m.join_state = 'approved'
  loop
    v_successor := room_successor(v_room_id, p_user);
    if v_successor is null then
      delete from rooms where id = v_room_id;
      v_rooms_deleted := v_rooms_deleted + 1;
    else
      delete from room_memberships where room_id = v_room_id and user_id = p_user;
      insert into moderation_actions (room_id, actor_id, action_type, target_user_id, reason)
      values (v_room_id, p_user, 'role_change', v_successor, 'Became owner when the previous owner deleted their account');
      v_handed_over := v_handed_over + 1;
    end if;
  end loop;

  delete from posts where author_id = p_user;
  get diagnostics v_posts = row_count;
  delete from comments where author_id = p_user;
  get diagnostics v_comments = row_count;
  delete from messages where author_id = p_user;
  get diagnostics v_messages = row_count;
  delete from stories where author_id = p_user;
  get diagnostics v_stories = row_count;

  return jsonb_build_object(
    'rooms_handed_over', v_handed_over,
    'rooms_deleted', v_rooms_deleted,
    'posts', v_posts,
    'comments', v_comments,
    'messages', v_messages,
    'stories', v_stories
  );
end;
$$;

-- ── Emailed requests ─────────────────────────────────────────────────────
-- People can ask for deletion without the app (Google Play), by email from
-- the address they signed up with. The admin screen finds the account by
-- that address. Emails live in auth.users, so this is service-role only.
create function find_account_by_email(p_email text)
returns table (user_id uuid, handle text, name text, is_app_admin boolean)
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.id, p.handle, p.name, is_app_admin(p.id)
  from auth.users u
  join profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(p_email));
$$;

revoke execute on function account_storage_paths(uuid) from public, anon, authenticated;
revoke execute on function delete_account_data(uuid) from public, anon, authenticated;
revoke execute on function find_account_by_email(text) from public, anon, authenticated;
grant execute on function account_storage_paths(uuid) to service_role;
grant execute on function delete_account_data(uuid) to service_role;
grant execute on function find_account_by_email(text) to service_role;
