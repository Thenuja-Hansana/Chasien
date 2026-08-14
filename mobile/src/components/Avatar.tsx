import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

// Ported from app_reference/src/components/Avatar.jsx — same gradient-per-id
// palette, referencing the ported theme tokens instead of CSS vars.
const GRADIENTS: Record<string, [string, string]> = {
  mara: [Colors.accent.DEFAULT, Colors.accent[700]],
  tobi: [Colors.accent[600], Colors.accent[900]],
  nadia: [Colors.accent2[600], Colors.accent2[900]],
  kwame: [Colors.neutral[700], Colors.neutral[900]],
  rui: [Colors.accent[700], Colors.neutral[900]],
  eve: [Colors.neutral[400], Colors.neutral[800]],
  grit: [Colors.accent.DEFAULT, Colors.accent[700]],
  ilford: [Colors.accent2[500], Colors.accent2[900]],
  sourdough: [Colors.neutral[400], Colors.neutral[800]],
  alfama: [Colors.accent[400], Colors.accent2[900]],
  bike: [Colors.accent2[500], Colors.accent2[800]],
  wallrats: [Colors.accent2[500], Colors.accent2[900]],
  plastic: [Colors.neutral[400], Colors.neutral[800]],
};

type AvatarProps = {
  gradient: string;
  letter: string;
  size?: number;
  shape?: 'circle' | 'square';
  ring?: boolean;
  dot?: boolean;
  style?: ViewStyle;
};

export default function Avatar({ gradient, letter, size = 40, shape = 'circle', ring = false, dot = false, style }: AvatarProps) {
  const colors = GRADIENTS[gradient] ?? GRADIENTS.mara;
  const radius = shape === 'circle' ? 999 : Math.max(10, size * 0.34);

  const inner = (
    <LinearGradient
      colors={colors}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[styles.fill, { borderRadius: radius }]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.4 }]}>{letter}</Text>
    </LinearGradient>
  );

  return (
    <View style={[{ width: size, height: size }, style]}>
      {ring ? (
        <LinearGradient
          colors={[Colors.accent.DEFAULT, Colors.accent2.DEFAULT, Colors.accent[300], Colors.accent.DEFAULT]}
          style={[styles.fill, { borderRadius: 999, padding: 2.5 }]}
        >
          <View style={[styles.fill, { borderRadius: 999, borderWidth: 2.5, borderColor: Colors.surface, overflow: 'hidden' }]}>
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

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: Fonts?.heading,
    color: '#f6e7d2',
  },
  dot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: Colors.accent2.DEFAULT,
    borderWidth: 2.5,
    borderColor: Colors.bg,
  },
});
