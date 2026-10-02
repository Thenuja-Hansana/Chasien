-- Phase 10, slice 3: the tables the column lockdown missed, and a way
-- around start_dm().
--
-- 20260916150000 replaced the blanket "every column of every table" grant
-- with column lists, table by table, for the tables the app writes by
-- column. Ten objects were left on the old grant: conversations,
-- post_likes, message_reactions, hidden_posts, push_tokens,
-- room_memberships, the my_inbox view, and polls / poll_options / events
-- (those three are slice 4's, with create_post()). Reproduced on the local
-- stack before this migration, as ordinary accounts, rolled back:
--
-- 1. A DM with anyone. start_dm() is where "you must be friends" and "not
--    blocked" are enforced, but it is SECURITY INVOKER, so the person
--    calling it needs INSERT on conversations and an INSERT policy for DMs
--    ("a user can start a dm they are part of"). The same grant and policy
--    let them skip the function and insert the row themselves. A non-friend
--    created the DM and sent a message into it. A blocked person's message
--    was refused by the block trigger, but the empty DM still appeared in
--    the other person's chat list.
--
-- 2. Sub-groups written directly. The app creates, edits and deletes
--    sub-groups through the room-membership Edge Function, which validates
--    them. Three policies (20260905140400) still let a Room admin write
--    the rows directly, and the grant covered every column: a sub-group
--    was inserted with member_count 9999 and a 2020 created_at.
--
-- 3. Client-written timestamps. A like, a reaction and a hidden post were
--    each inserted dated 2020, and a push token row was inserted directly
--    and re-dated. (Open since the 2026-09-16 audit.)
--
-- What changes:
--
-- * start_dm() becomes SECURITY DEFINER. Its checks are unchanged, and it
--   still identifies the caller from auth.uid(). It no longer needs the
--   caller to be able to write conversations, so that permission goes.
--
-- * conversations is not client-writable at all. DMs come from start_dm(),
--   sub-groups from the Edge Function (service role). The DM insert policy
--   and the three sub-group write policies are dropped: with no grant
--   behind them they would only suggest a path that isn't there. The two
--   SELECT policies are untouched.
--
-- * post_likes, message_reactions and hidden_posts keep INSERT on exactly
--   the columns the app sends; their timestamps come from the column
--   default. None of them had an UPDATE policy, so UPDATE goes.
--
-- * push_tokens loses INSERT and UPDATE. register_push_token() (SECURITY
--   DEFINER, 20260902120000) has been the app's only way of writing it
--   since Phase 8. SELECT and DELETE of your own rows stay.
--
-- * room_memberships and my_inbox lose write grants they could never use
--   (no policy; a view that isn't updatable). room_memberships is read-only
--   to clients by design; now the grants say so, and a write is refused
--   outright rather than filtered to nothing.
--
-- * DELETE is revoked where no policy allows it: comments, messages, posts,
--   profiles, conversation_participants, room_memberships. Removal of
--   content is a SECURITY DEFINER function (delete_post, remove_comment,
--   remove_message), account deletion is an Edge Function. A DELETE on one
--   of these used to succeed and delete nothing.
--
-- No app change: every direct write in mobile/src/lib was inventoried, and
-- none sends a column or touches a table that this takes away.

-- ---------------------------------------------------------------------
-- start_dm(): same body, SECURITY DEFINER.
-- ---------------------------------------------------------------------

create or replace function start_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
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

-- `create or replace` keeps the function's grants, and 20261002100000
-- granted it to authenticated. Stated again so this file stands alone.
revoke execute on function start_dm(uuid) from public, anon;
grant execute on function start_dm(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- conversations: no direct client writes.
-- ---------------------------------------------------------------------

drop policy "a user can start a dm they are part of" on conversations;
drop policy "admins can create sub-groups in their room" on conversations;
drop policy "admins can update sub-groups in their room" on conversations;
drop policy "admins can delete sub-groups in their room" on conversations;

revoke insert, update, delete on conversations from authenticated;

-- ---------------------------------------------------------------------
-- Likes, reactions, hidden posts: the app's columns only.
-- ---------------------------------------------------------------------

revoke insert, update on post_likes from authenticated;
grant insert (post_id, user_id) on post_likes to authenticated;

revoke insert, update on message_reactions from authenticated;
grant insert (message_id, user_id, emoji) on message_reactions to authenticated;

revoke insert, update on hidden_posts from authenticated;
grant insert (post_id, user_id) on hidden_posts to authenticated;

-- ---------------------------------------------------------------------
-- push_tokens: written by register_push_token() only.
-- ---------------------------------------------------------------------

revoke insert, update on push_tokens from authenticated;

-- ---------------------------------------------------------------------
-- Grants nothing could use.
-- ---------------------------------------------------------------------

revoke insert, update, delete on room_memberships from authenticated;
revoke insert, update, delete on my_inbox from authenticated;

revoke delete on comments, messages, posts, profiles, conversation_participants from authenticated;
