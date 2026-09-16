-- create_event_post(): adds p_event_ends_at and p_event_link as trailing
-- default parameters. Postgres lets CREATE OR REPLACE FUNCTION append new
-- parameters to an existing function as long as they're added at the end
-- and all have defaults — that preserves the function's identity (same
-- OID, same grants) rather than creating a second overload, which is why
-- this is a `create or replace` on the same name rather than a new
-- function.

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
as $$
declare
  v_post_id uuid;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
  v_title text := nullif(btrim(coalesce(p_event_title, '')), '');
  v_location text := nullif(btrim(coalesce(p_event_location, '')), '');
  v_link text := nullif(btrim(coalesce(p_event_link, '')), '');
begin
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
  values (p_room_id, auth.uid(), v_text)
  returning id into v_post_id;

  insert into events (post_id, title, starts_at, ends_at, location, link)
  values (v_post_id, v_title, p_event_starts_at, p_event_ends_at, v_location, v_link);

  return v_post_id;
end;
$$;

revoke execute on function create_event_post(uuid, text, text, timestamptz, text, timestamptz, text) from public;
grant execute on function create_event_post(uuid, text, text, timestamptz, text, timestamptz, text) to authenticated;
