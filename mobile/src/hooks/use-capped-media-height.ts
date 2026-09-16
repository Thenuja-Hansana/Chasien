import { useWindowDimensions } from 'react-native';

/**
 * Caps a media box's height to a fraction of the *current* window's
 * height, read live via `useWindowDimensions()` rather than a fixed
 * pixel value — so it adapts to whatever screen size, orientation, or
 * (on web) browser window shape the device actually has, instead of
 * assuming every screen is a tall phone.
 *
 * A portrait (3:4) photo laid out at full card width can otherwise grow
 * taller than the screen itself on a short/wide viewport (a laptop
 * browser window, a tablet in landscape, a phone with a large on-screen
 * keyboard or system font eating into the usable height) — forcing a
 * scroll just to see the rest of one photo, and leaving no room to see
 * anything below it. Capping the box's height and pairing it with
 * `contentFit="contain"` (not `"cover"`) means the whole photo always
 * fits without being cropped further to make it fit.
 */
export function useCappedMediaHeight(maxFraction: number): number {
  const { height } = useWindowDimensions();
  return height * maxFraction;
}
