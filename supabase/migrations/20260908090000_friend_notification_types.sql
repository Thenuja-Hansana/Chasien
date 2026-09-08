-- Friends architecture, step 1 of 2. A new enum value can't be used in
-- the same transaction that adds it (Postgres restriction on ALTER TYPE
-- ... ADD VALUE), and each migration file runs as one transaction — so
-- these two values are added here, in their own migration, and the
-- table/triggers that actually use them follow in the next one.
alter type notification_type add value 'friend_request';
alter type notification_type add value 'friend_accept';
