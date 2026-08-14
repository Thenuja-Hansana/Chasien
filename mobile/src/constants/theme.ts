/**
 * Chasien design tokens — ported from app_reference/src/styles/tokens.css
 * ("Organic" design system, source of truth for the app's look).
 *
 * That source defines a single deliberate dark palette with no light-mode
 * variant, so this module does the same — there is no `Colors.light` /
 * `Colors.dark` split. If a light mode is ever wanted, design it as new
 * tokens in tokens.css first; don't improvise one here.
 */

import { Platform } from 'react-native';

export const Colors = {
  bg: '#17130f',
  surface: '#221c17',
  text: '#f2e6d4',
  divider: 'rgba(242, 230, 212, 0.13)',

  neutral: {
    100: '#f9f4ed',
    200: '#eee7db',
    300: '#dcd3c4',
    400: '#c0b6a5',
    500: '#a19786',
    600: '#82796a',
    700: '#645c50',
    800: '#474238',
    900: '#2e2b25',
  },

  accent: {
    DEFAULT: '#e08c4e',
    100: '#fff2eb',
    200: '#ffe1d0',
    300: '#ffc6a5',
    400: '#f6a06b',
    500: '#d67f48',
    600: '#b2622d',
    700: '#8c491a',
    800: '#643312',
    900: '#402310',
  },

  accent2: {
    DEFAULT: '#a3b585',
    100: '#f0fae1',
    200: '#e1eecc',
    300: '#ccdbb2',
    400: '#aebf92',
    500: '#8fa073',
    600: '#728157',
    700: '#56633f',
    800: '#3d472b',
    900: '#272e1b',
  },
} as const;

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
 */
export const Shadows = {
  sm: {
    shadowColor: Colors.neutral[900],
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.14,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: Colors.neutral[900],
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 4,
  },
  lg: {
    shadowColor: Colors.neutral[900],
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 32,
    elevation: 10,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
