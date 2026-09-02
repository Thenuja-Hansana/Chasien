-- Phase 7: schedules cleanup-expired-stories to run hourly via pg_cron
-- + pg_net, mirroring the notify-new-message webhook's internal-URL
-- pattern (20260815002723_notify_new_message_webhook.sql) rather than
-- guessing at one — same edge_runtime:8081 Docker-network hostname, same
-- fixed local-dev anon key (not a real secret; see that migration's
-- comment for why). pg_cron is available in the same Postgres image
-- Supabase's hosted platform uses, confirmed via
-- `select * from pg_available_extensions where name = 'pg_cron'`
-- against this exact local stack before writing this, not assumed from
-- pg_cron being described as a hosted-only feature in Supabase's docs —
-- that description is about the dashboard's cron UI, not the extension
-- itself.
--
-- Why a cron schedule and not a Database Webhook: nothing about
-- "an hour has passed" is a row-level insert/update/delete event for a
-- trigger to fire on.
--
-- pg_net is explicitly (re-)created here too, not assumed already
-- present just because the webhook trigger above depends on it and has
-- worked since Phase 6: it turns out pg_net was never actually declared
-- in any tracked migration, only ever available because Supabase CLI's
-- own bootstrap enabled it outside version control — and a `supabase db
-- reset` while writing this migration came back with `schema "net" does
-- not exist`, proving that bootstrap behavior isn't something this
-- project's migrations can keep depending on implicitly.
--
-- Phase 11 caveat: same as the webhook migration this one borrows its
-- URL/key pattern from — this whole schedule is local-dev-scoped and
-- needs replacing with one pointing at the hosted project's real
-- function URL and a real service credential when that migration runs.

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'cleanup-expired-stories-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'http://edge_runtime:8081/cleanup-expired-stories',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"}'::jsonb
  );
  $$
);
