// Phase 7: fired hourly by pg_cron (supabase/migrations/20260901190100_story_cleanup_cron.sql).
// Not user-invoked, and not a Database Webhook either — there's no
// single row-insert event to react to here, only "time has passed,"
// which is what pg_cron is for.
//
// Uses the service-role client deliberately: an expired story is
// exactly the row `stories`' own SELECT policy (expires_at > now())
// refuses to return to a normal client — this function's whole job is
// to see the rows RLS is built to hide from everyone else.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'story-media';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: expired, error } = await admin
    .from('stories')
    .select('id, media_url')
    .lt('expires_at', new Date().toISOString());
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!expired || expired.length === 0) return json({ ok: true, deleted: 0 });

  const paths = expired.map((s) => s.media_url as string);
  const { error: storageError } = await admin.storage.from(BUCKET).remove(paths);
  if (storageError) {
    // Deliberately don't delete the rows in this branch: an orphaned
    // bucket object with nothing left pointing at it can't be retried,
    // but a row that failed to have its media removed just gets picked
    // up again on the next hourly run.
    return json({ ok: false, error: storageError.message }, 500);
  }

  const { error: deleteError } = await admin
    .from('stories')
    .delete()
    .in(
      'id',
      expired.map((s) => s.id),
    );
  if (deleteError) return json({ ok: false, error: deleteError.message }, 500);

  return json({ ok: true, deleted: expired.length });
});
