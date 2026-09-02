// Phase 8: fired by a Database Webhook (20260902100200_notify_activity_webhook.sql)
// on every INSERT into `notifications` — mirrors notify-new-message
// (Phase 6) closely, but for the reply/like/mention/join_request/
// pinned_post types the notifications triggers create, not chat
// messages. Rooms already muted a recipient out of getting the
// notifications row at all (the triggers check that), so this function
// doesn't need to check mute again — if a row exists here, it was
// already meant to reach this user.

import { createClient } from 'npm:@supabase/supabase-js@2';

type WebhookPayload = {
  type: 'INSERT';
  table: 'notifications';
  record: {
    id: string;
    user_id: string;
    type: 'reply' | 'like' | 'mention' | 'join_request' | 'pinned_post' | 'message';
    actor_id: string | null;
    room_id: string | null;
    data: Record<string, unknown>;
  };
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function titleFor(type: string, actorName: string, roomName: string, likerCount: number) {
  switch (type) {
    case 'reply':
      return `${actorName} replied to your comment`;
    case 'like':
      return likerCount > 1 ? `${actorName} and ${likerCount - 1} others liked your post` : `${actorName} liked your post`;
    case 'mention':
      return `${actorName} mentioned you`;
    case 'join_request':
      return `${actorName} wants to join ${roomName}`;
    case 'pinned_post':
      return `New pinned post in ${roomName}`;
    default:
      return 'New activity';
  }
}

Deno.serve(async (req) => {
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { record } = payload;

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const [{ data: actor }, { data: room }, { data: tokens }] = await Promise.all([
    record.actor_id ? admin.from('profiles').select('name').eq('id', record.actor_id).maybeSingle() : Promise.resolve({ data: null }),
    record.room_id ? admin.from('rooms').select('name').eq('id', record.room_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('push_tokens').select('token').eq('user_id', record.user_id),
  ]);

  if (!tokens || tokens.length === 0) {
    return json({ ok: true, skipped: 'no registered devices' });
  }

  const likerCount = Array.isArray(record.data?.likerIds) ? (record.data.likerIds as unknown[]).length : 1;
  const title = titleFor(record.type, actor?.name ?? 'Someone', room?.name ?? 'a Room', likerCount);

  const messages = tokens.map((t) => ({
    to: t.token,
    title,
    body: record.type === 'pinned_post' ? '' : room?.name ?? '',
    data: { notificationType: record.type, ...record.data },
  }));

  const pushResponse = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  const pushResult = await pushResponse.json().catch(() => null);
  return json({ ok: true, sent: messages.length, expo: pushResult });
});
