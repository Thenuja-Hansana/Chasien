import { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import GroupedCard, { GroupedDivider, GroupedRow, GroupedTextInput } from '@/components/create/GroupedCard';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDate, formatEventTime } from '@/lib/posts';

/**
 * v1 scope only: title, optional description, a start time, an optional
 * end time, and an optional location/link — no reminders, no guest limit.
 * See supabase/migrations/20260915160000_event_end_and_link.sql for why
 * those two specifically are deferred rather than shown as dead controls.
 *
 * The text rows are GroupedTextInput rather than locally-styled TextInputs;
 * see its comment for the Android empty-input caret bug that geometry
 * fixes.
 */
export default function EventTabFields({
  title,
  onChangeTitle,
  description,
  onChangeDescription,
  startsAt,
  onOpenStartsPicker,
  includeEndTime,
  onToggleEndTime,
  endsAt,
  onOpenEndsPicker,
  location,
  onChangeLocation,
  link,
  onChangeLink,
  focusedField,
  onFocusField,
  onBlurField,
  submitting,
}: {
  title: string;
  onChangeTitle: (v: string) => void;
  description: string;
  onChangeDescription: (v: string) => void;
  startsAt: Date;
  onOpenStartsPicker: () => void;
  includeEndTime: boolean;
  onToggleEndTime: (v: boolean) => void;
  endsAt: Date;
  onOpenEndsPicker: () => void;
  location: string;
  onChangeLocation: (v: string) => void;
  link: string;
  onChangeLink: (v: string) => void;
  focusedField: string | null;
  onFocusField: (key: string) => void;
  onBlurField: (key: string) => void;
  submitting: boolean;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.wrap}>
      <GroupedCard>
        <GroupedTextInput
          value={title}
          onChangeText={onChangeTitle}
          placeholder="Add event name"
          fieldKey="event-title"
          focusedField={focusedField}
          onFocusField={onFocusField}
          onBlurField={onBlurField}
          editable={!submitting}
        />
        <GroupedDivider />
        <GroupedTextInput
          value={description}
          onChangeText={onChangeDescription}
          placeholder="Add description (optional)"
          fieldKey="event-description"
          focusedField={focusedField}
          onFocusField={onFocusField}
          onBlurField={onBlurField}
          multiline
          editable={!submitting}
        />
      </GroupedCard>

      <GroupedCard>
        <GroupedRow label="Starts">
          <DatePill text={formatEventDate(startsAt.toISOString())} onPress={onOpenStartsPicker} disabled={submitting} />
          <DatePill text={formatEventTime(startsAt.toISOString())} onPress={onOpenStartsPicker} disabled={submitting} />
        </GroupedRow>
        <GroupedDivider />
        <GroupedRow label="Include end time">
          <Switch
            value={includeEndTime}
            onValueChange={onToggleEndTime}
            disabled={submitting}
            accessibilityLabel="Include end time"
            trackColor={{ false: colors.neutral[300], true: colors.accent.DEFAULT }}
          />
        </GroupedRow>
        {includeEndTime && (
          <>
            <GroupedDivider />
            <GroupedRow label="Ends">
              <DatePill text={formatEventDate(endsAt.toISOString())} onPress={onOpenEndsPicker} disabled={submitting} />
              <DatePill text={formatEventTime(endsAt.toISOString())} onPress={onOpenEndsPicker} disabled={submitting} />
            </GroupedRow>
          </>
        )}
      </GroupedCard>

      <GroupedCard>
        <GroupedTextInput
          value={location}
          onChangeText={onChangeLocation}
          placeholder="Add location (optional)"
          fieldKey="event-location"
          focusedField={focusedField}
          onFocusField={onFocusField}
          onBlurField={onBlurField}
          editable={!submitting}
        />
        <GroupedDivider />
        <GroupedTextInput
          value={link}
          onChangeText={onChangeLink}
          placeholder="Add a link (optional)"
          fieldKey="event-link"
          focusedField={focusedField}
          onFocusField={onFocusField}
          onBlurField={onBlurField}
          autoCapitalize="none"
          keyboardType="url"
          editable={!submitting}
        />
      </GroupedCard>
    </View>
  );
}

function DatePill({ text, onPress, disabled }: { text: string; onPress: () => void; disabled: boolean }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable style={styles.datePill} onPress={onPress} disabled={disabled}>
      <Text style={styles.datePillText}>{text}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      gap: Spacing[3],
    },
    datePill: {
      height: 34,
      paddingHorizontal: 14,
      borderRadius: Radius.pill,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    datePillText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13,
      color: colors.text,
    },
  });
