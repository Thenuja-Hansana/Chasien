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
    type: 'reply' | 'like' | 'mention' | 'join_request' | 'pinned_post' | 'new_post' | 'new_story' | 'message' | 'tag' | 'report_filed';
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
    case 'tag':
      return `${actorName} tagged you in a post`;
    case 'join_request':
      return `${actorName} wants to join ${roomName}`;
    case 'pinned_post':
      return `New pinned post in ${roomName}`;
    case 'new_post':
      return `${actorName} posted in ${roomName}`;
    case 'new_story':
      return `${actorName} added a story in ${roomName}`;
    // Phase 9: an app admin's alert for a new report
    // (20260921120100_reports.sql). No actor on purpose — the reporter
    // isn't named in a push.
    case 'report_filed':
      return 'New report to review';
    default:
      return 'New activity';
  }
}

// The report's reason and what kind of thing was reported — the only
// report details a push carries. The content itself stays in the app,
// behind the admin-only Reports screen.
const REASON_LABEL: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  sexual: 'Nudity or sexual content',
  violence: 'Violence or threats',
  self_harm: 'Self-harm',
  illegal: 'Something illegal',
  other: 'Something else',
};

function reportBody(data: Record<string, unknown>) {
  const reason = REASON_LABEL[String(data.reason)] ?? 'A report';
  return `${reason} · a ${String(data.targetType ?? 'post')}`;
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
    body:
      record.type === 'report_filed'
        ? reportBody(record.data)
        : record.type === 'pinned_post'
          ? ''
          : (room?.name ?? ''),
    data: { notificationType: record.type, ...record.data },
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
  });

  const pushResult = await pushResponse.json().catch(() => null);
  return json({ ok: true, sent: messages.length, expo: pushResult });
});
