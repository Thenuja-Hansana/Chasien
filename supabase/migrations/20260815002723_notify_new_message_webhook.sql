-- Phase 6: fires the notify-new-message Edge Function on every new
-- message, via `supabase_functions.http_request` — Supabase's own
-- pg_net-backed trigger function for exactly this ("Database Webhooks"),
-- rather than hand-rolling a net.http_post call.
--
-- The URL targets the edge runtime container directly on the internal
-- Docker network (`edge_runtime:8081`, confirmed via `docker inspect`
-- against the actually-running local stack — not guessed), not Kong's
-- externally-mapped :54321. The trigger runs inside the Postgres
-- container, which can't reach the host's port mapping; it can reach
-- another container on the same compose network by service name.
--
-- The anon key below is Supabase CLI's fixed, publicly-documented local
-- development JWT secret's output — identical on every `supabase start`
-- for this project, not a real secret (mobile/.env.local embeds the same
-- value for the client, same as any anon key is meant to be embedded).
-- This whole trigger is scoped to local dev as a result: Phase 11's move
-- to a hosted project needs this migration replaced with one pointing at
-- that project's real function URL, the same way Phase 5's media seam
-- anticipates its own Phase 11 swap.
create trigger notify_new_message
after insert on messages
for each row execute function supabase_functions.http_request(
  'http://edge_runtime:8081/notify-new-message',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"}',
  '{}',
  '5000'
);
