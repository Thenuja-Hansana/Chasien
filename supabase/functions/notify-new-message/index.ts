// Fired by a Database Webhook (supabase/migrations/20260815002723_notify_new_message_webhook.sql)
// on every INSERT into `messages`. Not user-invoked — there is no
// caller identity to establish here, unlike room-membership; this
// function only ever needs the service-role client, to look up the
// message's other participants and their push tokens across accounts
// the trigger itself has no business being scoped to any one of.

import { createClient } from 'npm:@supabase/supabase-js@2';

type WebhookPayload = {
  type: 'INSERT';
  table: 'messages';
  record: {
    id: string;
    conversation_id: string;
    author_id: string | null;
    text: string | null;
    image_url: string | null;
    voice_url: string | null;
  };
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function previewFor(record: WebhookPayload['record']) {
  if (record.text) return record.text.length > 120 ? `${record.text.slice(0, 117)}...` : record.text;
  if (record.image_url) return '📷 Photo';
  if (record.voice_url) return '🎤 Voice message';
  return 'New message';
}

Deno.serve(async (req) => {
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { record } = payload;
  if (!record?.author_id) {
    // Author account was deleted between the insert and this call (SET
    // NULL on messages.author_id) — nothing meaningful left to notify
    // anyone about who sent it.
    return json({ ok: true, skipped: 'no author' });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const [{ data: author }, { data: recipients }] = await Promise.all([
    admin.from('profiles').select('name').eq('id', record.author_id).maybeSingle(),
    admin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', record.conversation_id)
      .eq('muted', false)
      .neq('user_id', record.author_id),
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
    body: previewFor(record),
    data: { conversationId: record.conversation_id, messageId: record.id },
  }));

  const pushResponse = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  const pushResult = await pushResponse.json().catch(() => null);
  return json({ ok: true, sent: messages.length, expo: pushResult });
});
