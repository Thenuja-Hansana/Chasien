-- Explore page redesign: a category (for real filtering, not decorative
-- chips — this app's own convention, all through the codebase, is that a
-- control that doesn't do anything is worse than not showing one) and a
-- member count (for the featured-card stat row), both readable wherever a
-- Room itself already is — no new RLS policy needed, they just ride along
-- on rooms' existing SELECT policy.
--
-- Nullable: existing Rooms (including any created before this migration,
-- like ad-hoc ones made while testing locally) have no category until an
-- owner/mod sets one via Room settings or Room creation. Chosen for
-- Chasien's actual Rooms rather than copied from a gaming-platform
-- reference — this app's seeded/real Rooms are hobby and fan communities
-- (climbing, photography, baking, fan clubs), not games/servers.
alter table rooms
  add column category text
    check (category is null or category in (
      'Hobbies & Crafts',
      'Sports & Fitness',
      'Food & Drink',
      'Arts & Entertainment',
      'Fan Clubs',
      'Learning'
    )),
  add column member_count integer not null default 0;

-- member_count is a counter cache, not a live count — Explore lists many
-- Rooms at once and a per-row `count(*) from room_memberships` for every
-- one of them (itself gated by RLS the browsing user usually can't even
-- read past — see below) doesn't scale the way one denormalized column
-- read alongside the rest of the row does.
--
-- This has to be denormalized rather than queried live for a second
-- reason, not just performance: room_memberships' own SELECT policies
-- (this file's "members see their own membership row" /
-- "moderators see every membership row in their room") only let a caller
-- see their own row or every row *if they moderate that Room* — a
-- browsing, not-yet-a-member user on Explore can't run
-- `count(*) from room_memberships where room_id = ...` and get a real
-- number back at all, RLS would just filter it to (at most) their own
-- single row. rooms.member_count is maintained here by trigger,
-- server-side, bypassing that restriction deliberately for an aggregate
-- count only (no member identity leaks with it) — the same tradeoff
-- other public-facing "N members" counters make everywhere.
update rooms
set member_count = (
  select count(*) from room_memberships
  where room_memberships.room_id = rooms.id and room_memberships.join_state = 'approved'
);

-- security definer, matching this file's other helpers: room_memberships
-- has no direct client write policy at all (every write is either the
-- service-role room-membership Edge Function, or the security-definer
-- add_owner_membership_on_room_created trigger — see
-- 20260813051204_identity_and_rooms.sql), so this trigger's own
-- `update rooms` below would likely inherit enough privilege either way —
-- but declaring it explicitly, rather than relying on that inherited
-- context, keeps this correct regardless of what calls it, now or later.
-- It only ever adjusts one integer counter in response to a change the
-- caller already legitimately made, never exposes anything else.
create function sync_room_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.join_state = 'approved' then
      update rooms set member_count = member_count + 1 where id = new.room_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.join_state = 'approved' then
      update rooms set member_count = member_count - 1 where id = old.room_id;
    end if;
    return old;
  end if;

  -- UPDATE: only join_state actually flipping in or out of 'approved'
  -- changes the count — a role change or any other column update on an
  -- already-approved row must not double-count it.
  if old.join_state is distinct from new.join_state then
    if new.join_state = 'approved' then
      update rooms set member_count = member_count + 1 where id = new.room_id;
    elsif old.join_state = 'approved' then
      update rooms set member_count = member_count - 1 where id = old.room_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger sync_room_member_count_on_membership_change
after insert or update or delete on room_memberships
for each row execute function sync_room_member_count();
