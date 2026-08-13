-- Phase 1: notifications. `data` carries the type-specific payload (which
-- post, which comment, who liked what) as jsonb rather than a pile of
-- nullable foreign keys for every possible notification shape — the
-- trigger-based fan-out that actually populates this table on real
-- events (a like, a reply, a join request) is Phase 8 scope; this
-- migration only defines the shape it lands in.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  -- Recipient. CASCADE (not SET NULL like content tables) is correct
  -- here: a notification belongs entirely to one user and has no effect
  -- on anyone else's data, so deleting it with their account is right.
  user_id uuid not null references profiles (id) on delete cascade,
  type notification_type not null,
  actor_id uuid references profiles (id) on delete set null,
  room_id uuid references rooms (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on notifications (user_id, created_at desc);

-- `read_at is null` is an immutable predicate (unlike a now()-based one,
-- see stories.sql) so this partial index is valid — serves the unread
-- badge-count query directly.
create index notifications_user_id_unread_idx on notifications (user_id) where read_at is null;
