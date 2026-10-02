-- Phase 10, slice 6 (4 of 4): files nothing points at any more.
--
-- Stories have been cleaned up hourly since Phase 7 (20260901190100):
-- row and file together, once expired. Nothing did the same for the other
-- buckets, and two kinds of file pile up for ever:
--
--   * Orphans: uploaded, and then the post, message or story was never
--     made (the composer was closed, the app died, the request failed
--     where the app's own tidy-up couldn't run), or a profile or Room
--     picture that has since been replaced by a newer one.
--   * Media of removed content: delete_post() and remove_message() are
--     soft deletes, so the file outlives the post or message.
--
-- unused_media() lists them; the cleanup-unused-media Edge Function removes
-- them through the Storage API (a file can't be deleted by deleting its
-- row: storage.objects refuses that, and the bytes would stay anyway) and
-- is run daily by the job at the bottom.
--
-- What counts as unused, and after how long:
--
--   * A file no row points at, once it is 24 hours old. A day is far
--     longer than composing a post takes, and an upload in progress is
--     never touched.
--   * A file whose only posts or messages were removed, once the removal
--     is 7 days old. Not at once: a report about removed content is
--     reviewed by an app admin after the fact, and for a week the media is
--     still there to look at. The report's text snapshot stays for good
--     (capture_report_snapshot); the media doesn't.
--
-- It is read-only and returns paths; it deletes nothing itself. Internal:
-- only the service role can call it.

create function unused_media(
  p_orphan_after interval default interval '24 hours',
  p_removed_after interval default interval '7 days'
)
returns table (bucket text, path text)
language sql
stable
security definer
set search_path = public
as $$
  -- Post media: no post, or only posts removed long enough ago.
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = 'post-media'
    and o.created_at < now() - p_orphan_after
    and not exists (
      select 1
      from post_media pm
      join posts p on p.id = pm.post_id
      where pm.url = o.name
        and (p.deleted_at is null or p.deleted_at > now() - p_removed_after)
    )

  union all

  -- Chat attachments and voice notes: same rule, on messages.
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = 'message-media'
    and o.created_at < now() - p_orphan_after
    and not exists (
      select 1
      from messages m
      where (m.image_url = o.name or m.voice_url = o.name)
        and (m.deleted_at is null or m.deleted_at > now() - p_removed_after)
    )

  union all

  -- Story media with no story row. Expired stories are the hourly job's;
  -- this is only the upload whose story was never created.
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = 'story-media'
    and o.created_at < now() - p_orphan_after
    and not exists (select 1 from stories s where s.media_url = o.name)

  union all

  -- Profile pictures and banners that were replaced.
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = 'profile-media'
    and o.created_at < now() - p_orphan_after
    and not exists (select 1 from profiles pr where pr.avatar_url = o.name or pr.banner_url = o.name)

  union all

  -- Room pictures and banners that were replaced.
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = 'room-media'
    and o.created_at < now() - p_orphan_after
    and not exists (select 1 from rooms r where r.avatar_url = o.name or r.banner_url = o.name);
$$;

revoke execute on function unused_media(interval, interval) from public, anon, authenticated;

-- Daily, at an hour nobody is posting. Same shape as the story cleanup's
-- schedule (20260901190100), and the same Phase 11 caveat: the URL and key
-- are the local stack's and must be replaced with the hosted project's
-- when that migration runs.
select cron.schedule(
  'cleanup-unused-media-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'http://edge_runtime:8081/cleanup-unused-media',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"}'::jsonb
  );
  $$
);
