-- Phase 8 follow-up: notify_type needs two new values before the next
-- migration's triggers can use them. Split into its own migration
-- because Postgres won't let a newly added enum value be used by a
-- statement in the same transaction that added it (a later migration
-- runs as a separate transaction, this one doesn't).
alter type notification_type add value 'new_post';
alter type notification_type add value 'new_story';
