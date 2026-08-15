-- Phase 6: enables realtime delivery for messages, reactions, and
-- read-receipt updates (conversation_participants.last_read_at).
--
-- `postgres_changes` subscriptions authorize every event against the
-- subscribing user's own RLS policies before delivering it — confirmed
-- against Supabase's current docs before relying on it, since this is
-- exactly the mechanism the exit condition depends on ("a non-member
-- cannot subscribe to a Room's chat channel even by guessing the
-- channel id"). The existing policies on `messages` ("participants can
-- read messages") already express that; nothing new needs writing here,
-- only enabling the tables to emit change events at all — a table not
-- in this publication fires no realtime events for anyone, RLS-passing
-- or not.
--
-- Typing indicators deliberately don't need a table here: they're
-- ephemeral Realtime Broadcast messages on each conversation's channel
-- (mobile/src/lib/chat.ts), not rows, so there's nothing to add to a
-- publication for them.

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table message_reactions;
alter publication supabase_realtime add table conversation_participants;
