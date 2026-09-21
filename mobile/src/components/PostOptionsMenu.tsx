import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The post overflow menu — "Hide" (any Room member, personal, doesn't
 * touch the post), "Block" (someone else's post: blocks its author, see
 * lib/blocks.ts) and "Delete" (only the post's own author or the Room's
 * owner — enforced server-side too, this just hides the row otherwise).
 * A bottom sheet, not a small anchored dropdown: there's no popup-menu
 * precedent anywhere else in this app to match, and this is what
 * Instagram/Facebook/WhatsApp's own per-post menus actually look like on
 * mobile — no need to measure the trigger button's on-screen position
 * either. Tapping Delete only closes this sheet and hands off to the
 * caller's own ConfirmModal; this component never deletes anything itself.
 */
export default function PostOptionsMenu({
  visible,
  canDelete,
  canRemoveTag = false,
  canPin = false,
  pinned = false,
  blockHandle,
  onClose,
  onHide,
  onDelete,
  onRemoveTag,
  onTogglePin,
  onBlock,
}: {
  visible: boolean;
  canDelete: boolean;
  /** The viewer is tagged in this post — they can take themselves off it (RLS allows only their own tag). */
  canRemoveTag?: boolean;
  /** Owner/admin/mod of the Room — toggle_post_pin() checks the same thing server-side. */
  canPin?: boolean;
  pinned?: boolean;
  /** The author's handle when the post is someone else's — shows "Block @handle". Omit for your own posts and deleted authors. */
  blockHandle?: string;
  onClose: () => void;
  onHide: () => void;
  onDelete: () => void;
  onRemoveTag?: () => void;
  onTogglePin?: () => void;
  onBlock?: () => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows the backdrop's onPress so tapping inside the sheet doesn't close it. */}
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing[4] }]} onPress={() => {}}>
          <View style={styles.grabber} />

          {canPin && onTogglePin && (
            <Pressable style={styles.row} onPress={onTogglePin} accessibilityRole="button">
              <Icon name="pin" size={19} color={colors.text} filled={pinned} />
              <Text style={styles.rowText}>{pinned ? 'Unpin post' : 'Pin post'}</Text>
            </Pressable>
          )}

          <Pressable style={styles.row} onPress={onHide} accessibilityRole="button">
            <Icon name="eyeOff" size={19} color={colors.text} />
            <Text style={styles.rowText}>Hide post</Text>
          </Pressable>

          {canRemoveTag && onRemoveTag && (
            <Pressable style={styles.row} onPress={onRemoveTag} accessibilityRole="button">
              <Icon name="youTab" size={19} color={colors.text} />
              <Text style={styles.rowText}>Remove tag</Text>
            </Pressable>
          )}

          {blockHandle && onBlock && (
            <Pressable style={styles.row} onPress={onBlock} accessibilityRole="button">
              <Icon name="noEntry" size={19} color={colors.error} />
              <Text style={[styles.rowText, styles.destructiveText]}>Block @{blockHandle}</Text>
            </Pressable>
          )}

          {canDelete && (
            <Pressable style={styles.row} onPress={onDelete} accessibilityRole="button">
              <Icon name="trash" size={19} color={colors.error} />
              <Text style={[styles.rowText, styles.destructiveText]}>Delete post</Text>
            </Pressable>
          )}

          <Pressable style={[styles.row, styles.cancelRow]} onPress={onClose} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
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
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      paddingTop: Spacing[3],
      paddingHorizontal: Spacing[6],
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: Radius.pill,
      backgroundColor: colors.divider,
      marginBottom: Spacing[3],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[3],
      height: 52,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    rowText: {
      fontFamily: Fonts.body,
      fontSize: 15,
      color: colors.text,
    },
    destructiveText: {
      color: colors.error,
    },
    cancelRow: {
      justifyContent: 'center',
      marginTop: Spacing[2],
    },
    cancelText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 15,
      color: colors.text,
    },
  });
