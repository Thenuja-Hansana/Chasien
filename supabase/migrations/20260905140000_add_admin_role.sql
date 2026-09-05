-- 3-tier Community role upgrade (Owner -> Admin -> Moderator -> Member):
-- adds the missing 'admin' tier between owner and mod. Kept as its own
-- migration, deliberately empty of anything else that references it —
-- Postgres won't let a brand-new enum value be used by name in the same
-- transaction that adds it, so every policy/function naming 'admin' has
-- to live in a later migration, applied once this one has committed.
alter type room_role add value 'admin' after 'owner';
