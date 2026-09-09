import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type DimensionValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useThemeContext } from '@/lib/theme-context';

/**
 * A content-shaped loading placeholder with a shimmer sweep, replacing the
 * bare `ActivityIndicator` every list screen used to show while loading —
 * see the design audit's "Fixes at a glance": a spinner tells you
 * something is happening, but a skeleton sized like the row it's about to
 * become holds the layout still and reads as faster at the same real load
 * time. The sweep's travel distance comes from the block's own measured
 * width (`onLayout`), not a guessed constant, so it looks right whether
 * it's a 48px avatar circle or a full-width card.
 */
export default function Skeleton({
  width,
  height,
  radius = 6,
}: {
  width: DimensionValue;
  height: number;
  radius?: number;
}) {
  const colors = useTheme();
  const { mode } = useThemeContext();
  const [blockWidth, setBlockWidth] = useState(0);
  // eslint-disable-next-line react-hooks/refs -- read via .interpolate() during render, the standard idiomatic use of an Animated.Value.
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  // eslint-disable-next-line react-hooks/refs
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-blockWidth, blockWidth] });

  return (
    <View
      style={[styles.block, { width, height, borderRadius: radius, backgroundColor: colors.surface }]}
      onLayout={(e) => setBlockWidth(e.nativeEvent.layout.width)}
    >
      {blockWidth > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
          <LinearGradient
            colors={mode === 'dark' ? ['transparent', 'rgba(255,255,255,0.06)', 'transparent'] : ['transparent', 'rgba(255,255,255,0.9)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
  },
});
