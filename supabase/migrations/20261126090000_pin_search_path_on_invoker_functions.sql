-- Pin search_path on the four functions that had none.
--
-- Supabase's advisor flagged them on the hosted project
-- (`supabase db advisors --remote`, 2026-11-11, Phase 11 slice 3; lint
-- function_search_path_mutable). Every SECURITY DEFINER function here
-- already pins its search_path, and the security re-check enforced that,
-- but only for SECURITY DEFINER functions. These four are SECURITY
-- INVOKER, so nothing caught them:
--
--   set_updated_at()                        trigger: comments, conversations,
--                                           friendships, messages, posts,
--                                           profiles, push_tokens,
--                                           room_memberships, rooms
--   enforce_single_level_comment_replies()  trigger: comments
--   validate_polymorphic_content_target()   trigger: reports, moderation_actions
--   vote_poll(uuid, uuid)                   called by the app; stays SECURITY
--                                           INVOKER on purpose (architecture.md,
--                                           "Database write access")
--
-- Without a pinned search_path, a function finds the tables it names
-- (comments, polls, poll_votes, ...) through whatever search_path its
-- caller has set. Pinned, those names always mean the tables in public.
--
-- No behaviour changes:
--   - ALTER FUNCTION ... SET keeps each body, owner, grant and SECURITY
--     INVOKER as they are.
--   - Every name in the four bodies resolves in public, in pg_catalog
--     (now()), or is schema-qualified (auth.uid()).
--   - All four are PL/pgSQL, which the planner never inlines, so a SET
--     clause costs nothing. (A plain SQL function used in a policy would
--     lose inlining; none of these is one.)
--
-- supabase/tests/security_invariants.js now checks every function in
-- public, so a new function without a pinned search_path fails there.

alter function public.set_updated_at() set search_path = public;
alter function public.enforce_single_level_comment_replies() set search_path = public;
alter function public.validate_polymorphic_content_target() set search_path = public;
alter function public.vote_poll(uuid, uuid) set search_path = public;
