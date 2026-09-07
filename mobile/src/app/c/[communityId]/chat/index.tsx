import { BlurTargetView } from 'expo-blur';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Spacing, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchInbox, type InboxItem } from '@/lib/chat';
import { fetchMyMembership, fetchRoomBySlug, type Room } from '@/lib/rooms';

function previewFor(item: InboxItem) {
  if (item.last_message_text) return item.last_message_text;
  if (item.last_message_image_url) return '📷 Photo';
  if (item.last_message_voice_url) return '🎤 Voice message';
  return 'No messages yet';
}

/**
 * A Room's own chat space: General (auto-joined the moment you join the
 * Room, always present) plus whichever sub-groups you've actually
 * joined — independent membership, never inherited from the Room join
 * (see the 20260905140xxx migrations). "Discover sub-groups" is the
 * separate All-Groups view, listing every sub-group whether joined or
 * not.
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
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetchRoomBySlug(communityId);
      setRoom(r);
      if (!r) return;
      const [membership, inbox] = await Promise.all([fetchMyMembership(r.id, userId), fetchInbox(userId)]);
      setCanCreate(membership?.role === 'owner' || membership?.role === 'admin');
      setItems(inbox.filter((i) => i.kind === 'room_channel' && i.room_id === r.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load this Room's chat.");
    }
  }, [communityId, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!session) return null;

  if (room === 'loading' || items === null) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <ActivityIndicator color={colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!room) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.body}>Room not found.</Text>
      </SafeAreaView>
    );
  }

  const general = items.find((i) => i.is_default);
  const subgroups = items.filter((i) => !i.is_default);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
        <View style={styles.header}>
          <Pressable style={styles.headerSide} hitSlop={8} onPress={() => router.back()}>
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
            >
              <Icon name="plus" size={22} color={colors.text} strokeWidth={2.4} />
            </Pressable>
          ) : (
            <View style={styles.headerSide} />
          )}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: clearance }]}>
          {general && <ChatEntryRow item={general} />}

          <Text style={styles.sectionLabel}>Sub-groups</Text>
          {subgroups.length === 0 ? (
            <Text style={styles.emptyNote}>You haven&apos;t joined any sub-groups yet.</Text>
          ) : (
            subgroups.map((item) => <ChatEntryRow key={item.conversation_id} item={item} />)
          )}

          <Pressable
            style={styles.discoverRow}
            onPress={() => router.push({ pathname: '/c/[communityId]/chat/discover', params: { communityId } })}
          >
            <View style={styles.discoverIcon}>
              <Icon name="search" size={18} color={colors.bg} strokeWidth={2.4} />
            </View>
            <Text style={styles.discoverText}>Discover sub-groups</Text>
            <Icon name="chevronRight" size={18} color={colors.neutral[400]} />
          </Pressable>
        </ScrollView>
      </BlurTargetView>
    </SafeAreaView>
  );
}

function ChatEntryRow({ item }: { item: InboxItem }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const label = item.is_default ? 'General' : (item.channel_name ?? 'Sub-group');

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => router.push({ pathname: '/chats/[chatId]', params: { chatId: item.conversation_id } })}
    >
      <Avatar gradient={item.room_id ?? 'grit'} letter={label.charAt(0).toUpperCase()} shape="square" size={48} />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {previewFor(item)}
        </Text>
      </View>
      {item.unread_count > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
        </View>
      )}
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
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
  },
  list: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingBottom: Spacing[8],
  },
  sectionLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.neutral[500],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[1],
  },
  emptyNote: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: colors.neutral[400],
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[2],
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
  discoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[3],
    marginTop: Spacing[3],
  },
  discoverIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discoverText: {
    flex: 1,
    fontFamily: Fonts.bodySemibold,
    fontSize: 14.5,
    color: colors.text,
  },
});
