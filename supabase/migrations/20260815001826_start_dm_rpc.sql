-- Phase 6: get-or-create a DM conversation between the caller and
-- another user.
--
-- Genuinely awkward as pure client logic, for two reasons the schema
-- itself imposes (chat.sql): dm_user_a/dm_user_b must be in canonical
-- sorted order (dm_pair_ordered), and dm_pair_unique means a second
-- attempt to create the same pair's DM is a race, not just a duplicate
-- to politely ignore — two people tapping "Message" on each other at
-- the same moment would otherwise surface a raw unique-violation to
-- one of them. This wraps "does it exist -> use it, else create it,
-- and if someone beat you to it, use theirs" as one atomic call.
--
-- security invoker, deliberately: the existing RLS policies already
-- permit everything this function does (a user can always start a DM
-- they're a part of, and can always read a DM they're a participant
-- in) — there's no privileged bypass needed here, unlike
-- room-membership's Edge Function.
create function start_dm(other_user_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  user_a uuid;
  user_b uuid;
  conv_id uuid;
begin
  if caller is null then
    raise exception 'Not authenticated.';
  end if;
  if other_user_id = caller then
    raise exception 'Cannot start a DM with yourself.';
  end if;

  if caller < other_user_id then
    user_a := caller;
    user_b := other_user_id;
  else
    user_a := other_user_id;
    user_b := caller;
  end if;

  select id into conv_id
  from conversations
  where kind = 'dm' and dm_user_a = user_a and dm_user_b = user_b;

  if conv_id is not null then
    return conv_id;
  end if;

  begin
    insert into conversations (kind, dm_user_a, dm_user_b)
    values ('dm', user_a, user_b)
    returning id into conv_id;
  exception when unique_violation then
    -- The other participant's own start_dm() call won the race between
    -- this function's SELECT above and its INSERT — use their row.
    select id into conv_id
    from conversations
    where kind = 'dm' and dm_user_a = user_a and dm_user_b = user_b;
  end;

  return conv_id;
end;
$$;
