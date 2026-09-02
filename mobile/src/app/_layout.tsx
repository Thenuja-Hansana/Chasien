import { Caprasimo_400Regular } from '@expo-google-fonts/caprasimo';
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import { DarkTheme, router, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { configureForegroundNotificationHandler, registerForPushNotifications, subscribeToNotificationTaps } from '@/lib/push';

// Held open until fonts resolve so screens never flash with the platform
// default font before Caprasimo/Figtree are ready — see constants/theme.ts.
SplashScreen.preventAutoHideAsync();

// Registering a push token needs no session-specific timing beyond "the
// module has loaded" — call once, not per render.
configureForegroundNotificationHandler();

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

  // Registration is a silent no-op without a configured EAS project id
  // (see lib/push.ts) — safe to call unconditionally on every login
  // rather than gating this on some "push is set up" flag the app would
  // otherwise need to track.
  useEffect(() => {
    if (!session) return;
    registerForPushNotifications().catch(() => {});
  }, [session]);

  useEffect(() => {
    return subscribeToNotificationTaps((data) => {
      if (typeof data.conversationId === 'string') {
        router.push({ pathname: '/chats/[chatId]', params: { chatId: data.conversationId } });
      } else if (typeof data.notificationType === 'string') {
        // Activity notifications (Phase 8) land on the feed itself —
        // resolving a postId/roomId straight to its Room's own screen
        // needs the Room's slug, which the push payload doesn't carry
        // (only its id), so tapping through to the specific post from
        // there is the notification row's own job, not this listener's.
        router.push('/notifications');
      }
    });
  }, []);

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
  const [fontsLoaded, fontError] = useFonts({
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

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
