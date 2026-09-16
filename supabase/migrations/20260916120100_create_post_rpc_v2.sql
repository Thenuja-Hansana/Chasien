-- create_post(): adds p_poll_allow_multiple, so a poll can be created as
-- multi-select. Postgres identifies a function by its name *and* its
-- ordered argument-type list, so adding a parameter — even a trailing one
-- with a default — changes that identity; `create or replace` would leave
-- the old 6-argument version sitting alongside this new 7-argument one as
-- a second overload rather than actually replacing it. The explicit drop
-- avoids that: this app's client always calls with the full current
-- argument list, so there's never a reason to keep the old one around.

drop function if exists create_post(uuid, text, text, text[], text, text[]);

create function create_post(
  p_room_id uuid,
  p_text text default null,
  p_tag text default null,
  p_media_paths text[] default '{}',
  p_poll_question text default null,
  p_poll_options text[] default '{}',
  p_poll_allow_multiple boolean default false
)
returns uuid
language plpgsql
as $$
declare
  v_post_id uuid;
  v_poll_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_tag text := nullif(btrim(coalesce(p_tag, '')), '');
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

  if v_text is null and v_media_count = 0 and v_question is null then
    raise exception 'a post needs text, an image, or a poll';
  end if;

  if v_question is not null and coalesce(array_length(v_options, 1), 0) < 2 then
    raise exception 'a poll needs at least two options';
  end if;

  insert into posts (room_id, author_id, text, tag)
  values (p_room_id, auth.uid(), v_text, v_tag)
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

revoke execute on function create_post(uuid, text, text, text[], text, text[], boolean) from public;
grant execute on function create_post(uuid, text, text, text[], text, text[], boolean) to authenticated;
