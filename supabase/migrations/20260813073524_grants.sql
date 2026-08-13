-- Phase 1: table-level privileges for the `authenticated` role.
--
-- RLS policies are a *second*, row-level filter — Postgres still checks
-- ordinary GRANTs first, and a table with RLS enabled but no GRANT to a
-- role denies that role everything regardless of how permissive the
-- policies are. Found this the hard way: every query below failed with
-- "permission denied for table X" (a privilege error, not a policy
-- rejection) until this migration existed.
--
-- Deliberately coarse — SELECT/INSERT/UPDATE/DELETE granted broadly to
-- `authenticated` on every table, with RLS doing 100% of the actual
-- row-level restriction. This is safe specifically because it's paired
-- with deny-by-default RLS: granting UPDATE on room_memberships, for
-- instance, does nothing on its own, since that table has zero UPDATE
-- policies for `authenticated` (see row_level_security.sql) — a grant
-- with no matching policy is still a full deny. Not granting anything to
-- `anon`: every table in this schema requires a signed-in user.

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
