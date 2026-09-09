/**
 * Chasien design tokens.
 *
 * Bones Phase: replaced the single "Organic" dark palette with a
 * black/white/gray brand system, in two modes (Light/Dark). Every
 * mode-dependent value lives in `LightColors` / `DarkColors`, both the
 * same shape so a screen written against `ThemeColors` never needs to
 * know which mode is active — see `lib/theme-context.tsx` and
 * `hooks/use-theme.ts` for how a component actually gets one of these.
 *
 * `neutral`'s 100-900 steps deliberately run light-to-dark in
 * `LightColors` and dark-to-light in `DarkColors` (not mirrored) so
 * that call sites needing "a light tone" and "a dark tone" can keep
 * using the same numeric step in both modes — e.g. Avatar's gradients
 * ask for `neutral[700]`/`neutral[900]` and get a dark pair in Light
 * mode, a light pair in Dark mode, without Avatar itself knowing which
 * mode is active.
 */

type ColorScale = {
  DEFAULT: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
};

export type ThemeColors = {
  bg: string;
  surface: string;
  text: string;
  divider: string;
  neutral: Omit<ColorScale, 'DEFAULT'>;
  accent: ColorScale;
  accent2: ColorScale;
  /**
   * The one color outside the black/white/gray system — reserved solely
   * for errors and destructive actions (failed requests, delete
   * confirmations). Never used for likes, links, badges, or anything
   * else the accent already covers; see the design audit's "Fixes at a
   * glance" — before this, error text rendered in the same black/white
   * accent as everything else and carried no visual urgency of its own.
   */
  error: string;
};

export type ThemeMode = 'light' | 'dark';

function flatScale(hex: string): ColorScale {
  return { DEFAULT: hex, 100: hex, 200: hex, 300: hex, 400: hex, 500: hex, 600: hex, 700: hex, 800: hex, 900: hex };
}

export const LightColors: ThemeColors = {
  bg: '#FFFFFF',
  surface: '#F5F5F5',
  text: '#111111',
  divider: 'rgba(17,17,17,0.12)',

  neutral: {
    100: '#FAFAFA',
    200: '#F0F0F0',
    300: '#E0E0E0',
    400: '#B0B0B0',
    500: '#8A8A8A',
    600: '#6B6B6B',
    700: '#4A4A4A',
    800: '#2A2A2A',
    900: '#141414',
  },

  // "All the blue parts would be black" — the brand accent is solid
  // black in Light mode, with no separate hue for likes/links/active
  // states.
  accent: flatScale('#111111'),
  accent2: flatScale('#111111'),

  error: '#B3473C',
};

export const DarkColors: ThemeColors = {
  bg: '#121212',
  surface: '#1E1E1E',
  text: '#F2F2F2',
  divider: 'rgba(255,255,255,0.10)',

  neutral: {
    100: '#2A2A2A',
    200: '#3A3A3A',
    300: '#4A4A4A',
    400: '#8A8A8A',
    500: '#9A9A9A',
    600: '#B0B0B0',
    700: '#C7C7C7',
    800: '#D8D8D8',
    900: '#F2F2F2',
  },

  // Dark mode never introduces a white fill — only text/icons go
  // light, and the accent is an off-white rather than pure #fff.
  accent: flatScale('#F2F2F2'),
  accent2: flatScale('#F2F2F2'),

  // Lighter than Light mode's error so it still reads at AA contrast
  // against the #121212 background.
  error: '#E2685C',
};

/**
 * Family names Chasien's screens render with — the exact keys `useFonts()`
 * in `app/_layout.tsx` registers them under (from
 * `@expo-google-fonts/caprasimo` and `@expo-google-fonts/figtree`),
 * coordinated with the splash screen there so nothing flashes the
 * platform default font first. `expo-font` registers under these same
 * names on every platform including web, so there's no per-platform split.
 */
export const Fonts = {
  heading: 'Caprasimo_400Regular',
  body: 'Figtree_400Regular',
  bodySemibold: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
} as const;

/** --space-* custom properties in tokens.css, kept as the same numbers for 1:1 traceability. */
export const Spacing = {
  1: 4.4,
  2: 8.8,
  3: 13.2,
  4: 17.6,
  6: 26.4,
  // 7 isn't in tokens.css's original scale (it jumps 6 -> 8) — added for
  // the Room feed's story-row spacing, following the same index * 4.4
  // pattern as every other step.
  7: 30.8,
  8: 35.2,
} as const;

export const Radius = {
  sm: 8,
  md: 16,
  lg: 28,
  /** Buttons, tags, inputs — the mock rounds these all the way to pill. */
  pill: 999,
} as const;

/**
 * Approximate RN translations of tokens.css's box-shadow values. iOS reads
 * shadowColor/Offset/Opacity/Radius; Android reads elevation only —
 * elevation values here are a starting point, not tuned against a device.
 * Shadow color deliberately stays a fixed black in both modes — a real
 * shadow doesn't turn white just because the theme did.
 */
export const Shadows = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 32,
    elevation: 10,
  },
} as const;

export const MaxContentWidth = 800;

/**
 * TabBar's own rendered height, excluding the device's bottom safe-area
 * inset (TabBar adds that separately via `useSafeAreaInsets`) — paddingTop
 * (10) + tabContent (paddingTop 5 + icon 25 + a 4px gap + an ~12px label)
 * + paddingBottom (8). Nudged up from an earlier, smaller bar (icon
 * 22/label 8.5, height 56) that read as too small next to the rest of the
 * app's controls — sized deliberately short of the even-chunkier bar this
 * was originally cut down from (icon 28/label 9.5), per the same "not
 * really big, just a little bit larger" ask this size came from. Exists
 * so `PostFab` can float its pill so it straddles the bar's top edge
 * without either file having to read the other's internals — keep this in
 * sync if TabBar's own layout constants change.
 */
export const TabBarContentHeight = 64;

/**
 * The gap between TabBar's own floating pill and the device's safe-area
 * edge — TabBar no longer sits flush against the bottom of the screen
 * (Telegram-style: a rounded bar with daylight on all sides, not an
 * edge-to-edge rectangle). Every screen's own bottom padding/FAB offset
 * needs to add this on top of TabBarContentHeight, or content ends up
 * hidden in the new gap instead of clearing the bar — see
 * `hooks/use-tab-bar-clearance.ts`, the one place that actually combines
 * these two constants with the device's live inset.
 */
export const TabBarFloatingGap = Spacing[3];
