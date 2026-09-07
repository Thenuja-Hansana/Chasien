-- Sub-group membership needs the same pending/approved/invited states
-- Room membership already has (join_state, extensions_and_enums.sql) —
-- a 'request' or 'invite' visibility sub-group can't represent "asked
-- to join, not approved yet" without it. General and DM rows are always
-- 'approved' the instant they're created (mirrored/seeded immediately);
-- only a sub-group row can ever sit at 'pending' or 'invited'.
alter table conversation_participants
  add column join_state join_state not null default 'approved';

-- Every existing read-access check that uses conversation_participants
-- as "is this user actually in here" must now also require approved —
-- a pending/invited sub-group row is a placeholder, not real membership
-- yet, same as room_memberships already works.
create or replace function is_conversation_participant(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = p_conversation_id and user_id = p_user_id
      and not banned and join_state = 'approved'
  );
$$;

drop policy "participants can see their conversations" on conversations;

create policy "participants can see their conversations"
on conversations for select
to authenticated
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = conversations.id and cp.user_id = auth.uid()
      and not cp.banned and cp.join_state = 'approved'
  )
);

drop policy "participants can read messages, minus soft-deleted content" on messages;

create policy "participants can read messages, minus soft-deleted content"
on messages for select
to authenticated
using (
  exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
      and not cp.banned and cp.join_state = 'approved'
  )
  and (
    deleted_at is null
    or author_id = auth.uid()
    or exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and c.room_id is not null
        and is_room_moderator(c.room_id, auth.uid())
    )
  )
);

drop policy "participants can send messages unless muted or banned" on messages;

create policy "participants can send messages unless muted or banned"
on messages for insert
to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1 from conversation_participants cp
    where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
      and not cp.posting_disabled and not cp.banned and cp.join_state = 'approved'
  )
);
