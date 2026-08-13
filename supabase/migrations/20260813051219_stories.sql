-- Phase 1: stories — ephemeral, per-Room. Actual purge of expired
-- media from Cloudflare R2 is Phase 7 scope (a scheduled job); this
-- migration only defines expiry as data. RLS (next-but-one migration)
-- is what actually stops an expired story from being readable — expiry
-- here is a fact, not enforcement by itself.

create table stories (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  media_url text not null,
  caption text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- Not a partial index filtered on "where expires_at > now()" — now() is
-- STABLE, not IMMUTABLE, and Postgres rejects non-immutable expressions
-- in a partial index predicate. A plain range index on (room_id,
-- expires_at) serves the same "active stories in this room" query just
-- as well via a range scan at query time.
create index stories_room_id_expires_at_idx on stories (room_id, expires_at desc);
