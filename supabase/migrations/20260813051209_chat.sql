-- Phase 1: chat — one unified `conversations` table for both Room group
-- channels and 1:1 DMs, matching the mock's single inbox. The asymmetry
-- risk (DM participation vs Room-channel participation meaning different
-- things) is resolved by making conversation_participants the *only*
-- thing RLS ever checks — kept in sync with room_memberships by trigger,
-- never queried in place of it. See docs/phase/phase01.md.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  kind conversation_kind not null,
  room_id uuid references rooms (id) on delete cascade,
  name text,
  -- DM-only, stored in canonical sorted order (dm_user_a < dm_user_b) so
  -- "does a DM already exist between these two users" is a single indexed
  -- lookup instead of a conversation_participants set-intersection query.
  dm_user_a uuid references profiles (id) on delete cascade,
  dm_user_b uuid references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_shape_matches_kind check (
    (kind = 'room_channel' and room_id is not null and name is not null
      and dm_user_a is null and dm_user_b is null)
    or
    (kind = 'dm' and room_id is null and name is null
      and dm_user_a is not null and dm_user_b is not null)
  ),
  constraint dm_pair_ordered check (dm_user_a is null or dm_user_b is null or dm_user_a < dm_user_b)
);

create trigger set_conversations_updated_at
before update on conversations
for each row execute function set_updated_at();

create unique index room_channel_name_unique
  on conversations (room_id, name)
  where kind = 'room_channel';

create unique index dm_pair_unique
  on conversations (dm_user_a, dm_user_b)
  where kind = 'dm';

-- ── conversation_participants ─────────────────────────────────────────
-- The single source of truth RLS checks for read access to a
-- conversation, regardless of kind. For 'dm' conversations, a row here
-- *is* the membership. For 'room_channel' conversations, rows are
-- maintained automatically by the triggers below, derived from
-- room_memberships — never written to directly by application code.

create table conversation_participants (
  conversation_id uuid not null references conversations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  muted boolean not null default false,
  pinned boolean not null default false,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_participants_user_id_idx on conversation_participants (user_id);

-- ── messages ────────────────────────────────────────────────────────────

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  -- SET NULL, not CASCADE: a deleted account's past messages stay in
  -- other people's conversation history (rendered as "Deleted user"),
  -- rather than leaving holes in threads that were never that user's to
  -- erase on their own.
  author_id uuid references profiles (id) on delete set null,
  text text,
  image_url text,
  voice_url text,
  reply_to_id uuid references messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set explicitly by the app when the author edits their own message —
  -- deliberately not touched by the generic updated_at trigger, so it
  -- means only "the author changed this," never "a moderator acted on
  -- this" (that's deleted_at/removed_by below).
  edited_at timestamptz,
  -- Moderation removal is a soft delete: the row is retained (for the
  -- moderation_actions/reports audit trail) and hidden from normal reads
  -- by RLS, never hard-deleted by a moderation action.
  deleted_at timestamptz,
  removed_by uuid references profiles (id) on delete set null,
  removal_reason text,
  constraint message_has_content check (text is not null or image_url is not null or voice_url is not null)
);

create trigger set_messages_updated_at
before update on messages
for each row execute function set_updated_at();

create index messages_conversation_id_created_at_idx on messages (conversation_id, created_at desc);
create index messages_reply_to_id_idx on messages (reply_to_id);

create table message_reactions (
  message_id uuid not null references messages (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ── sync triggers ──────────────────────────────────────────────────────
-- Keeps conversation_participants correct for room_channel conversations
-- automatically, so RLS never has to branch on kind and no app code path
-- can "forget" to add/remove someone. security definer is required: these
-- triggers write to conversation_participants on the system's behalf
-- regardless of which user's action fired them, deliberately bypassing
-- the RLS policies that (in the next migration) forbid users from writing
-- to conversation_participants for room_channel rows directly.

create function sync_channel_participants_on_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from conversation_participants cp
    using conversations c
    where cp.conversation_id = c.id
      and c.kind = 'room_channel'
      and c.room_id = old.room_id
      and cp.user_id = old.user_id;
    return old;
  end if;

  if new.join_state = 'approved' and (tg_op = 'INSERT' or old.join_state is distinct from 'approved') then
    insert into conversation_participants (conversation_id, user_id)
    select c.id, new.user_id
    from conversations c
    where c.kind = 'room_channel' and c.room_id = new.room_id
    on conflict (conversation_id, user_id) do nothing;
  elsif tg_op = 'UPDATE' and old.join_state = 'approved' and new.join_state is distinct from 'approved' then
    delete from conversation_participants cp
    using conversations c
    where cp.conversation_id = c.id
      and c.kind = 'room_channel'
      and c.room_id = new.room_id
      and cp.user_id = new.user_id;
  end if;

  return new;
end;
$$;

create trigger sync_channel_participants_on_membership_change
after insert or update or delete on room_memberships
for each row execute function sync_channel_participants_on_membership_change();

-- Seeds participant rows the moment a conversation is created — for
-- room_channel, backfills every currently-approved room member (the
-- other half of the sync problem the trigger above doesn't cover: new
-- channel, existing members). For dm, seeds both participants directly,
-- since a DM has no room_memberships to derive from.
create function seed_participants_on_conversation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'room_channel' then
    insert into conversation_participants (conversation_id, user_id)
    select new.id, rm.user_id
    from room_memberships rm
    where rm.room_id = new.room_id and rm.join_state = 'approved'
    on conflict (conversation_id, user_id) do nothing;
  elsif new.kind = 'dm' then
    insert into conversation_participants (conversation_id, user_id)
    values (new.id, new.dm_user_a), (new.id, new.dm_user_b)
    on conflict (conversation_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger seed_participants_on_conversation_created
after insert on conversations
for each row execute function seed_participants_on_conversation_created();
