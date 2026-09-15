import { BlurTargetView } from 'expo-blur';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import { Fonts, MaxContentWidth, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchInbox, type InboxItem } from '@/lib/chat';
import { fetchMyMembership, fetchRoomBySlug, type Room } from '@/lib/rooms';
import {
  fetchMySubgroupParticipations,
  fetchRoomSubgroups,
  joinSubgroup,
  respondToSubgroupInvite,
  type Subgroup,
  type SubgroupParticipation,
} from '@/lib/subgroups';

const VISIBILITY_LABEL = { public: 'Public', request: 'Request to join', invite: 'Invite only' } as const;

function previewFor(item: InboxItem) {
  if (item.last_message_text) return item.last_message_text;
  if (item.last_message_image_url) return '📷 Photo';
  if (item.last_message_voice_url) return '🎤 Voice message';
  return 'No messages yet';
}

/**
 * A Room's own chat space — WhatsApp Community-style: the Main chat
 * (General, auto-joined, always present) at the top, then every
 * sub-group in the Community below it, joined or not, all on this one
 * page. A sub-group you haven't joined shows its size and a Join/
 * Request/Accept button instead of a preview; no separate Discover
 * screen — sub-group visibility is independent of membership (you can
 * see one exists without being in it), so this page just shows all of
 * them at once, same as the rest of the Community's chat.
 */
export default function RoomChat() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const blurTargetRef = useRef<View>(null);

  const [room, setRoom] = useState<Room | null | 'loading'>('loading');
  const [canCreate, setCanCreate] = useState(false);
  const [general, setGeneral] = useState<InboxItem | null>(null);
  const [inboxByConversation, setInboxByConversation] = useState<Map<string, InboxItem>>(new Map());
  const [subgroups, setSubgroups] = useState<Subgroup[] | null>(null);
  const [participations, setParticipations] = useState<Map<string, SubgroupParticipation>>(new Map());
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetchRoomBySlug(communityId);
      setRoom(r);
      if (!r) return;

      const [membership, inbox, allSubgroups] = await Promise.all([
        fetchMyMembership(r.id, userId),
        fetchInbox(userId),
        fetchRoomSubgroups(r.id),
      ]);
      setCanCreate(membership?.role === 'owner' || membership?.role === 'admin');

      const roomInbox = inbox.filter((i) => i.kind === 'room_channel' && i.room_id === r.id);
      setGeneral(roomInbox.find((i) => i.is_default) ?? null);
      setInboxByConversation(new Map(roomInbox.map((i) => [i.conversation_id, i])));

      setSubgroups(allSubgroups);
      setParticipations(await fetchMySubgroupParticipations(allSubgroups.map((s) => s.id), userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load this Room's chat.");
    }
  }, [communityId, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!session) return null;

  async function handleJoin(subgroup: Subgroup) {
    const invited = participations.get(subgroup.id)?.join_state === 'invited';
    setJoiningId(subgroup.id);
    setError(null);
    try {
      if (invited) {
        await respondToSubgroupInvite(subgroup.id, true);
      } else {
        await joinSubgroup(subgroup.id);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that sub-group.');
    } finally {
      setJoiningId(null);
    }
  }

  if (room === 'loading' || subgroups === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.list}>
          {[100, 130].map((width, i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={48} height={48} radius={Radius.sm} />
              <View style={[styles.rowContent, { gap: 5 }]}>
                <Skeleton width={width} height={14} radius={6} />
                <Skeleton width={width + 40} height={12} radius={5} />
              </View>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (!room) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <EmptyState icon="alertCircle" message="Room not found." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
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
            Chat
          </Text>
          {canCreate ? (
            <Pressable
              style={[styles.headerSide, styles.headerSideEnd]}
              hitSlop={8}
              onPress={() => router.push({ pathname: '/c/[communityId]/chat/create', params: { communityId } })}
              accessibilityRole="button"
              accessibilityLabel="Create a sub-group"
            >
              <Icon name="plus" size={22} color={colors.text} strokeWidth={2.4} />
            </Pressable>
          ) : (
            <View style={styles.headerSide} />
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: clearance }]}>
          <Text style={styles.sectionLabel}>Main chat</Text>
          {general && <ChatEntryRow label="General" item={general} />}

          <Text style={styles.sectionLabel}>Sub-groups</Text>
          {subgroups.length === 0 ? (
            <EmptyState icon="comment" message="No sub-groups in this Room yet." />
          ) : (
            subgroups.map((s) => {
              const participation = participations.get(s.id);
              const inboxItem = inboxByConversation.get(s.id);
              return participation?.join_state === 'approved' && !participation.banned ? (
                <ChatEntryRow key={s.id} label={s.name} item={inboxItem} conversationId={s.id} />
              ) : (
                <BrowseSubgroupRow
                  key={s.id}
                  subgroup={s}
                  participation={participation}
                  joining={joiningId === s.id}
                  onJoin={() => handleJoin(s)}
                />
              );
            })
          )}
        </ScrollView>
      </BlurTargetView>
    </SafeAreaView>
  );
}

function ChatEntryRow({ label, item, conversationId }: { label: string; item: InboxItem | undefined | null; conversationId?: string }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const targetId = item?.conversation_id ?? conversationId;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => targetId && router.push({ pathname: '/chats/[chatId]', params: { chatId: targetId } })}
    >
      <Avatar gradient={item?.room_id ?? 'grit'} letter={label.charAt(0).toUpperCase()} shape="square" size={48} />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {item ? previewFor(item) : 'No messages yet'}
        </Text>
      </View>
      {item && item.unread_count > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
        </View>
      )}
    </Pressable>
  );
}

function BrowseSubgroupRow({
  subgroup,
  participation,
  joining,
  onJoin,
}: {
  subgroup: Subgroup;
  participation: SubgroupParticipation | undefined;
  joining: boolean;
  onJoin: () => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  let actionLabel: string;
  let disabled = false;
  if (participation?.banned) {
    actionLabel = 'Removed';
    disabled = true;
  } else if (participation?.join_state === 'pending') {
    actionLabel = 'Requested';
    disabled = true;
  } else if (participation?.join_state === 'invited') {
    actionLabel = 'Accept';
  } else if (subgroup.visibility === 'invite') {
    actionLabel = 'Invite only';
    disabled = true;
  } else {
    actionLabel = subgroup.visibility === 'public' ? 'Join' : 'Request';
  }

  return (
    <View style={styles.row}>
      <Avatar gradient={subgroup.room_id} letter={subgroup.name.charAt(0).toUpperCase()} shape="square" size={48} />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {subgroup.name}
        </Text>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {subgroup.member_count} member{subgroup.member_count === 1 ? '' : 's'} · {VISIBILITY_LABEL[subgroup.visibility]}
        </Text>
      </View>
      <Pressable style={[styles.actionButton, disabled && styles.actionButtonSecondary]} onPress={onJoin} disabled={disabled || joining}>
        {joining ? (
          <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
        ) : (
          <Text style={[styles.actionText, disabled && styles.actionTextSecondary]}>{actionLabel}</Text>
        )}
      </Pressable>
    </View>
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
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
  headerSideEnd: {
    alignItems: 'flex-end',
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
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingBottom: Spacing[8],
  },
  sectionLabel: {
    ...Typography.label,
    color: colors.neutral[500],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: 10,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 15.5,
    color: colors.text,
  },
  rowPreview: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11,
    color: colors.bg,
  },
  actionButton: {
    height: 32,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  actionText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.bg,
  },
  actionTextSecondary: {
    color: colors.neutral[400],
  },
});
