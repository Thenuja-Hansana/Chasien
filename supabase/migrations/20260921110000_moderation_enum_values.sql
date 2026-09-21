-- Phase 9, slice 2: enum values the moderation tools need, in a migration of
-- their own — Postgres can't use a value added by ALTER TYPE ... ADD VALUE
-- until the transaction that added it has committed, and the next
-- migration (20260921110100_moderation_tools.sql) uses both.
--
-- `report_target_type` doubles as moderation_actions.target_type (see
-- 20260813051229_trust_and_safety.sql), so 'story' here also makes stories
-- reportable once slice 3 builds reporting.
alter type report_target_type add value if not exists 'story';
alter type moderation_action_type add value if not exists 'remove_story';
