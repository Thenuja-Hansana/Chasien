import { BlurTargetView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import TabBar from '@/components/TabBar';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import {
  deleteNotification,
  fetchNotifications,
  markNotificationRead,
  subscribeToNotifications,
  type AppNotification,
} from '@/lib/notifications';
import { acceptFriendRequest, removeFriendship } from '@/lib/friends';
import { relativeTime } from '@/lib/posts';
import { respondToRequest } from '@/lib/rooms';

/**
 * Ported from app_reference/src/screens/Notifications.jsx. Grouped by
 * Today / This week / Older — the mock only ever had the first two
 * (static seed data never went stale), but a real feed accumulates
 * indefinitely, so a third bucket is the natural extension rather than
 * a new feature.
 */

type Group = 'Today' | 'This week' | 'Older';

function groupFor(iso: string): Group {
  const created = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (created >= startOfToday) return 'Today';
  const weekAgo = new Date(startOfToday);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return created >= weekAgo ? 'This week' : 'Older';
}

function textFor(n: AppNotification): { line: string; highlight?: string } {
  switch (n.type) {
    case 'reply':
      return { line: `${n.actorName} replied to your comment in`, highlight: n.roomName ?? undefined };
    case 'like': {
      const likerIds = Array.isArray(n.data.likerIds) ? (n.data.likerIds as string[]) : [];
      const others = Math.max(0, likerIds.length - 1);
      return { line: others > 0 ? `${n.actorName} and ${others} others liked your post` : `${n.actorName} liked your post` };
    }
    case 'mention': {
      const preview = typeof n.data.preview === 'string' ? n.data.preview : null;
      return { line: `${n.actorName} mentioned you${preview ? `: "${preview}"` : ''}` };
    }
    case 'join_request':
      return { line: `${n.actorName} wants to join`, highlight: n.roomName ?? undefined };
    case 'pinned_post':
      return { line: 'New pinned post in', highlight: n.roomName ?? undefined };
    case 'new_post':
      return { line: `${n.actorName} posted in`, highlight: n.roomName ?? undefined };
    case 'new_story':
      return { line: `${n.actorName} added a story in`, highlight: n.roomName ?? undefined };
    case 'friend_request':
      return { line: `${n.actorName} sent you a friend request` };
    case 'friend_accept':
      return { line: `${n.actorName} accepted your friend request` };
    default:
      return { line: 'New activity' };
  }
}

const GROUPS: Group[] = ['Today', 'This week', 'Older'];

export default function Notifications() {
  const { session } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const blurTargetRef = useRef<View>(null);
  const { roomId, roomName } = useLocalSearchParams<{ roomId?: string; roomName?: string }>();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(() => {
    if (!userId) return;
    fetchNotifications(userId, roomId)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load activity.'));
  }, [userId, roomId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, load);
  }, [userId, load]);

  if (!session) return null;

  function openNotification(n: AppNotification) {
    if (!n.read_at) markNotificationRead(n.id).catch(() => {});
    const postId = typeof n.data.postId === 'string' ? n.data.postId : undefined;
    if (n.type === 'new_story' && n.roomSlug && n.actor_id) {
      router.push({ pathname: '/c/[communityId]/story', params: { communityId: n.roomSlug, authorId: n.actor_id } });
    } else if (n.roomSlug && postId) {
      router.push({ pathname: '/c/[communityId]/post/[postId]', params: { communityId: n.roomSlug, postId } });
    } else if (n.roomSlug) {
      router.push({ pathname: '/c/[communityId]', params: { communityId: n.roomSlug } });
    }
  }

  async function respond(n: AppNotification, approve: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setBusyId(n.id);
    try {
      if (n.type === 'friend_request') {
        if (!n.actor_id || !userId) return;
        await (approve ? acceptFriendRequest(userId, n.actor_id) : removeFriendship(userId, n.actor_id));
      } else {
        const targetUserId = typeof n.data.targetUserId === 'string' ? n.data.targetUserId : null;
        if (!n.room_id || !targetUserId) return;
        await respondToRequest(n.room_id, targetUserId, approve);
      }
      await deleteNotification(n.id);
      load();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e instanceof Error ? e.message : 'Could not respond to that request.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
      <View style={styles.header}>
        {roomId && (
          <Pressable hitSlop={8} onPress={() => router.back()} style={styles.backButton}>
            <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
          </Pressable>
        )}
        <Text style={styles.heading}>{roomId ? `${roomName ?? 'Room'} Activity` : 'Activity'}</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {items === null ? (
        <View style={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={42} height={42} radius={999} />
              <View style={[styles.rowContent, { gap: 6 }]}>
                <Skeleton width={i % 2 === 0 ? 210 : 170} height={12} radius={6} />
                <Skeleton width={70} height={10} radius={5} />
              </View>
            </View>
          ))}
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="bell"
          message={roomId ? 'No activity in this Room yet.' : 'Nothing here yet.'}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: clearance }]}>
          {GROUPS.map((group) => {
            const groupItems = items.filter((n) => groupFor(n.created_at) === group);
            if (groupItems.length === 0) return null;
            return (
              <View key={group}>
                <Text style={styles.groupLabel}>{group}</Text>
                {groupItems.map((n) => {
                  const { line, highlight } = textFor(n);
                  return (
                    <Pressable
                      key={n.id}
                      style={[styles.row, !n.read_at && styles.rowUnread]}
                      onPress={() => openNotification(n)}
                    >
                      {n.actor_id ? (
                        <Avatar gradient={n.actor_id} letter={n.actorName.charAt(0).toUpperCase()} size={42} />
                      ) : (
                        <View style={styles.systemIcon}>
                          <Icon name="bell" size={18} color={colors.accent[300]} />
                        </View>
                      )}
                      <View style={styles.rowContent}>
                        <Text style={styles.rowText}>
                          {line}
                          {highlight ? <Text style={styles.highlight}> {highlight}</Text> : null}
                        </Text>
                        <Text style={styles.time}>{relativeTime(n.created_at)}</Text>
                      </View>
                      {n.type === 'join_request' || n.type === 'friend_request' ? (
                        <View style={styles.actions}>
                          {busyId === n.id ? (
                            <ActivityIndicator color={colors.accent.DEFAULT} />
                          ) : (
                            <>
                              <Pressable style={styles.acceptBtn} onPress={() => respond(n, true)} hitSlop={4}>
                                <Text style={styles.acceptText}>Accept</Text>
                              </Pressable>
                              <Pressable style={styles.skipBtn} onPress={() => respond(n, false)} hitSlop={4}>
                                <Text style={styles.skipText}>{n.type === 'friend_request' ? 'Decline' : 'Skip'}</Text>
                              </Pressable>
                            </>
                          )}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      )}
      </BlurTargetView>

      <TabBar active="Home" userId={session.user.id} blurTarget={blurTargetRef} />
    </SafeAreaView>
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
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[2],
  },
  backButton: {
    marginLeft: -Spacing[1],
  },
  heading: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    color: colors.text,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[2],
  },
  list: {
    paddingBottom: Spacing[8],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  groupLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.neutral[500],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: 10,
  },
  rowUnread: {
    backgroundColor: `${colors.accent.DEFAULT}0F`,
  },
  systemIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowText: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.text,
  },
  highlight: {
    fontFamily: Fonts.bodySemibold,
    color: colors.accent[300],
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[500],
  },
  actions: {
    flexDirection: 'row',
    gap: 7,
  },
  acceptBtn: {
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
  },
  acceptText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: colors.bg,
  },
  skipBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  skipText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: colors.text,
  },
});
