import { BlurView } from 'expo-blur';
import { Link, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type RefObject } from 'react';
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
  /**
   * A ref to the `BlurTargetView` wrapping this screen's own scrollable
   * content — required on Android for the bar's blur to actually blur
   * anything (see BlurView.types' own doc comment: without a blurTarget,
   * the native side silently falls back to a plain translucent view, no
   * blur).
   */
  blurTarget?: RefObject<View | null>;
};

function useTabs(communityId: string | undefined, userId: string): { label: TabLabel; icon: 'homeTab' | 'exploreTab' | 'chatsTab' | 'youTab'; href: Href }[] {
  return [
    { label: 'Home', icon: 'homeTab', href: communityId ? { pathname: '/c/[communityId]', params: { communityId } } : '/' },
    { label: 'Explore', icon: 'exploreTab', href: '/discover' },
    { label: 'Chats', icon: 'chatsTab', href: '/chats' },
    { label: 'You', icon: 'youTab', href: { pathname: '/u/[userId]', params: { userId } } },
  ];
}

export default function TabBar({ active, communityId, userId, blurTarget }: TabBarProps) {
  const tabs = useTabs(communityId, userId);
  const { mode, colors } = useThemeContext();
  // The device's real home-indicator/gesture-nav height, not a hardcoded
  // per-platform guess — a fixed 80 (theme.ts's old BottomTabInset) reads
  // fine on the emulator it was tuned against but is wrong on plenty of
  // real hardware (a 3-button nav Samsung needs far less than a
  // gesture-nav iPhone, and even gesture-nav height varies by device).
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);

  return (
    <BlurView
      style={styles.bar}
      tint={mode === 'dark' ? 'dark' : 'light'}
      // Counter-intuitive on Android's dimezis blur methods: a LOWER
      // intensity produced a darker, more opaque-looking scrim, not a
      // lighter one — confirmed empirically (78 and 30 both read as flat
      // gray; 100 is the value that actually looks like light glass in
      // both themes). Don't "fix" this back down without checking on a
      // real device first.
      intensity={100}
      // Real frosted blur on Android needs a `blurTarget` (a ref to the
      // BlurTargetView wrapping whatever should show through) — without
      // one, the native side silently drops to a plain translucent view.
      // iOS ignores this prop entirely; its own system material always
      // blurs whatever's genuinely behind the view.
      blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
      blurTarget={blurTarget}
    >
      {/* A flat blur alone can't be told apart from a plain translucent
          box once whatever's behind it is a single flat colour — which is
          exactly what sat behind this bar on Home/Chats/You and in dark
          mode generally, reading as "just gray" instead of glass. Apple's
          own Liquid Glass reads as glass largely because of a specular
          highlight and a lit rim that stay visible regardless of what's
          behind the material — this gradient and the hairline border
          below are a static stand-in for that, so the bar looks the same
          material on every screen instead of only where it happens to
          have colourful content to blur. */}
      <LinearGradient
        colors={mode === 'dark' ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)'] : ['rgba(255,255,255,0.65)', 'rgba(255,255,255,0.08)']}
        locations={[0, 0.7]}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {tabs.map((tab) => {
        const isActive = tab.label === active;
        const color = isActive ? colors.accent.DEFAULT : `${colors.text}6B`;
        // Filled counterpart on activation, not just a color swap — see
        // Icon.tsx's homeTabFilled/etc.
        const iconName = isActive ? (`${tab.icon}Filled` as const) : tab.icon;
        return (
          <Link key={tab.label} href={tab.href} asChild style={styles.tab}>
            <Pressable>
              <View style={styles.tabContent}>
                <Icon name={iconName} size={22} color={color} />
                <Text style={[styles.label, { color }]}>{tab.label}</Text>
              </View>
            </Pressable>
          </Link>
        );
      })}
      {/* The rim itself: a hairline border painted as a sibling on top of
          the native blur child, not as this View's own `borderColor` —
          same reasoning as the `backgroundColor` note below, a border set
          directly on the BlurView is a background-layer property and gets
          painted underneath NativeBlurView on Android too. */}
      <View pointerEvents="none" style={[styles.rim, { borderColor: mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)' }]} />
    </BlurView>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) => StyleSheet.create({
  // A floating pill, not an edge-to-edge rectangle — Telegram-style,
  // with daylight on both sides and above the safe-area edge, rather
  // than a bar flush against all three. Floats over the screen's own
  // content (the way Apple's real tab bars work) rather than occupying
  // its own row in the layout, which is what actually lets it have
  // anything to blur, and lets content peek through as it scrolls
  // underneath. Every screen that renders <TabBar> needs matching bottom
  // clearance on its own scrollable content — see
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
    paddingTop: Spacing[2],
    paddingHorizontal: Spacing[3],
    paddingBottom: 6,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    // Only matters as a fallback fill for the rare case blurMethod ends
    // up "none" (no blurTarget wired, or an Android version below 31) —
    // when the native blur is actually running, this layer paints
    // *underneath* NativeBlurView and isn't visibly distinguishable at
    // any opacity (confirmed on-device: changing this alone, alpha 80%
    // down to 40%, produced no visible difference). The "too gray on
    // Home" issue this alpha was originally lowered for turned out to be
    // the BlurView's own `intensity` above, not this.
    backgroundColor: `${colors.surface}66`,
    ...Shadows.md,
  },
  rim: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  tab: {
    // Fixed, not flex:1 — a flex tab stretches to fill the bar's full
    // width, spreading its icon out to wherever that slot's center lands.
    // A fixed width lets `bar`'s justifyContent:'center' cluster all four
    // tabs together in the middle instead.
    width: 58,
    alignItems: 'center',
  },
  tabContent: {
    alignItems: 'center',
    gap: 3,
    paddingTop: 4,
  },
  label: {
    fontFamily: Fonts?.bodyBold,
    fontSize: 8.5,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});

