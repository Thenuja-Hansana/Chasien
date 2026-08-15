-- Phase 6: registered Expo push tokens, one row per device installation.
--
-- `token` is UNIQUE, not `(user_id, token)` — a given device installation
-- has exactly one current owner. Re-registering the same physical device
-- under a different account (a shared device, or logging out and back in
-- as someone else) should reassign that row's user_id, not accumulate a
-- second row still pointing push traffic at the previous account.
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_push_tokens_updated_at
before update on push_tokens
for each row execute function set_updated_at();

create index push_tokens_user_id_idx on push_tokens (user_id);

alter table push_tokens enable row level security;

-- Self-service, not routed through an Edge Function: a token is only
-- ever meaningful to the account that registers it, and nothing here
-- needs a privileged cross-user check the way room_memberships does.
-- The send side (supabase/functions/notify-new-message) reads every
-- recipient's tokens via its own service-role client, which bypasses
-- RLS entirely — it has no reason to go through these policies at all.
create policy "users manage their own push tokens"
on push_tokens for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- grants.sql's blanket grant to `authenticated`/`service_role` only
-- covered tables that already existed when it ran (20260813073524) — a
-- table created afterward, like this one, needs its own explicit grant
-- or every query against it fails with "permission denied," the same
-- bug class 20260813073524_grants.sql and
-- 20260814044514_service_role_grants.sql each fixed once already this
-- project. Granted explicitly here instead of waiting to rediscover it
-- live.
grant select, insert, update, delete on push_tokens to authenticated;
grant select, insert, update, delete on push_tokens to service_role;
