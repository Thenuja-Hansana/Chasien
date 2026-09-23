// Phase 8: fired by a Database Webhook (20260902100200_notify_activity_webhook.sql)
// on every INSERT into `notifications` — mirrors notify-new-message
// (Phase 6) closely, but for the reply/like/mention/join_request/
// pinned_post types the notifications triggers create, not chat
// messages. Rooms already muted a recipient out of getting the
// notifications row at all (the triggers check that), so this function
// doesn't need to check mute again — if a row exists here, it was
// already meant to reach this user.
//
// Phase 10: nothing from the request body is trusted except the row's id.
// The only gate on this endpoint is a valid JWT, and the anon key that
// ships inside every build is one, so a caller could otherwise have pushed
// made-up notifications to any account. The notification is read from the
// database instead, and claimed first (`pushed_at`), so a forged call can
// at most ask for a push that was about to be sent anyway, and a second
// call for the same row does nothing. See
// 20260923100000_push_claimed_from_the_row.sql.

import { createClient } from 'npm:@supabase/supabase-js@2';

type Notification = {
  id: string;
  user_id: string;
  type: 'reply' | 'like' | 'mention' | 'join_request' | 'pinned_post' | 'new_post' | 'new_story' | 'message' | 'tag' | 'report_filed';
  actor_id: string | null;
  room_id: string | null;
  data: Record<string, unknown>;
};

/** The webhook posts the whole row; only its id is used. */
function notificationIdFrom(body: unknown): string | null {
  const payload = body as { record?: { id?: unknown }; id?: unknown } | null;
  const id = payload?.record?.id ?? payload?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const notificationId = notificationIdFrom(body);
  if (!notificationId) {
    return json({ error: 'Missing notification id.' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Claim and read in one statement: whoever sets pushed_at first is the
  // one that sends. An unknown id, or one already pushed, updates nothing.
  const { data: record, error: claimError } = await admin
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('pushed_at', null)
    .select('id, user_id, type, actor_id, room_id, data')
    .maybeSingle<Notification>();

  if (claimError) return json({ error: claimError.message }, 500);
  if (!record) return json({ ok: true, skipped: 'already pushed, or no such notification' });

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
  }).catch(() => null);

  if (!pushResponse) {
    // Expo itself was unreachable. Give the claim back, so this
    // notification can be pushed if the call is retried; the alternative
    // is losing it silently.
    await admin.from('notifications').update({ pushed_at: null }).eq('id', record.id);
    return json({ error: "Couldn't reach the push service." }, 502);
  }

  const pushResult = await pushResponse.json().catch(() => null);
  return json({ ok: true, sent: messages.length, expo: pushResult });
});
