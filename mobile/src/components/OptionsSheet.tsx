import { type ComponentProps } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SheetOption = {
  key: string;
  label: string;
  icon: ComponentProps<typeof Icon>['name'];
  /** Red, for actions against someone or something (block, report, remove). */
  destructive?: boolean;
  onPress: () => void;
};

/**
 * A plain bottom sheet of actions — the same look as PostOptionsMenu, but
 * with the rows supplied by the caller. Built for Phase 9, where a profile,
 * a comment, a message, a story and a Room each need their own short menu
 * (Block, Report, Remove); PostOptionsMenu stays as it is, since its rows
 * are post-specific. Like that menu, it never acts itself: each row's
 * onPress hands off to the caller, which usually confirms first.
 */
export default function OptionsSheet({
  visible,
  options,
  onClose,
}: {
  visible: boolean;
  options: SheetOption[];
  onClose: () => void;
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

          {options.map((option) => (
            <Pressable key={option.key} style={styles.row} onPress={option.onPress} accessibilityRole="button">
              <Icon name={option.icon} size={19} color={option.destructive ? colors.error : colors.text} />
              <Text style={[styles.rowText, option.destructive && styles.destructiveText]}>{option.label}</Text>
            </Pressable>
          ))}

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
