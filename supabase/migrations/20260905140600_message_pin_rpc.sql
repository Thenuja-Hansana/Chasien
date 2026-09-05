-- "Pin/unpin a chat message" (chat permission matrix) — mirrors
-- toggle_post_pin (20260902100000) exactly: a narrow, security-definer
-- RPC rather than widening messages' own UPDATE policy (currently
-- author-only) to let moderators touch *any* column of *any* message.
-- Restricted to Room channels — a DM has no moderator role to check
-- against, so pinning there wouldn't mean anything.
create function toggle_message_pin(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_room_id uuid;
begin
  select conversation_id into v_conversation_id from messages where id = p_message_id and deleted_at is null;
  if v_conversation_id is null then
    raise exception 'Message not found.';
  end if;

  select room_id into v_room_id from conversations where id = v_conversation_id;
  if v_room_id is null then
    raise exception 'Only messages in a Community chat can be pinned.';
  end if;

  if not is_room_moderator(v_room_id, auth.uid()) then
    raise exception 'Only an owner, admin, or moderator can pin a message.';
  end if;

  update messages
  set pinned_at = case when p_pinned then now() else null end,
      pinned_by = case when p_pinned then auth.uid() else null end
  where id = p_message_id;
end;
$$;

grant execute on function toggle_message_pin(uuid, boolean) to authenticated;
