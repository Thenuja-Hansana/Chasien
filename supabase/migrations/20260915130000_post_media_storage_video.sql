-- The composer now accepts video alongside images. Mirrors story-media's
-- own mime/size ceiling exactly (20260901190000_story_media_storage.sql)
-- — video here is uploaded as-is via uploadLocalFile() (lib/media.ts's
-- uploadPostMedia()), same as there, so the same "short clip from the
-- gallery" size assumption applies.
--
-- The bucket already exists (20260814063412_post_media_storage.sql's
-- `on conflict (id) do nothing` insert), so this only updates it — no
-- RLS policy changes: the three existing policies on `post-media` only
-- parse `{room_id}/{user_id}/...` path segments, never mime type or file
-- extension, so they apply unchanged to a `.mp4` object.

update storage.buckets
set
  file_size_limit = 52428800, -- 50 MiB
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
where id = 'post-media';
