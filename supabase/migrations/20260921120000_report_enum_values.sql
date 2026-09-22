-- Phase 9, slice 3: enum values reporting needs, in their own migration —
-- Postgres can't use a value added by ALTER TYPE ... ADD VALUE until the
-- transaction that added it commits, and 20260921120100_reports.sql uses
-- all three.
--
-- 'room': a whole Room can be reported, not just what's in it.
-- 'report_filed': the notification an app admin gets for each new report.
-- 'unban_user': logged when an app admin lifts a suspension, so the
--   moderation log shows both sides (ban_user already exists).
alter type report_target_type add value if not exists 'room';
alter type notification_type add value if not exists 'report_filed';
alter type moderation_action_type add value if not exists 'unban_user';
