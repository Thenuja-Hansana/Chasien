-- Phase 7: the `story-media` storage bucket, for per-Room story
-- image/video attachments. Mirrors post-media's design (Phase 5,
-- 20260814063412_post_media_storage.sql) — Room-scoped, private,
-- signed-URL reads — with one addition: video mime types, since Phase 7
-- is the first feature to accept video at all.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-media',
  'story-media',
  false,
  -- Images are resized/compressed client-side same as post-media (5 MiB
  -- ceiling still applies to those); video is uploaded as-is (no
  -- client-side video compression in this app), so the ceiling is set
  -- for "a short clip picked from the gallery," not a full recording.
  52428800, -- 50 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do nothing;

-- Object paths are `{room_id}/{user_id}/{uuid}.{ext}` — identical shape
-- and identical reasoning to post-media's policies (see that migration's
-- comment for the full "no ::uuid cast on attacker-controlled path
-- segments, ownership from the path not storage.objects' ambiguous
-- owner columns" reasoning, which applies unchanged here).

create policy "room members can read that room's story media"
on storage.objects for select
to authenticated
using (
  bucket_id = 'story-media'
  and exists (
    select 1 from rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and is_room_member(r.id, auth.uid())
  )
);

-- Unlike post-media, not gated on members_can_post — the stories table's
-- own INSERT policy (row_level_security.sql) already requires only
-- room membership, not posting permission, so a story upload shouldn't
-- be blocked by a check the row it belongs to was never going to enforce
-- either.
create policy "room members can upload story media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'story-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
  and exists (
    select 1 from rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and is_room_member(r.id, auth.uid())
  )
);

create policy "uploaders can delete their own story media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'story-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
);
