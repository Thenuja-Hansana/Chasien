-- delete_post(): soft-deletes a post, restricted to its own author or the
-- Room's owner — deliberately narrower than "moderator" (mods can't delete
-- posts here, only owners can), so this can't reuse is_room_moderator().
--
-- Unlike create_post() (security invoker, by design — see that function's
-- own comment), this one has to be security definer: the owner-removes-
-- someone-else's-post path has no matching RLS UPDATE policy today
-- ("authors can edit their own, not-yet-removed posts" in
-- row_level_security.sql is author-only), so a plain UPDATE under RLS would
-- fail for exactly the case this function exists to allow. The permission
-- check below is what keeps that bypass narrow instead of wide open.
--
-- Only logs to moderation_actions when the actor isn't the post's own
-- author — a person deleting their own post is ordinary content management,
-- not a moderation event, the same way editing your own post isn't logged
-- either. An owner removing someone else's post is exactly the case
-- moderation_actions (Phase 1, trust_and_safety.sql) was built to audit.

create function delete_post(p_post_id uuid, p_reason text default null)
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

  if auth.uid() <> v_author_id and not is_room_owner(v_room_id, auth.uid()) then
    raise exception 'only this post''s author or the Room owner can delete it';
  end if;

  update posts
  set deleted_at = now(), removed_by = auth.uid(), removal_reason = p_reason
  where id = p_post_id;

  if auth.uid() <> v_author_id then
    insert into moderation_actions (room_id, actor_id, action_type, target_type, target_id, content_snapshot, reason)
    values (v_room_id, auth.uid(), 'remove_post', 'post', p_post_id, v_snapshot, p_reason);
  end if;
end;
$$;

revoke execute on function delete_post(uuid, text) from public;
grant execute on function delete_post(uuid, text) to authenticated;
