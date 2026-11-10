import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useOnline } from '@/lib/network';

/** The strip's own height, under the status bar. */
const STRIP_HEIGHT = 30;

/**
 * "No connection", as a strip under the status bar on every screen while
 * the phone has no internet (Phase 10 slice 9). Screens keep showing what
 * they'd already loaded; this says why nothing new arrives.
 *
 * It makes room for itself rather than floating over the screen: a
 * floating pill covered whatever header sat under the status bar (on the
 * A14, the chat thread's title). Every screen pads its own top by the
 * status bar's height, so the app is moved down by the strip's height
 * only, and the strip is drawn in the gap that opens between the status
 * bar and the screen's header. (Moving the app down by the status bar's
 * height as well left an empty band: the screens' safe-area padding
 * doesn't shrink when they sit lower.)
 *
 * The app is the first child either way, so going offline never remounts
 * it or loses where anyone was.
 */
export default function OfflineBanner({ children }: { children: ReactNode }) {
  const online = useOnline();
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.fill, !online && styles.makeRoom]}>
      {children}
      {!online && (
        <View
          style={[styles.strip, { top: insets.top }]}
          pointerEvents="none"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Icon name="noEntry" size={14} color={colors.text} strokeWidth={2.2} />
          <Text style={styles.text}>No connection</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    fill: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    makeRoom: {
      paddingTop: STRIP_HEIGHT,
    },
    strip: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: STRIP_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing[1],
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    text: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13,
      color: colors.text,
    },
  });
