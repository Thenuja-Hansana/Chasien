-- Phase 8: fires notify-activity on every new notification, same
-- pattern and same local-dev caveat as notify_new_message
-- (20260815002723_notify_new_message_webhook.sql) — internal Docker
-- hostname (edge_runtime:8081, not Kong's external :54321, since this
-- trigger runs inside the Postgres container), fixed local-dev anon
-- key (not a real secret). Needs replacing with the hosted project's
-- real function URL/credential when Phase 11 stands that up.

create trigger notify_activity
after insert on notifications
for each row execute function supabase_functions.http_request(
  'http://edge_runtime:8081/notify-activity',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"}',
  '{}',
  '5000'
);
