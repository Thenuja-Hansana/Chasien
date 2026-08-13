-- Phase 1: reports, blocks, moderation_actions — day-1 requirements per
-- docs/store-compliance.md, not deferred polish. The polymorphic
-- target_type/target_id pattern on reports and moderation_actions is
-- hardened three ways rather than replaced with one table per reportable
-- type: (1) every table uses UUID PKs, so a wrong target_type can never
-- collide with the wrong row, only fail to find one; (2) content_snapshot
-- captures the reported content at write time, so a report/audit entry
-- stays reviewable even if the original row is later hard-deleted or its
-- text scrubbed; (3) an insert-time trigger rejects a target that doesn't
-- exist, so a bad insert can't silently create a dangling reference. See
-- docs/phase/phase01.md.

create table reports (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: the report must survive the reporter later
  -- deleting their account — accountability record, not their data.
  reporter_id uuid references profiles (id) on delete set null,
  target_type report_target_type not null,
  target_id uuid not null,
  reason text not null,
  content_snapshot jsonb,
  status report_status not null default 'open',
  reviewed_by uuid references profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index reports_open_idx on reports (created_at) where status = 'open';

create table blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint cannot_block_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_id_idx on blocks (blocked_id);

create table moderation_actions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms (id) on delete cascade,
  actor_id uuid references profiles (id) on delete set null,
  action_type moderation_action_type not null,
  -- A moderation action targets either a user (mute/kick/ban/role_change)
  -- or a piece of content (remove_post/remove_comment/remove_message) —
  -- reuses report_target_type rather than defining a near-duplicate enum.
  target_user_id uuid references profiles (id) on delete set null,
  target_type report_target_type,
  target_id uuid,
  content_snapshot jsonb,
  reason text,
  created_at timestamptz not null default now(),
  constraint moderation_action_has_target check (
    target_user_id is not null or (target_type is not null and target_id is not null)
  )
);

create index moderation_actions_room_id_idx on moderation_actions (room_id);

-- Shared by both reports and moderation_actions — both have identically
-- named target_type/target_id columns, so one trigger function covers
-- both tables. Null target_type is allowed through (a moderation action
-- targeting a user, not content, via target_user_id instead).
create function validate_polymorphic_content_target()
returns trigger
language plpgsql
as $$
declare
  target_exists boolean;
begin
  if new.target_type is null then
    return new;
  end if;

  case new.target_type
    when 'post' then
      select exists (select 1 from posts where id = new.target_id) into target_exists;
    when 'comment' then
      select exists (select 1 from comments where id = new.target_id) into target_exists;
    when 'message' then
      select exists (select 1 from messages where id = new.target_id) into target_exists;
    when 'user' then
      select exists (select 1 from profiles where id = new.target_id) into target_exists;
  end case;

  if not target_exists then
    raise exception 'target % of type % does not exist', new.target_id, new.target_type;
  end if;

  return new;
end;
$$;

create trigger validate_report_target
before insert on reports
for each row execute function validate_polymorphic_content_target();

create trigger validate_moderation_action_target
before insert on moderation_actions
for each row execute function validate_polymorphic_content_target();
