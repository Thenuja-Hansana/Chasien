import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Matches posts_location_length in 20260916160000_post_location.sql. */
export const MAX_LOCATION_LENGTH = 100;

/**
 * The Post composer's "Add location" sheet: type a place name. Free text by
 * design — place search is a paid API (see the migration's comment) — so
 * this is a plain field, not a search list.
 *
 * Edits a local draft and only hands it back on Done, so backing out
 * (backdrop, hardware back) leaves the post's location as it was. Same
 * bottom-sheet shell as EventDateTimeModal, including its own bottom
 * safe-area padding: RN's <Modal> renders outside create-post.tsx's
 * SafeAreaView.
 */
export default function LocationSheet({
  visible,
  value,
  onDone,
  onClose,
}: {
  visible: boolean;
  value: string;
  onDone: (location: string) => void;
  onClose: () => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);
  const [draft, setDraft] = useState(value);

  // Re-seed from the post's current value each time the sheet opens, so a
  // cancelled edit doesn't linger into the next opening. Adjusting state
  // during render on a prop transition (not in an effect) is React's
  // documented pattern for this.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(value);
  }

  const trimmed = draft.trim();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* 'height' on Android, never `undefined` (which disables avoidance
          entirely and left this sheet — text field and all — hidden behind
          the keyboard on the Galaxy A14). Under Expo's default edge-to-edge
          display, adjustResize no longer shrinks the window for the
          keyboard, so the view has to move itself; same reason and same
          setting as the chat composer in chats/[chatId].tsx. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          {/* Swallows the backdrop's onPress so tapping inside the sheet doesn't close it — same pattern as ConfirmModal. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>Add location</Text>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Where was this?"
              placeholderTextColor={colors.neutral[500]}
              maxLength={MAX_LOCATION_LENGTH}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => onDone(trimmed)}
              accessibilityLabel="Location"
            />
            <Text style={styles.counter}>
              {draft.length}/{MAX_LOCATION_LENGTH}
            </Text>

            <View style={styles.actions}>
              {value.length > 0 && (
                <Pressable style={styles.secondaryButton} onPress={() => onDone('')} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Remove</Text>
                </Pressable>
              )}
              <Pressable style={styles.doneButton} onPress={() => onDone(trimmed)} accessibilityRole="button">
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      backgroundColor: colors.bg,
      paddingTop: Spacing[6],
      paddingHorizontal: Spacing[6],
      paddingBottom: Spacing[6] + bottomInset,
      gap: Spacing[2],
    },
    title: {
      fontFamily: Fonts.heading,
      fontSize: 18,
      color: colors.text,
      marginBottom: Spacing[1],
    },
    input: {
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      paddingHorizontal: 18,
      fontSize: 15,
      color: colors.text,
      fontFamily: Fonts.body,
    },
    counter: {
      fontFamily: Fonts.body,
      fontSize: 11.5,
      color: colors.neutral[500],
      alignSelf: 'flex-end',
    },
    actions: {
      flexDirection: 'row',
      gap: Spacing[2],
      marginTop: Spacing[2],
    },
    secondaryButton: {
      flex: 1,
      height: 48,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 14,
      color: colors.text,
    },
    doneButton: {
      flex: 1,
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 14,
      color: colors.bg,
    },
  });
