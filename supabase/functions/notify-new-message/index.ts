// Fired by a Database Webhook (supabase/migrations/20260815002723_notify_new_message_webhook.sql)
// on every INSERT into `messages`. Not user-invoked — there is no
// caller identity to establish here, unlike room-membership; this
// function only ever needs the service-role client, to look up the
// message's other participants and their push tokens across accounts
// the trigger itself has no business being scoped to any one of.
//
// Phase 10: nothing from the request body is trusted except the row's id.
// The only gate on this endpoint is a valid JWT, and the anon key that
// ships inside every build is one, so a caller could otherwise have pushed
// their own wording to every member of a chat. The message is read from
// the database instead, and claimed first (`pushed_at`), so a forged call
// can at most ask for a push that was about to be sent anyway, and a
// second call for the same message does nothing. See
// 20260923100000_push_claimed_from_the_row.sql.

import { createClient } from 'npm:@supabase/supabase-js@2';

type Message = {
  id: string;
  conversation_id: string;
  author_id: string | null;
  text: string | null;
  image_url: string | null;
  voice_url: string | null;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function previewFor(message: Message) {
  if (message.text) return message.text.length > 120 ? `${message.text.slice(0, 117)}...` : message.text;
  if (message.image_url) return '📷 Photo';
  if (message.voice_url) return '🎤 Voice message';
  return 'New message';
}

/** The webhook posts the whole row; only its id is used. */
function messageIdFrom(body: unknown): string | null {
  const payload = body as { record?: { id?: unknown }; id?: unknown } | null;
  const id = payload?.record?.id ?? payload?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

Deno.serve(async (req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const messageId = messageIdFrom(body);
  if (!messageId) {
    return json({ error: 'Missing message id.' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Claim and read in one statement: whoever sets pushed_at first is the
  // one that sends. An unknown id, or one already pushed, updates nothing.
  const { data: message, error: claimError } = await admin
    .from('messages')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', messageId)
    .is('pushed_at', null)
    .select('id, conversation_id, author_id, text, image_url, voice_url')
    .maybeSingle<Message>();

  if (claimError) return json({ error: claimError.message }, 500);
  if (!message) return json({ ok: true, skipped: 'already pushed, or no such message' });

  if (!message.author_id) {
    // Author account was deleted between the insert and this call (SET
    // NULL on messages.author_id) — nothing meaningful left to notify
    // anyone about who sent it.
    return json({ ok: true, skipped: 'no author' });
  }

  const [{ data: author }, { data: recipients }] = await Promise.all([
    admin.from('profiles').select('name').eq('id', message.author_id).maybeSingle(),
    admin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', message.conversation_id)
      .eq('muted', false)
      .neq('user_id', message.author_id),
  ]);

  if (!recipients || recipients.length === 0) {
    return json({ ok: true, skipped: 'no recipients' });
  }

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('token')
    .in(
      'user_id',
      recipients.map((r) => r.user_id),
    );

  if (!tokens || tokens.length === 0) {
    return json({ ok: true, skipped: 'no registered devices' });
  }

  const messages = tokens.map((t) => ({
    to: t.token,
    title: author?.name ?? 'New message',
    body: previewFor(message),
    data: { conversationId: message.conversation_id, messageId: message.id },
    // 'high', not Expo's default: on Android the default is FCM "normal"
    // priority, which Doze holds while the phone is locked and idle. On
    // the Galaxy A14 in forced deep idle, a normal push was still waiting
    // after 60s (it arrived only once the phone left idle); a high one
    // arrived within 5s. Every push here is a visible notification, which
    // is what FCM expects high priority to be used for.
    priority: 'high',
  }));

  const pushResponse = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  }).catch(() => null);

  if (!pushResponse) {
    // Expo itself was unreachable. Give the claim back, so this message can
    // be pushed if the call is retried; the alternative is losing it
    // silently.
    await admin.from('messages').update({ pushed_at: null }).eq('id', message.id);
    return json({ error: "Couldn't reach the push service." }, 502);
  }

  const pushResult = await pushResponse.json().catch(() => null);
  return json({ ok: true, sent: messages.length, expo: pushResult });
});
