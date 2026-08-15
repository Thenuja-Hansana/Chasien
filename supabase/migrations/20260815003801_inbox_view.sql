-- Phase 6: the unified inbox — Room channels and DMs in one list,
-- each row carrying its own latest message and unread count, which
-- isn't expressible as a single supabase-js embed (there's no
-- "one row per group, please" operation in PostgREST's query grammar;
-- SQL's DISTINCT ON is exactly built for it).
--
-- `security_invoker = true` (Postgres 15+) is not optional here: without
-- it, a view runs with its *creator's* privileges — the migration-
-- applying role, effectively superuser — silently bypassing every RLS
-- policy on conversations/messages/profiles underneath it for every
-- caller. The `cp.user_id = auth.uid()` join below is already a correct
-- filter on its own, but relying on that alone and skipping
-- security_invoker would mean the view's actual safety depends on nobody
-- ever editing that one line — invoker semantics make the RLS policies
-- underneath enforce it independently, the same defense-in-depth reason
-- every table here has RLS enabled rather than trusting application code
-- alone.
create view my_inbox
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
  ) as unread_count
from conversations c
join conversation_participants cp on cp.conversation_id = c.id and cp.user_id = auth.uid()
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
