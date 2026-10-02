-- Phase 10, slice 4: a post, and everything attached to one, is made by
-- create_post() or create_event_post() and nothing else.
--
-- Open since the 2026-09-16 audit ("direct inserts into polls /
-- poll_options / post_media / events that skip create_post's validation").
-- The cause is the one slice 3 found behind start_dm(): both functions were
-- SECURITY INVOKER, so the person calling them needed INSERT on posts,
-- post_media, polls, poll_options and events, and policies letting an
-- author attach to their own post. The same grants and policies let the
-- author skip the functions. Reproduced on the local stack before this
-- migration, as a post's author, rolled back:
--
--   * a post with no text, media or poll, inserted directly
--   * a one-option poll attached to an existing post
--   * 29 more options added to a poll people could already be voting on
--   * an event attached to a post that already has a poll
--   * 40 media items added to an old post, pointing at another Room's file
--   * media rows deleted from a published post (an edit nobody can see)
--   * people tagged on an old post, by calling tag_people_in_post() directly
--
-- and through create_post() itself, a post with 60 media items and a
-- 40-option poll: the limits of 10 and 4 existed only in the app.
--
-- What changes:
--
-- * Both functions are SECURITY DEFINER. That takes RLS out of the
--   picture for their inserts, so the rule the posts INSERT policy
--   enforced is now enforced by the functions themselves, through one
--   internal helper, can_post_in_room(): an approved member, and either a
--   moderator or the Room lets members post. Same rule, same four roles,
--   read from room_rank(). The author is always auth.uid(); there is no
--   parameter for it.
--
--   Refused callers all get one sentence, "You can't post in this Room.",
--   whether they aren't a member, their request is pending, the Room is
--   moderators-only, or the Room doesn't exist. It's raised without a
--   custom errcode, so the app shows it (errorMessage(), lib/errors.ts);
--   the RLS refusal it replaces showed the screen's generic fallback.
--
-- * The limits move to the server: at most 10 media items, 2 to 4 poll
--   options (blank ones dropped first, as before). A media path has to be
--   {this Room's id}/{the caller's id}/{one file name}, which is exactly
--   what the upload produces (lib/media.ts) and what the storage policy
--   lets that person upload. So a post can only point at media its author
--   uploaded for that Room.
--
-- * Clients lose every direct write on the five tables: INSERT on posts,
--   and INSERT, UPDATE and DELETE on post_media, polls, poll_options and
--   events (the last three were still on the pre-2026-09-16 grant of every
--   column). The six write policies behind them are dropped. The SELECT
--   policies are untouched: who can read a post is unchanged.
--
-- * tag_people_in_post() is no longer callable over the API. It was
--   granted to authenticated only because create_post() called it as the
--   caller; now it is called as the owner.
--
-- Not here: a limit on how long a post's text can be. Nothing limits text
-- length anywhere yet (a 200,000-character post is accepted). That's a
-- product decision with a number in it, and belongs with the other limits
-- in slice 6.
--
-- No app change. The app only ever called the two functions.

-- ---------------------------------------------------------------------
-- The posting rule, in one place.
-- ---------------------------------------------------------------------

create function can_post_in_room(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- room_rank(): -1 not an approved member, 0 member, 1 mod, 2 admin,
  -- 3 owner. A Room that doesn't exist has no members, so it's false too.
  select room_rank(p_room_id, p_user_id) >= 1
      or (
        room_rank(p_room_id, p_user_id) = 0
        and coalesce((select members_can_post from rooms where id = p_room_id), false)
      );
$$;

-- Internal: called by the two functions below, which run as the owner.
-- (New functions start closed since 20261002100000; stated so it's visible.)
revoke execute on function can_post_in_room(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- create_post(): SECURITY DEFINER, the posting rule, the limits.
-- Same signature, so the grant to authenticated carries over.
-- ---------------------------------------------------------------------

create or replace function create_post(
  p_room_id uuid,
  p_text text default null,
  p_tag text default null,
  p_media_paths text[] default '{}',
  p_poll_question text default null,
  p_poll_options text[] default '{}',
  p_poll_allow_multiple boolean default false,
  p_location text default null,
  p_tagged_user_ids uuid[] default '{}',
  p_media_framing jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_post_id uuid;
  v_poll_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_tag text := nullif(btrim(coalesce(p_tag, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  v_question text := nullif(btrim(coalesce(p_poll_question, '')), '');
  v_media_count int := coalesce(array_length(p_media_paths, 1), 0);
  v_media_folder text;
  v_options text[];
  v_option_count int;
  v_option text;
  v_path text;
  v_frame jsonb;
  v_position int := 0;
begin
  if v_caller is null then
    raise exception 'Not authenticated.';
  end if;

  if not can_post_in_room(p_room_id, v_caller) then
    raise exception 'You can''t post in this Room.';
  end if;

  -- Blank-only options are dropped before counting, so three inputs where
  -- two are whitespace is correctly rejected rather than accepted as a
  -- one-option poll.
  select array_agg(btrim(o))
  into v_options
  from unnest(coalesce(p_poll_options, '{}'::text[])) as o
  where btrim(o) <> '';
  v_option_count := coalesce(array_length(v_options, 1), 0);

  -- A location (or tags) alone isn't a post: they describe content, they
  -- aren't content.
  if v_text is null and v_media_count = 0 and v_question is null then
    raise exception 'a post needs text, an image, or a poll';
  end if;

  if v_question is not null and v_option_count < 2 then
    raise exception 'a poll needs at least two options';
  end if;

  -- The app's own limits (MAX_POLL_OPTIONS, MAX_POST_MEDIA_ITEMS), which
  -- until now only the app applied.
  if v_question is not null and v_option_count > 4 then
    raise exception 'a poll can have at most 4 options';
  end if;

  if v_media_count > 10 then
    raise exception 'a post can have at most 10 photos or videos';
  end if;

  -- {room}/{author}/{file}: what uploadPostMedia() produces and what the
  -- post-media storage policy lets this person upload. One segment after
  -- the folder, so nothing can climb out of it.
  v_media_folder := p_room_id::text || '/' || v_caller::text || '/';
  foreach v_path in array coalesce(p_media_paths, '{}'::text[])
  loop
    if v_path is null
       or left(v_path, length(v_media_folder)) <> v_media_folder
       or substr(v_path, length(v_media_folder) + 1) !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$'
    then
      raise exception 'media has to be uploaded to this Room by the post''s author';
    end if;
  end loop;

  insert into posts (room_id, author_id, text, tag, location)
  values (p_room_id, v_caller, v_text, v_tag, v_location)
  returning id into v_post_id;

  foreach v_path in array coalesce(p_media_paths, '{}'::text[])
  loop
    v_frame := case when jsonb_typeof(p_media_framing) = 'array' then p_media_framing -> v_position end;
    if v_frame is not null and jsonb_typeof(v_frame) <> 'object' then
      v_frame := null;
    end if;

    insert into post_media (post_id, url, position, crop_shape, crop_zoom, crop_focus_x, crop_focus_y, video_aspect)
    values (
      v_post_id, v_path, v_position,
      v_frame ->> 'shape',
      (v_frame ->> 'zoom')::real,
      (v_frame ->> 'focusX')::real,
      (v_frame ->> 'focusY')::real,
      (v_frame ->> 'videoAspect')::real
    );
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

-- ---------------------------------------------------------------------
-- create_event_post(): SECURITY DEFINER, the same posting rule.
-- ---------------------------------------------------------------------

create or replace function create_event_post(
  p_room_id uuid,
  p_text text default null,
  p_event_title text default '',
  p_event_starts_at timestamptz default null,
  p_event_location text default null,
  p_event_ends_at timestamptz default null,
  p_event_link text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_post_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_title text := nullif(btrim(coalesce(p_event_title, '')), '');
  v_location text := nullif(btrim(coalesce(p_event_location, '')), '');
  v_link text := nullif(btrim(coalesce(p_event_link, '')), '');
begin
  if v_caller is null then
    raise exception 'Not authenticated.';
  end if;

  if not can_post_in_room(p_room_id, v_caller) then
    raise exception 'You can''t post in this Room.';
  end if;

  if v_title is null then
    raise exception 'an event needs a title';
  end if;

  if p_event_starts_at is null then
    raise exception 'an event needs a start time';
  end if;

  if p_event_ends_at is not null and p_event_ends_at <= p_event_starts_at then
    raise exception 'an event''s end time must be after its start time';
  end if;

  insert into posts (room_id, author_id, text)
  values (p_room_id, v_caller, v_text)
  returning id into v_post_id;

  insert into events (post_id, title, starts_at, ends_at, location, link)
  values (v_post_id, v_title, p_event_starts_at, p_event_ends_at, v_location, v_link);

  return v_post_id;
end;
$$;

-- `create or replace` keeps both functions' grants (authenticated, from
-- 20261002100000). Stated again so this file stands alone.
revoke execute on function create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[], jsonb) from public, anon;
grant execute on function create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[], jsonb) to authenticated;
revoke execute on function create_event_post(uuid, text, text, timestamptz, text, timestamptz, text) from public, anon;
grant execute on function create_event_post(uuid, text, text, timestamptz, text, timestamptz, text) to authenticated;

-- create_post() calls this as the owner now; nobody else should.
revoke execute on function tag_people_in_post(uuid, uuid[]) from authenticated;

-- ---------------------------------------------------------------------
-- No direct client writes on the five tables.
-- ---------------------------------------------------------------------

drop policy "members can post if the room allows it, mods always can" on posts;
drop policy "post authors attach their own media" on post_media;
drop policy "post authors remove their own media" on post_media;
drop policy "post authors attach their own poll" on polls;
drop policy "post authors attach their own poll options" on poll_options;
drop policy "post authors attach their own event" on events;

-- Revoking at table level takes the column-level grants with it.
revoke insert on posts from authenticated;
revoke insert, update, delete on post_media, polls, poll_options, events from authenticated;
