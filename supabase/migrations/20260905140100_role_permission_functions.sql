-- Splits "can moderate" into two tiers now that 'admin' exists, as a
-- pair of named permission functions rather than hardcoded role-name
-- checks scattered across policies — so a future custom-role system can
-- swap what's inside these two functions without touching every call
-- site that uses them.

-- Broadened, not renamed: every existing policy already calling
-- is_room_moderator (rooms update, conversations for room channels,
-- messages/posts/comments delete, moderation_actions, join-request
-- approval) picks up 'admin' automatically via CREATE OR REPLACE,
-- with none of those policies needing an edit. Matches the chat
-- permission matrix's Moderator-and-above row: delete any message/
-- post/comment, mute/ban a member, pin/unpin a message, approve join
-- requests.
create or replace function is_room_moderator(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id
      and join_state = 'approved' and role in ('owner', 'admin', 'mod')
  );
$$;

-- The stricter tier the matrix's Admin-and-above column needs: editing
-- Community settings, creating/renaming/deleting a sub-group, toggling
-- a sub-group's visibility, and assigning roles. Deliberately excludes
-- 'mod' — a Moderator does not get these, unlike is_room_moderator above.
create function is_room_admin(p_room_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = p_user_id
      and join_state = 'approved' and role in ('owner', 'admin')
  );
$$;
