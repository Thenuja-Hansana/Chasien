-- Domain Verified rooms are meant to be discoverable the same way
-- Public/Request ones are (per create-community.tsx's own description:
-- "Anyone with a matching email domain joins") — found this while
-- actually testing the join flow end-to-end: rooms' own SELECT policy
-- only admitted 'public'/'request' to non-members, so a domain_verified
-- Room 404'd for anyone who hadn't already joined it, before they'd
-- ever get the chance to. Invite-only stays the one visibility that's
-- genuinely hidden.
drop policy "public and request rooms are listable; invite rooms only to members" on rooms;

create policy "public, request, and domain-verified rooms are listable; invite rooms only to members"
on rooms for select
to authenticated
using (
  visibility in ('public', 'request', 'domain_verified')
  or exists (
    select 1 from room_memberships rm
    where rm.room_id = rooms.id and rm.user_id = auth.uid()
  )
);

-- Same class of fix for the Room's own avatar/banner: visible to anyone
-- who can already see the Room, same reasoning as the SELECT policy
-- above.
drop policy "anyone who can see a room can view its avatar/banner" on storage.objects;

create policy "anyone who can see a room can view its avatar/banner"
on storage.objects for select
to authenticated
using (
  bucket_id = 'room-media'
  and exists (
    select 1 from rooms r
    where r.id::text = (storage.foldername(objects.name))[1]
      and (r.visibility in ('public', 'request', 'domain_verified') or is_room_member(r.id, auth.uid()))
  )
);
