-- Tag people (Post composer, stage 4): a notification type for "X tagged you
-- in a post".
--
-- Its own migration on purpose: Postgres can't use an enum value in the
-- same transaction that adds it ("unsafe use of new value"), and the next
-- migration's trigger inserts notifications of this type.

alter type notification_type add value if not exists 'tag';
