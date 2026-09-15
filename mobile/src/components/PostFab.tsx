import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import Icon from '@/components/Icon';
import { Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';

export const FAB_SIZE = 54;

/**
 * "Post" no longer lives in the main tab bar (Home/Explore/Chats/You
 * only) — it only ever made sense inside a specific Room, so it's now a
 * round "+" button floating above the tab bar's right side, only on a
 * Room's own feed screen. Rendered as a sibling of `<TabBar>`, not inside
 * it — TabBar has no idea this exists. Positioned off the device's real
 * safe-area inset (not a hardcoded pixel guess — see decision-log,
 * 2026-09-02, for the bug that caused).
 */
export default function PostFab({ communityId }: { communityId: string }) {
  const colors = useTheme();
  const clearance = useTabBarClearance();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Link href={{ pathname: '/c/[communityId]/create-post', params: { communityId } }} asChild>
      {/* A single flattened style object, not an array — expo-router's
          <Link asChild> clones this Pressable through its own <Slot>,
          which (unlike a plain RN element) warns/errors on an array style. */}
      <Pressable style={StyleSheet.flatten([styles.fab, { bottom: clearance }])}>
        <Icon name="plus" size={24} color={colors.bg} />
      </Pressable>
    </Link>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    fab: {
      position: 'absolute',
      right: Spacing[4],
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 6,
    },
  });
