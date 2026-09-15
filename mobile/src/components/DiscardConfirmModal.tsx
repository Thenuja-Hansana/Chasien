import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The "you're about to lose what you typed" confirmation shown when a
 * composer-style screen is closed (Cancel, X, or the hardware back
 * button/gesture) with unsaved content — first built for create-community,
 * now shared with create-post so every screen with this shape looks and
 * behaves identically rather than re-implementing the same ~50 lines.
 */
export default function DiscardConfirmModal({
  visible,
  title,
  body,
  onKeepEditing,
  onDiscard,
}: {
  visible: boolean;
  title: string;
  body: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const colors = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onKeepEditing}>
      <Pressable style={styles.backdrop} onPress={onKeepEditing}>
        {/* Swallows the backdrop's onPress so tapping inside the card doesn't close it. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={onKeepEditing}>
              <Text style={styles.cancelText}>Keep Editing</Text>
            </Pressable>
            <Pressable style={styles.discardButton} onPress={onDiscard}>
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing[6],
    },
    card: {
      width: '100%',
      maxWidth: 340,
      borderRadius: Radius.lg,
      backgroundColor: colors.bg,
      padding: Spacing[6],
    },
    title: {
      fontFamily: Fonts.heading,
      fontSize: 18,
      color: colors.text,
      marginBottom: Spacing[2],
    },
    body: {
      fontFamily: Fonts.body,
      fontSize: 13.5,
      lineHeight: 19,
      color: colors.neutral[400],
      marginBottom: Spacing[6],
    },
    actions: {
      flexDirection: 'row',
      gap: Spacing[3],
    },
    cancelButton: {
      flex: 1,
      height: 48,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelText: {
      fontFamily: Fonts.body,
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    // `colors.error` — the one deliberate departure from the app's
    // otherwise monochrome palette, reserved for exactly this (errors and
    // destructive actions), since this one's irreversible.
    discardButton: {
      flex: 1,
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    discardText: {
      fontFamily: Fonts.body,
      fontSize: 14,
      fontWeight: '700',
      color: '#ffffff',
    },
  });
