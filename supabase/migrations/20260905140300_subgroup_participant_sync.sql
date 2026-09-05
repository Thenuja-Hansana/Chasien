-- Rescopes the two existing room_channel participant-sync triggers
-- (20260813051209_chat.sql) now that a Room can have sub-groups whose
-- membership is independent of room_memberships. Only the two
-- "auto-add on join" branches change — the "remove on leave" branches
-- are left exactly as they already were, deliberately: leaving or being
-- un-approved from the Community must still clear every one of that
-- Room's channels, General and every sub-group alike, which is already
-- what both functions' removal branches do today.

create or replace function sync_channel_participants_on_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from conversation_participants cp
    using conversations c
    where cp.conversation_id = c.id
      and c.kind = 'room_channel'
      and c.room_id = old.room_id
      and cp.user_id = old.user_id;
    return old;
  end if;

  -- Joining/being approved only auto-adds to General (is_default) now —
  -- a sub-group's membership is joined individually (see the
  -- join_subgroup Edge Function action), never inherited from Community
  -- membership.
  if new.join_state = 'approved' and (tg_op = 'INSERT' or old.join_state is distinct from 'approved') then
    insert into conversation_participants (conversation_id, user_id)
    select c.id, new.user_id
    from conversations c
    where c.kind = 'room_channel' and c.room_id = new.room_id and c.is_default
    on conflict (conversation_id, user_id) do nothing;
  elsif tg_op = 'UPDATE' and old.join_state = 'approved' and new.join_state is distinct from 'approved' then
    delete from conversation_participants cp
    using conversations c
    where cp.conversation_id = c.id
      and c.kind = 'room_channel'
      and c.room_id = new.room_id
      and cp.user_id = new.user_id;
  end if;

  return new;
end;
$$;

create or replace function seed_participants_on_conversation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only General gets backfilled with every current Community member —
  -- a newly created sub-group starts with just its creator, inserted
  -- directly by the create_subgroup Edge Function action, not mirrored
  -- from room_memberships here.
  if new.kind = 'room_channel' and new.is_default then
    insert into conversation_participants (conversation_id, user_id)
    select new.id, rm.user_id
    from room_memberships rm
    where rm.room_id = new.room_id and rm.join_state = 'approved'
    on conflict (conversation_id, user_id) do nothing;
  elsif new.kind = 'dm' then
    insert into conversation_participants (conversation_id, user_id)
    values (new.id, new.dm_user_a), (new.id, new.dm_user_b)
    on conflict (conversation_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

-- Denormalized conversations.member_count (20260905140200), maintained
-- the same way rooms.member_count already is (20260903150000): a
-- counter trigger, not a live count(*) per row on Discover/All-Groups.
create function sync_conversation_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update conversations set member_count = member_count + 1 where id = new.conversation_id;
    return new;
  end if;
  if tg_op = 'DELETE' then
    update conversations set member_count = member_count - 1 where id = old.conversation_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger sync_conversation_member_count_on_participant_change
after insert or delete on conversation_participants
for each row execute function sync_conversation_member_count();
