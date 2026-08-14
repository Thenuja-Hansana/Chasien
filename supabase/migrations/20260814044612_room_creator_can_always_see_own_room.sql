-- Phase 4: a room's creator can always see it, even before their owner
-- membership row exists.
--
-- `INSERT ... RETURNING` re-checks the table's SELECT policy on the row
-- being returned, in the same statement as the INSERT. The owner's
-- room_memberships row is only created by an AFTER INSERT trigger
-- (add_owner_membership_on_room_created, identity_and_rooms.sql) — for
-- an `invite`-visibility room, the original SELECT policy had no other
-- way to admit the row, so every invite-only room's creation itself
-- failed with 42501 the moment the client's insert asked for the new
-- row back (`.insert(...).select().single()`, mobile/src/lib/rooms.ts).
-- Public/request rooms never hit this, since their SELECT policy already
-- admits any authenticated user regardless of membership.
--
-- Rather than restructure the client to insert-then-fetch as two
-- separate round trips (working around the timing, not fixing the
-- policy), this closes the actual gap: a room's creator can always see
-- it, independent of whether their membership row exists yet. That's a
-- correct policy on its own merits, not just a workaround — a creator
-- should never lose visibility into a room they made, even transiently.

alter policy "public and request rooms are listable; invite rooms only to members"
on rooms
using (
  visibility in ('public', 'request')
  or created_by = auth.uid()
  or exists (
    select 1 from room_memberships rm
    where rm.room_id = rooms.id and rm.user_id = auth.uid()
  )
);
