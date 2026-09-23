-- Phase 10: a push can't be forged, and can't be sent twice.
--
-- notify-activity and notify-new-message took the notification or the
-- message straight from the request body, and the only gate was a valid
-- JWT — which the anon key shipped in every build is. So anyone could push
-- made-up notifications to any account, and notify-new-message would send
-- their own wording to every member of a chat (found 2026-09-22; see
-- decision-log).
--
-- The fix isn't a shared secret to keep in step in two places, local and
-- hosted. The functions now ignore the body apart from the row's id, read
-- the row themselves with the service role, and claim it first:
--
--   update notifications set pushed_at = now() where id = $1 and pushed_at is null
--
-- The push is then built from what's actually in the database, so nothing
-- can be injected through the request. A forged call can at most ask for a
-- push the database was about to send anyway, and only in the moment before
-- the real webhook call claims the row; afterwards it does nothing at all.
-- The same claim makes a double push impossible, which nothing prevented
-- before.
--
-- `pushed_at` is server-only: it's deliberately absent from every column
-- grant (20260916150000), so a client can't claim a row itself and
-- suppress someone else's push.

alter table notifications add column pushed_at timestamptz;
alter table messages add column pushed_at timestamptz;

comment on column notifications.pushed_at is
  'When notify-activity claimed this row to push it (20260923100000). Service role only: never granted to clients.';
comment on column messages.pushed_at is
  'When notify-new-message claimed this row to push it (20260923100000). Service role only: never granted to clients.';
