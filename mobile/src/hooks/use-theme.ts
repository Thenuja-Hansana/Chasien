import { useThemeContext } from '@/lib/theme-context';
import type { ThemeColors } from '@/constants/theme';

/**
 * The active palette (Light or Dark, per the user's Settings choice or
 * the OS default) — see `lib/theme-context.tsx`. This is the one hook
 * every screen/component reaches for instead of importing a static
 * `Colors` object, so the whole app re-renders in the new palette the
 * moment the mode changes.
 */
export function useTheme(): ThemeColors {
  return useThemeContext().colors;
}
