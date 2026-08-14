-- Phase 5: approved members of a Room can see each other's approved
-- membership rows.
--
-- Until now `room_memberships` was readable only two ways
-- (row_level_security.sql): your own row, or every row if you're a
-- moderator. That made the feed's OWNER/MOD badge — which the mock puts
-- on posts, and which Phase 5 ports — effectively dead UI: the only
-- people who could see who the mods are were the mods themselves.
--
-- Scope is deliberately narrow. This grants visibility of *approved*
-- rows only, and only to callers who are themselves approved members of
-- that same Room:
--
--   * `pending` rows stay hidden from ordinary members, so who asked to
--     join (and was turned down) is still mod-only information.
--   * `invited` rows stay hidden too, so a pending invite isn't
--     advertised to the whole Room before the person accepts.
--   * Non-members gain nothing: is_room_member() is false for them, so
--     Phase 4's isolation guarantee — an invite-only Room revealing
--     nothing to outsiders — is untouched.
--
-- What it does newly reveal, to fellow members only, is the membership
-- list of a Room you are already inside. That is the ordinary
-- expectation for a community app (and what the mock assumes), not a
-- widening of who can see the Room's existence or its content.

create policy "approved members can see each other"
on room_memberships for select
to authenticated
using (
  join_state = 'approved'
  and is_room_member(room_id, auth.uid())
);
