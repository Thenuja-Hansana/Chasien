import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A generic "confirm before doing something you can't easily undo" dialog —
 * first built for create-community's discard-confirmation, then reused by
 * create-post's, and now by post deletion too. Generalized (title/body/
 * button labels all caller-supplied, rather than hardcoded "Discard"/"Keep
 * Editing") once a third call site needed the same shape with different
 * copy, rather than copying the same ~50 lines a third time.
 */
export default function ConfirmModal({
  visible,
  title,
  body,
  cancelLabel = 'Cancel',
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  body: string;
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useTheme();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Swallows the backdrop's onPress so tapping inside the card doesn't close it. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable style={styles.confirmButton} onPress={onConfirm}>
              <Text style={styles.confirmText}>{confirmLabel}</Text>
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
    confirmButton: {
      flex: 1,
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmText: {
      fontFamily: Fonts.body,
      fontSize: 14,
      fontWeight: '700',
      color: '#ffffff',
    },
  });
