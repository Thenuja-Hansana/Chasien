-- Sub-groups: a Community's chat space is no longer just its one
-- 'general' channel. A Room can now have additional room_channel
-- conversations ("sub-groups") whose membership is independent of
-- room_memberships — see is_default below for how General stays
-- special, and 20260905140300 for how participant sync gets rescoped
-- around it.

-- Marks exactly one room_channel conversation per Room as its General —
-- the one still auto-mirroring room_memberships, permanent, never
-- renamed/deleted/made private via the sub-group management policies
-- added in 20260905140400. Every room_channel conversation that exists
-- before this migration *is* that Room's General (today's only
-- channel), hence the backfill below.
alter table conversations
  add column is_default boolean not null default false,
  add column visibility room_visibility,
  add column member_count integer not null default 0,
  add column description text;

update conversations set is_default = true where kind = 'room_channel';

-- Denormalized, same reasoning as rooms.member_count
-- (20260903150000): Discover/All-Groups sorts sub-groups by size, and a
-- live count(*) per row doesn't scale as a Community accumulates
-- sub-groups. Backfill from conversation_participants, which already
-- holds every current room_channel participant (all mirrored from
-- room_memberships up to this point).
update conversations c
set member_count = (
  select count(*) from conversation_participants cp where cp.conversation_id = c.id
)
where c.kind = 'room_channel';

-- The real "stop them posting" mute (chat permission matrix: "Mute a
-- member within chat") and a persistent ban. Deliberately not the
-- existing `muted` column on this table — that one is a personal
-- "don't notify me" preference the member sets on themselves; these two
-- are set on someone else by a moderator, and must survive independent
-- of it. `banned` is kept on the row instead of deleting it, precisely
-- so a self-join attempt on a public sub-group can see "you're banned
-- here" and be refused, rather than looking like they were never a
-- member and quietly rejoining.
alter table conversation_participants
  add column posting_disabled boolean not null default false,
  add column banned boolean not null default false;

-- "Pin/unpin a chat message" — a message pinned in a conversation for
-- every participant to see, not the existing per-user, personal
-- conversation_participants.pinned ("pin this chat to the top of my own
-- inbox"). Toggled through a narrow RPC (20260905140500), mirroring the
-- existing toggle_post_pin function exactly.
alter table messages
  add column pinned_at timestamptz,
  add column pinned_by uuid references profiles (id) on delete set null;
