import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Registers this device for push notifications and upserts its Expo
 * push token into `push_tokens` (send side: supabase/functions/notify-new-message,
 * triggered by 20260815002723_notify_new_message_webhook.sql on every
 * new message).
 *
 * `getExpoPushTokenAsync()` requires a real EAS project id — there is no
 * way around this even for Expo Go testing, unlike the Firebase/FCM
 * question (which only affects standalone/production Android builds).
 * See docs/decision-log.md, "Push notifications need an EAS project."
 * Returns null and does nothing further if no project id is configured
 * yet, rather than throwing — call sites treat "push isn't set up" as a
 * normal, silent no-op, not an error condition worth surfacing to a user
 * who's simply using the app before that one-time setup step has run.
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (!Device.isDevice) {
    // Push tokens are meaningless in the web/simulator context — there's
    // no device to deliver to. Not an error, just nothing to register.
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return null;
  }

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
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Tapping a delivered notification opens the conversation it was about — the payload's `data.conversationId` comes from notify-new-message. */
export function subscribeToNotificationTaps(onTap: (conversationId: string) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const conversationId = response.notification.request.content.data?.conversationId;
    if (typeof conversationId === 'string') onTap(conversationId);
  });
  return () => subscription.remove();
}
