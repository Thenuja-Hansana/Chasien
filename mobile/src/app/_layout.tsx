import { Caprasimo_400Regular } from '@expo-google-fonts/caprasimo';
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { configureForegroundNotificationHandler, registerForPushNotifications, subscribeToNotificationTaps } from '@/lib/push';
import { ThemeProvider as ChasienThemeProvider, useThemeContext } from '@/lib/theme-context';
import { UserPreviewProvider } from '@/lib/user-preview-context';

// Held open until fonts resolve so screens never flash with the platform
// default font before Caprasimo/Figtree are ready — see constants/theme.ts.
SplashScreen.preventAutoHideAsync();

// Registering a push token needs no session-specific timing beyond "the
// module has loaded" — call once, not per render.
configureForegroundNotificationHandler();

const AUTH_ROUTES = ['/login', '/signup'];
// Readable signed in or out: signup links to the guidelines people accept
// before an account exists.
const PUBLIC_ROUTES = ['/guidelines'];

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
    if (loading || PUBLIC_ROUTES.includes(pathname)) return;
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
          <UserPreviewProvider>
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
            <Stack.Screen name="u/[userId]/index" options={{ animation: 'none' }} />

            {/* These four are all the same shape — Cancel/X, a centered
                title, a primary action on the right, a full-screen form —
                the exact "compose something new" pattern every major app
                presents as a sheet rising over what you were just looking
                at, not as another layer drilled into. The default push
                (slide in from the right, same as opening a Room or a
                post) gave them no visual distinction from "going deeper"
                even though dismissing one with Cancel/X clearly reads as
                "back out to where I was," not "go back." Animation
                polish pass, 2026-09-15. */}
            <Stack.Screen name="create-community" options={{ presentation: 'modal' }} />
            <Stack.Screen name="c/[communityId]/create-post" options={{ presentation: 'modal' }} />
            <Stack.Screen name="c/[communityId]/create-story" options={{ presentation: 'modal' }} />
            <Stack.Screen name="c/[communityId]/chat/create" options={{ presentation: 'modal' }} />

            {/* Full-bleed media, X to close — reads as "step into this
                media, then step back out," the same beat Instagram/
                Snapchat's own story viewers use a cross-fade for, not a
                sheet rising over the Room feed underneath it. */}
            <Stack.Screen name="c/[communityId]/story" options={{ animation: 'fade' }} />
            {/* Same "step into the media" beat as stories, for the full-screen clips viewer. */}
            <Stack.Screen name="c/[communityId]/clips" options={{ animation: 'fade' }} />
          </Stack>
          </UserPreviewProvider>
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

  // react-native-gesture-handler's gestures only work under this root view.
  // The dependency shipped with the Expo template but nothing used it until
  // the Post composer's photo editor (pinch/pan to crop).
  return (
    <GestureHandlerRootView style={rootStyles.fill}>
      <ChasienThemeProvider>
        <AppShell />
      </ChasienThemeProvider>
    </GestureHandlerRootView>
  );
}

const rootStyles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
