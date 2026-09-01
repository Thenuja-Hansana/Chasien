import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import TabBar from '@/components/TabBar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchInbox, subscribeToInbox, type InboxItem } from '@/lib/chat';

const FILTERS = ['All', 'Unread', 'Rooms', 'DMs'] as const;
type Filter = (typeof FILTERS)[number];

function formatTime(iso: string | null) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function previewFor(item: InboxItem) {
  if (item.last_message_text) return item.last_message_text;
  if (item.last_message_image_url) return '📷 Photo';
  if (item.last_message_voice_url) return '🎤 Voice message';
  return 'No messages yet';
}

export default function Chats() {
  const { session } = useAuth();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(() => {
    if (!userId) return;
    fetchInbox(userId)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chats.'));
  }, [userId]);

  useFocusEffect(useCallback(() => load(), [load]));

  useEffect(() => {
    if (!userId) return;
    const unsubscribe = subscribeToInbox(userId, load);
    return unsubscribe;
  }, [userId, load]);

  const visible = useMemo(() => {
    if (!items) return [];
    if (filter === 'Unread') return items.filter((i) => i.unread_count > 0);
    if (filter === 'Rooms') return items.filter((i) => i.kind === 'room_channel');
    if (filter === 'DMs') return items.filter((i) => i.kind === 'dm');
    return items;
  }, [items, filter]);

  if (!session) return null;

  const unreadCount = items?.filter((i) => i.unread_count > 0).length ?? 0;
  const pinned = visible.filter((i) => i.pinned);
  const rest = visible.filter((i) => !i.pinned);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Chats</Text>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable key={f} style={[styles.chip, active && styles.chipActive]} onPress={() => setFilter(f)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {f}
                  {f === 'Unread' && unreadCount > 0 ? ` ${unreadCount}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {items === null ? (
        <View style={styles.empty}>
          <ActivityIndicator color={Colors.accent.DEFAULT} />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.body}>No chats here yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {pinned.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Pinned</Text>
              {pinned.map((item) => (
                <ChatRow key={item.conversation_id} item={item} />
              ))}
            </>
          )}
          {rest.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Today</Text>
              {rest.map((item) => (
                <ChatRow key={item.conversation_id} item={item} />
              ))}
            </>
          )}
        </ScrollView>
      )}

      <TabBar active="Chats" userId={session.user.id} />
    </SafeAreaView>
  );
}

function ChatRow({ item }: { item: InboxItem }) {
  const avatarKey = item.kind === 'room_channel' ? (item.room_id ?? 'grit') : (item.otherUserId ?? 'mara');
  const letter = item.title.charAt(0).toUpperCase();

  return (
    <Pressable
      style={[styles.row, item.pinned && styles.rowPinned]}
      onPress={() => router.push({ pathname: '/chats/[chatId]', params: { chatId: item.conversation_id } })}
    >
      <Avatar gradient={avatarKey} letter={letter} shape={item.kind === 'room_channel' ? 'square' : 'circle'} size={50} />
      <View style={styles.rowContent}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.kind === 'room_channel' ? `${item.title} · ${item.channel_name}` : item.title}
          </Text>
          {item.pinned && <Icon name="bookmark" size={12} color={Colors.neutral[500]} filled />}
          {item.muted && <Icon name="bellSlash" size={13} color={Colors.neutral[500]} />}
        </View>
        <Text style={styles.rowPreview} numberOfLines={1}>
          {previewFor(item)}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowTime}>{formatTime(item.last_message_created_at)}</Text>
        {item.unread_count > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[3],
    gap: Spacing[3],
  },
  heading: {
    fontFamily: Fonts.heading,
    fontSize: 26,
    color: Colors.text,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 7,
  },
  chip: {
    height: 30,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: Colors.accent.DEFAULT,
    borderColor: Colors.accent.DEFAULT,
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.neutral[400],
  },
  chipTextActive: {
    color: Colors.bg,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.neutral[400],
  },
  list: {
    paddingBottom: Spacing[8],
  },
  sectionLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.neutral[500],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: 10,
  },
  rowPinned: {
    backgroundColor: `${Colors.accent.DEFAULT}12`,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowTitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    flexShrink: 1,
  },
  rowPreview: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.neutral[400],
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 5,
  },
  rowTime: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.neutral[500],
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.bg,
  },
});
