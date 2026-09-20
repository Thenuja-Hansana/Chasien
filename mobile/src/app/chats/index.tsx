import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import TabBar from '@/components/TabBar';
import { Fonts, MaxContentWidth, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchInbox, subscribeToInbox, type InboxItem } from '@/lib/chat';
import { cachedImageSource } from '@/lib/mediaUtils';
import { signMessageMediaUrls } from '@/lib/messageMedia';

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

/**
 * The preview line's text, plus a small real thumbnail when the last
 * message was a photo and its signed URL has come back — same "actual
 * image, not just an emoji" treatment Telegram/WhatsApp use for a photo
 * preview in a chat list. `imagePath` is the raw storage path from
 * `messages.image_url`; `mediaUrls` is the signed-URL cache this screen
 * fills in asynchronously, so a not-yet-signed path just renders the text
 * alone until its entry arrives.
 */
function RowPreview({ text, imagePath, mediaUrls }: { text: string; imagePath: string | null; mediaUrls: Map<string, string> }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const url = imagePath ? mediaUrls.get(imagePath) : undefined;

  return (
    <View style={styles.previewLine}>
      {url && <Image source={cachedImageSource(url)} style={styles.previewThumb} contentFit="cover" cachePolicy="memory-disk" />}
      <Text style={styles.rowPreview} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function timeValue(iso: string | null) {
  return iso ? new Date(iso).getTime() : 0;
}

/**
 * A Room's General channel plus every sub-group of it the user has
 * joined, collapsed into one row — same grouping WhatsApp Communities
 * and Telegram forum topics use, so a Room with sub-groups doesn't
 * scatter across this flat, cross-Room list as several look-alike rows.
 * `key` is the room_id for a group (stable across re-fetches, needed to
 * remember expand/collapse state) or the conversation_id for anything
 * ungrouped (a DM, or a room_channel row with no General counterpart in
 * the current, filtered list — e.g. a sub-group surviving the Unread
 * filter on its own).
 */
type Row = { key: string; sortAt: string | null; pinned: boolean; unread: number } & (
  | { type: 'item'; item: InboxItem }
  | { type: 'group'; main: InboxItem; subgroups: InboxItem[] }
);

function buildRows(items: InboxItem[]): Row[] {
  const byRoom = new Map<string, InboxItem[]>();
  const rows: Row[] = [];

  for (const item of items) {
    if (item.kind === 'room_channel' && item.room_id) {
      const list = byRoom.get(item.room_id) ?? [];
      list.push(item);
      byRoom.set(item.room_id, list);
    } else {
      rows.push({ key: item.conversation_id, type: 'item', item, sortAt: item.last_message_created_at, pinned: item.pinned, unread: item.unread_count });
    }
  }

  for (const roomItems of byRoom.values()) {
    const main = roomItems.find((i) => i.is_default);
    // No General in this filtered set (or nothing to nest under it) —
    // fall back to flat rows rather than inventing a parent that isn't
    // really there.
    if (!main || roomItems.length === 1) {
      for (const item of roomItems) {
        rows.push({ key: item.conversation_id, type: 'item', item, sortAt: item.last_message_created_at, pinned: item.pinned, unread: item.unread_count });
      }
      continue;
    }

    const subgroups = roomItems
      .filter((i) => i !== main)
      .sort((a, b) => timeValue(b.last_message_created_at) - timeValue(a.last_message_created_at));
    const allItems = [main, ...subgroups];
    const sortAt = allItems.reduce<string | null>(
      (latest, i) => (timeValue(i.last_message_created_at) > timeValue(latest) ? i.last_message_created_at : latest),
      null,
    );
    rows.push({
      key: main.room_id as string,
      type: 'group',
      main,
      subgroups,
      sortAt,
      pinned: main.pinned,
      unread: allItems.reduce((sum, i) => sum + i.unread_count, 0),
    });
  }

  return rows.sort((a, b) => timeValue(b.sortAt) - timeValue(a.sortAt));
}

export default function Chats() {
  const { session } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [error, setError] = useState<string | null>(null);
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());

  // Paths already handed to the signer. A ref rather than reading
  // `mediaUrls`, which this effect also writes: depending on `mediaUrls`
  // would loop forever over any path that fails to sign, because
  // signBucketUrls omits failures from its result instead of throwing, so
  // the path would stay unsigned and re-trigger the effect on every pass.
  // Reading a ref inside an effect is fine — only during render it isn't —
  // so this needs no eslint-disable, which would make the React Compiler
  // skip the whole screen.
  const requestedPaths = useRef<Set<string>>(new Set());

  useEffect(() => {
    const paths = (items ?? []).map((i) => i.last_message_image_url).filter((p): p is string => !!p);
    const unsigned = paths.filter((p) => !requestedPaths.current.has(p));
    if (unsigned.length === 0) return;
    for (const path of unsigned) requestedPaths.current.add(path);
    signMessageMediaUrls(unsigned)
      .then((signed) => setMediaUrls((prev) => new Map([...prev, ...signed])))
      .catch(() => {});
  }, [items]);

  const toggleExpand = useCallback((roomId: string) => {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }, []);

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

  const rows = useMemo(() => buildRows(visible), [visible]);

  if (!session) return null;

  const unreadCount = items?.filter((i) => i.unread_count > 0).length ?? 0;
  const pinned = rows.filter((r) => r.pinned);
  const rest = rows.filter((r) => !r.pinned);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.heading}>Chats</Text>
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
              >
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
        <View style={styles.list}>
          {[128, 96, 150, 110, 134, 100].map((nameWidth, i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={50} height={50} radius={999} />
              <View style={[styles.rowContent, { gap: 6 }]}>
                <Skeleton width={nameWidth} height={13} radius={6} />
                <Skeleton width={nameWidth + 60} height={11} radius={5} />
              </View>
            </View>
          ))}
        </View>
      ) : visible.length === 0 ? (
        <EmptyState icon="comment" heading="No chats here yet" message="Messages with people and Rooms you join will show up here." />
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: clearance }]}>
          {pinned.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Pinned</Text>
              {pinned.map((row) => (
                <RowView key={row.key} row={row} expanded={expandedRooms.has(row.key)} onToggle={() => toggleExpand(row.key)} mediaUrls={mediaUrls} />
              ))}
            </>
          )}
          {rest.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Today</Text>
              {rest.map((row) => (
                <RowView key={row.key} row={row} expanded={expandedRooms.has(row.key)} onToggle={() => toggleExpand(row.key)} mediaUrls={mediaUrls} />
              ))}
            </>
          )}
        </ScrollView>
      )}
      </View>

      <TabBar active="Chats" userId={session.user.id} />
    </SafeAreaView>
  );
}

