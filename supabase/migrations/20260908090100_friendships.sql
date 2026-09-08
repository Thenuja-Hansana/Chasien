-- Friends architecture, step 2 of 2. Mutual-accept only (no one-way
-- follow/follower model) — a friendship is exactly one row per
-- unordered pair, same canonical-ordering trick conversations.dm_user_a/
-- dm_user_b already uses (chat.sql) so "does a request already exist
-- between these two" is a single indexed lookup, not a set-intersection
-- query. `status` is plain text + a check constraint rather than a new
-- enum, deliberately — only two states ever, and it sidesteps the
-- ALTER TYPE transactional restriction the previous migration had to
-- split around entirely.

create table friendships (
  user_a uuid not null references profiles (id) on delete cascade,
  user_b uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  requested_by uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint friendship_pair_ordered check (user_a < user_b),
  constraint requester_is_a_party check (requested_by = user_a or requested_by = user_b)
);

-- The primary key already indexes (user_a, user_b) together, but "all of
-- my friendships" has to check both sides (auth.uid() could be stored as
-- either column depending on UUID ordering) — without this, the user_b
-- half of that OR would seq-scan.
create index friendships_user_b_idx on friendships (user_b);

create trigger set_friendships_updated_at
before update on friendships
for each row execute function set_updated_at();

alter table friendships enable row level security;

-- Two permissive SELECT policies (RLS ORs them together): an accepted
-- friendship is public — any authenticated user can see it, which is
-- what lets a friend *count* and list render on anyone's profile, not
-- just your own. A still-pending request stays private to its two
-- parties, the same way you wouldn't want a stranger seeing who has an
-- outstanding request out.
create policy "accepted friendships are visible to any authenticated user"
on friendships for select
to authenticated
using (status = 'accepted');

create policy "a pending request is visible only to its two parties"
on friendships for select
to authenticated
using (status = 'pending' and (auth.uid() = user_a or auth.uid() = user_b));

create policy "a user can send a friend request involving themselves"
on friendships for insert
to authenticated
with check (
  (auth.uid() = user_a or auth.uid() = user_b)
  and requested_by = auth.uid()
  and status = 'pending'
);

-- Only the *other* party can accept — the requester accepting their own
-- request would make sending one equivalent to instantly friending
-- someone unilaterally, defeating the whole mutual-accept point.
create policy "only the other party can accept a pending request"
on friendships for update
to authenticated
using ((auth.uid() = user_a or auth.uid() = user_b) and auth.uid() <> requested_by and status = 'pending')
with check (status = 'accepted');

-- Covers all three real actions with one policy: the requester
-- cancelling their own still-pending request, the recipient declining
-- it, or either side unfriending an accepted one later.
create policy "either party can delete a friendship"
on friendships for delete
to authenticated
using (auth.uid() = user_a or auth.uid() = user_b);

-- ── notifications ───────────────────────────────────────────────────────
-- Same shape as notify_on_join_request (notification_triggers.sql):
-- security definer because notifications has no client INSERT policy at
-- all, by design.

create function notify_on_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  if new.status <> 'pending' then
    return new;
  end if;
  v_recipient := case when new.requested_by = new.user_a then new.user_b else new.user_a end;

  insert into notifications (user_id, type, actor_id)
  values (v_recipient, 'friend_request', new.requested_by);

  return new;
end;
$$;

create trigger notify_on_friend_request
after insert on friendships
for each row execute function notify_on_friend_request();

create function notify_on_friend_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acceptor uuid;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    v_acceptor := case when new.requested_by = new.user_a then new.user_b else new.user_a end;
    insert into notifications (user_id, type, actor_id)
    values (new.requested_by, 'friend_accept', v_acceptor);
  end if;
  return new;
end;
$$;

create trigger notify_on_friend_accept
after update on friendships
for each row execute function notify_on_friend_accept();

-- ── DM gating ────────────────────────────────────────────────────────────
-- "You cannot DM someone without being friends first" — enforced here,
-- not just by hiding the button client-side, so it holds even against a
-- direct RPC call. Local variables renamed from the original's user_a/
-- user_b to v_user_a/v_user_b: this function now also queries
-- friendships, whose columns are *also* named user_a/user_b, and
-- PL/pgSQL raises "column reference is ambiguous" when a bare identifier
-- matches both a local variable and a column in scope.
create or replace function start_dm(other_user_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
  conv_id uuid;
begin
  if caller is null then
    raise exception 'Not authenticated.';
  end if;
  if other_user_id = caller then
    raise exception 'Cannot start a DM with yourself.';
  end if;

  if caller < other_user_id then
    v_user_a := caller;
    v_user_b := other_user_id;
  else
    v_user_a := other_user_id;
    v_user_b := caller;
  end if;

  if not exists (
    select 1 from friendships
    where user_a = v_user_a and user_b = v_user_b and status = 'accepted'
  ) then
    raise exception 'You must be friends to start a conversation.';
  end if;

  select id into conv_id
  from conversations
  where kind = 'dm' and dm_user_a = v_user_a and dm_user_b = v_user_b;

  if conv_id is not null then
    return conv_id;
  end if;

  begin
    insert into conversations (kind, dm_user_a, dm_user_b)
    values ('dm', v_user_a, v_user_b)
    returning id into conv_id;
  exception when unique_violation then
    -- The other participant's own start_dm() call won the race between
    -- this function's SELECT above and its INSERT — use their row.
    select id into conv_id
    from conversations
    where kind = 'dm' and dm_user_a = v_user_a and dm_user_b = v_user_b;
  end;

  return conv_id;
end;
$$;
