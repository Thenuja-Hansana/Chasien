-- Locks down what a signed-in client can write directly, table by table.
--
-- Background: grants.sql (Phase 1) granted INSERT/UPDATE/DELETE on every
-- table to `authenticated` and left all restriction to RLS. RLS decides
-- *which rows* a user may write, but not *which columns* — so on most
-- tables, columns that carry authority were client-writable. Each case
-- below was reproduced on the local stack (2026-09-16) as an ordinary user,
-- exactly the way PostgREST runs a request, before this migration:
--
--   T1 room_email_verifications: insert your own row with any email and a
--      self-chosen token, then open verify-room-email?token=… → approved
--      member of a domain_verified Room without an address at that domain.
--   T2 conversation_participants: a pending sub-group member sets their
--      own join_state = 'approved' → reads and posts in the private sub-group.
--   T3 messages: a muted member sends in another chat, then updates the
--      message's conversation_id into the chat they're muted in; messages
--      could also be inserted future-dated and self-pinned.
--   T4 friendships: "accepting" a request rewrites user_b/requested_by →
--      an accepted friendship with someone who never asked.
--   T5 stories: insert with expires_at ten years out → a story that never
--      expires.
--   T6 poll_votes: a direct insert skips vote_poll() → two votes on a
--      single-choice poll.
--   T7 reports: insert with status = 'dismissed', reviewed_by someone else,
--      and a fabricated content_snapshot.
--   T8 comments: insert future-dated and pre-marked removed_by someone else.
--   T9 rooms: an owner/admin rewrites member_count and created_by.
-- Not open: moving content into a Room/conversation you aren't in (an
-- UPDATE's new row must also pass the table's SELECT policy), banned users
-- acting, and anon writes (RLS refused them).
--
-- Approach: revoke table-wide INSERT/UPDATE and grant back only the columns
-- the app and the SECURITY INVOKER functions actually write — inventoried
-- from mobile/src and every function body, not assumed. SECURITY DEFINER
-- functions and service-role Edge Functions are unaffected by these grants.
-- Column grants fail closed: a column added later is not client-writable
-- until it's added here on purpose.

-- ── T1: domain verification rows are server-only ──────────────────────────
-- request-room-verification (service role) is the only legitimate writer,
-- and it's where the email domain is checked. The client never inserts.
drop policy if exists "a user can create their own verification request" on room_email_verifications;
revoke insert, update, delete on room_email_verifications from anon, authenticated;

-- ── T2: participants may only change their personal preferences ──────────
-- App writes: last_read_at (markConversationRead). muted/pinned are the
-- other personal preferences the "update their own personal preferences"
-- policy exists for. join_state, posting_disabled and banned are decided by
-- the room-membership Edge Function (service role).
revoke insert, update on conversation_participants from anon, authenticated;
grant update (muted, pinned, last_read_at) on conversation_participants to authenticated;

-- ── T3 / T8: messages and comments — content columns on insert, no updates ─
-- App writes: sendMessage (lib/chat.ts) and addComment (lib/posts.ts).
-- Nothing in the app edits a message, comment or post, so no client UPDATE
-- at all: allowing text-only updates would still let content be silently
-- rewritten (edited_at untouched) — including by a member muted in that
-- chat. When editing ships, grant UPDATE (text) together with a trigger
-- that stamps edited_at. Pinning and removal go through SECURITY DEFINER
-- functions (toggle_message_pin, delete_post) and the Edge Function.
revoke insert, update on messages from anon, authenticated;
grant insert (conversation_id, author_id, text, image_url, voice_url, reply_to_id) on messages to authenticated;

revoke insert, update on comments from anon, authenticated;
grant insert (post_id, author_id, parent_comment_id, text) on comments to authenticated;

-- posts: 20260916140000 granted UPDATE (text, tag) for a future edit feature;
-- same reasoning as above, so withdrawn until that feature (and its
-- edited_at trigger) exists. The INSERT column grant stays as it was.
revoke update on posts from authenticated;

