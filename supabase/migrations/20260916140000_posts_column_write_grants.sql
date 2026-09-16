-- posts: narrow direct INSERT/UPDATE to the columns a client may actually set.
--
-- grants.sql (Phase 1) granted INSERT/UPDATE on every table to
-- `authenticated` and left all restriction to RLS. That works for *rows*,
-- but RLS can't restrict *columns*: posts' INSERT policy checks authorship,
-- membership and members_can_post, and its UPDATE policy checks
-- authorship — neither looks at which columns are being written. Verified
-- on the local stack (2026-09-16) through the public REST API with ordinary
-- user sessions, never the service role:
--   * a plain member (tobi, grit-club) could insert a post with
--     pinned = true and created_at a year in the future;
--   * an author could update their own post's pinned and created_at.
-- The feed orders by created_at, so a future-dated post sits above every
-- newer post in its Room for as long as the fake date says; and pinning is
-- meant to be moderator-only, through toggle_post_pin(). (Moving a post
-- into another Room by updating room_id was already refused: an UPDATE's
-- new row must also pass posts' SELECT policy, which requires membership
-- of the new Room — so the cross-Room isolation guarantee was never open.)
--
-- Every legitimate writer, checked against the full migration history:
--   create_post()        security invoker  inserts room_id, author_id, text, tag
--   create_event_post()  security invoker  inserts room_id, author_id, text
--   toggle_post_pin()    security definer  updates pinned                     (unaffected)
--   delete_post()        security definer  updates deleted_at, removed_by,
--                                          removal_reason                     (unaffected)
-- The client never writes `posts` directly, and updated_at is set by a
-- BEFORE trigger, which column privileges don't apply to. Defaulted columns
-- (id, pinned, created_at, ...) need no privilege when an INSERT omits them.
--
-- So: INSERT only on the columns the two invoker RPCs write, and UPDATE
-- only on text and tag — the edit the "authors can edit their own posts"
-- policy exists for, though nothing in the app edits posts yet. A column
-- added to posts later is NOT client-writable until it's added to these
-- grants explicitly; that's the point.
--
-- anon: grants.sql meant to grant it nothing, but Supabase's default
-- privileges gave it INSERT/UPDATE on every table anyway. RLS already
-- refused its writes (verified); this removes the privilege itself for
-- posts. Other tables likely share both gaps — that's the roadmap's
-- Phase 10 security pass, not this migration.

revoke insert, update on posts from anon, authenticated;

grant insert (room_id, author_id, text, tag) on posts to authenticated;
grant update (text, tag) on posts to authenticated;
