// Phase 9: app-admin actions that need the service role — suspending and
// un-suspending an account (Supabase Auth's admin API, which SQL can't
// reach), and signing a report's media so the admin can see the evidence
// (storage policies only let a Room's members read its media). Everything
// else an app admin does (reading reports, resolving them, removing
// content) is plain RLS / SECURITY DEFINER functions; see
// supabase/migrations/20260921120100_reports.sql.
//
// A suspension is two things, kept in step here:
//   1. a row in account_suspensions — the admin-visible record, and what
//      the Reports screen lists and un-suspends from;
//   2. a ban on the auth user — what actually stops them. Supabase Auth
//      refuses a banned user's sign-in and token refresh. An access token
//      they already hold stays valid until it expires (jwt_expiry, an hour
//      by default), so a suspension takes full effect within the hour.
// The row is written first and the ban second, and the row is removed if
// the ban fails: the other order could leave someone banned with no record
// an admin can see — and so no way to lift it from the app.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type Action =
  | { action: 'suspend_user'; user_id: string; reason?: string; report_id?: string }
  | { action: 'unsuspend_user'; user_id: string }
  | { action: 'sign_report_media'; report_id: string };

// Which private bucket a reported thing's media lives in. Media stays
// behind membership-gated storage policies, and an app admin usually
// isn't a member of the Room a report came from — so this function signs
// it for them, but only the paths recorded in that report's snapshot.
const MEDIA_BUCKET: Record<string, string> = {
  post: 'post-media',
  story: 'story-media',
  message: 'message-media',
};
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// Effectively permanent until an admin lifts it (Supabase Auth takes a
// duration, not "forever").
const SUSPENSION_DURATION = '876000h';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // The caller comes from their own JWT, never from the request body.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: isAdmin } = await admin.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!isAdmin) {
    return json({ error: 'Only an app admin can do this.' }, 403);
  }

  let body: Action;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  switch (body.action) {
    case 'suspend_user':
      return suspend(admin, user.id, body.user_id, body.reason, body.report_id);
    case 'unsuspend_user':
      return unsuspend(admin, user.id, body.user_id);
    case 'sign_report_media':
      return signReportMedia(admin, body.report_id);
    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});

type AdminClient = ReturnType<typeof createClient>;

async function suspend(admin: AdminClient, actorId: string, targetId: string, reason?: string, reportId?: string) {
  if (!targetId) return json({ error: 'Missing user_id.' }, 400);
  if (targetId === actorId) return json({ error: "You can't suspend yourself." }, 400);

  const { data: target } = await admin.from('profiles').select('id').eq('id', targetId).maybeSingle();
  if (!target) return json({ error: 'That account no longer exists.' }, 404);

  // Taking an admin's powers away is a deliberate, out-of-app step (remove
  // them from app_admins first), not something one admin does to another.
  const { data: targetIsAdmin } = await admin.from('app_admins').select('user_id').eq('user_id', targetId).maybeSingle();
  if (targetIsAdmin) return json({ error: "App admins can't be suspended." }, 403);

  const { error: rowError } = await admin
    .from('account_suspensions')
    .upsert({ user_id: targetId, suspended_by: actorId, reason: reason ?? null });
  if (rowError) return json({ error: rowError.message }, 500);

  const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: SUSPENSION_DURATION });
  if (banError) {
    await admin.from('account_suspensions').delete().eq('user_id', targetId);
    return json({ error: banError.message }, 500);
  }

  // Best-effort, like the room-membership function's logging: the
  // suspension itself has already happened and shouldn't be undone by a
  // log or report-bookkeeping failure.
  await admin.from('moderation_actions').insert({
    room_id: null,
    actor_id: actorId,
    action_type: 'ban_user',
    target_user_id: targetId,
    reason: reason ?? null,
  });
  if (reportId) {
    await admin
      .from('reports')
      .update({ status: 'actioned', reviewed_by: actorId, reviewed_at: new Date().toISOString() })
      .eq('id', reportId);
  }

  return json({ ok: true });
}

// The evidence a report captured, viewable by the admin reviewing it. Paths
// come from the report's own server-written snapshot, never from the
// request, so this can't be used to sign arbitrary storage objects. A path
// whose object has since been deleted (an expired story, say) just comes
// back without a URL.
async function signReportMedia(admin: AdminClient, reportId: string) {
  if (!reportId) return json({ error: 'Missing report_id.' }, 400);
  const { data: report } = await admin.from('reports').select('target_type, content_snapshot').eq('id', reportId).maybeSingle();
  if (!report) return json({ error: 'Report not found.' }, 404);

  const bucket = MEDIA_BUCKET[report.target_type as string];
  const snapshot = (report.content_snapshot ?? {}) as Record<string, unknown>;
  const paths = [
    ...(Array.isArray(snapshot.media) ? (snapshot.media as unknown[]) : []),
    snapshot.media_url,
    snapshot.image_url,
    snapshot.voice_url,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (!bucket || paths.length === 0) return json({ media: [] });

  const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) return json({ error: error.message }, 500);
  // Path and token only, not the full URL: this function's SUPABASE_URL is
  // whatever address it reaches the gateway by — locally that's
  // http://kong:8000, inside Docker, which no phone or browser can
  // resolve (found in testing). The app prefixes its own Supabase URL.
  return json({
    media: (data ?? []).map((item) => {
      if (!item.signedUrl) return { path: item.path, signedPath: null };
      const u = new URL(item.signedUrl);
      return { path: item.path, signedPath: u.pathname + u.search };
    }),
  });
}

async function unsuspend(admin: AdminClient, actorId: string, targetId: string) {
  if (!targetId) return json({ error: 'Missing user_id.' }, 400);

  const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: 'none' });
  if (banError) return json({ error: banError.message }, 500);

  const { error: rowError } = await admin.from('account_suspensions').delete().eq('user_id', targetId);
  if (rowError) return json({ error: rowError.message }, 500);

  await admin.from('moderation_actions').insert({
    room_id: null,
    actor_id: actorId,
    action_type: 'unban_user',
    target_user_id: targetId,
  });

  return json({ ok: true });
}
