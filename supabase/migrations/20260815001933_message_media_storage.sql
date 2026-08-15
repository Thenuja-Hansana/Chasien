-- Phase 6: the `message-media` storage bucket, for chat image and voice
-- attachments — mirrors post-media's design (Phase 5,
-- 20260814063412_post_media_storage.sql) with one necessary difference:
-- access is scoped by conversation, not Room, since a DM has no
-- room_id at all for a Room-based policy to check.
--
-- Private, signed-URL reads — same reasoning as post-media: a public
-- bucket would hand out DM photos and voice notes to anyone with the
-- URL, which is a far more sensitive leak than a Room post ever was.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-media',
  'message-media',
  false,
  10485760, -- 10 MiB — covers a compressed photo or a voice note of a minute or two
  array['image/jpeg', 'image/png', 'image/webp', 'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg']
)
on conflict (id) do nothing;

-- Object paths are `{conversation_id}/{user_id}/{uuid}.{ext}`. Same two
-- deliberate details as post-media's policies (see that migration's
-- comment for the full reasoning): no `::uuid` cast on the
-- attacker-controlled path segments (compare the *known* uuid column
-- cast to text instead, never the other way around — casting a
-- malformed path segment to uuid raises a hard error, not a clean
-- deny), and ownership checked from the path rather than
-- storage.objects' ambiguous owner/owner_id columns.
--
-- Written as an EXISTS on conversation_participants directly rather
-- than calling is_conversation_participant() (row_level_security.sql),
-- since that helper takes a typed uuid argument and would need exactly
-- the unsafe cast this comment just ruled out.

create policy "conversation participants can read that conversation's media"
on storage.objects for select
to authenticated
using (
  bucket_id = 'message-media'
  and exists (
    select 1 from conversation_participants cp
    where cp.conversation_id::text = (storage.foldername(objects.name))[1]
      and cp.user_id = auth.uid()
  )
);

create policy "participants can upload media to their own conversations"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
  and exists (
    select 1 from conversation_participants cp
    where cp.conversation_id::text = (storage.foldername(objects.name))[1]
      and cp.user_id = auth.uid()
  )
);

create policy "uploaders can delete their own message media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'message-media'
  and (storage.foldername(objects.name))[2] = auth.uid()::text
);