-- ── T4: accepting a friend request can only change its status ─────────────
-- App writes: sendFriendRequest inserts (user_a, user_b, requested_by);
-- acceptFriendRequest updates status.
revoke insert, update on friendships from anon, authenticated;
grant insert (user_a, user_b, requested_by) on friendships to authenticated;
grant update (status) on friendships to authenticated;

-- ── T5: story lifetime is not client-chosen ───────────────────────────────
-- App writes: createStory inserts (room_id, author_id, media_url, caption).
revoke insert, update on stories from anon, authenticated;
grant insert (room_id, author_id, media_url, caption) on stories to authenticated;

-- ── T6: single-choice polls take one vote per person, however it arrives ──
-- vote_poll() removes a caller's previous pick before inserting on a
-- single-choice poll, so it passes; a direct insert of a second vote doesn't.
-- SECURITY DEFINER so the check sees every vote regardless of RLS.
create function enforce_single_choice_poll_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select allow_multiple from polls where id = new.poll_id), false)
     and exists (select 1 from poll_votes where poll_id = new.poll_id and user_id = new.user_id) then
    raise exception 'this poll allows only one answer';
  end if;
  return new;
end;
$$;

create trigger enforce_single_choice_poll_vote
before insert on poll_votes
for each row execute function enforce_single_choice_poll_vote();

revoke insert, update on poll_votes from anon, authenticated;
grant insert (poll_id, poll_option_id, user_id) on poll_votes to authenticated;

-- ── T7: reports can't be pre-reviewed or carry client-written evidence ────
-- No app flow files reports yet (Phase 9). When it does, content_snapshot
-- must be captured server-side from the reported row, not accepted from
-- the client — so it isn't granted here.
revoke insert, update on reports from anon, authenticated;
grant insert (reporter_id, target_type, target_id, reason) on reports to authenticated;

-- ── T9: rooms — only the fields the create/settings screens edit ──────────
-- App writes: createRoom (lib/rooms.ts) and updateRoomSettings.
-- member_count is maintained by triggers; ownership lives in
-- room_memberships.role, not created_by.
revoke insert, update on rooms from anon, authenticated;
grant insert (slug, name, description, visibility, accent_color, category, required_email_domain, created_by) on rooms to authenticated;
grant update (description, visibility, accent_color, avatar_url, banner_url, category, members_can_post, required_email_domain) on rooms to authenticated;

-- ── profiles and notifications: what the app writes, nothing else ─────────
-- App writes: updateProfile (name, bio, avatar_url, banner_url) and the
-- presence heartbeat (last_active_at); notifications are only marked read.
revoke insert, update on profiles from anon, authenticated;
grant update (name, bio, avatar_url, banner_url, last_active_at) on profiles to authenticated;

revoke insert, update on notifications from anon, authenticated;
grant update (read_at) on notifications to authenticated;

-- ── Room notification mute: a real write path ─────────────────────────────
-- setRoomNotificationsMuted() updated room_memberships directly, but that
-- table is read-only to clients by design (no UPDATE policy), so the update
-- matched 0 rows and returned no error — muting a Room silently did nothing.
-- A SECURITY DEFINER function that can change exactly one column of the
-- caller's own approved membership row.
create function set_room_notifications_muted(p_room_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update room_memberships
  set notifications_muted = p_muted
  where room_id = p_room_id and user_id = auth.uid() and join_state = 'approved';
  if not found then
    raise exception 'not a member of this Room';
  end if;
end;
$$;

revoke execute on function set_room_notifications_muted(uuid, boolean) from public, anon;
grant execute on function set_room_notifications_muted(uuid, boolean) to authenticated;

-- ── anon writes nothing, now or in future tables ──────────────────────────
-- grants.sql intended anon to have no privileges, but Supabase's default
-- privileges granted it INSERT/UPDATE/DELETE/TRUNCATE on every table. RLS
-- refused those writes; this removes the privileges themselves. TRUNCATE
-- bypasses RLS entirely (only reachable over a direct database connection,
-- which clients don't have), so it's withdrawn from authenticated too.
revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate on tables from anon;
alter default privileges for role postgres in schema public revoke truncate on tables from authenticated;
