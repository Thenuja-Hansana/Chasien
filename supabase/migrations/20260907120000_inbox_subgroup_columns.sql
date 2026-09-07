-- my_inbox (20260815003801_inbox_view.sql) predates sub-groups having
-- their own join_state/banned — without the join condition below, a
-- pending sub-group request, an unaccepted sub-group invite, or a
-- banned participant's row (kept rather than deleted, see
-- 20260905140200) would show up here as if it were an already-open
-- chat. Also exposes what the Chats/sub-group UI needs to tell General
-- apart from a sub-group and render either one consistently.
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
  -- Appended, not inserted next to the other channel_* columns above —
  -- CREATE OR REPLACE VIEW can only add columns at the end, never
  -- reorder or interleave with the existing ones.
  c.is_default,
  c.visibility as channel_visibility,
  c.description as channel_description,
  c.member_count as channel_member_count
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

-- Discover/All-Groups needs to list every sub-group in a Room the
-- caller belongs to, joined or not — "sub-group visibility is
-- independent of sub-group membership" (all Community members should
-- be able to see what sub-groups exist). The existing "participants
-- can see their conversations" policy only covers ones you're already
-- in; this is a second, additive permissive policy scoped to
-- room_channel only (DMs stay participant-only, untouched).
create policy "room members can see every channel in their room"
on conversations for select
to authenticated
using (kind = 'room_channel' and is_room_member(room_id, auth.uid()));
