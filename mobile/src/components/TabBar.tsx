import { BlurView } from 'expo-blur';
import { Link, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radius, Shadows, Spacing, TabBarFloatingGap, type ThemeColors } from '@/constants/theme';
import { useThemeContext } from '@/lib/theme-context';
import Icon from './Icon';

// Ported from app_reference/src/components/TabBar.jsx. Not an Expo Router
// `Tabs` layout — like the mock, this is a plain component each top-level
// screen renders itself, since its destinations depend on the *current*
// Room/user, not a fixed set of routes Expo Router's tab primitive expects.
//
// "Post" used to live here as a fifth tab, disabled outside a Room. It's
// gone from the main bar now — creating a post only ever makes sense
// inside a specific Room, so it moved to `PostFab`, a small pill that
// floats on top of this bar and only renders on a Room's own feed screen.
type TabLabel = 'Home' | 'Explore' | 'Chats' | 'You';

type TabBarProps = {
  active: TabLabel;
  /** Current Room id — the Home tab falls back to "/" without one. */
  communityId?: string;
  userId: string;
};

function useTabs(communityId: string | undefined, userId: string): { label: TabLabel; icon: 'homeTab' | 'exploreTab' | 'chatsTab' | 'youTab'; href: Href }[] {
  return [
    { label: 'Home', icon: 'homeTab', href: communityId ? { pathname: '/c/[communityId]', params: { communityId } } : '/' },
    { label: 'Explore', icon: 'exploreTab', href: '/discover' },
    { label: 'Chats', icon: 'chatsTab', href: '/chats' },
    { label: 'You', icon: 'youTab', href: { pathname: '/u/[userId]', params: { userId } } },
  ];
}

export default function TabBar({ active, communityId, userId }: TabBarProps) {
  const tabs = useTabs(communityId, userId);
  const { mode, colors } = useThemeContext();
  // The device's real home-indicator/gesture-nav height, not a hardcoded
  // per-platform guess — a fixed 80 (theme.ts's old BottomTabInset) reads
  // fine on the emulator it was tuned against but is wrong on plenty of
  // real hardware (a 3-button nav Samsung needs far less than a
  // gesture-nav iPhone, and even gesture-nav height varies by device).
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);

  // The icons and labels, identical on both platforms; only the material
  // behind them differs (below).
  const tabItems = tabs.map((tab) => {
    const isActive = tab.label === active;
    const color = isActive ? colors.accent.DEFAULT : `${colors.text}6B`;
    // Filled counterpart on activation, not just a color swap — see
    // Icon.tsx's homeTabFilled/etc.
    const iconName = isActive ? (`${tab.icon}Filled` as const) : tab.icon;
    return (
      <Link key={tab.label} href={tab.href} asChild style={styles.tab}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: isActive }}>
          <View style={styles.tabContent}>
            <Icon name={iconName} size={25} color={color} />
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </View>
        </Pressable>
      </Link>
    );
  });

  // A static stand-in for the specular highlight real glass would have, so
  // the bar reads as the same material on every screen, not just where
  // there's colourful content behind it.
  const highlight = (
    <LinearGradient
      colors={mode === 'dark' ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)'] : ['rgba(255,255,255,0.35)', 'rgba(255,255,255,0.05)']}
      locations={[0, 0.7]}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    />
  );

  // Android: no live blur. The frosted look used Dimezis BlurView with the
  // screen's content as its blur target, which re-captured and re-blurred
  // that content on every frame it moved — measured on a Galaxy A14 as the
  // single biggest cost of scrolling the feed (median frame 34 → 26 ms, 90th
  // percentile 69 → 46 ms with it off, production JS bundle). A nearly
  // opaque surface keeps the icons readable over photos, and it costs
  // nothing per frame. See the decision log, "Tab bar: no live blur on
  // Android".
  if (Platform.OS === 'android') {
    return (
      <View style={[styles.bar, styles.androidGlass]}>
        {highlight}
        {tabItems}
      </View>
    );
  }

  // iOS: the system material blurs whatever is behind the bar natively and
  // cheaply.
  return (
    <BlurView style={styles.bar} tint={mode === 'dark' ? 'dark' : 'light'} intensity={100}>
      {/* Blurring an all-white screen with a light tint just produces more
          white; this scrim gives the light bar some contrast. Dark mode
          already reads clearly against dark screens, so it's a no-op there. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: mode === 'dark' ? 'transparent' : 'rgba(17,17,17,0.11)' }]}
      />
      {highlight}
      {tabItems}
    </BlurView>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) => StyleSheet.create({
  // A floating pill, not an edge-to-edge rectangle — Telegram-style,
  // with daylight on both sides and above the safe-area edge, rather
  // than a bar flush against all three. Floats over the screen's own
  // content (the way Apple's real tab bars work) rather than occupying
  // its own row in the layout, which is what gives iOS's blur something
  // to blur and lets content pass underneath as it scrolls. Every screen
  // that renders <TabBar> needs matching bottom clearance on its own
  // scrollable content — see
  // hooks/use-tab-bar-clearance.ts — so its last item doesn't end up
  // hidden behind the bar or in the new gap below it.
  bar: {
    position: 'absolute',
    // Wider side margins than before — narrows the pill itself, on top of
    // `tab`'s own fixed (not flex:1) width below clustering the four tabs
    // together rather than spreading them across the full band.
    left: 48,
    right: 48,
    bottom: bottomInset + TabBarFloatingGap,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
    // Nudged up from Spacing[2]/6 — a modest bump (not the old chunky
    // icon-28/label-9.5 bar this was sized down from, see
    // TabBarContentHeight's own comment) asked for specifically to make
    // the bar easier to tap and read for older/less tech-savvy users.
    paddingTop: 10,
    paddingHorizontal: Spacing[3],
    paddingBottom: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    // iOS: a light fill under the system blur.
    backgroundColor: `${colors.surface}66`,
    ...Shadows.md,
  },
  // Android has no blur behind the bar, so the fill has to carry it: the
  // surface colour at 97%. Unblurred content shows through sharply, so any
  // lower and text scrolling underneath starts competing with the icons
  // (checked on the A14 in both themes).
  androidGlass: {
    backgroundColor: `${colors.surface}F7`,
  },
  tab: {
    // Fixed, not flex:1 — a flex tab stretches to fill the bar's full
    // width, spreading its icon out to wherever that slot's center lands.
    // A fixed width lets `bar`'s justifyContent:'center' cluster all four
    // tabs together in the middle instead.
    width: 62,
    alignItems: 'center',
  },
  tabContent: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 5,
  },
  label: {
    fontFamily: Fonts?.bodyBold,
    fontSize: 9.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});

