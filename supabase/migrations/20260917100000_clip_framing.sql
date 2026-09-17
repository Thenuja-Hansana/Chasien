-- Clip framing (Clip tab): how a clip is cropped in the feed.
--
-- Why this exists: the feed draws media at full card width, capped at 60% of
-- the screen's height. A portrait phone video (9:16) is far taller than that,
-- so it was shrunk to fit — small, with bars on both sides. Clips now fill
-- the card, cropped to one of the app's three post shapes, and the author can
-- pick the shape and drag/pinch what shows. The full-screen clips viewer
-- still shows the whole, uncropped video.
--
-- Photos have their edit baked into the uploaded file. Videos can't be
-- re-encoded on the phone (no video-processing library), so a clip uploads
-- as-is and its framing is stored here and applied when the feed draws it:
--   crop_shape             square | portrait | landscape
--   crop_zoom              1–4 (1 = the largest crop of that shape that fits)
--   crop_focus_x/_y        0–1, the crop's centre as a fraction of the video
-- Same model as the photo editor's PhotoEdit (lib/mediaUtils.ts), minus
-- rotate/flip, which don't apply to phone video.
--
--   video_aspect           displayed width / height
-- Stored because nothing on the client can read it reliably after upload:
-- expo-video reports a track's raw width/height and ignores its rotation
-- flag, and phones commonly record portrait as a landscape stream rotated 90°,
-- so the player would report a portrait clip as landscape. The composer knows
-- the real value (expo-media-library's asset size is rotation-corrected; the
-- in-app camera records in this portrait-locked app), so it's captured once
-- at post time.
--
-- All four crop columns are set together or not at all; a clip with no
-- framing (and every clip posted before this) is centre-cropped to its
-- closest shape.

alter table post_media
  add column crop_shape text,
  add column crop_zoom real,
  add column crop_focus_x real,
  add column crop_focus_y real,
  add column video_aspect real,
  add constraint post_media_crop_shape_valid check (crop_shape is null or crop_shape in ('square', 'portrait', 'landscape')),
  add constraint post_media_crop_zoom_range check (crop_zoom is null or crop_zoom between 1 and 4),
  add constraint post_media_crop_focus_range check (
    (crop_focus_x is null or crop_focus_x between 0 and 1) and (crop_focus_y is null or crop_focus_y between 0 and 1)
  ),
  add constraint post_media_crop_all_or_none check (
    (crop_shape is null) = (crop_zoom is null)
    and (crop_zoom is null) = (crop_focus_x is null)
    and (crop_focus_x is null) = (crop_focus_y is null)
  ),
  add constraint post_media_video_aspect_range check (video_aspect is null or video_aspect between 0.2 and 5);

-- post_media was left with grants.sql's table-wide INSERT/UPDATE when
-- 20260916150000 narrowed the other client-writable tables (it was on the
-- Phase 10 list). Adding columns is the moment to close it, per the rule in
-- CLAUDE.md: INSERT on exactly what create_post() (SECURITY INVOKER) writes,
-- no UPDATE (nothing updates media rows; there's no UPDATE policy either).
revoke insert, update on post_media from authenticated;
grant insert (post_id, url, position, crop_shape, crop_zoom, crop_focus_x, crop_focus_y, video_aspect) on post_media to authenticated;

-- ── create_post(): adds p_media_framing ───────────────────────────────────
-- A JSON array aligned with p_media_paths, one entry per item:
--   {"shape": "portrait", "zoom": 1.4, "focusX": 0.5, "focusY": 0.3, "videoAspect": 0.5625}
-- or null for an item with nothing to store. The column CHECKs above do the
-- validation, so a bad value fails the whole post rather than half-saving it.
-- Drop then create: a new parameter changes the function's identity (see
-- 20260916130000).

drop function if exists create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[]);

create function create_post(
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
  v_frame jsonb;
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

revoke execute on function create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[], jsonb) from public, anon;
grant execute on function create_post(uuid, text, text, text[], text, text[], boolean, text, uuid[], jsonb) to authenticated;
