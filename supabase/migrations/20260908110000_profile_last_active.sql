-- Backs the new user-preview popup's "Active now" / "Active 5m ago" line
-- — a plain last-seen timestamp the client bumps itself while the app is
-- in use, not real-time presence (no new Realtime Presence channel,
-- multi-device fan-in, or disconnect-detection edge cases to build for
-- what's ultimately a cosmetic touch). No RLS changes needed: "users can
-- update their own profile" (row_level_security.sql) already covers
-- writing this on your own row, and "profiles are readable by any
-- authenticated user" already covers reading anyone else's — RLS is
-- row-level, not column-level.
alter table profiles add column last_active_at timestamptz;
