-- Phase 5: the `post-media` storage bucket and its access rules.
--
-- Created here as a migration rather than as a `[storage.buckets.*]`
-- block in supabase/config.toml, because config.toml only provisions
-- buckets for the *local* stack — a migration runs against the hosted
-- project too (Phase 11), so the bucket and its policies stay a single
-- portable definition instead of two places to keep in sync.
--
-- Private, not public. Chasien's whole premise is that a Room's content
-- is invisible to non-members (verified in Phases 1 and 4); a public
-- bucket would hand out every post image to anyone holding the URL,
-- which quietly undoes that guarantee for exactly the content most
-- likely to get shared around. Reads go through short-lived signed URLs
-- instead (mobile/src/lib/media.ts).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  false,
  -- Post images are resized and JPEG-compressed client-side before
  -- upload (lib/media.ts), so anything arriving near this ceiling is a
  -- bug or a bypass attempt, not a legitimate photo.
  5242880, -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Object paths are `{room_id}/{user_id}/{uuid}.jpg`. storage.objects has
-- no room_id or author column to join on, so the path itself carries
-- both facts, and `storage.foldername(name)` is what lets a policy read
-- them back out.
--
-- Two deliberate details in the comparisons below:
--
-- 1. No `::uuid` cast on the path segments. They're attacker-controlled,
--    and casting a malformed one raises a hard error instead of cleanly
--    denying. Comparing against `rooms.id::text` / `auth.uid()::text`
--    keeps a junk path an ordinary "no rows matched" deny.
-- 2. Ownership is checked via the path's user_id segment, not the
--    `storage.objects.owner` column. That table carries *both* a legacy
--    `owner` (uuid) and a newer `owner_id` (text), and which one the
--    Storage API actually populates varies by version — a policy resting
--    on the wrong one fails closed and blocks every upload. The path
--    segment is set by us and verifiable without that ambiguity.

create policy "room members can read that room's post media"
on storage.objects for select
to authenticated
using (
  bucket_id = 'post-media'
  and exists (
    select 1 from rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and is_room_member(r.id, auth.uid())
  )
);

-- Mirrors the `posts` INSERT policy (row_level_security.sql): a member
-- can upload only where they'd be allowed to post, so flipping a Room's
-- members_can_post off closes the image path too, not just the text one.
create policy "members can upload post media where they can post"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'post-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
  and exists (
    select 1 from rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and is_room_member(r.id, auth.uid())
      and (is_room_moderator(r.id, auth.uid()) or r.members_can_post)
  )
);

-- Needed for the best-effort cleanup path in lib/media.ts: an image is
-- uploaded before the post row it belongs to exists, so a failure in
-- between would otherwise strand an orphaned object nobody can remove.
create policy "uploaders can delete their own post media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'post-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
);
