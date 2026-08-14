-- Phase 5: create_post() — one transaction for what is otherwise four
-- dependent inserts (posts, post_media, polls, poll_options).
--
-- Why this isn't four client calls: `posts` has no DELETE policy for
-- authors (row_level_security.sql grants authors SELECT/INSERT/UPDATE
-- only), so a client that successfully inserted a post and then failed
-- to attach its image or poll has no way to roll the post back — it
-- would strand a half-built post permanently, visible to the whole Room.
-- A plpgsql function is transactional by default: any raise below undoes
-- every insert above it.
--
-- Deliberately SECURITY INVOKER (the default, stated here because the
-- contrast matters): unlike the `security definer` helpers in
-- row_level_security.sql, this function has no reason to bypass RLS.
-- Every insert still passes through the caller's own policies — "can
-- this user post in this Room at all", "is members_can_post on", "is the
-- author really them" — so this adds atomicity without adding trust.
--
-- It also finally enforces the invariant feed.sql called out as
-- unenforceable at the schema level ("No 'must have text/media/poll'
-- CHECK here... Enforced at the application/Edge Function layer
-- instead"): post_media and polls are separate rows that need the post's
-- id to exist first, so no single-row CHECK can express it — but a
-- function that creates all of them can, and does.

create function create_post(
  p_room_id uuid,
  p_text text default null,
  p_tag text default null,
  p_media_paths text[] default '{}',
  p_poll_question text default null,
  p_poll_options text[] default '{}'
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
    insert into polls (post_id, question)
    values (v_post_id, v_question)
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

-- Postgres grants EXECUTE on new functions to PUBLIC by default. That
-- would technically be harmless here (every insert inside is RLS-gated,
-- and an anonymous caller's null auth.uid() fails the posts INSERT
-- policy outright), but relying on "it fails closed anyway" is weaker
-- than just not granting it.
revoke execute on function create_post(uuid, text, text, text[], text, text[]) from public;
grant execute on function create_post(uuid, text, text, text[], text, text[]) to authenticated;
