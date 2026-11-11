import { Caprasimo_400Regular } from '@expo-google-fonts/caprasimo';
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import { NavigationBar } from 'expo-navigation-bar';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider, usePathname, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import ErrorScreen from '@/components/ErrorScreen';
import OfflineBanner from '@/components/OfflineBanner';
import { DarkColors, LightColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { initCrashReporting, reportError } from '@/lib/crash-reporting';
import { NetworkProvider } from '@/lib/network';
import { configureForegroundNotificationHandler, registerForPushNotifications, subscribeToNotificationTaps } from '@/lib/push';
import { ThemeProvider as ChasienThemeProvider, useThemeContext } from '@/lib/theme-context';
import { UserPreviewProvider } from '@/lib/user-preview-context';

// First, so a crash anywhere after this is caught. Does nothing until a
// Sentry key is set (lib/crash-reporting.ts).
initCrashReporting();

// Held open until fonts resolve so screens never flash with the platform
// default font before Caprasimo/Figtree are ready — see constants/theme.ts.
SplashScreen.preventAutoHideAsync();

// Registering a push token needs no session-specific timing beyond "the
// module has loaded" — call once, not per render.
configureForegroundNotificationHandler();

// Signed out only. A correct code on /confirm-email signs the person in,
// and being on an auth route with a session is what sends them on to Home.
const AUTH_ROUTES = ['/login', '/signup', '/confirm-email'];
// Readable signed in or out: signup links to the guidelines people accept
// before an account exists, and /forgot-password's code signs the person in
// before the new password is set, so it mustn't be bounced to Home midway.
const PUBLIC_ROUTES = ['/guidelines', '/forgot-password'];

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

// One screen crashed: it's replaced by this, inside the app, so the theme
// still applies and there's somewhere to go. Without it, one screen's
// crash blanked the whole app (Phase 10 slice 8). A screen with nothing
// behind it (opened from a link or a notification) offers Home instead of
// Back, unless it is Home.
function ScreenError({ error, retry }: ErrorBoundaryProps) {
  const colors = useTheme();
  const pathname = usePathname();

  useEffect(() => {
    reportError(error, 'screen');
  }, [error]);

  const canGoBack = router.canGoBack();
  const goHome = pathname !== '/';
  return (
    <ErrorScreen
      colors={colors}
      error={error}
      onRetry={retry}
      backLabel={canGoBack ? 'Go back' : goHome ? 'Go to Home' : undefined}
      onBack={canGoBack ? () => router.back() : goHome ? () => router.replace('/') : undefined}
    />
  );
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
      {/* The system bars' icons, from the app's own mode. Nothing set them
          before. The status bar kept Android's default (light icons): right
          in Dark, white-on-white in Light. The navigation bar followed the
          *phone's* theme, so a Dark app on a Light phone sat on a light
          bar. Not "auto" for either — that follows the phone's theme too,
          and the mode chosen in Settings can differ from it. The clips and
          story viewers, dark in both modes, mount their own on top of these
          while they're open. */}
      <StatusBar style={mode === 'light' ? 'dark' : 'light'} />
      <NavigationBar style={mode === 'light' ? 'dark' : 'light'} />
      <NetworkProvider>
      <OfflineBanner>
      <AuthProvider>
        <AuthGate>
          <UserPreviewProvider>
          <Stack screenOptions={{ headerShown: false }} unstable_screenErrorBoundary={ScreenError}>
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
      </OfflineBanner>
      </NetworkProvider>
    </ThemeProvider>
  );
}

// The last resort: a crash outside any one screen (fonts, theme, sign-in
// state, the layout itself). expo-router wraps this whole file in it, so
// it's drawn outside every provider: no theme context, no router state
// worth trusting. It takes Light or Dark from the phone, not from Settings
// (the stored choice is behind the provider that may have crashed), and
// hides the splash screen itself in case the crash came before AppShell
// did. `unstable_screenErrorBoundary` is expo-router's own name for the
// per-screen boundary above; typecheck will catch a rename on an upgrade.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? DarkColors : LightColors;

  useEffect(() => {
    reportError(error, 'app');
    SplashScreen.hideAsync();
  }, [error]);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <ErrorScreen colors={colors} error={error} onRetry={retry} />
    </>
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
