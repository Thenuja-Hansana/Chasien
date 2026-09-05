import { Caprasimo_400Regular } from '@expo-google-fonts/caprasimo';
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { configureForegroundNotificationHandler, registerForPushNotifications, subscribeToNotificationTaps } from '@/lib/push';
import { ThemeProvider as ChasienThemeProvider, useThemeContext } from '@/lib/theme-context';

// Held open until fonts resolve so screens never flash with the platform
// default font before Caprasimo/Figtree are ready — see constants/theme.ts.
SplashScreen.preventAutoHideAsync();

// Registering a push token needs no session-specific timing beyond "the
// module has loaded" — call once, not per render.
configureForegroundNotificationHandler();

const AUTH_ROUTES = ['/login', '/signup'];

// The only route guard the app needs at this phase: no session -> only
// the auth screens are reachable; a session -> the auth screens bounce
// back to "/". Real per-screen navigation is Phase 3's job — this just
// proves the session loop (sign up, restart, still logged in, log out)
// actually works end to end.
function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();
  const colors = useTheme();

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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent.DEFAULT} />
      </View>
    );
  }

  return <>{children}</>;
}

// React Navigation's own chrome (headers, tab bars it draws itself, the
// native back-swipe/status-bar tinting) is tinted to match whichever mode
// is active — this has to live inside ChasienThemeProvider to read it.
// Also holds the splash screen open past the font gate above until the
// stored theme preference (if any) has actually been read from
// AsyncStorage, so a Dark-mode user on a Light-default device never sees
// even one frame of the wrong theme before it corrects itself.
function AppShell() {
  const { mode, colors, ready } = useThemeContext();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const navigationTheme = {
    ...(mode === 'light' ? DefaultTheme : DarkTheme),
    colors: {
      ...(mode === 'light' ? DefaultTheme.colors : DarkTheme.colors),
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.divider,
      primary: colors.accent.DEFAULT,
    },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <AuthProvider>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            {/* The four main tab destinations (Home/Explore/Chats/You)
                swap instantly instead of sliding in from the right — each
                is its own Stack screen (see TabBar.tsx's comment on why
                there's no dedicated Tabs navigator yet), so without this
                override switching tabs looked and felt like drilling into
                a new screen, animation and all. Everything else (opening
                a Room, a post, settings, a chat thread) keeps the normal
                slide — that's still the right cue for "going deeper", just
                not for switching sections. */}
            <Stack.Screen name="index" options={{ animation: 'none' }} />
            <Stack.Screen name="discover" options={{ animation: 'none' }} />
            <Stack.Screen name="chats/index" options={{ animation: 'none' }} />
            <Stack.Screen name="u/[userId]" options={{ animation: 'none' }} />
          </Stack>
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  // Only the error path hides the splash screen from here — the happy
  // path waits on AppShell's theme-ready effect too, below.
  useEffect(() => {
    if (fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ChasienThemeProvider>
      <AppShell />
    </ChasienThemeProvider>
  );
}
