import { DarkTheme, Stack, ThemeProvider } from 'expo-router';

import { Colors } from '@/constants/theme';

// Chasien is single-themed (see constants/theme.ts) — React Navigation's
// chrome (headers, tab bars) is tinted to match rather than switching
// with the OS color scheme.
const ChasienNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.bg,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.divider,
    primary: Colors.accent.DEFAULT,
  },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={ChasienNavigationTheme}>
      <Stack />
    </ThemeProvider>
  );
}
