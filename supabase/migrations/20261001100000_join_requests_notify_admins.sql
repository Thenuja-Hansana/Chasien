-- Join requests reach a Room's admins too.
--
-- notify_on_join_request() (20260902100100_notification_triggers.sql)
-- listed the roles it notifies by name: ('owner', 'mod'). The admin role
-- arrived three days later (20260905140000), and 20260905140100 widened
-- is_room_moderator() so every policy calling it picked admins up. This
-- trigger doesn't call it, so it was left behind: an admin can approve a
-- join request (the room-membership Edge Function's requireModerator lets
-- them), but was never told one had arrived. Reproduced on the local stack
-- before this migration: the owner and a mod were notified, an admin wasn't.
--
-- It asks is_room_moderator() now instead of naming roles, so the people
-- who are told about a request are, by construction, the people who can
-- answer it, and a future role change can't leave this behind again.
--
-- Same body otherwise. `create or replace` is right here: the signature is
-- unchanged, so the trigger keeps pointing at this function. Requests that
-- are already pending aren't notified again.

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
    and is_room_moderator(rm.room_id, rm.user_id)
    and not rm.notifications_muted;

  return new;
end;
$$;
