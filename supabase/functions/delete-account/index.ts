// Phase 9: deleting an account for real (Apple 5.1.1(v), Google Play's User
// Data policy). Three requests:
//   {}                                    the signed-in person deletes their own account
//   { action: 'lookup', email }           an app admin finds the account behind an emailed request
//   { action: 'delete_user', user_id }    an app admin deletes that account
//
// Deleting runs the same steps either way (see
// supabase/migrations/20260922120000_account_deletion.sql): list the files,
// delete the data in one transaction (owned Rooms handed over or deleted,
// content deleted), delete the Supabase Auth user (which cascades the rest),
// then remove the files. Files go last, so a failure part-way never leaves
// content pointing at files that are already gone; a retry after a failed
// Auth step is safe, because the data step finds nothing left to do.

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

type Body = { action?: undefined } | { action: 'lookup'; email: string } | { action: 'delete_user'; user_id: string };

// Deleting your own account needs the password entered in the last few
// minutes, not just a signed-in session, so a phone left unlocked (or a
// stolen session) can't do it. The app signs in again with the password
// right before calling this. Supabase's access token records when the
// password was entered in `amr`, and a token refresh keeps that timestamp
// (checked when this was built), so it can't be satisfied by refreshing.
const REAUTH_WINDOW_SECONDS = 5 * 60;

function passwordEnteredRecently(accessToken: string): boolean {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const entry = (payload.amr ?? []).find((a: { method?: string }) => a.method === 'password');
    return !!entry && Date.now() / 1000 - Number(entry.timestamp) <= REAUTH_WINDOW_SECONDS;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (!body.action) {
    // The token was validated by getUser() above, so its claims can be read.
    if (!passwordEnteredRecently(authHeader.replace(/^Bearer\s+/i, ''))) {
      return json({ error: 'For your security, enter your password again.', code: 'reauth_required' }, 403);
    }
    return deleteAccount(admin, user.id);
  }

  const { data: isAdmin } = await admin.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!isAdmin) {
    return json({ error: 'Only an app admin can do this.' }, 403);
  }

  if (body.action === 'lookup') {
    const { data, error } = await admin.rpc('find_account_by_email', { p_email: body.email ?? '' });
    if (error) return json({ error: error.message }, 500);
    const account = (data ?? [])[0];
    if (!account) return json({ error: 'No account uses that email address.' }, 404);
    return json({ account: { userId: account.user_id, handle: account.handle, name: account.name, isAppAdmin: account.is_app_admin } });
  }

  if (body.action === 'delete_user') {
    if (!body.user_id) return json({ error: 'Missing user_id.' }, 400);
    if (body.user_id === user.id) {
      return json({ error: 'To delete your own account, use Settings → Delete account.' }, 400);
    }
    const { data: target } = await admin.from('profiles').select('id').eq('id', body.user_id).maybeSingle();
    if (!target) return json({ error: 'That account no longer exists.' }, 404);
    // Same rule as suspending: removing another admin is a deliberate,
    // out-of-app step (take them out of app_admins first).
    const { data: targetIsAdmin } = await admin.from('app_admins').select('user_id').eq('user_id', body.user_id).maybeSingle();
    if (targetIsAdmin) return json({ error: "App admins' accounts can't be deleted from here." }, 403);
    return deleteAccount(admin, body.user_id);
  }

  return json({ error: 'Unknown action.' }, 400);
});

type AdminClient = ReturnType<typeof createClient>;

async function deleteAccount(admin: AdminClient, userId: string) {
  const { data: files, error: filesError } = await admin.rpc('account_storage_paths', { p_user: userId });
  if (filesError) return json({ error: filesError.message }, 500);

  const { data: summary, error: dataError } = await admin.rpc('delete_account_data', { p_user: userId });
  if (dataError) return json({ error: dataError.message }, 500);

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    return json({ error: `Their content was deleted, but the account itself wasn't: ${authError.message}. Try again.` }, 500);
  }

  // Best-effort: the account and everything pointing at these files are
  // already gone, so a failure here only leaves unreachable files behind.
  const byBucket = new Map<string, string[]>();
  for (const f of (files ?? []) as { bucket: string; path: string }[]) {
    byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  }
  let removed = 0;
  let failed = 0;
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { data, error } = await admin.storage.from(bucket).remove(chunk);
      if (error) failed += chunk.length;
      else removed += data?.length ?? 0;
    }
  }

  return json({ ok: true, summary, files: { removed, failed } });
}