function RowView({
  row,
  expanded,
  onToggle,
  mediaUrls,
}: {
  row: Row;
  expanded: boolean;
  onToggle: () => void;
  mediaUrls: Map<string, string>;
}) {
  if (row.type === 'item') return <ChatRow item={row.item} mediaUrls={mediaUrls} />;
  return <GroupRow main={row.main} subgroups={row.subgroups} unread={row.unread} expanded={expanded} onToggle={onToggle} mediaUrls={mediaUrls} />;
}

function ChatRow({ item, mediaUrls }: { item: InboxItem; mediaUrls: Map<string, string> }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const avatarKey = item.kind === 'room_channel' ? (item.room_id ?? 'grit') : (item.otherUserId ?? 'mara');
  const letter = item.title.charAt(0).toUpperCase();

  return (
    <Pressable
      style={[styles.row, item.pinned && styles.rowPinned]}
      onPress={() => router.push({ pathname: '/chats/[chatId]', params: { chatId: item.conversation_id } })}
    >
      <Avatar
        gradient={avatarKey}
        color={item.kind === 'room_channel' ? item.room_accent_color : undefined}
        letter={letter}
        shape={item.kind === 'room_channel' ? 'square' : 'circle'}
        size={50}
      />
      <View style={styles.rowContent}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.kind === 'room_channel' ? `${item.title} · ${item.channel_name}` : item.title}
          </Text>
          {item.pinned && <Icon name="bookmark" size={12} color={colors.neutral[500]} filled />}
          {item.muted && <Icon name="bellSlash" size={13} color={colors.neutral[500]} />}
        </View>
        <RowPreview text={previewFor(item)} imagePath={item.last_message_image_url} mediaUrls={mediaUrls} />
      </View>
      <View style={styles.rowMeta}>
        {item.unread_count > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
          </View>
        )}
        <Text style={styles.rowTime}>{formatTime(item.last_message_created_at)}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The collapsed row for a Room: General's own preview, unless a
 * sub-group has more recent activity, in which case that sub-group's
 * name and message lead instead (same convention Telegram uses for a
 * forum-group row when a topic other than General is the active one).
 * The chevron only appears here — never on a plain DM/ungrouped row —
 * since it's the only thing on this screen that has anything to expand.
 */
