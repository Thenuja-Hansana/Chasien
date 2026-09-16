import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDateTime } from '@/lib/posts';

function startOfDay(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}
function addDays(d: Date, days: number) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}
function withTime(d: Date, hour: number, minute: number) {
  const n = new Date(d);
  n.setHours(hour, minute, 0, 0);
  return n;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const DATE_CHOICES_COUNT = 14;
const TIME_OPTIONS: { hour: number; minute: number }[] = Array.from({ length: 48 }, (_, i) => ({
  hour: Math.floor(i / 2),
  minute: i % 2 === 0 ? 0 : 30,
}));

function dateLabel(d: Date, today: Date) {
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, addDays(today, 1))) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function timeLabel(hour: number, minute: number) {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * A dependency-free "Starts" picker. No calendar/wheel-picker library is
 * installed anywhere in this app, and adding a new native module would
 * need a prebuild/rebuild this session has no way to verify — see
 * AGENTS.md's own warning about Expo versions moving out from under
 * whatever a third-party module last targeted. Quick-pick chips for the
 * next two weeks plus 30-minute time slots answer the same "when is this"
 * question an event needs, without a new native dependency.
 */
export default function EventDateTimeModal({
  visible,
  title = 'Starts',
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  title?: string;
  value: Date;
  onChange: (d: Date) => void;
  onClose: () => void;
}) {
  const colors = useTheme();
  // RN's <Modal> renders full-screen, outside create-post.tsx's own
  // SafeAreaView entirely — this sheet needs its own bottom-inset padding
  // or its "Done" button ends up flush against (or under) the device's
  // gesture/button nav, the same class of bug CreateTabSwitcher.tsx hit.
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);
  const today = useMemo(() => startOfDay(new Date()), []);
  const dateChoices = useMemo(() => Array.from({ length: DATE_CHOICES_COUNT }, (_, i) => addDays(today, i)), [today]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows the backdrop's onPress so tapping inside the sheet doesn't close it — same pattern as ConfirmModal. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.preview}>{formatEventDateTime(value.toISOString())}</Text>

          <Text style={styles.label}>Date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {dateChoices.map((d) => {
              const active = sameDay(d, value);
              return (
                <Pressable
                  key={d.toISOString()}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => onChange(withTime(d, value.getHours(), value.getMinutes()))}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{dateLabel(d, today)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.label}>Time</Text>
          <ScrollView style={styles.timeScroll} contentContainerStyle={styles.timeGrid}>
            {TIME_OPTIONS.map(({ hour, minute }) => {
              const active = value.getHours() === hour && value.getMinutes() === minute;
              return (
                <Pressable
                  key={`${hour}:${minute}`}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => onChange(withTime(value, hour, minute))}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{timeLabel(hour, minute)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable style={styles.doneButton} onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '80%',
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
    },
    preview: {
      fontFamily: Fonts.bodyBold,
      fontSize: 14,
      color: colors.accent.DEFAULT,
      marginBottom: Spacing[2],
    },
    label: {
      ...Typography.label,
      color: colors.neutral[500],
      marginTop: Spacing[2],
    },
    chipRow: {
      gap: Spacing[2],
      paddingVertical: Spacing[1],
    },
    timeScroll: {
      maxHeight: 220,
    },
    timeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing[2],
      paddingVertical: Spacing[1],
    },
    chip: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: {
      backgroundColor: colors.accent.DEFAULT,
      borderColor: colors.accent.DEFAULT,
    },
    chipText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13,
      color: colors.text,
    },
    chipTextActive: {
      color: colors.bg,
    },
    doneButton: {
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: Spacing[4],
    },
    doneText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 14,
      color: colors.bg,
    },
  });
