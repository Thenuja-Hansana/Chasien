import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Avatar from '@/components/Avatar';
import BottomSheet, { BottomSheetFlatList } from '@/components/BottomSheet';
import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { acceptFriendRequest, fetchFriendshipStatuses, removeFriendship, sendFriendRequest, type FriendshipStatus } from '@/lib/friends';
import { fetchPostLikers, type TaggedPerson } from '@/lib/posts';

/**
 * Who liked a post, as a bottom sheet (tap the like count). Instagram's
 * version has Follow; this app has friends, so each row carries the
 * friend action for that person's current state instead:
 *   none → Add friend · pending_sent → Requested (tap cancels) ·
 *   pending_received → Accept · friends → Friends (no action, so a tap in a
 *   list can't unfriend anyone by accident).
 * Updates optimistically and rolls back on failure.
 *
 * Opened through its `open(postId)` handle, like CommentsSheet, so opening
 * and closing don't re-render the feed behind it.
 */
export type LikesSheetHandle = { open: (postId: string) => void };

const LikesSheet = forwardRef<LikesSheetHandle, { viewerId: string }>(function LikesSheet({ viewerId }, ref) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  /** null = closed. */
  const [postId, setPostId] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ open: setPostId }), []);
  const [likers, setLikers] = useState<TaggedPerson[] | null>(null);
  const [statuses, setStatuses] = useState<Map<string, FriendshipStatus>>(new Map());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [shownPostId, setShownPostId] = useState(postId);
  if (postId !== shownPostId) {
    setShownPostId(postId);
    setLikers(null);
    setQuery('');
    setError(null);
  }

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    Promise.all([fetchPostLikers(postId), fetchFriendshipStatuses(viewerId)])
      .then(([people, friendStatuses]) => {
        if (cancelled) return;
        setLikers(people);
        setStatuses(friendStatuses);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load likes.');
      });
    return () => {
      cancelled = true;
    };
  }, [postId, viewerId]);

  const q = query.trim().toLowerCase();
  const filtered = (likers ?? []).filter((p) => !q || p.handle.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));

  async function act(person: TaggedPerson) {
    const current = statuses.get(person.userId) ?? 'none';
    if (current === 'friends') return;
    const next: FriendshipStatus = current === 'none' ? 'pending_sent' : current === 'pending_received' ? 'friends' : 'none';
    const setStatus = (s: FriendshipStatus) => setStatuses((prev) => new Map(prev).set(person.userId, s));
    setStatus(next);
    try {
      if (current === 'none') await sendFriendRequest(viewerId, person.userId);
      else if (current === 'pending_received') await acceptFriendRequest(viewerId, person.userId);
      else await removeFriendship(viewerId, person.userId);
    } catch (e) {
      setStatus(current);
      setError(e instanceof Error ? e.message : 'Could not update that friend request.');
    }
  }

  return (
    <BottomSheet visible={postId !== null} title="Likes" onClose={() => setPostId(null)}>
      <View style={styles.searchBox}>
        <Icon name="search" size={17} color={colors.neutral[500]} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={colors.neutral[500]}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search people who liked this"
        />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {likers === null && !error ? (
        <ActivityIndicator style={styles.loading} color={colors.accent.DEFAULT} />
      ) : (
        <BottomSheetFlatList
          data={filtered}
          keyExtractor={(p) => p.userId}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>{(likers ?? []).length === 0 ? 'No likes yet.' : 'No one matches that search.'}</Text>}
          renderItem={({ item }) => {
            const status = statuses.get(item.userId) ?? 'none';
            const primary = status === 'none' || status === 'pending_received';
            const label = status === 'none' ? 'Add friend' : status === 'pending_sent' ? 'Requested' : status === 'pending_received' ? 'Accept' : 'Friends';
            return (
              <View style={styles.row}>
                <Avatar gradient={item.userId} letter={item.name.charAt(0).toUpperCase() || '?'} size={48} />
                <View style={styles.rowText}>
                  <Text style={styles.handle} numberOfLines={1}>
                    {item.handle}
                  </Text>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                </View>
                {item.userId !== viewerId && (
                  <Pressable
                    style={[styles.button, primary ? styles.buttonPrimary : styles.buttonSecondary]}
                    onPress={() => act(item)}
                    disabled={status === 'friends'}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}, ${item.handle}`}
                  >
                    <Text style={[styles.buttonText, primary ? styles.buttonTextPrimary : styles.buttonTextSecondary]}>{label}</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </BottomSheet>
  );
});

export default LikesSheet;

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    searchBox: {
      height: 44,
      marginHorizontal: Spacing[4],
      marginTop: Spacing[3],
      marginBottom: Spacing[2],
      borderRadius: Radius.sm + 4,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[2],
    },
    searchInput: {
      flex: 1,
      height: 44,
      fontFamily: Fonts.body,
      fontSize: 15,
      color: colors.text,
    },
    loading: {
      marginTop: Spacing[8],
    },
    error: {
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.error,
      textAlign: 'center',
      paddingHorizontal: Spacing[4],
    },
    listContent: {
      paddingHorizontal: Spacing[4],
      paddingBottom: Spacing[4],
    },
    empty: {
      fontFamily: Fonts.body,
      fontSize: 14,
      color: colors.neutral[500],
      textAlign: 'center',
      marginTop: Spacing[8],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[3],
      paddingVertical: Spacing[2],
    },
    rowText: {
      flex: 1,
    },
    handle: {
      fontFamily: Fonts.bodyBold,
      fontSize: 15,
      color: colors.text,
    },
    name: {
      fontFamily: Fonts.body,
      fontSize: 13.5,
      color: colors.neutral[500],
    },
    button: {
      minWidth: 108,
      height: 36,
      paddingHorizontal: 14,
      borderRadius: Radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonPrimary: {
      backgroundColor: colors.accent.DEFAULT,
    },
    buttonSecondary: {
      backgroundColor: colors.surface,
    },
    buttonText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 14,
    },
    buttonTextPrimary: {
      color: colors.bg,
    },
    buttonTextSecondary: {
      color: colors.text,
    },
  });
