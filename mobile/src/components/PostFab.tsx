import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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

  // A small press-down squish, released on lift/cancel either way — lives
  // on the inner circle, not the outer Pressable Link's <Slot> clones (see
  // that Pressable's own comment on why its style has to stay one flat
  // object). Animation polish pass, 2026-09-15.
  const scale = useSharedValue(1);
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pressIn = () => {
    // eslint-disable-next-line react-hooks/immutability -- a Reanimated shared value's .value is deliberately mutable, the same escape hatch Skeleton.tsx's Animated.Value ref already needs — the compiler's static analysis has no way to know that.
    scale.value = withTiming(0.88, { duration: 80 });
  };
  const pressOut = () => {
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withTiming(1, { duration: 120 });
  };

  return (
    <Link href={{ pathname: '/c/[communityId]/create-post', params: { communityId } }} asChild>
      {/* A single flattened style object, not an array — expo-router's
          <Link asChild> clones this Pressable through its own <Slot>,
          which (unlike a plain RN element) warns/errors on an array style.
          Only a hit-target here now; the visible circle moved to the
          Animated.View child below so it's free to carry its own
          (array-valued) animated style. */}
      <Pressable
        style={StyleSheet.flatten([styles.fabHit, { bottom: clearance }])}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel="New post"
      >
        <Animated.View style={[styles.fab, scaleStyle]}>
          <Icon name="plus" size={24} color={colors.bg} />
        </Animated.View>
      </Pressable>
    </Link>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    fabHit: {
      position: 'absolute',
      right: Spacing[4],
      width: FAB_SIZE,
      height: FAB_SIZE,
    },
    fab: {
      width: '100%',
      height: '100%',
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
