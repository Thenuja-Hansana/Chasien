import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';

/**
 * What's left on screen after a crash, instead of nothing (Phase 10 slice
 * 8). Two error boundaries in `app/_layout.tsx` draw it: one for a single
 * screen, which can send people back, and one for the whole app, which
 * can only try again.
 *
 * Takes `colors` as a prop instead of calling `useTheme()`, the one
 * exception to that rule: the whole-app boundary sits outside the theme
 * provider (outside everything), where `useTheme()` would throw.
 *
 * The error's own text is shown only in development. In a release build it
 * would be a stack-trace sentence nobody can act on, and it can carry data.
 */
export default function ErrorScreen({
  colors,
  error,
  onRetry,
  backLabel,
  onBack,
}: {
  colors: ThemeColors;
  error: Error;
  onRetry: () => void;
  backLabel?: string;
  onBack?: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Icon name="alertCircle" size={24} color={colors.text} strokeWidth={2} />
      </View>
      <Text style={styles.heading}>Something went wrong</Text>
      <Text style={styles.message}>
        This part of Chasien hit a problem it couldn&apos;t recover from. Try again, and if it keeps happening, let us
        know.
      </Text>
      {__DEV__ ? <Text style={styles.devDetail}>{error.message}</Text> : null}
      <Pressable style={styles.primary} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.primaryText}>Try again</Text>
      </Pressable>
      {backLabel && onBack ? (
        <Pressable style={styles.secondary} onPress={onBack} accessibilityRole="button">
          <Text style={styles.secondaryText}>{backLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing[2],
      paddingHorizontal: Spacing[6],
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: Radius.pill,
      backgroundColor: `${colors.text}0F`,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing[1],
    },
    heading: {
      fontFamily: Fonts.heading,
      fontSize: 18,
      color: colors.text,
      textAlign: 'center',
    },
    message: {
      fontFamily: Fonts.body,
      fontSize: 13,
      lineHeight: 19,
      color: colors.neutral[400],
      textAlign: 'center',
      maxWidth: 280,
    },
    devDetail: {
      fontFamily: Fonts.body,
      fontSize: 12,
      color: colors.error,
      textAlign: 'center',
      maxWidth: 280,
    },
    primary: {
      marginTop: Spacing[3],
      height: 44,
      minWidth: 160,
      paddingHorizontal: Spacing[6],
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: {
      fontFamily: Fonts.heading,
      fontSize: 15,
      color: colors.bg,
    },
    secondary: {
      height: 44,
      minWidth: 160,
      paddingHorizontal: Spacing[6],
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 15,
      color: colors.text,
    },
  });
