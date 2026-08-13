-- Phase 1: identity (profiles) and Rooms + membership — the table
-- everything else's access control hangs off. See docs/phase/phase01.md.

-- Reusable "touch updated_at on every UPDATE" trigger function. Used by
-- every mutable table in every migration that follows.
create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles ────────────────────────────────────────────────────────────
-- App-visible user data. auth.users (managed entirely by Supabase Auth —
-- email, password hash, sessions) is never queried or joined against
-- directly from application code; profiles is the public-facing mirror.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique,
  name text not null,
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9_]{3,30}$')
);

create trigger set_profiles_updated_at
before update on profiles
for each row execute function set_updated_at();

-- Auto-create a profile row the moment someone signs up. security definer
-- is required because this trigger fires on auth.users (a schema the
-- signed-up user has no privileges on yet) and needs to insert into
-- public.profiles on their behalf. search_path is pinned explicitly —
-- an unpinned search_path on a security definer function is a real,
-- well-known Postgres privilege-escalation vector.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, handle, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'handle', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'name', 'New user')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ── rooms ───────────────────────────────────────────────────────────────

create table rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  visibility room_visibility not null default 'public',
  accent_color text,
  -- CommunitySettings in the mock has a "members can post" toggle
  -- ("Off = only mods post"). Missed on the first pass of this schema —
  -- caught here rather than left silently unmodeled.
  members_can_post boolean not null default true,
  -- Historical "who founded this" record, distinct from current
  -- ownership (room_memberships.role = 'owner', which can be
  -- transferred). Nullable + SET NULL: a founder deleting their account
  -- must never be blocked by, or cascade-delete, a Room they created.
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slug_format check (slug ~ '^[a-z0-9-]{3,50}$')
);

create trigger set_rooms_updated_at
before update on rooms
for each row execute function set_updated_at();

create index rooms_public_visibility_idx on rooms (visibility) where visibility = 'public';

-- ── room_memberships ───────────────────────────────────────────────────
-- The central permission gate. Nearly every RLS policy elsewhere in the
-- schema is, directly or indirectly (via the chat sync triggers in the
-- next migration), a check against this table.

create table room_memberships (
  room_id uuid not null references rooms (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role room_role not null default 'member',
  join_state join_state not null default 'approved',
  invited_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create trigger set_room_memberships_updated_at
before update on room_memberships
for each row execute function set_updated_at();

create index room_memberships_user_id_idx on room_memberships (user_id);

-- Exactly one owner per room, enforced by the database, not just app
-- code. Postgres actually rejects converting a *partial* unique index
-- into a deferrable constraint (tried it — SQLSTATE 42809, "cannot
-- create a primary key or unique constraint using such an index";
-- deferrable is a table-constraint property, and a table constraint by
-- definition can't be partial). So this is a plain, non-deferred partial
-- unique index instead: a transfer-ownership transaction MUST demote the
-- old owner before promoting the new one, in that statement order, so
-- there is never a moment with two owner rows for the index to reject —
-- promoting first, then demoting, will fail. The Edge Function that
-- performs transfers (Phase 4) needs to respect that order.
create unique index one_owner_per_room
  on room_memberships (room_id)
  where role = 'owner';

-- A room is never created without its creator becoming its owner in the
-- same transaction, atomically, at the database layer — not a second
-- client-side insert the app could get wrong (or a malicious client could
-- skip, or point at someone else). security definer because this write
-- must succeed regardless of the RLS policies placed on room_memberships
-- for regular users in the row_level_security migration (which, by
-- design, allows no direct client writes to that table at all).
create function add_owner_membership_on_room_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into room_memberships (room_id, user_id, role, join_state)
    values (new.id, new.created_by, 'owner', 'approved');
  end if;
  return new;
end;
$$;

create trigger add_owner_membership_on_room_created
after insert on rooms
for each row execute function add_owner_membership_on_room_created();
