-- Domain-verified Rooms, step 1 of 2 — see the next migration for why
-- this is split out (ALTER TYPE ... ADD VALUE can't be used in the same
-- transaction that adds it, same reason 20260908090000 split similarly
-- for notification_type).
alter type room_visibility add value 'domain_verified';