function GroupRow({
  main,
  subgroups,
  unread,
  expanded,
  onToggle,
  mediaUrls,
}: {
  main: InboxItem;
  subgroups: InboxItem[];
  unread: number;
  expanded: boolean;
  onToggle: () => void;
  mediaUrls: Map<string, string>;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const previewSource = [main, ...subgroups].reduce(
    (latest, i) => (timeValue(i.last_message_created_at) > timeValue(latest.last_message_created_at) ? i : latest),
    main,
  );
  const previewText = previewSource === main ? previewFor(main) : `${previewSource.channel_name ?? 'Sub-group'}: ${previewFor(previewSource)}`;

  return (
    <View>
      <Pressable
        style={[styles.row, main.pinned && styles.rowPinned]}
        onPress={() => router.push({ pathname: '/chats/[chatId]', params: { chatId: main.conversation_id } })}
      >
        <Avatar gradient={main.room_id ?? 'grit'} color={main.room_accent_color} letter={main.title.charAt(0).toUpperCase()} shape="square" size={50} />
        <View style={styles.rowContent}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {main.title}
            </Text>
            {main.pinned && <Icon name="bookmark" size={12} color={colors.neutral[500]} filled />}
            {main.muted && <Icon name="bellSlash" size={13} color={colors.neutral[500]} />}
          </View>
          <RowPreview text={previewText} imagePath={previewSource.last_message_image_url} mediaUrls={mediaUrls} />
        </View>
        <View style={styles.rowMeta}>
          {unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unread}</Text>
            </View>
          )}
          <View style={styles.timeChevronRow}>
            <Text style={styles.rowTime}>{formatTime(previewSource.last_message_created_at)}</Text>
            <Pressable
              hitSlop={10}
              onPress={onToggle}
              accessibilityRole="button"
              accessibilityLabel={`${main.title} sub-groups`}
              accessibilityState={{ expanded }}
            >
              <Icon name={expanded ? 'chevronDown' : 'chevronLeft'} size={16} color={colors.neutral[400]} />
            </Pressable>
          </View>
        </View>
      </Pressable>

      {expanded &&
        subgroups.map((child) => (
          <Pressable
            key={child.conversation_id}
            style={[styles.row, styles.childRow]}
            onPress={() => router.push({ pathname: '/chats/[chatId]', params: { chatId: child.conversation_id } })}
          >
            <Avatar
              gradient={child.room_id ?? 'grit'}
              color={child.room_accent_color}
              letter={(child.channel_name ?? '?').charAt(0).toUpperCase()}
              shape="square"
              size={40}
            />
            <View style={styles.rowContent}>
              <View style={styles.rowTitleLine}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {child.channel_name}
                </Text>
                {child.muted && <Icon name="bellSlash" size={13} color={colors.neutral[500]} />}
              </View>
              <RowPreview text={previewFor(child)} imagePath={child.last_message_image_url} mediaUrls={mediaUrls} />
            </View>
            <View style={styles.rowMeta}>
              {child.unread_count > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{child.unread_count}</Text>
                </View>
              )}
              <Text style={styles.rowTime}>{formatTime(child.last_message_created_at)}</Text>
            </View>
          </Pressable>
        ))}
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
  header: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
    gap: Spacing[3],
  },
  heading: {
    fontFamily: Fonts.heading,
    fontSize: 26,
    color: colors.text,
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
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.accent.DEFAULT,
    borderColor: colors.accent.DEFAULT,
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.neutral[400],
  },
  chipTextActive: {
    color: colors.bg,
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
  sectionLabel: {
    ...Typography.label,
    color: colors.neutral[500],
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
    backgroundColor: `${colors.accent.DEFAULT}12`,
  },
  childRow: {
    paddingLeft: Spacing[6] + 20,
  },
  timeChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    color: colors.text,
    flexShrink: 1,
  },
  previewLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  previewThumb: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  rowPreview: {
    flexShrink: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 5,
  },
  rowTime: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: colors.neutral[500],
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
    fontFamily: Fonts.body,
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.bg,
  },
});
