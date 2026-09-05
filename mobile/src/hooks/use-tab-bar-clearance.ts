import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing, TabBarContentHeight, TabBarFloatingGap } from '@/constants/theme';

/**
 * How much bottom clearance a screen's own scrollable content (or a
 * floating button like PostFab) needs to avoid ending up hidden behind
 * — or in the gap below — TabBar's floating pill. Combines the device's
 * real safe-area inset with TabBar's own fixed dimensions, so every
 * screen asks one place for this number instead of re-deriving the same
 * formula (and risking it drifting out of sync with TabBar's actual
 * layout).
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + TabBarFloatingGap + TabBarContentHeight + Spacing[3];
}
