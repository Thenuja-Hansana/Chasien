-- Create Room flow gets real avatar/banner photos instead of only the
-- flat accent-color swatch it's had since Phase 0. Same private-bucket +
-- signed-URL pattern as post-media/message-media (lib/media.ts): a
-- Room's avatar/banner is its "storefront" image though, not gated
-- member content, so the SELECT policy below is intentionally broader
-- than post-media's — readable by anyone who could already see the Room
-- exists (public/request Rooms are visible to everyone in Discover;
-- invite Rooms only to their own members, matching rooms' own SELECT
-- policy in row_level_security.sql).

alter table rooms add column avatar_url text, add column banner_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-media',
  'room-media',
  false,
  5242880, -- 5 MiB, same ceiling as post-media — client-compressed before upload
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Object paths are `{room_id}/{user_id}/{uuid}.jpg`, same shape and same
-- reasoning as post-media's own policies (see that migration's comment
-- on why no ::uuid cast and why the path's user_id segment, not
-- storage.objects.owner, is what's checked).
create policy "anyone who can see a room can view its avatar/banner"
on storage.objects for select
to authenticated
using (
  bucket_id = 'room-media'
  and exists (
    select 1 from rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and (r.visibility in ('public', 'request') or is_room_member(r.id, auth.uid()))
  )
);

-- Only an owner/admin sets a Room's own identity images — the same
-- authority level rooms' own UPDATE policy already requires to change
-- anything else about a Room.
create policy "room admins can upload their room's avatar/banner"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'room-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
  and exists (
    select 1 from rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and is_room_admin(r.id, auth.uid())
  )
);

-- Best-effort cleanup path, same reasoning as post-media's own delete
-- policy: an image can be uploaded and then orphaned if the room row
-- update that references it never completes.
create policy "uploaders can delete their own room media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'room-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
);
