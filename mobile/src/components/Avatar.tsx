import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Fonts, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cachedImageSource } from '@/lib/mediaUtils';

// Ported from app_reference/src/components/Avatar.jsx, then regraded for
// the Bones Phase's black/white brand — every gradient is now a pair of
// `neutral` steps rather than a hue. `neutral`'s 100-900 ramp runs
// light-to-dark in Light mode and dark-to-light in Dark mode (see
// constants/theme.ts), so the exact same pairs below read as dark-on-white
// avatars in Light mode and light-on-black avatars in Dark mode — this map
// never needs to know which mode is active.
function gradientsFor(colors: ThemeColors): Record<string, [string, string]> {
  const { neutral } = colors;
  return {
    mara: [neutral[700], neutral[900]],
    tobi: [neutral[600], neutral[800]],
    nadia: [neutral[500], neutral[900]],
    kwame: [neutral[400], neutral[700]],
    rui: [neutral[600], neutral[900]],
    eve: [neutral[300], neutral[600]],
    grit: [neutral[700], neutral[900]],
    ilford: [neutral[500], neutral[800]],
    sourdough: [neutral[300], neutral[600]],
    alfama: [neutral[600], neutral[900]],
    bike: [neutral[500], neutral[800]],
    wallrats: [neutral[500], neutral[900]],
    plastic: [neutral[300], neutral[600]],
  };
}

type AvatarProps = {
  gradient: string;
  /**
   * A real per-Room `accent_color`, when the caller has one — takes over
   * from `gradient`'s small hardcoded neutral-tone lookup entirely (flat
   * fill, not a gradient), which is how every Room avatar reads, Home's
   * included. `gradient` stays required so every existing call site (DMs,
   * profile avatars, stories — anything without a Room's own color) keeps
   * working unchanged.
   */
  color?: string | null;
  /** A real uploaded photo (a signed URL, already resolved by the caller) — takes priority over both `color` and the gradient fallback below it. */
  imageUrl?: string | null;
  letter: string;
  size?: number;
  shape?: 'circle' | 'square';
  ring?: boolean;
  dot?: boolean;
  style?: ViewStyle;
};

export default function Avatar({ gradient, color, imageUrl, letter, size = 40, shape = 'circle', ring = false, dot = false, style }: AvatarProps) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const gradientColors = gradientsFor(colors)[gradient] ?? gradientsFor(colors).mara;
  const radius = shape === 'circle' ? 999 : Math.max(10, size * 0.34);

  const fallback = color ? (
    <View style={[styles.fill, { borderRadius: radius, backgroundColor: color }]}>
      {/* colors.onAccent, not the theme-derived contrast the gradient
          branch below uses, since an arbitrary accent color can't be
          assumed to pair with either theme's bg color the way the neutral
          gradient ramp is designed to. */}
      <Text style={[styles.letter, { fontSize: size * 0.4, color: colors.onAccent }]}>{letter}</Text>
    </View>
  ) : (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[styles.fill, { borderRadius: radius }]}
    >
      {/* The gradient always runs from a light-ish to a dark-ish `neutral`
          step, so whichever end of the theme's bg/text pair contrasts with
          it also works as the letter color — same trick MessageBubble uses
          for text on its "mine" bubble. */}
      <Text style={[styles.letter, { fontSize: size * 0.4, color: colors.bg }]}>{letter}</Text>
    </LinearGradient>
  );

  // A real photo used to render *instead of* the color/gradient fallback,
  // so an avatar with an actual uploaded photo showed nothing at all
  // while its signed URL loaded/decoded — every other avatar state already
  // has a correctly-colored placeholder, this one just never used it. Now
  // the fallback always renders as the base layer and the photo
  // cross-fades in on top of it once decoded, image caching pass,
  // 2026-09-15.
  const inner = imageUrl ? (
    <View style={styles.fill}>
      {fallback}
      <Image
        source={cachedImageSource(imageUrl)}
        style={[styles.fill, StyleSheet.absoluteFill, { borderRadius: radius }]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={200}
      />
    </View>
  ) : (
    fallback
  );

  return (
    <View style={[{ width: size, height: size }, style]}>
      {ring ? (
        <LinearGradient
          colors={[colors.accent.DEFAULT, colors.accent.DEFAULT]}
          style={[styles.fill, { borderRadius: 999, padding: 2.5 }]}
        >
          <View style={[styles.fill, { borderRadius: 999, borderWidth: 2.5, borderColor: colors.surface, overflow: 'hidden' }]}>
            {inner}
          </View>
        </LinearGradient>
      ) : (
        inner
      )}
      {dot && (
        <View
          style={[
            styles.dot,
            {
              width: size * 0.34,
              height: size * 0.34,
              borderRadius: 999,
            },
          ]}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    fill: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    letter: {
      fontFamily: Fonts?.heading,
    },
    dot: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      backgroundColor: colors.accent.DEFAULT,
      borderWidth: 2.5,
      borderColor: colors.bg,
    },
  });
