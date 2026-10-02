-- Phase 10, slice 6 (3 of 4): how much one person can upload.
--
-- Files, not text, are what runs a photo-and-video app out of free-tier
-- space (architecture.md, "Where free tiers actually break"). On
-- 2026-10-02 the post-media bucket held 28 files and 38 MB, an average of
-- 1.4 MB, because video is uploaded as it was recorded: the app has no
-- video compression. Two things were missing.
--
-- 1. No limit on how many files a person uploads. The storage policies say
--    *where* someone may upload (their own folder, in a Room they can post
--    in), not how much, and an upload doesn't need a post to go with it.
--    Now: at most 50 files uploaded in any 24 hours, across all five
--    buckets.
--
--    It is a RESTRICTIVE policy, so it is ANDed with whichever bucket's
--    own INSERT policy applies and none of those five has to be rewritten.
--    The check is a function that counts the files this person has
--    uploaded in the last 24 hours (storage.objects.owner_id, which the
--    Storage service sets from the uploader's token).
--
--    Why it counts files rather than using rate_limit_counters like every
--    other limit: tried first, and it never counted. The Storage service
--    evaluates the INSERT policy inside a transaction it rolls back (a
--    permission test), uploads the bytes, and then writes the real row as
--    its own role, past RLS. Anything a policy writes is undone; the row
--    is the only thing that persists, so the row is what's counted. Found
--    on the local stack: the upload succeeded and the counter stayed 0.
--
--    Two consequences of counting rows. Deleting your own uploads gives
--    the allowance back, which is right: the limit is on what's stored.
--    And the count is a scan of storage.objects by owner, with no index
--    to help (the table belongs to the Storage service; a migration can
--    add policies to it but not indexes). At the free tier's size, a few
--    thousand files, that is nothing; it is a thing to revisit with R2.
--
--    The function has to be executable by `authenticated`, because a
--    policy runs as the person uploading. That also makes it callable
--    directly; all it tells a caller is whether they are under their own
--    limit.
--
-- 2. Video could be 50 MB a file in posts and stories. 25 MB now. At
--    typical phone bitrates that is roughly a minute of 1080p, which is
--    also the clip length the app allows from this slice on (60 seconds,
--    lib/media.ts). The app's check is on duration, which the server can't
--    see; this is the server's half.
--
-- Not changed: message-media (10 MB), profile-media and room-media (5 MB).

create function within_upload_quota()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- No person behind the request: the service role doesn't reach policies
  -- at all, and anything else without a user isn't allowed to upload by
  -- the bucket's own policy.
  select auth.uid() is null
      or (
        select count(*)
        from storage.objects o
        where o.owner_id = auth.uid()::text
          and o.created_at > now() - interval '24 hours'
      ) < 50;
$$;

revoke execute on function within_upload_quota() from public, anon;
grant execute on function within_upload_quota() to authenticated;

create policy "uploads are capped per person per day"
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (within_upload_quota());

update storage.buckets
set file_size_limit = 25 * 1024 * 1024
where id in ('post-media', 'story-media');
