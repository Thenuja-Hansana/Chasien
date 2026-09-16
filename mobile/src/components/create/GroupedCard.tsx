import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The rounded, multi-row "grouped table" card the reference design's Poll
 * and Event screens use for related fields (question+options, name+
 * description, starts+end-time) — one rounded container per section, thin
 * hairlines between its own rows, rather than each field being its own
 * separate pill. Rows are passed as children with `<GroupedDivider />`
 * between them; this component only owns the outer shape.
 */
export default function GroupedCard({ children }: { children: ReactNode }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.card}>{children}</View>;
}

/** A hairline separator between two rows in the same GroupedCard. */
export function GroupedDivider() {
  const colors = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: Spacing[4] }} />;
}

/** A label + right-aligned value/control row, for rows that aren't a plain text input (Starts, Include end time, …). */
export function GroupedRow({ label, children }: { label: string; children: ReactNode }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

/**
 * A text-input row inside a GroupedCard, shared by the Poll tab's options
 * and the Event tab's name/description/location/link.
 *
 * This exists as one component rather than a copied style block because of
 * an Android caret bug both tabs hit: tapping an *empty* single-line input
 * put the cursor at the right edge of the row instead of at the start of
 * the placeholder. On Android an empty TextInput draws its placeholder
 * from a separate hint layout while positioning the caret from the (empty)
 * text layout, and the two disagree when the input is transparent over a
 * styled parent and has an unresolved height — see
 * facebook/react-native#32225 and #28794, and ReactEditText.kt's
 * "make sure we have *something* to measure" hint substitution.
 *
 * The single-line variant therefore resolves both conditions: a fixed
 * `height` (not `minHeight` + paddingVertical) and its own background in
 * the same colour GroupedCard already paints, so nothing changes visually.
 * Do not fold these back into a bare `minHeight`/transparent style.
 *
 * Note that an earlier attempt at this fix — `textAlign: 'left'` on the
 * input — was a no-op: RN maps it to `Gravity.LEFT`, which resolves to the
 * same `ALIGN_NORMAL` as the default `Gravity.START` in an LTR locale.
 *
 * The multiline variant (Event's description) never showed the bug, and
 * keeps its top-aligned, min-height textarea geometry.
 */
export function GroupedTextInput({
  value,
  onChangeText,
  placeholder,
  fieldKey,
  focusedField,
  onFocusField,
  onBlurField,
  editable = true,
  multiline = false,
  autoCapitalize,
  keyboardType,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  /** Identity used by the composer's shared `focusedField` state, e.g. `poll-option-0`. */
  fieldKey: string;
  focusedField: string | null;
  onFocusField: (key: string) => void;
  onBlurField: (key: string) => void;
  editable?: boolean;
  multiline?: boolean;
} & Pick<TextInputProps, 'autoCapitalize' | 'keyboardType'>) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <TextInput
      style={[
        styles.rowInput,
        multiline ? styles.rowInputMultiline : styles.rowInputSingle,
        focusedField === fieldKey && styles.rowInputFocused,
      ]}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => onFocusField(fieldKey)}
      onBlur={() => onBlurField(fieldKey)}
      placeholder={placeholder}
      placeholderTextColor={colors.neutral[500]}
      multiline={multiline}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      editable={editable}
    />
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 52,
      paddingHorizontal: Spacing[4],
      paddingVertical: Spacing[2],
      gap: Spacing[3],
    },
    rowLabel: {
      fontFamily: Fonts.body,
      fontSize: 15,
      color: colors.text,
    },
    rowValue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[2],
    },
    rowInput: {
      paddingHorizontal: Spacing[4],
      fontSize: 15,
      color: colors.text,
      fontFamily: Fonts.body,
      // Same colour the card already paints, so this is invisible — it's
      // here so the input isn't a transparent child of a styled parent.
      backgroundColor: colors.surface,
    },
    rowInputSingle: {
      height: 52,
      paddingVertical: 0,
      textAlignVertical: 'center',
      includeFontPadding: false,
    },
    rowInputMultiline: {
      minHeight: 70,
      paddingVertical: Spacing[3],
      textAlignVertical: 'top',
    },
    rowInputFocused: {
      // Translucent, so it still tints against the card beneath it.
      backgroundColor: `${colors.accent.DEFAULT}0F`,
    },
  });
