-- Follow-up to 20260907130000. sync_channel_participants_on_membership_change
-- (20260905140300) only auto-adds a newly-approved Room member to
-- conversations where is_default = true. While the previous migration's
-- bug meant a Room's 'general' channel could have is_default = false,
-- that trigger silently found no channel to add new members to at all --
-- so any member who joined such a Room *after* it was created (not just
-- the owner, already fixed for their own row by the previous migration)
-- ended up with no conversation_participants row for General whatsoever,
-- not merely one mis-flagged as a sub-group. Backfilling here rather than
-- relying on the previous migration's is_default fix to somehow retroact
-- through a trigger that only fires on room_memberships changes.
insert into conversation_participants (conversation_id, user_id, join_state)
select c.id, rm.user_id, 'approved'
from conversations c
join room_memberships rm on rm.room_id = c.room_id and rm.join_state = 'approved'
where c.kind = 'room_channel' and c.is_default = true
on conflict (conversation_id, user_id) do nothing;
