import { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import GroupedCard, { GroupedDivider, GroupedRow, GroupedTextInput } from '@/components/create/GroupedCard';
import { Fonts, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const MAX_POLL_OPTIONS = 4;

/**
 * The same question/options fields create-post.tsx used to build inline,
 * now the Poll tab's whole screen rather than a collapsible section.
 * Question stays a standalone pill (it's the one field in the section);
 * Options moves into a GroupedCard — a single rounded card whose rows are
 * divided by hairlines — matching the reference design's grouped-table
 * treatment for a list of same-kind fields. Each option row is a
 * GroupedTextInput; see its comment for why the row geometry lives there
 * rather than in this file's stylesheet.
 */
export default function PollTabFields({
  question,
  onChangeQuestion,
  options,
  onChangeOption,
  onAddOption,
  allowMultiple,
  onToggleAllowMultiple,
  pollReady,
  focusedField,
  onFocusField,
  onBlurField,
  submitting,
}: {
  question: string;
  onChangeQuestion: (v: string) => void;
  options: string[];
  onChangeOption: (index: number, value: string) => void;
  onAddOption: () => void;
  allowMultiple: boolean;
  onToggleAllowMultiple: (v: boolean) => void;
  pollReady: boolean;
  focusedField: string | null;
  onFocusField: (key: string) => void;
  onBlurField: (key: string) => void;
  submitting: boolean;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Question</Text>
      <TextInput
        style={[styles.input, focusedField === 'poll-question' && styles.inputFocused]}
        value={question}
        onChangeText={onChangeQuestion}
        onFocus={() => onFocusField('poll-question')}
        onBlur={() => onBlurField('poll-question')}
        placeholder="Ask question"
        placeholderTextColor={colors.neutral[500]}
        editable={!submitting}
      />

      <Text style={styles.label}>Options</Text>
      <GroupedCard>
        {options.map((option, index) => (
          <View key={index}>
            {index > 0 && <GroupedDivider />}
            <GroupedTextInput
              value={option}
              onChangeText={(v) => onChangeOption(index, v)}
              placeholder="Add"
              fieldKey={`poll-option-${index}`}
              focusedField={focusedField}
              onFocusField={onFocusField}
              onBlurField={onBlurField}
              editable={!submitting}
            />
          </View>
        ))}
      </GroupedCard>
      {options.length < MAX_POLL_OPTIONS && (
        <Pressable onPress={onAddOption} disabled={submitting}>
          <Text style={styles.addOption}>+ Add option</Text>
        </Pressable>
      )}

      <GroupedCard>
        <GroupedRow label="Allow multiple answers">
          <Switch
            value={allowMultiple}
            onValueChange={onToggleAllowMultiple}
            disabled={submitting}
            accessibilityLabel="Allow multiple answers"
            trackColor={{ false: colors.neutral[300], true: colors.accent.DEFAULT }}
          />
        </GroupedRow>
      </GroupedCard>

      {!pollReady && <Text style={styles.hint}>A poll needs a question and at least two options.</Text>}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      gap: Spacing[2],
    },
    label: {
      ...Typography.label,
      color: colors.neutral[500],
      marginTop: Spacing[2],
    },
    input: {
      height: 46,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      paddingHorizontal: 18,
      fontSize: 15,
      color: colors.text,
      fontFamily: Fonts.body,
    },
    inputFocused: {
      backgroundColor: `${colors.accent.DEFAULT}0F`,
    },
    addOption: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13,
      color: colors.accent2[300],
      paddingVertical: Spacing[1],
    },
    hint: {
      fontFamily: Fonts.body,
      fontSize: 12,
      color: colors.neutral[500],
    },
  });
