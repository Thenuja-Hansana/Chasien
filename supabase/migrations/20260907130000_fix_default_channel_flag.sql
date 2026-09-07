-- Bug fix: add_owner_membership_on_room_created() (20260815001743) has
-- inserted every new Room's 'general' conversation with no is_default
-- value since the column didn't exist yet when that trigger was written.
-- 20260905140200 added is_default (default false) and backfilled true
-- only for channels that existed at that moment -- the trigger itself
-- was never updated, so every Room created since then got a 'general'
-- channel indistinguishable from a sub-group. Client-side,
-- fetchRoomSubgroups() filters on is_default = false (subgroups.ts), so
-- General silently fell into the "Sub-groups" list instead of "Main
-- chat" for any Room created after that migration.
create or replace function add_owner_membership_on_room_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into room_memberships (room_id, user_id, role, join_state)
    values (new.id, new.created_by, 'owner', 'approved');
  end if;

  insert into conversations (kind, room_id, name, is_default)
  values ('room_channel', new.id, 'general', true);

  return new;
end;
$$;

-- Backfill: any Room created between 20260905140200 and this fix whose
-- 'general' channel got silently mis-flagged is_default = false. Scoped
-- to Rooms with no is_default = true channel at all yet, so this can
-- never touch a Room whose General is already flagged correctly.
update conversations c
set is_default = true
where c.kind = 'room_channel'
  and c.name = 'general'
  and c.is_default = false
  and not exists (
    select 1 from conversations c2
    where c2.room_id = c.room_id and c2.kind = 'room_channel' and c2.is_default = true
  );
