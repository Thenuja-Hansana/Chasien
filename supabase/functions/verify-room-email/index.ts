// The link inside a domain-verification email (request-room-verification
// sends it). Deliberately public — no Authorization header, no Chasien
// session required to click it, since the whole point is it might be
// opened from an email client on a different device or browser than the
// one that requested it. The token itself (a random UUID, mailed
// out-of-band to an address only its owner can read) is what stands in
// for authentication here, the same trust model Supabase Auth's own
// email-confirmation links use.
//
// Runs entirely as the service role: this is the one place that's
// allowed to write an approved room_memberships row outside of the
// room-membership Edge Function, and only because "a real, unexpired
// token that was mailed to a matching-domain address" is exactly the
// business rule this whole feature exists to enforce — decided here as
// code, same discipline every other room_memberships write already
// follows (see room-membership/index.ts's own top-of-file comment).

import { createClient } from 'npm:@supabase/supabase-js@2';

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chasien</title></head>
     <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 64px 24px; color: #171310;">
       ${body}
     </body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token');
  if (!token) {
    return page('<h2>Missing verification link.</h2>', 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: verification } = await admin
    .from('room_email_verifications')
    .select('id, room_id, user_id, email, verified_at, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!verification) {
    return page('<h2>This verification link is invalid.</h2>', 404);
  }

  const { data: room } = await admin.from('rooms').select('name, visibility, required_email_domain').eq('id', verification.room_id).maybeSingle();
  const roomName = room?.name ?? 'this Room';

  // Re-check the domain here too, not only in request-room-verification.
  // Clients used to be able to insert their own verification rows (any
  // email, self-chosen token) and this function trusted whatever row the
  // token matched — a full bypass of domain verification, found and closed
  // 2026-09-16 (see 20260916150000_lock_down_client_writable_columns.sql).
  // Only the service role can write these rows now, but a membership grant
  // shouldn't depend on that alone: the row must still name an address at
  // the Room's current required domain.
  const emailDomain = String(verification.email ?? '').trim().toLowerCase().split('@')[1];
  const requiredDomain = room?.required_email_domain?.toLowerCase();
  if (room?.visibility !== 'domain_verified' || !requiredDomain || emailDomain !== requiredDomain) {
    return page('<h2>This verification link is invalid.</h2><p>Go back to the app and request a new one.</p>', 403);
  }

  if (verification.verified_at) {
    return page(`<h2>Already verified</h2><p>You're a member of <strong>${roomName}</strong> — reopen the Chasien app to see it.</p>`);
  }
  if (new Date(verification.expires_at) < new Date()) {
    return page('<h2>This verification link has expired.</h2><p>Go back to the app and request a new one.</p>', 410);
  }

  await admin.from('room_email_verifications').update({ verified_at: new Date().toISOString() }).eq('id', verification.id);

  // Mirrors add_owner_membership_on_room_created's own reasoning for why
  // conversation_participants ends up correct automatically: inserting
  // an approved room_memberships row fires
  // sync_channel_participants_on_membership_change, which adds this
  // member to the Room's General channel the same way every other join
  // path already does — nothing domain-verification-specific needed here.
  await admin
    .from('room_memberships')
    .upsert({ room_id: verification.room_id, user_id: verification.user_id, role: 'member', join_state: 'approved' }, { onConflict: 'room_id,user_id' });

  return page(`<h2>You're verified!</h2><p>You've joined <strong>${roomName}</strong>. Reopen the Chasien app to see it.</p>`);
});
