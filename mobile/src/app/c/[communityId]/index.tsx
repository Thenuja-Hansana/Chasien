import { Link, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import PostCard from '@/components/PostCard';
import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchUnreadCount, subscribeToNotifications } from '@/lib/notifications';
import { fetchMyMembership, fetchRoomBySlug, joinRoom, respondToInvite, type Membership, type Room } from '@/lib/rooms';
import { FEED_PAGE_SIZE, fetchPost, fetchRoomFeed, setLiked, votePoll, type FeedPost } from '@/lib/posts';
import { fetchActiveStories, type Story } from '@/lib/stories';

type LoadState = { room: Room | null; membership: Membership | null } | 'loading';

// One ring per author, not one per story — fetchActiveStories() returns
// every active story, so an author with two up would otherwise get two
// rings. The viewer itself still walks every story in order regardless
// of which ring was tapped (matches the mock's StoryViewer flow).
function dedupeStoryAuthors(stories: Story[]): Story[] {
  const seen = new Set<string>();
  const result: Story[] = [];
  for (const s of stories) {
    const key = s.author_id ?? s.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(s);
  }
  return result;
}

export default function RoomHome() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [page, setPage] = useState(0);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Deliberately not paired with mediaUrls/signing the way posts and
  // messages are — the ring row only ever needs each author's own
  // profile info, never the story media itself. The viewer screen signs
  // media on its own when it's actually opened.
  const [activeStories, setActiveStories] = useState<Story[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const userId = session?.user.id;

  const loadFeed = useCallback(
    async (roomId: string) => {
      if (!userId) return;
      const first = await fetchRoomFeed(roomId, userId, 0);
      setPosts(first);
      setPage(0);
      setReachedEnd(first.length < FEED_PAGE_SIZE);
    },
    [userId],
  );

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const room = await fetchRoomBySlug(communityId);
      const membership = room ? await fetchMyMembership(room.id, userId) : null;
      setState({ room, membership });
      if (room && membership?.join_state === 'approved') {
        await loadFeed(room.id);
        setActiveStories(await fetchActiveStories(room.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load this Room.');
    }
  }, [communityId, userId, loadFeed]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loadUnreadCount = useCallback(() => {
    if (!userId) return;
    fetchUnreadCount(userId).then(setUnreadCount).catch(() => {});
  }, [userId]);

  useFocusEffect(useCallback(() => loadUnreadCount(), [loadUnreadCount]));

  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, loadUnreadCount);
  }, [userId, loadUnreadCount]);

  if (!session) return null;

  async function handleJoin(room: Room) {
    setBusy(true);
    setError(null);
    try {
      await joinRoom(room.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteResponse(room: Room, accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      await respondToInvite(room.id, accept);
      if (accept) await load();
      else router.replace('/discover');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not respond to the invite.');
    } finally {
      setBusy(false);
    }
  }

  // Optimistic: the count moves on tap and reverts if the write is
  // rejected, rather than making every like wait on a round trip.
  async function handleToggleLike(post: FeedPost) {
    if (!userId) return;
    const nextLiked = !post.likedByMe;
    setPosts(
      (prev) =>
        prev?.map((p) =>
          p.id === post.id ? { ...p, likedByMe: nextLiked, likeCount: p.likeCount + (nextLiked ? 1 : -1) } : p,
        ) ?? prev,
    );
    try {
      await setLiked(post.id, userId, nextLiked);
    } catch (e) {
      setPosts(
        (prev) =>
          prev?.map((p) =>
            p.id === post.id ? { ...p, likedByMe: post.likedByMe, likeCount: post.likeCount } : p,
          ) ?? prev,
      );
      setError(e instanceof Error ? e.message : 'Could not update that like.');
    }
  }

  // PollCard shows its own optimistic bar; this refetches just the one
  // post afterwards so the displayed tallies are the server's, not a
  // client-side guess that could drift from other people's votes.
  async function handleVote(post: FeedPost, optionId: string) {
    if (!userId || !post.poll) return;
    try {
      await votePoll(post.poll.id, optionId, userId, post.poll.myOptionId);
      const fresh = await fetchPost(post.id, userId);
      if (fresh) setPosts((prev) => prev?.map((p) => (p.id === post.id ? fresh : p)) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that vote.');
    }
  }

  async function handleLoadMore(roomId: string) {
    if (loadingMore || reachedEnd || !posts || !userId) return;
    setLoadingMore(true);
    try {
      const next = await fetchRoomFeed(roomId, userId, page + 1);
      setPosts([...posts, ...next]);
      setPage(page + 1);
      if (next.length < FEED_PAGE_SIZE) setReachedEnd(true);
    } catch {
      setReachedEnd(true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleRefresh(roomId: string) {
    setRefreshing(true);
    try {
      await loadFeed(roomId);
    } finally {
      setRefreshing(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <ActivityIndicator color={Colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  const { room, membership } = state;

  if (!room) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>Room not found</Text>
        <Text style={styles.body}>It may not exist, or you don&apos;t have access to it.</Text>
        <Pressable style={styles.cta} onPress={() => router.replace('/discover')}>
          <Text style={styles.ctaText}>Back to Discover</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!membership) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>{room.name}</Text>
        {room.description ? <Text style={styles.body}>{room.description}</Text> : null}
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={styles.cta} onPress={() => handleJoin(room)} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={Colors.bg} />
          ) : (
            <Text style={styles.ctaText}>{room.visibility === 'public' ? 'Join' : 'Request to join'}</Text>
          )}
        </Pressable>
      </SafeAreaView>
    );
  }

  if (membership.join_state === 'pending') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>{room.name}</Text>
        <Text style={styles.body}>Your request to join is pending approval from a mod.</Text>
      </SafeAreaView>
    );
  }

  if (membership.join_state === 'invited') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>{room.name}</Text>
        <Text style={styles.body}>You&apos;ve been invited to join this Room.</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.inviteActions}>
          <Pressable style={[styles.cta, styles.inviteCta]} onPress={() => handleInviteResponse(room, true)} disabled={busy}>
            <Text style={styles.ctaText}>Accept</Text>
          </Pressable>
          <Pressable
            style={[styles.declineCta, styles.inviteCta]}
            onPress={() => handleInviteResponse(room, false)}
            disabled={busy}
          >
            <Text style={styles.declineCtaText}>Decline</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const canPost = room.members_can_post || membership.role === 'owner' || membership.role === 'mod';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {room.name}
        </Text>
        <View style={styles.headerActions}>
          <Link href="/notifications" asChild>
            <Pressable hitSlop={8} style={styles.bellWrap}>
              <Icon name="bell" size={20} color={Colors.text} />
              {unreadCount > 0 && <View style={styles.unreadDot} />}
            </Pressable>
          </Link>
          <Link href="/search" asChild>
            <Pressable hitSlop={8}>
              <Icon name="search" size={20} color={Colors.text} />
            </Pressable>
          </Link>
          <Link href={{ pathname: '/c/[communityId]/settings', params: { communityId } }} asChild>
            <Pressable hitSlop={8}>
              <Icon name="settings" size={20} color={Colors.text} />
            </Pressable>
          </Link>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRow}>
        <Link href={{ pathname: '/c/[communityId]/create-story', params: { communityId } }} asChild>
          <Pressable style={styles.storyItem}>
            <View style={styles.storyAddCircle}>
              <Icon name="plus" size={22} color={Colors.accent.DEFAULT} />
            </View>
            <Text style={styles.storyLabel}>Your story</Text>
          </Pressable>
        </Link>
        {dedupeStoryAuthors(activeStories).map((s) => (
          <Pressable
            key={s.author_id ?? s.id}
            style={styles.storyItem}
            onPress={() =>
              router.push({
                pathname: '/c/[communityId]/story',
                params: { communityId, authorId: s.author_id ?? undefined },
              })
            }
          >
            <Avatar gradient={s.author_id ?? 'mara'} letter={s.authorName.charAt(0).toUpperCase()} size={60} ring />
            <Text style={styles.storyLabel} numberOfLines={1}>
              {s.authorHandle || s.authorName}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {error && <Text style={styles.error}>{error}</Text>}

      {posts === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.accent.DEFAULT} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(post) => post.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => handleRefresh(room.id)}
              tintColor={Colors.accent.DEFAULT}
            />
          }
          ListHeaderComponent={
            posts.length > 0 ? (
              <View style={styles.newestRow}>
                <Text style={styles.newestLabel}>Newest first</Text>
                <View style={styles.newestRule} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyFeed}>
              <Text style={styles.emptyHeading}>No posts yet</Text>
              <Text style={styles.body}>
                {canPost ? 'Be the first to post in this Room.' : 'Only mods can post in this Room.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={Colors.accent.DEFAULT} /> : null
          }
          onEndReached={() => handleLoadMore(room.id)}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              onPress={() =>
                router.push({
                  pathname: '/c/[communityId]/post/[postId]',
                  params: { communityId, postId: item.id },
                })
              }
              onToggleLike={() => handleToggleLike(item)}
              onVote={(optionId) => handleVote(item, optionId)}
            />
          )}
        />
      )}

      {canPost && (
        <Link href={{ pathname: '/c/[communityId]/create-post', params: { communityId } }} asChild>
          <Pressable style={styles.fab}>
            <Icon name="plus" size={24} color={Colors.bg} />
          </Pressable>
        </Link>
      )}

      <TabBar active="Home" communityId={communityId} userId={session.user.id} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },
  title: {
    flex: 1,
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: Colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing[4],
  },
  bellWrap: {
    position: 'relative',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: Colors.accent.DEFAULT,
    borderWidth: 1.5,
    borderColor: Colors.bg,
  },
  storyRow: {
    flexDirection: 'row',
    gap: Spacing[4],
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[4],
  },
  storyItem: {
    alignItems: 'center',
    gap: Spacing[1],
    width: 64,
  },
  storyAddCircle: {
    width: 60,
    height: 60,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyLabel: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: Colors.neutral[400],
  },
  newestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[2],
  },
  newestLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.accent[300],
  },
  newestRule: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.divider,
  },
  emptyFeed: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingTop: Spacing[8],
    paddingHorizontal: Spacing[6],
  },
  emptyHeading: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: Colors.text,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    textAlign: 'center',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[2],
  },
  footerSpinner: {
    paddingVertical: Spacing[4],
  },
  cta: {
    marginTop: Spacing[4],
    height: 44,
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.bg,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginTop: Spacing[4],
  },
  inviteCta: {
    flex: 1,
    marginTop: 0,
  },
  declineCta: {
    flex: 1,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineCtaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.text,
  },
  fab: {
    position: 'absolute',
    right: Spacing[4],
    bottom: 96,
    width: 54,
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    // `boxShadow` rather than the shadow* family: RN Web logs a
    // deprecation warning for shadowColor/Offset/Opacity/Radius on every
    // render (32 of them in one verification run). `elevation` stays for
    // Android, which doesn't read boxShadow.
    boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.3)',
    elevation: 6,
  },
});
