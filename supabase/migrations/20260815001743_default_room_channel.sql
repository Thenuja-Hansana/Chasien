-- Phase 6: every Room gets exactly one group chat channel, 'general',
-- the moment it's created — matching the mock's single-inbox-per-Room
-- model (no sub-channel UI anywhere in app_reference).
--
-- Extends the existing add_owner_membership_on_room_created() trigger
-- (identity_and_rooms.sql) rather than adding a second AFTER INSERT
-- trigger on rooms. Two triggers on the same table for the same event
-- fire in name order, which is implicit and easy to get wrong — here it
-- would matter a lot: seed_participants_on_conversation_created (which
-- fires the instant the conversation row below is inserted) seeds
-- participants from currently-approved room_memberships rows, so the
-- owner's membership MUST already exist before the conversation is
-- created, or the owner ends up with no participant row in their own
-- Room's channel. Keeping both inserts in one function body guarantees
-- that order outright instead of depending on trigger-name sorting.
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

  insert into conversations (kind, room_id, name)
  values ('room_channel', new.id, 'general');

  return new;
end;
$$;

-- Backfill: every Room created before this migration (all of Phase 4 and
-- Phase 5's testing) has no conversation at all yet. seed_participants_
-- on_conversation_created (chat.sql) still fires per row for this insert
-- and correctly backfills current approved members alongside it.
insert into conversations (kind, room_id, name)
select 'room_channel', r.id, 'general'
from rooms r
where not exists (
  select 1 from conversations c where c.room_id = r.id and c.kind = 'room_channel'
);
