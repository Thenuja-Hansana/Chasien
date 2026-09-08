-- Fixes a real regression, found while testing the new friendships work
-- but unrelated to it: 20260815021051_dm_participants_can_always_see_own_dm.sql
-- widened "participants can see their conversations" so a DM's own two
-- participants can always see it, closing a genuine INSERT ... RETURNING
-- + RLS timing gap (documented there in detail -- seed_participants_
-- on_conversation_created's participant-row insert isn't visible to the
-- same statement's RETURNING re-check of the SELECT policy).
--
-- 20260905150000_subgroup_join_state.sql later needed to add join_state/
-- banned checks to this same policy for sub-groups, and did it with
-- `drop policy ... create policy ...` built off the *original* policy
-- body (predating the Aug 15 ALTER POLICY) -- silently dropping the
-- dm_user_a/dm_user_b clause. start_dm() has been unable to create a
-- genuinely new DM ever since (reusing an existing conversation row
-- still worked, since that path never touches this timing gap at all --
-- which is exactly why this went unnoticed until a fresh pair with no
-- prior DM tried it).
drop policy "participants can see their conversations" on conversations;

create policy "participants can see their conversations"
on conversations for select
to authenticated
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = conversations.id and cp.user_id = auth.uid()
      and not cp.banned and cp.join_state = 'approved'
  )
  or dm_user_a = auth.uid()
  or dm_user_b = auth.uid()
);
