-- Add location (Post composer, Stage 3): a free-text place name on a post.
--
-- Free text rather than a places API on purpose: place search (Google
-- Places and similar) is a paid service, and this project holds itself to
-- free tiers (docs/architecture.md). It's the same shape as events.location.
--
-- The length limit is a table CHECK, not only validation inside
-- create_post(): clients can also insert into posts directly (column grants
-- allow it, see below), and a limit that lives only in the RPC is skipped by
-- that path. 100 characters covers a real place name with room to spare.
-- Blank is stored as NULL (create_post trims), so "has a location" is simply
-- `location is not null`.

alter table posts
  add column location text
  constraint posts_location_length check (location is null or char_length(location) between 1 and 100);

-- Column grants fail closed (20260916150000): without this, create_post()
-- — SECURITY INVOKER, so it writes with the caller's privileges — would be
-- refused on the new column.
grant insert (location) on posts to authenticated;

-- create_post(): adds p_location. Drop then create, not `create or replace`
-- — adding a parameter changes the function's identity, and create or
-- replace would leave the 7-argument version behind as a second overload
-- (exactly what happened to create_event_post; see 20260916130000).

drop function if exists create_post(uuid, text, text, text[], text, text[], boolean);

create function create_post(
  p_room_id uuid,
  p_text text default null,
  p_tag text default null,
  p_media_paths text[] default '{}',
  p_poll_question text default null,
  p_poll_options text[] default '{}',
  p_poll_allow_multiple boolean default false,
  p_location text default null
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

  -- A location alone isn't a post: it describes content, it isn't content.
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

  return v_post_id;
end;
$$;

revoke execute on function create_post(uuid, text, text, text[], text, text[], boolean, text) from public, anon;
grant execute on function create_post(uuid, text, text, text[], text, text[], boolean, text) to authenticated;
