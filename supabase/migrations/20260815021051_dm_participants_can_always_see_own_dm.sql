-- Phase 6: a DM's own two participants can always see it, independent
-- of whether their conversation_participants rows exist yet.
--
-- The exact same bug class as Phase 4's
-- 20260814044612_room_creator_can_always_see_own_room.sql, rediscovered
-- here despite being documented once already: `INSERT ... RETURNING`
-- re-checks the table's SELECT policy on the row being returned, in the
-- same statement — and start_dm()'s participant rows are only created
-- by seed_participants_on_conversation_created (chat.sql), an AFTER
-- INSERT trigger whose own insert that recheck doesn't see. Every call
-- to start_dm() failed with "new row violates row-level security policy
-- for table conversations", reproduced with the other INSERT policy on
-- this table temporarily dropped to rule out a multi-policy interaction
-- — it was this, alone.
--
-- Fixed the same way Phase 4 fixed it: not by restructuring the RPC
-- into two round trips to dodge the timing, but by closing the actual
-- gap in the policy. The two people a DM is between should always be
-- able to see it — that's correct on its own merits, not just a
-- workaround for this timing quirk.

alter policy "participants can see their conversations"
on conversations
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = conversations.id and cp.user_id = auth.uid()
  )
  or dm_user_a = auth.uid()
  or dm_user_b = auth.uid()
);
