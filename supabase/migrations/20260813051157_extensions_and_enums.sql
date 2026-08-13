-- Phase 1: extensions and enum types shared across every domain migration
-- that follows. See docs/phase/phase01.md for the reasoning behind each
-- enum's exact value set.

create extension if not exists pgcrypto with schema extensions;

-- Rooms
create type room_visibility as enum ('public', 'request', 'invite');
create type room_role as enum ('owner', 'mod', 'member');
create type join_state as enum ('pending', 'approved', 'invited');

-- Chat
create type conversation_kind as enum ('room_channel', 'dm');

-- Notifications
create type notification_type as enum (
  'reply',
  'like',
  'mention',
  'join_request',
  'pinned_post',
  'message'
);

-- Trust & safety
create type report_target_type as enum ('post', 'comment', 'message', 'user');
create type report_status as enum ('open', 'reviewed', 'actioned', 'dismissed');
create type moderation_action_type as enum (
  'remove_post',
  'remove_comment',
  'remove_message',
  'mute_member',
  'kick_member',
  'ban_user',
  'role_change'
);
