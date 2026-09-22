-- The Chats list shows each Room's own picture, the same one Home,
-- Discover and a profile's Rooms list show, so my_inbox passes
-- rooms.avatar_url through (a storage path in the room-media bucket; the
-- client signs it like everywhere else).
--
-- Otherwise identical to 20260907120000_inbox_subgroup_columns.sql, which
-- is the current definition. The new column is appended at the end,
-- because CREATE OR REPLACE VIEW can only add columns after the existing
-- ones. Still security_invoker, so the rooms join is still subject to
-- rooms' own RLS: this exposes no picture its Room's storage policy
-- (20260908120000_room_avatar_banner.sql) wouldn't already let the
-- caller read.
create or replace view my_inbox
with (security_invoker = true)
as
select
  c.id as conversation_id,
  c.kind,
  c.room_id,
  c.name as channel_name,
  r.name as room_name,
  r.accent_color as room_accent_color,
  c.dm_user_a,
  c.dm_user_b,
  pa.handle as dm_user_a_handle,
  pa.name as dm_user_a_name,
  pb.handle as dm_user_b_handle,
  pb.name as dm_user_b_name,
  cp.muted,
  cp.pinned,
  cp.last_read_at,
  lm.id as last_message_id,
  lm.text as last_message_text,
  lm.image_url as last_message_image_url,
  lm.voice_url as last_message_voice_url,
  lm.author_id as last_message_author_id,
  lm.created_at as last_message_created_at,
  (
    select count(*)
    from messages m2
    where m2.conversation_id = c.id
      and m2.deleted_at is null
      and m2.author_id is distinct from cp.user_id
      and m2.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
  ) as unread_count,
  c.is_default,
  c.visibility as channel_visibility,
  c.description as channel_description,
  c.member_count as channel_member_count,
  r.avatar_url as room_avatar_url
from conversations c
join conversation_participants cp on cp.conversation_id = c.id and cp.user_id = auth.uid()
  and cp.join_state = 'approved' and not cp.banned
left join rooms r on r.id = c.room_id
left join profiles pa on pa.id = c.dm_user_a
left join profiles pb on pb.id = c.dm_user_b
left join lateral (
  select m.id, m.text, m.image_url, m.voice_url, m.author_id, m.created_at
  from messages m
  where m.conversation_id = c.id and m.deleted_at is null
  order by m.created_at desc
  limit 1
) lm on true;

grant select on my_inbox to authenticated;
