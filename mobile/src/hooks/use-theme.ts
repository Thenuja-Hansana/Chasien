import { Colors } from '@/constants/theme';

/**
 * Chasien has one deliberate dark palette, no light/dark switch — see
 * constants/theme.ts. This hook exists so components have a stable,
 * consistent way to reach the palette, the same shape a future
 * light/dark-aware version would have.
 */
export function useTheme() {
  return Colors;
}
