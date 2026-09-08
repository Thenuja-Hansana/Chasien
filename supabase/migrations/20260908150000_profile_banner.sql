-- Mirrors rooms.banner_url (20260908120000_room_avatar_banner.sql) — the
-- You page gets the same cover-photo header a Room's own create/edit
-- flow already has. No new storage policy needed: profile-media's
-- existing policies (20260908140000_profile_avatar_storage.sql) already
-- scope by path (`{user_id}/{uuid}.jpg`) rather than by which profile
-- field the object ends up referenced from, so they cover a banner photo
-- exactly the same way they already cover an avatar photo.

alter table profiles add column banner_url text;
