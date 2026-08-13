-- Phase 1: the Room feed — posts, media, comments, likes, polls. Always
-- reverse-chronological, never algorithmic — see posts_room_feed_idx
-- below, which is what actually makes that fast rather than just policy.

create table posts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  text text,
  tag text,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Moderation removal is a soft delete (see docs/phase/phase01.md) —
  -- the row stays for the reports/moderation_actions audit trail and is
  -- filtered out for normal readers by RLS, not actually deleted.
  deleted_at timestamptz,
  removed_by uuid references profiles (id) on delete set null,
  removal_reason text
  -- No "must have text/media/poll" CHECK here: post_media and polls are
  -- separate rows inserted after the post itself exists (need its id
  -- first), so that invariant can't be expressed at a single INSERT the
  -- way it can on `messages`. Enforced at the application/Edge Function
  -- layer instead — noted explicitly rather than silently assumed.
);

create trigger set_posts_updated_at
before update on posts
for each row execute function set_updated_at();

create index posts_room_feed_idx on posts (room_id, created_at desc);
create index posts_author_id_idx on posts (author_id);

create table post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  url text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

-- ── comments ────────────────────────────────────────────────────────────
-- One level deep, matching the mock (a reply to a comment, never a reply
-- to a reply) — enforced below by trigger, not just assumed by the app.

create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  parent_comment_id uuid references comments (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  removed_by uuid references profiles (id) on delete set null,
  removal_reason text
);

create trigger set_comments_updated_at
before update on comments
for each row execute function set_updated_at();

create index comments_post_id_idx on comments (post_id);
create index comments_parent_comment_id_idx on comments (parent_comment_id);

create function enforce_single_level_comment_replies()
returns trigger
language plpgsql
as $$
declare
  parent_has_parent boolean;
begin
  if new.parent_comment_id is not null then
    select (parent_comment_id is not null) into parent_has_parent
    from comments
    where id = new.parent_comment_id;

    if parent_has_parent is null then
      raise exception 'parent_comment_id % does not exist', new.parent_comment_id;
    end if;

    if parent_has_parent then
      raise exception 'cannot reply to a reply — comments are only one level deep';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_single_level_comment_replies
before insert on comments
for each row execute function enforce_single_level_comment_replies();

create table post_likes (
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ── polls ───────────────────────────────────────────────────────────────

create table polls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references posts (id) on delete cascade,
  question text not null,
  created_at timestamptz not null default now()
);

create table poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls (id) on delete cascade,
  label text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (poll_id, position),
  -- Lets poll_votes below reference (id, poll_id) together, so a vote
  -- row can't reference an option that doesn't actually belong to the
  -- poll it claims to.
  unique (id, poll_id)
);

create table poll_votes (
  poll_id uuid not null,
  poll_option_id uuid not null,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One vote per user per poll (not per option) — the PK is on
  -- (poll_id, user_id), not (poll_option_id, user_id), specifically so a
  -- second vote for a different option in the same poll is rejected too.
  primary key (poll_id, user_id),
  foreign key (poll_option_id, poll_id)
    references poll_options (id, poll_id)
    on delete cascade
);

create index poll_votes_option_id_idx on poll_votes (poll_option_id);
