import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

import { DarkColors, LightColors, type ThemeColors, type ThemeMode } from '@/constants/theme';

const STORAGE_KEY = 'chasien.themeMode';

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  /** True until the stored preference (if any) has been read once. */
  ready: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// No stored preference yet (first launch, or a fresh install) falls back to
// the OS setting rather than hard-coding light or dark — matches how most
// apps with a real light/dark switch behave, and Settings can always
// override it explicitly afterward.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [storedMode, setStoredMode] = useState<ThemeMode | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value === 'light' || value === 'dark') setStoredMode(value);
      })
      .finally(() => setReady(true));
  }, []);

  const mode: ThemeMode = storedMode ?? (systemScheme === 'light' ? 'light' : 'dark');

  // Tell the OS which scheme the app is in whenever Settings overrides the
  // phone's. The screens don't need it (they read `colors`), but what the OS
  // draws for the app does: a <Modal> is its own window on Android and takes
  // its navigation bar from this, so without it every sheet in a Dark app
  // on a Light phone sat on a light bar (checked on the A14, 2026-10-02).
  // With no stored preference the app goes back to following the phone.
  // Not on web: react-native-web's Appearance has no setColorScheme.
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return;
    Appearance.setColorScheme(storedMode ?? 'unspecified');
  }, [ready, storedMode]);

  const setMode = (next: ThemeMode) => {
    setStoredMode(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      colors: mode === 'light' ? LightColors : DarkColors,
      ready,
      setMode,
      toggleMode: () => setMode(mode === 'light' ? 'dark' : 'light'),
    }),
    [mode, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeContext must be used within a ThemeProvider');
  return ctx;
}
