-- The "You" page's own missing piece: profiles.avatar_url has existed
-- since Phase 4 but nothing ever wrote to it — no bucket, no upload path,
-- so every profile fell back to a generated gradient+letter regardless of
-- whether the user had a real photo. Same private-bucket + signed-URL
-- pattern as post-media/room-media (lib/profileMedia.ts).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  false,
  5242880, -- 5 MiB, same ceiling as post-media/room-media — client-compressed before upload
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Matches profiles' own "profiles are readable by any authenticated user"
-- policy (20260813051235_row_level_security.sql) — a profile photo is
-- exactly as public as the profile row it belongs to.
create policy "any authenticated user can view a profile photo"
on storage.objects for select
to authenticated
using (bucket_id = 'profile-media');

-- Object paths are `{user_id}/{uuid}.jpg` — only the profile's own owner
-- ever writes here, the same authority profiles' own "users can update
-- their own profile" policy already requires.
create policy "users can upload their own profile photo"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-media'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

-- Best-effort cleanup path, same reasoning as post-media/room-media's own
-- delete policies: replacing a photo uploads a new object under a fresh
-- uuid rather than overwriting the old one, so the previous file needs an
-- explicit delete once profiles.avatar_url moves on from it.
create policy "users can delete their own profile photo"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-media'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);
