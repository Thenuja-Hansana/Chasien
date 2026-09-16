-- create_event_post(): one transaction for the Event tab's post + events
-- insert pair, the same reason create_post() exists for posts + post_media
-- + polls — see that function's own comment. A separate function rather
-- than more optional parameters bolted onto create_post(): an event never
-- carries media or a poll, and create_post()'s existing "needs text, an
-- image, or a poll" guard doesn't apply to it at all (an event needs a
-- title and a start time instead), so sharing one function would mean two
-- unrelated validation shapes living behind one signature.
--
-- Deliberately SECURITY INVOKER, same reasoning as create_post(): every
-- insert still passes through the caller's own RLS policies.

create function create_event_post(
  p_room_id uuid,
  p_text text default null,
  p_event_title text default '',
  p_event_starts_at timestamptz default null,
  p_event_location text default null
)
returns uuid
language plpgsql
as $$
declare
  v_post_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_title text := nullif(btrim(coalesce(p_event_title, '')), '');
  v_location text := nullif(btrim(coalesce(p_event_location, '')), '');
begin
  if v_title is null then
    raise exception 'an event needs a title';
  end if;

  if p_event_starts_at is null then
    raise exception 'an event needs a start time';
  end if;

  insert into posts (room_id, author_id, text)
  values (p_room_id, auth.uid(), v_text)
  returning id into v_post_id;

  insert into events (post_id, title, starts_at, location)
  values (v_post_id, v_title, p_event_starts_at, v_location);

  return v_post_id;
end;
$$;

revoke execute on function create_event_post(uuid, text, text, timestamptz, text) from public;
grant execute on function create_event_post(uuid, text, text, timestamptz, text) to authenticated;
