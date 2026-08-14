-- Phase 4: table-level privileges for the `service_role` role — the same
-- class of bug as 20260813073524_grants.sql, just discovered later and
-- for a different role.
--
-- `service_role` has BYPASSRLS, which skips row-level security *policy*
-- checks — a completely separate layer from ordinary table-level GRANTs,
-- which Postgres still enforces regardless of BYPASSRLS. Without this,
-- every Edge Function using the service-role client (starting with
-- room-membership, Phase 4's join/approve/invite/role-change actions —
-- see supabase/functions/room-membership/index.ts) got a bare
-- "permission denied for table X" on its very first query. Found the
-- same way the original grants.sql bug was: by actually running the
-- function against a live local stack, not by reading the code.

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
