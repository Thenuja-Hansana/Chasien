// Sends the "verify your institutional email" message for a
// domain_verified Room (rooms.visibility) — see
// supabase/migrations/20260908130100_domain_verification_schema.sql for
// the schema this reads/writes.
//
// The domain check has to happen here, server-side, not just in the
// client form: anyone can type any email into a text field, so the only
// thing that actually proves someone controls a `@theirschool.edu`
// address is receiving mail there and clicking a real link — this
// function is what makes that link exist and get sent, and it's the
// one place that enforces the domain actually matches before doing so.
//
// Local dev sends real SMTP to the same Mailpit/Inbucket container
// Supabase Auth's own emails already land in (localhost:54324) — no
// separate mail provider account needed to test this. `SMTP_HOST`/
// `SMTP_PORT` are overridable via env for the real-SMTP swap Phase 11
// will eventually need, same one-file-seam pattern the Storage-to-R2
// swap already uses elsewhere in this codebase.

import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

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

async function sendVerificationEmail(to: string, roomName: string, verifyUrl: string) {
  const transport = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') ?? 'inbucket',
    port: Number(Deno.env.get('SMTP_PORT') ?? '1025'),
    secure: false,
    ignoreTLS: true,
  });
  await transport.sendMail({
    from: 'Chasien <noreply@chasien.app>',
    to,
    subject: `Verify your email to join ${roomName}`,
    html: `
      <p>You're one step from joining <strong>${roomName}</strong> on Chasien.</p>
      <p>Click below to confirm this email address and join the Room:</p>
      <p><a href="${verifyUrl}">Verify and join ${roomName}</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can ignore it.</p>
    `,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  const { room_id, email } = (await req.json().catch(() => ({}))) as { room_id?: string; email?: string };
  if (!room_id || !email || typeof email !== 'string') {
    return json({ error: 'room_id and email are required.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: room } = await admin
    .from('rooms')
    .select('id, name, visibility, required_email_domain')
    .eq('id', room_id)
    .maybeSingle();
  if (!room) {
    return json({ error: 'Room not found.' }, 404);
  }
  if (room.visibility !== 'domain_verified' || !room.required_email_domain) {
    return json({ error: 'This Room does not use email domain verification.' }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@')[1];
  if (!domain || domain !== room.required_email_domain.toLowerCase()) {
    return json({ error: `Please use an email address ending in @${room.required_email_domain}.` }, 400);
  }

  const { data: existingMembership } = await admin
    .from('room_memberships')
    .select('join_state')
    .eq('room_id', room_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existingMembership?.join_state === 'approved') {
    return json({ error: 'You are already a member of this Room.' }, 409);
  }

  const token = crypto.randomUUID();
  const { error: upsertError } = await admin.from('room_email_verifications').upsert(
    {
      room_id,
      user_id: user.id,
      email: normalizedEmail,
      token,
      verified_at: null,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'room_id,user_id' },
  );
  if (upsertError) {
    return json({ error: upsertError.message }, 400);
  }

  // Deliberately not built from SUPABASE_URL: inside the Edge Function
  // that resolves to the internal Docker network address (kong:8000),
  // reachable from other containers but not from an actual email client
  // opening this link from outside. PUBLIC_FUNCTIONS_URL is the
  // externally-reachable equivalent — the hosted project's real URL once
  // Phase 11 exists, and localhost's own published port until then.
  const publicFunctionsUrl = Deno.env.get('PUBLIC_FUNCTIONS_URL') ?? 'http://127.0.0.1:54321/functions/v1';
  const verifyUrl = `${publicFunctionsUrl}/verify-room-email?token=${token}`;

  try {
    await sendVerificationEmail(normalizedEmail, room.name, verifyUrl);
  } catch {
    return json({ error: 'Could not send the verification email — try again.' }, 500);
  }

  return json({ ok: true });
});
