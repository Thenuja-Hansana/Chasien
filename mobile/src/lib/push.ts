import Constants, { AppOwnership } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * `expo-notifications` is imported dynamically everywhere in this file,
 * never as a static top-level import. As of SDK 53, merely *importing*
 * the module throws an uncaught error on Android when running inside
 * Expo Go — not just calling a push-specific function — confirmed by
 * running this exact app in Expo Go on a real Android emulator (a
 * static import here took down the whole app at launch, before any of
 * this file's own guards ever ran). A development build doesn't have
 * this restriction; only the shared Expo Go client does. See
 * docs/decision-log.md, "Expo Go can't do push at all since SDK 53."
 */
const isExpoGo = Constants.appOwnership === AppOwnership.Expo;

/**
 * Registers this device for push notifications and upserts its Expo
 * push token into `push_tokens` (send side: supabase/functions/notify-new-message,
 * triggered by 20260815002723_notify_new_message_webhook.sql on every
 * new message).
 *
 * `getExpoPushTokenAsync()` requires a real EAS project id — there is no
 * way around this even for development-build testing, unlike the
 * Firebase/FCM question (which only affects standalone/production
 * Android builds). See docs/decision-log.md, "Push notifications need
 * an EAS project." Returns null and does nothing further if no project
 * id is configured, or the device is Expo Go, rather than throwing —
 * call sites treat "push isn't available yet" as a normal, silent
 * no-op, not an error condition worth surfacing to a user.
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (!Device.isDevice || isExpoGo) {
    // Push tokens are meaningless in the web/simulator context (no
    // device to deliver to) and unobtainable in Expo Go (see above) —
    // neither is an error, just nothing to register yet.
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return null;
  }

  const Notifications = await import('expo-notifications');

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') {
    return null;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token, platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web' },
      { onConflict: 'token' },
    );
  if (error) throw error;

  return token;
}

/**
 * Foreground display config — without this, a notification that arrives
 * while the app is already open is delivered silently to the listener
 * but never shown as a banner, which looks like push "not working" when
 * it's actually just this handler defaulting to hidden. shouldShowBanner/
 * shouldShowList (not the deprecated shouldShowAlert) is the current
 * SDK 57 shape — checked against the versioned docs rather than assumed,
 * since this exact property set has changed across SDK versions.
 */
export function configureForegroundNotificationHandler() {
  if (isExpoGo) return;
  import('expo-notifications').then((Notifications) => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  });
}

/**
 * Tapping a delivered notification hands back its raw `data` payload —
 * generic rather than chat-specific, since notify-new-message's payload
 * shape (`{ conversationId }`) and notify-activity's (Phase 8;
 * `{ notificationType, postId?, commentId?, targetUserId?, roomId? }`)
 * differ, and this module has no business knowing either shape or which
 * screen either one routes to — that's the caller's job (see
 * app/_layout.tsx). Kept synchronous (returns a cleanup function
 * immediately, as the useEffect calling this expects) even though the
 * underlying listener is attached after a dynamic import resolves —
 * `cancelled` covers the case where the component unmounts before that
 * import settles.
 */
export function subscribeToNotificationTaps(onTap: (data: Record<string, unknown>) => void) {
  if (isExpoGo) return () => {};

  let cancelled = false;
  let subscription: { remove: () => void } | undefined;
  import('expo-notifications').then((Notifications) => {
    if (cancelled) return;
    subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data) onTap(data);
    });
  });

  return () => {
    cancelled = true;
    subscription?.remove();
  };
}
