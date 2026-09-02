-- Phase 8: per-Room notification mute, and a narrow RPC for pinning a
-- post (the one Phase 8 mock event — "New pinned post in..." — with no
-- existing trigger for it, since nothing could pin a post before now).

-- Additive on an already-applied table, per this project's convention —
-- never editing 20260813051204_identity_and_rooms.sql itself.
alter table room_memberships
  add column notifications_muted boolean not null default false;

-- Mirrors create_post()/start_dm()'s shape: a narrow, atomic, security
-- definer function for one specific privileged action, rather than
-- widening posts' UPDATE policy (currently author-only) to let
-- moderators update *any* column of *any* post — a blanket grant like
-- that would also incidentally hand mods the soft-delete columns
-- (deleted_at/removed_by/removal_reason) before Phase 9 builds any UI
-- or review process around using them.
create function toggle_post_pin(p_post_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  select room_id into v_room_id from posts where id = p_post_id and deleted_at is null;
  if v_room_id is null then
    raise exception 'Post not found.';
  end if;

  if not is_room_moderator(v_room_id, auth.uid()) then
    raise exception 'Only an owner or mod can pin a post.';
  end if;

  update posts set pinned = p_pinned where id = p_post_id;
end;
$$;

grant execute on function toggle_post_pin(uuid, boolean) to authenticated;
