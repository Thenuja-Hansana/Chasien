import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radius, Shadows, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CreateTab = 'post' | 'clip' | 'poll' | 'event';

const TABS: { key: CreateTab; label: string }[] = [
  { key: 'post', label: 'Post' },
  { key: 'clip', label: 'Clip' },
  { key: 'poll', label: 'Poll' },
  { key: 'event', label: 'Event' },
];

/**
 * How much bottom padding a tab's own ScrollView content needs so its last
 * field doesn't end up hidden behind this floating pill — mirrors
 * `hooks/use-tab-bar-clearance.ts`'s role for the main TabBar. A fixed
 * value (not the live inset) is fine here since it only pads *content*,
 * not the bar's own position — being a little generous costs nothing.
 */
export const CREATE_TAB_SWITCHER_CLEARANCE = 96;

/**
 * The create modal's own bottom nav — Instagram's POST/STORY/REEL/LIVE
 * strip, adapted to this app's four creation kinds, floating the same way
 * TabBar.tsx's main bottom nav does (daylight on all sides, not flush
 * against an edge) rather than a flat bar with a top border. Deliberately
 * tap-only, not swipeable — see TabBar.tsx's own comment on why even the
 * *main* bottom nav isn't Expo Router's `Tabs` primitive: there's no pager
 * library in this app, and four discrete forms with their own validation
 * don't need paging where a tap is unambiguous.
 */
export default function CreateTabSwitcher({
  active,
  onChange,
  disabled,
}: {
  active: CreateTab;
  onChange: (tab: CreateTab) => void;
  disabled: boolean;
}) {
  const colors = useTheme();
  // A `position: 'absolute'` child measures its offsets from its parent's
  // outer (padding-included) edge, not the parent's own padded content
  // box — so this bar being a sibling inside create-post.tsx's
  // SafeAreaView does NOT inherit that SafeAreaView's bottom safe-area
  // padding for free. It needs the live inset itself, same as TabBar.tsx's
  // own floating pill does. (A build without this landed the bar flush
  // against — or under — the device's gesture/button nav, invisible in
  // practice; see decision-log.)
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);

  return (
    // A full-width, non-visible wrapper centers the actual pill below —
    // the pill itself has no `flex: 1` tabs and no left/right anchoring,
    // so it hugs its own content width instead of stretching edge to edge.
    // `pointerEvents="box-none"` lets taps outside the pill (but still
    // inside this wrapper's full-width hit area) fall through to whatever
    // is underneath, rather than this transparent strip swallowing them.
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onChange(tab.key)}
              disabled={disabled}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: bottomInset + Spacing[6],
      alignItems: 'center',
    },
    bar: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: Radius.pill,
      padding: 4,
      gap: 2,
      ...Shadows.lg,
    },
    tab: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: {
      backgroundColor: colors.bg,
    },
    label: {
      fontFamily: Fonts.bodyBold,
      fontSize: 11,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: colors.neutral[500],
    },
    labelActive: {
      color: colors.accent.DEFAULT,
    },
  });
