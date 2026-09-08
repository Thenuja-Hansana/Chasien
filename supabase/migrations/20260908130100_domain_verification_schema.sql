-- Domain-verified Rooms, step 2 of 2 — a 4th "who can join" mode
-- alongside public/request/invite: a Room owner sets a required email
-- domain (e.g. `iit.ac.lk`) at creation, and joining means proving you
-- control an email address on that domain, not a manual mod approval.
--
-- Deliberately separate from the account's own login email (Phase 2's
-- Supabase Auth identity): a member's Chasien account might use a
-- personal address while a Room only cares that they *also* control an
-- institutional one, so this can't reuse Supabase Auth's own email
-- system — it needs its own token table and its own outbound email,
-- sent by the two new Edge Functions alongside this migration
-- (request-room-verification, verify-room-email).

alter table rooms add column required_email_domain text;

-- A domain_verified Room without a configured domain would have no way
-- to ever admit a member — enforced here, not just left to the client
-- form's own validation.
alter table rooms add constraint domain_verified_needs_domain
  check (visibility <> 'domain_verified' or required_email_domain is not null);

create table room_email_verifications (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  email text not null,
  token text not null unique,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  -- Generous but bounded — a stale, never-clicked link shouldn't stay
  -- valid indefinitely, mirroring how Supabase Auth's own confirmation
  -- links expire (auth.email.otp_expiry, config.toml).
  expires_at timestamptz not null default (now() + interval '1 hour'),
  -- One outstanding request per person per Room: a second attempt (e.g.
  -- correcting a typo'd address) replaces the first via upsert rather
  -- than accumulating stale rows.
  unique (room_id, user_id)
);

create index room_email_verifications_token_idx on room_email_verifications (token);

alter table room_email_verifications enable row level security;

-- The only client-facing access this table needs: a member can see
-- their own outstanding/completed request (to render "check your inbox"
-- state) and create one for themselves. Nothing ever lets a client set
-- verified_at directly or read someone else's row — the actual
-- confirm-and-join step is verify-room-email, which authenticates via
-- the token itself (mailed out-of-band) rather than a Chasien session,
-- and so runs as the service role, bypassing RLS entirely by design.
create policy "a user can see their own verification requests"
on room_email_verifications for select
to authenticated
using (auth.uid() = user_id);

create policy "a user can create their own verification request"
on room_email_verifications for insert
to authenticated
with check (auth.uid() = user_id and verified_at is null);
