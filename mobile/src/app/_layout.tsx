import { DarkTheme, router, Stack, ThemeProvider, usePathname } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';

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

const AUTH_ROUTES = ['/login', '/signup'];

// The only route guard the app needs at this phase: no session -> only
// the auth screens are reachable; a session -> the auth screens bounce
// back to "/". Real per-screen navigation is Phase 3's job — this just
// proves the session loop (sign up, restart, still logged in, log out)
// actually works end to end.
function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    const onAuthRoute = AUTH_ROUTES.includes(pathname);
    if (!session && !onAuthRoute) {
      router.replace('/login');
    } else if (session && onAuthRoute) {
      router.replace('/');
    }
  }, [session, loading, pathname]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg }}>
        <ActivityIndicator color={Colors.accent.DEFAULT} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ThemeProvider value={ChasienNavigationTheme}>
      <AuthProvider>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
