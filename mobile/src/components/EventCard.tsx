import { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDateTime, formatEventTime, type EventInfo } from '@/lib/posts';

/**
 * A post's attached event, rendered next to PollCard in the same feed slot
 * — read-only for now, same v1 scope as the Event tab itself (no RSVP, no
 * reminders, no call link). See supabase/migrations/20260915150000_events.sql
 * for why an event is a post with an attached row rather than its own
 * separate feed entry.
 */
export default function EventCard({ event }: { event: EventInfo }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Icon name="calendar" size={17} color={colors.accent.DEFAULT} />
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>
      </View>
      <Text style={styles.detail}>{formatEventRange(event.startsAt, event.endsAt)}</Text>
      {event.location ? (
        <View style={styles.row}>
          <Icon name="location" size={14} color={colors.neutral[500]} />
          <Text style={styles.location} numberOfLines={1}>
            {event.location}
          </Text>
        </View>
      ) : null}
      {event.link ? (
        <Pressable onPress={() => Linking.openURL(event.link as string).catch(() => {})} hitSlop={4}>
          <Text style={styles.link} numberOfLines={1}>
            {event.link}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Same-day events read as "Sep 15, 2026 · 7:30 – 9:00 PM"; a multi-day event spells out both full date/times instead. */
function formatEventRange(startsAt: string, endsAt: string | null) {
  if (!endsAt) return formatEventDateTime(startsAt);
  const sameDay = new Date(startsAt).toDateString() === new Date(endsAt).toDateString();
  return sameDay
    ? `${formatEventDateTime(startsAt)} – ${formatEventTime(endsAt)}`
    : `${formatEventDateTime(startsAt)} – ${formatEventDateTime(endsAt)}`;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    marginTop: Spacing[2],
    padding: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  title: {
    flex: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: colors.text,
  },
  detail: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.accent[300],
  },
  location: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[500],
    flexShrink: 1,
  },
  link: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 12,
    color: colors.accent.DEFAULT,
    textDecorationLine: 'underline',
  },
});
