import { BlurTargetView } from 'expo-blur';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import TabBar from '@/components/TabBar';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchRoomUnreadCounts, fetchUnreadCount, subscribeToNotifications } from '@/lib/notifications';
import { fetchLatestPostPreview, type RoomActivityPreview } from '@/lib/posts';
import { cacheJoinedRoom } from '@/lib/room-cache';
import { fetchMyRooms, type Room, type RoomRole } from '@/lib/rooms';

/**
 * Telegram/WhatsApp's own chat-list timestamp: a bare clock time for
 * anything from today (matches how a fresh message actually reads —
 * "4:34 PM", not "2h"), falling back to a relative day/week count, then a
 * short date once it's old enough that neither reads naturally.
 */
function formatRoomTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  // Calendar-day difference, not elapsed-hours-divided-by-24 — a message
  // from 11pm yesterday is genuinely "yesterday" the instant the clock
  // ticks past midnight, even though less than 24 raw hours have passed.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// The root "/" — the mock hardcodes a default Room (`grit-club`) here, but a
// real account starts in no Room at all. Now a real Room switcher: lists
// every Room you've actually joined, or the empty state if there are none.
type JoinedRoom = Room & { myRole: RoomRole; myNotificationsMuted: boolean };

export default function Index() {
  const { session } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rooms, setRooms] = useState<JoinedRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  /** Per-Room unread-activity badge — see fetchRoomUnreadCounts()'s own comment for why this is a separate query from the bell's total. */
  const [unreadByRoom, setUnreadByRoom] = useState<Map<string, number>>(new Map());
  /** The Telegram-style "Name: content" line + timestamp under each Room's name. Absent (not just null) while still loading a given Room's preview, so a row can tell "not fetched yet" apart from "genuinely no posts". */
  const [previewByRoom, setPreviewByRoom] = useState<Map<string, RoomActivityPreview | null>>(new Map());
  /** What TabBar's blur actually blurs on Android — see TabBar's own blurTarget doc comment. */
  const blurTargetRef = useRef<View>(null);
  const clearance = useTabBarClearance();

  const userId = session?.user.id;

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      fetchMyRooms(session.user.id)
        .then((rooms) => {
          setRooms(rooms);
          // So tapping into one of these a moment from now doesn't have to
          // re-fetch what we just fetched — see lib/room-cache.ts.
          for (const room of rooms) cacheJoinedRoom(room, room.myRole);

          // One lightweight query per Room, not a single batched call —
          // PostgREST has no "latest row per group" embed, and Home only
          // ever lists the handful of Rooms one person actually joined.
          Promise.all(rooms.map((room) => fetchLatestPostPreview(room.id).then((preview) => [room.id, preview] as const)))
            .then((entries) => setPreviewByRoom(new Map(entries)))
            .catch(() => {});
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load your Rooms.'));
    }, [session]),
  );

  const loadNotificationState = useCallback(() => {
    if (!userId) return;
    fetchUnreadCount(userId).then(setUnreadCount).catch(() => {});
    fetchRoomUnreadCounts(userId).then(setUnreadByRoom).catch(() => {});
  }, [userId]);

  useFocusEffect(useCallback(() => loadNotificationState(), [loadNotificationState]));

  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, loadNotificationState);
  }, [userId, loadNotificationState]);

  // Most-recent-activity-first, the way every real chat list orders itself
  // — a Room that just got a new post jumps to the top, not wherever
  // fetchMyRooms() happened to return it. Rooms with no posts yet (no
  // entry in previewByRoom) sink to the bottom in their original order.
  const sortedRooms = useMemo(() => {
    if (!rooms) return null;
    return [...rooms].sort((a, b) => {
      const at = previewByRoom.get(a.id)?.createdAt;
      const bt = previewByRoom.get(b.id)?.createdAt;
      if (at && bt) return new Date(bt).getTime() - new Date(at).getTime();
      if (at) return -1;
      if (bt) return 1;
      return 0;
    });
  }, [rooms, previewByRoom]);

  // AuthGate redirects away from here once it notices there's no session,
  // but that happens in an effect after this still renders once — guard
  // rather than assume `session` is non-null.
  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
        <View style={styles.header}>
          <Text style={styles.brand}>chasien</Text>
          <Link href="/notifications" asChild>
            <Pressable hitSlop={8} style={styles.bellWrap}>
              <Icon name="bell" size={22} color={colors.text} />
              {unreadCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </Link>
        </View>

        <Pressable style={styles.searchBar} onPress={() => router.push('/search')}>
          <Icon name="search" size={17} color={colors.neutral[400]} />
          <Text style={styles.searchBarText}>Search</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        {sortedRooms === null ? (
          <View style={styles.listWrap}>
            <View style={styles.list}>
              {[128, 96, 150, 110, 134, 100].map((nameWidth, i) => (
                <View key={i} style={styles.roomRow}>
                  <Skeleton width={48} height={48} radius={999} />
                  <View style={styles.roomRowBody}>
                    <Skeleton width={nameWidth} height={13} radius={6} />
                    <Skeleton width={nameWidth + 80} height={11} radius={5} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : sortedRooms.length === 0 ? (
          <EmptyState
            icon="globe"
            heading="No Rooms yet"
            message="Join or start a Room to see its feed here."
            actionLabel="Find a Room"
            onAction={() => router.push('/discover')}
          />
        ) : (
          <ScrollView contentContainerStyle={[styles.listWrap, { paddingBottom: clearance }]}>
            <View style={styles.list}>
              {sortedRooms.map((room) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  unreadCount={unreadByRoom.get(room.id) ?? 0}
                  preview={previewByRoom.get(room.id)}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </BlurTargetView>

      <TabBar active="Home" userId={session.user.id} blurTarget={blurTargetRef} />
    </SafeAreaView>
  );
}

function RoomRow({
  room,
  unreadCount,
  preview,
}: {
  room: JoinedRoom;
  unreadCount: number;
  /** undefined = preview still loading; null = Room genuinely has no posts yet. */
  preview: RoomActivityPreview | null | undefined;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Pressable
      style={styles.roomRow}
      onPress={() => router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } })}
    >
      <View style={[styles.roomIcon, { backgroundColor: room.accent_color ?? colors.accent.DEFAULT }]}>
        <Text style={styles.roomIconLetter}>{room.name.charAt(0).toUpperCase()}</Text>
      </View>

      <View style={styles.roomRowBody}>
        <View style={styles.roomRowLine}>
          {room.myNotificationsMuted && (
            <Icon name="bellSlash" size={13} color={colors.neutral[400]} />
          )}
          <Text style={styles.roomName} numberOfLines={1}>
            {room.name}
          </Text>
          {preview && <Text style={styles.roomTime}>{formatRoomTimestamp(preview.createdAt)}</Text>}
        </View>
        <View style={styles.roomRowLine}>
          <Text style={styles.roomPreview} numberOfLines={1}>
            {preview ? `${preview.authorName}: ${preview.summary}` : preview === null ? 'No posts yet' : ''}
          </Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[4],
  },
  brand: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    color: colors.text,
  },
  bellWrap: {
    position: 'relative',
  },
  // A real count, not a bare dot — matches roomRow's own unreadBadge below
  // instead of leaving the two badge styles inconsistent with each other.
  bellBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  bellBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: colors.bg,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginHorizontal: Spacing[6],
    marginBottom: Spacing[3],
    height: 38,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing[4],
    backgroundColor: colors.surface,
  },
  searchBarText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.error,
    paddingHorizontal: Spacing[6],
  },
  // No horizontal padding here — rows go edge-to-edge inside this
  // constrained column, Telegram-style, with the padding living on each
  // row instead so a row's divider line spans the same full width.
  listWrap: {
    paddingBottom: Spacing[8],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  list: {
    // Deliberately no `gap`/rounded card per row — rows sit flush against
    // each other, separated only by roomRow's own divider line, the way a
    // real chat list (Telegram, WhatsApp) never leaves daylight between
    // one row and the next.
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  // Circular, not the rounded-square Room icon used elsewhere in the app
  // (Explore cards, search results, Room settings) — Home is the first
  // screen moving to the Telegram-style chat-list look; the rest follow
  // later, per the user's own scoping of this pass to Home only.
  roomIcon: {
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomIconLetter: {
    fontFamily: Fonts.heading,
    fontSize: 19,
    color: colors.onAccent,
  },
  roomRowBody: {
    flex: 1,
    gap: 4,
  },
  roomRowLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  roomName: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 15.5,
    fontWeight: '700',
    color: colors.text,
  },
  roomTime: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[400],
  },
  roomPreview: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: colors.bg,
  },
});
