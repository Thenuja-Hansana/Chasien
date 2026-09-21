import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import { Fonts, MaxContentWidth, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchModerationLog, type ModerationActionType, type ModerationEntry } from '@/lib/moderation';
import { relativeTime } from '@/lib/posts';
import { fetchRoomBySlug } from '@/lib/rooms';

/**
 * "Mara removed Tobi's comment" — the log reads as sentences, newest first.
 * `target` is null when the log row names nobody: the author's account was
 * deleted, or it's an entry from before 20260921110100, when delete_post
 * didn't record whose post it was. So it says "a post", not "a deleted
 * user's post", which would be wrong for those older rows.
 */
function describe(action: ModerationActionType, target: string | null): string {
  const whose = (thing: string) => (target ? `${target}'s ${thing}` : `a ${thing}`);
  const who = target ?? 'someone';
  switch (action) {
    case 'remove_post':
      return `removed ${whose('post')}`;
    case 'remove_comment':
      return `removed ${whose('comment')}`;
    case 'remove_message':
      return `removed ${whose('message')}`;
    case 'remove_story':
      return `removed ${whose('story')}`;
    case 'mute_member':
      return `muted ${who} in a chat`;
    case 'kick_member':
      return `removed ${who} from the Room`;
    case 'ban_user':
      return `banned ${who}`;
    case 'role_change':
      return `changed ${who}'s role`;
  }
}

/**
 * Room Settings → Moderation log (Phase 9): every moderation action taken
 * in this Room, with a snapshot of what was removed. Readable by the Room's
 * owner, admins and mods under moderation_actions' RLS; anyone else who
 * reached this screen would just see it empty, so it needs no gate of its
 * own. Written only by the server (removal RPCs and the room-membership
 * Edge Function), never by this screen.
 */
export default function ModerationLog() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState<ModerationEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const loadLog = async () => {
        const room = await fetchRoomBySlug(communityId);
        setEntries(room ? await fetchModerationLog(room.id) : []);
      };
      loadLog().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load the moderation log.'));
    }, [communityId]),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerSide}
          hitSlop={8}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Moderation log
        </Text>
        <View style={styles.headerSide} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {entries === null ? (
        <View style={styles.list}>
          {[200, 160, 180].map((width, i) => (
            <View key={i} style={[styles.row, { gap: 6 }]}>
              <Skeleton width={width} height={14} radius={6} />
              <Skeleton width={90} height={12} radius={5} />
            </View>
          ))}
        </View>
      ) : entries.length === 0 ? (
        <EmptyState icon="shield" heading="Nothing here yet" message="When content is removed or someone is muted in this Room, it's recorded here." />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {entries.map((entry) => (
            <View key={entry.id} style={styles.row}>
              <Text style={styles.sentence}>
                <Text style={styles.actor}>{entry.actorName}</Text> {describe(entry.actionType, entry.targetName)}
              </Text>
              {entry.excerpt && (
                <Text style={styles.excerpt} numberOfLines={3}>
                  “{entry.excerpt}”
                </Text>
              )}
              {entry.reason && <Text style={styles.meta}>Reason: {entry.reason}</Text>}
              <Text style={styles.meta}>{relativeTime(entry.createdAt)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  headerSide: {
    width: 32,
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: colors.text,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
  },
  list: {
    paddingBottom: Spacing[8],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  row: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 4,
  },
  sentence: {
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  actor: {
    fontFamily: Fonts.bodySemibold,
  },
  excerpt: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral[400],
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: colors.neutral[500],
  },
});
