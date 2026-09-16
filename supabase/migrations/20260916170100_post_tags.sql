-- Tag people (Post composer, stage 4).
--
-- Who can be tagged: approved members of the post's Room, not the author,
-- nobody with a block in either direction, at most 20 per post.
--
-- Writes go ONLY through tag_people_in_post() (SECURITY DEFINER), never a
-- client INSERT, and invalid people are dropped silently rather than
-- raising. That's deliberate: `blocks` only lets you see blocks *you*
-- created, so if tags were client-insertable with an RLS check, a refused
-- insert would tell the author "this person blocked you". Keeping the
-- check server-side and silent means neither the app nor a direct API call
-- gets an error that reveals a block. (An author who reads back their own
-- post's tags can still notice someone is missing — the same limit
-- Instagram has — but nothing announces why.)

create table post_tags (
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index post_tags_user_id_idx on post_tags (user_id);

alter table post_tags enable row level security;

-- Readable exactly where the post is: the subquery runs under posts' own
-- SELECT policy, so a non-member (or anyone once the post is soft-deleted,
-- other than its author/moderators) sees no tags.
create policy "tags are readable wherever their post is"
on post_tags for select
to authenticated
using (exists (select 1 from posts p where p.id = post_tags.post_id));

-- A tagged person can take themselves off a post ("Remove tag" in the post
-- menu). Nobody else can delete a tag — failing closed until a feature
-- needs more.
create policy "tagged people can remove themselves"
on post_tags for delete
to authenticated
using (user_id = auth.uid());

-- No INSERT/UPDATE grant: see the top comment.
revoke all on post_tags from anon, authenticated;
grant select, delete on post_tags to authenticated;

-- ── the only write path ────────────────────────────────────────────────────
create function tag_people_in_post(p_post_id uuid, p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_author_id uuid;
  v_requested uuid[];
  v_existing int;
begin
  select room_id, author_id into v_room_id, v_author_id
  from posts
  where id = p_post_id and deleted_at is null;

  if v_room_id is null or v_author_id is distinct from auth.uid() then
    raise exception 'post not found';
  end if;

  select coalesce(array_agg(distinct u), '{}')
  into v_requested
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
  where u is not null and u <> v_author_id;

  if coalesce(array_length(v_requested, 1), 0) = 0 then
    return;
  end if;

  -- Counted on what was asked for, before any silent filtering, so the limit
  -- can't be used to probe who got filtered out.
  select count(*) into v_existing from post_tags where post_id = p_post_id;
  if v_existing + array_length(v_requested, 1) > 20 then
    raise exception 'a post can tag at most 20 people';
  end if;

  insert into post_tags (post_id, user_id)
  select p_post_id, u
  from unnest(v_requested) as u
  where is_room_member(v_room_id, u)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = v_author_id and b.blocked_id = u)
         or (b.blocker_id = u and b.blocked_id = v_author_id)
    )
  on conflict (post_id, user_id) do nothing;
end;
$$;

revoke execute on function tag_people_in_post(uuid, uuid[]) from public, anon;
grant execute on function tag_people_in_post(uuid, uuid[]) to authenticated;

-- ── notification ───────────────────────────────────────────────────────────
-- Same rules as mentions: only reaches an approved member (guaranteed by the
-- insert above), never the author, and not if they muted the Room. Data
-- keys match the other post notifications (postId/preview), so the
-- notifications screen's existing "open the post" routing just works.
create function notify_on_post_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_author_id uuid;
  v_text text;
begin
  select room_id, author_id, text into v_room_id, v_author_id, v_text
  from posts where id = new.post_id;

  if v_author_id is null or new.user_id = v_author_id then
    return new;
  end if;

  if exists (
    select 1 from room_memberships
    where room_id = v_room_id and user_id = new.user_id and notifications_muted
  ) then
    return new;
  end if;

  insert into notifications (user_id, type, actor_id, room_id, data)
  values (new.user_id, 'tag', v_author_id, v_room_id,
          jsonb_build_object('postId', new.post_id, 'preview', left(coalesce(v_text, ''), 140)));
  return new;
end;
$$;

create trigger notify_on_post_tag
after insert on post_tags
for each row execute function notify_on_post_tag();

-- ── create_post(): adds p_tagged_user_ids ─────────────────────────────────
-- Drop then create (a new parameter changes the function's identity; see
-- 20260916130000). Tags go through tag_people_in_post(), which re-checks
-- that the caller authored the post it just created.

drop function if exists create_post(uuid, text, text, text[], text, text[], boolean, text);

create function create_post(
  p_room_id uuid,
  p_text text default null,
  p_tag text default null,
  p_media_paths text[] default '{}',
  p_poll_question text default null,
  p_poll_options text[] default '{}',
  p_poll_allow_multiple boolean default false,
  p_location text default null,
  p_tagged_user_ids uuid[] default '{}'
)
returns uuid
language plpgsql
as $$
declare
  v_post_id uuid;
  v_poll_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_tag text := nullif(btrim(coalesce(p_tag, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_question text := nullif(btrim(coalesce(p_poll_question, '')), '');
  v_media_count int := coalesce(array_length(p_media_paths, 1), 0);
  v_options text[];
  v_option text;
  v_path text;
  v_position int := 0;
begin
  -- Blank-only options are dropped before counting, so three inputs where
  -- two are whitespace is correctly rejected rather than accepted as a
  -- one-option poll.
  select array_agg(btrim(o))
  into v_options
  from unnest(coalesce(p_poll_options, '{}'::text[])) as o
  where btrim(o) <> '';

  -- A location (or tags) alone isn't a post: they describe content, they
  -- aren't content.
  if v_text is null and v_media_count = 0 and v_question is null then
    raise exception 'a post needs text, an image, or a poll';
  end if;

  if v_question is not null and coalesce(array_length(v_options, 1), 0) < 2 then
    raise exception 'a poll needs at least two options';
  end if;

  insert into posts (room_id, author_id, text, tag, location)
  values (p_room_id, auth.uid(), v_text, v_tag, v_location)
  returning id into v_post_id;

  foreach v_path in array coalesce(p_media_paths, '{}'::text[])
  loop
    insert into post_media (post_id, url, position)
    values (v_post_id, v_path, v_position);
    v_position := v_position + 1;
  end loop;

  if v_question is not null then
    insert into polls (post_id, question, allow_multiple)
    values (v_post_id, v_question, coalesce(p_poll_allow_multiple, false))
    returning id into v_poll_id;

    v_position := 0;
    foreach v_option in array v_options
    loop
      insert into poll_options (poll_id, label, position)
      values (v_poll_id, v_option, v_position);
      v_position := v_position + 1;
    end loop;
  end if;

  if coalesce(array_length(p_tagged_user_ids, 1), 0) > 0 then
    perform tag_people_in_post(v_post_id, p_tagged_user_ids);
  end if;

  return v_post_id;
end;
$$;

revoke execute on function create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[]) from public, anon;
grant execute on function create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[]) to authenticated;
