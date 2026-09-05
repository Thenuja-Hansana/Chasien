import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, Shadows, Spacing, type ThemeColors } from '@/constants/theme';
import { useThemeContext } from '@/lib/theme-context';

const DRAWER_WIDTH_RATIO = 0.45;
// 45% of a phone screen is a narrow, pocket-friendly panel; 45% of a
// tablet's width would swell into an oversized column, so the drawer caps
// out at a sane absolute width past that point instead of scaling forever.
const DRAWER_MAX_WIDTH = 400;
const ANIM_MS = 260;

/**
 * The account-settings panel off the You tab's gear icon — a right-edge
 * drawer covering 45% of the screen width, sliding in from the right the
 * way Instagram's does, rather than a full-screen push. Kept mounted
 * through its close animation (`mounted` state) so the slide-out is
 * actually visible instead of the panel just vanishing.
 *
 * Only one setting exists for now (the Dark Mode switch, wired straight to
 * `ThemeProvider`); this is deliberately just a plain scrollless View, not
 * a list component, since one row doesn't need one yet — add a
 * `ScrollView` here if/when more settings land.
 */
export default function SettingsDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { mode, colors, toggleMode } = useThemeContext();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // useWindowDimensions (not Dimensions.get) so a tablet or foldable that
  // rotates mid-session gets a re-render with the new width immediately,
  // instead of the drawer keeping whatever size it had on mount.
  const { width: windowWidth } = useWindowDimensions();
  // progress is an Animated.Value, not a plain ref: reading it (via
  // .interpolate() below) during render is the standard, idiomatic way to
  // use react-native's Animated API, unlike a plain ref's .current — same
  // as story.tsx's progressAnim.
  // eslint-disable-next-line react-hooks/refs
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  // Kept mounted through the close animation, not just while `visible` is
  // true — this is React's documented "adjust state during render" escape
  // hatch (not an effect) specifically so it never trips
  // react-hooks/set-state-in-effect. Closing is the mirror case, but its
  // setMounted(false) runs inside Animated's own completion callback below,
  // which fires asynchronously after the effect has already committed —
  // same reasoning story.tsx's progressAnim.setValue() comment gives for
  // why that one doesn't need the same guard.
  if (visible && !mounted) {
    setMounted(true);
  }

  useEffect(() => {
    Animated.timing(progress, { toValue: visible ? 1 : 0, duration: ANIM_MS, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, progress]);

  const width = Math.round(Math.min(windowWidth * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH));
  // eslint-disable-next-line react-hooks/refs -- see the justification above.
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  // eslint-disable-next-line react-hooks/refs -- see the justification above.
  const scrimOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: scrimOpacity }]}>
          <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close settings" />
        </Animated.View>

        <Animated.View style={[styles.panel, { width, transform: [{ translateX }] }]}>
          <SafeAreaView style={styles.panelInner} edges={['top', 'right', 'bottom']}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Settings</Text>
              <Pressable hitSlop={8} onPress={onClose}>
                <Icon name="close" size={20} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>Dark Mode</Text>
              <Switch
                value={mode === 'dark'}
                onValueChange={toggleMode}
                trackColor={{ false: colors.neutral[300], true: colors.accent.DEFAULT }}
              />
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    panel: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      ...Shadows.lg,
    },
    panelInner: {
      flex: 1,
      paddingHorizontal: Spacing[4],
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing[4],
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      marginBottom: Spacing[3],
    },
    title: {
      fontFamily: Fonts.heading,
      fontSize: 17,
      color: colors.text,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing[3],
    },
    rowLabel: {
      fontFamily: Fonts.body,
      fontSize: 14.5,
      color: colors.text,
    },
  });
