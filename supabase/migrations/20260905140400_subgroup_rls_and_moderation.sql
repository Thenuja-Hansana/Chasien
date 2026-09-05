-- Wires the new admin/sub-group columns into RLS: sub-group management
-- becomes Admin-and-above (not Moderator), General is protected from
-- the rename/delete/visibility policies that now apply to sub-groups,
-- and posting_disabled/banned actually get enforced rather than just
-- sitting there as inert columns.

-- ── rooms ───────────────────────────────────────────────────────────────
-- Editing Community settings tightens from Moderator-and-above to
-- Admin-and-above (chat permission matrix, 5.3) — a plain rename, not
-- a rename+behavior-change, since is_room_admin already existed and
-- "owners and mods" was already the exact previous wording being fixed.
drop policy "owners and mods can update their room" on rooms;

create policy "owners and admins can update their room"
on rooms for update
to authenticated
using (is_room_admin(id, auth.uid()))
with check (is_room_admin(id, auth.uid()));

-- ── conversations (sub-group management) ──────────────────────────────
-- Same tightening for creating/renaming/deleting a sub-group (matrix:
-- Admin-and-above only, not Moderator) — plus `not is_default` on
-- update/delete so General can never be renamed or deleted through
-- this policy, and `not is_default` on insert so a client can never
-- claim to be creating a second "General" for a Room (General is only
-- ever created by add_owner_membership_on_room_created's trigger).
drop policy "moderators can create channels in their room" on conversations;
drop policy "moderators can rename channels in their room" on conversations;
drop policy "moderators can delete channels in their room" on conversations;

create policy "admins can create sub-groups in their room"
on conversations for insert
to authenticated
with check (
  kind = 'room_channel' and not is_default and is_room_admin(room_id, auth.uid())
);

create policy "admins can update sub-groups in their room"
on conversations for update
to authenticated
using (kind = 'room_channel' and not is_default and is_room_admin(room_id, auth.uid()))
with check (kind = 'room_channel' and not is_default and is_room_admin(room_id, auth.uid()));

create policy "admins can delete sub-groups in their room"
on conversations for delete
to authenticated
using (kind = 'room_channel' and not is_default and is_room_admin(room_id, auth.uid()));

-- ── conversation_participants ──────────────────────────────────────────
-- is_conversation_participant now excludes a banned row — a ban keeps
-- the row (rather than deleting it, so a rejoin attempt on a public
-- sub-group can be refused) but must stop counting as real membership
-- everywhere this function gates read access. Their own row is still
-- visible to them via the separate `user_id = auth.uid()` branch on
-- conversation_participants' own select policy, so a banned member can
-- still tell they're banned.
create or replace function is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id and not banned
  );
$$;

-- Still no insert/delete policy for regular users, sub-groups included
-- — joining/leaving/removing/muting/banning all route through the
-- room-membership Edge Function under the service role, same reasoning
-- as room_memberships itself: business rules (public vs. request vs.
-- invite, who can remove/mute/ban whom) belong in testable code, not a
-- single RLS boolean expression on the one table where getting it
-- wrong is a real privacy/moderation leak.
--
-- The one client-writable path — updating your own personal
-- preferences (muted/pinned/last_read_at) — now has to also make sure
-- that same path can't be used to quietly clear posting_disabled/banned
-- on yourself. RLS has no column-level check, so this is done by
-- comparing the proposed new value against the row's current
-- (pre-update) value via a self-referencing subquery: a real change to
-- either column fails the check, a same-value write passes; either way,
-- only the service role (which bypasses RLS) can actually flip them.
drop policy "a participant can update their own preferences" on conversation_participants;

create policy "a participant can update their own personal preferences"
on conversation_participants for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and posting_disabled = (
    select cp.posting_disabled from conversation_participants cp
    where cp.conversation_id = conversation_participants.conversation_id and cp.user_id = conversation_participants.user_id
  )
  and banned = (
    select cp.banned from conversation_participants cp
    where cp.conversation_id = conversation_participants.conversation_id and cp.user_id = conversation_participants.user_id
  )
);

-- ── conversations / messages read access excludes a ban ───────────────
-- These two inline their own conversation_participants EXISTS check
-- rather than calling is_conversation_participant (the function above
-- already covers every *other* caller), so both need the same
-- `not banned` added directly.
drop policy "participants can see their conversations" on conversations;

create policy "participants can see their conversations"
on conversations for select
to authenticated
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = conversations.id and cp.user_id = auth.uid() and not cp.banned
  )
);

drop policy "participants can read messages, minus soft-deleted content" on messages;

create policy "participants can read messages, minus soft-deleted content"
on messages for select
to authenticated
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid() and not cp.banned
  )
  and (
    deleted_at is null
    or author_id = auth.uid()
    or exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.room_id is not null
        and is_room_moderator(c.room_id, auth.uid())
    )
  )
);

-- ── messages insert enforces mute/ban ──────────────────────────────────
-- "Mute a member within chat" (matrix) only means something if it's
-- checked here, not just displayed in the UI.
drop policy "participants can send messages as themselves" on messages;

create policy "participants can send messages unless muted or banned"
on messages for insert
to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
      and not cp.posting_disabled and not cp.banned
  )
);
