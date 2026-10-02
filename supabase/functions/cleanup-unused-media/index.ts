// Phase 10: fired daily by pg_cron
// (supabase/migrations/20261002140300_unused_media_cleanup.sql). Not
// user-invoked. Removes files that nothing points at any more: uploads
// whose post, message or story was never made, replaced profile and Room
// pictures, and the media of posts and messages removed over a week ago.
//
// The database decides what is unused (unused_media(), in that migration)
// and this only carries the decision out. It has to be an Edge Function
// because a file is removed through the Storage API, not by deleting its
// row. Expired stories are the hourly cleanup-expired-stories function's
// job and aren't touched here.
//
// Like that function, the only gate on this endpoint is a valid JWT, which
// the anon key is. That's acceptable for the same reason: nothing in the
// request is used, so all a caller can do is ask for a cleanup that was
// going to happen anyway.

import { createClient } from 'npm:@supabase/supabase-js@2';

type UnusedFile = { bucket: string; path: string };

// Storage's remove() takes a list; keep each call small enough that one
// bad batch doesn't hold up the rest.
const BATCH = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async () => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data, error } = await admin.rpc('unused_media');
  if (error) return json({ ok: false, error: error.message }, 500);

  const files = (data ?? []) as UnusedFile[];
  if (files.length === 0) return json({ ok: true, removed: {} });

  const byBucket = new Map<string, string[]>();
  for (const file of files) {
    const paths = byBucket.get(file.bucket) ?? [];
    paths.push(file.path);
    byBucket.set(file.bucket, paths);
  }

  const removed: Record<string, number> = {};
  const failed: Record<string, string> = {};
  for (const [bucket, paths] of byBucket) {
    removed[bucket] = 0;
    for (let i = 0; i < paths.length; i += BATCH) {
      const batch = paths.slice(i, i + BATCH);
      const { error: removeError } = await admin.storage.from(bucket).remove(batch);
      if (removeError) {
        // Left for tomorrow's run: the files are still listed as unused
        // until they're actually gone.
        failed[bucket] = removeError.message;
        break;
      }
      removed[bucket] += batch.length;
    }
  }

  const ok = Object.keys(failed).length === 0;
  return json({ ok, removed, ...(ok ? {} : { failed }) }, ok ? 200 : 500);
});
