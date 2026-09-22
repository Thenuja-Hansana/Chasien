import { Linking } from 'react-native';

import { SUPPORT_EMAIL } from '@/constants/contact';

/**
 * Opens a new email to the Chasien team in the device's mail app.
 * Resolves false when nothing can handle a mailto: link (no mail app set
 * up), so the caller can show the address instead of failing silently.
 */
export function emailSupport(subject = 'Chasien support'): Promise<boolean> {
  return Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`)
    .then(() => true)
    .catch(() => false);
}
