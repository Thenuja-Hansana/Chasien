import { BlurTargetView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Link, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import PostCard from '@/components/PostCard';
import PostCardSkeleton from '@/components/PostCardSkeleton';
import PostFab, { FAB_SIZE } from '@/components/PostFab';
import TabBar from '@/components/TabBar';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchRoomUnreadCounts, markAllNotificationsRead, subscribeToNotifications } from '@/lib/notifications';
import { getCachedJoinedRoom } from '@/lib/room-cache';
import { fetchMyMembership, fetchRoomBySlug, joinRoom, respondToInvite, type Membership, type Room } from '@/lib/rooms';
import { FEED_PAGE_SIZE, deletePost, fetchPost, fetchRoomFeed, hidePost, setLiked, votePoll, type FeedPost } from '@/lib/posts';
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
  // Render the header immediately if Home already told us this Room and
  // our role in it (tapping in from the "my Rooms" list, the common case)
  // instead of starting on a blank loading screen every time — see
  // lib/room-cache.ts. `load()` below still re-fetches to catch anything
  // that's actually changed since.
  const [state, setState] = useState<LoadState>(() => {
    const cached = getCachedJoinedRoom(communityId);
    return cached ? { room: cached.room, membership: { role: cached.myRole, join_state: 'approved' } } : 'loading';
  });
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
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const blurTargetRef = useRef<View>(null);

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
    // Cache hit: the feed and stories fetch don't actually depend on
    // fresh room+membership data (only on the room's id, which the cache
    // already gives us), so start them right away instead of gating both
    // behind a room+membership round trip that, for a Room you're already
    // in, almost always comes back unchanged.
    const cached = getCachedJoinedRoom(communityId);
    const immediateFeed = cached
      ? Promise.all([loadFeed(cached.room.id), fetchActiveStories(cached.room.id).then(setActiveStories)])
      : null;
    try {
      const room = await fetchRoomBySlug(communityId);
      const membership = room ? await fetchMyMembership(room.id, userId) : null;
      setState({ room, membership });
      if (room && membership?.join_state === 'approved') {
        // Independent of each other either way — run together rather than
        // one after the other.
        await (immediateFeed ?? Promise.all([loadFeed(room.id), fetchActiveStories(room.id).then(setActiveStories)]));
        // Actually opening a Room reads its activity, same as a real chat
        // app marking a thread read the instant you open it — without
        // this, the badge stayed stuck at whatever it was even after the
        // member had genuinely seen everything, since nothing else in the
        // app ever called this. Cheap no-op once already caught up.
        markAllNotificationsRead(userId, room.id)
          .then(() => setUnreadCount(0))
          .catch(() => {});
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

  // Room-scoped, not the app-wide total the bell shows everywhere else —
  // the badge on this Room's own header bell now has to agree with what
  // tapping it actually opens (this Room's Activity, not everything).
  const loadUnreadCount = useCallback(() => {
    if (!userId) return;
    const roomId = state !== 'loading' ? state.room?.id : undefined;
    if (!roomId) return;
    fetchRoomUnreadCounts(userId)
      .then((counts) => setUnreadCount(counts.get(roomId) ?? 0))
      .catch(() => {});
  }, [userId, state]);

  useFocusEffect(useCallback(() => loadUnreadCount(), [loadUnreadCount]));

  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, loadUnreadCount);
  }, [userId, loadUnreadCount]);

  if (!session) return null;

  async function handleJoin(room: Room) {
    if (room.visibility === 'domain_verified') {
      router.push({ pathname: '/c/[communityId]/verify-email', params: { communityId } });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setBusy(true);
    setError(null);
    try {
      await joinRoom(room.id);
      await load();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteResponse(room: Room, accept: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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
      await votePoll(post.poll.id, optionId);
      const fresh = await fetchPost(post.id, userId);
      if (fresh) setPosts((prev) => prev?.map((p) => (p.id === post.id ? fresh : p)) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that vote.');
    }
  }

  // Not optimistic, unlike the like/vote handlers above — a menu action
  // already has a tap-through-confirm's worth of latency ahead of it, so
  // waiting for the real result (rather than removing the card immediately
  // and having to re-insert it at the right sorted position on failure) is
  // simpler and the delay is imperceptible.
  async function handleHidePost(post: FeedPost) {
    if (!userId) return;
    try {
      await hidePost(post.id, userId);
      setPosts((prev) => prev?.filter((p) => p.id !== post.id) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hide that post.');
    }
  }

  async function handleDeletePost(post: FeedPost) {
    try {
      await deletePost(post.id);
      setPosts((prev) => prev?.filter((p) => p.id !== post.id) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that post.');
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
        <ActivityIndicator color={colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  const { room, membership } = state;

  if (!room) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <EmptyState
          icon="alertCircle"
          heading="Room not found"
          message="It may not exist, or you don't have access to it."
          actionLabel="Back to Discover"
          onAction={() => router.replace('/discover')}
        />
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
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.ctaText}>
              {room.visibility === 'public' ? 'Join' : room.visibility === 'domain_verified' ? 'Verify your email to join' : 'Request to join'}
            </Text>
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

  const canPost = room.members_can_post || membership.role === 'owner' || membership.role === 'admin' || membership.role === 'mod';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {room.name}
        </Text>
        <View style={styles.headerActions}>
          <Link href={{ pathname: '/c/[communityId]/chat', params: { communityId } }} asChild>
            <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel="Open chat">
              <Icon name="comment" size={24} color={colors.text} />
            </Pressable>
          </Link>
          <Link href={{ pathname: '/notifications', params: { roomId: room.id, roomName: room.name } }} asChild>
            <Pressable
              hitSlop={8}
              style={styles.bellWrap}
              accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? 'Activity, unread' : 'Activity'}
            >
              <Icon name="bell" size={24} color={colors.text} />
              {unreadCount > 0 && <View style={styles.unreadDot} />}
            </Pressable>
          </Link>
          <Link href={{ pathname: '/c/[communityId]/settings', params: { communityId } }} asChild>
            <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel="Room settings">
              <Icon name="settings" size={24} color={colors.text} />
            </Pressable>
          </Link>
        </View>
      </View>

      {/* Hard height on a plain View wrapper, not on the FlatList's own
          `style` — a horizontal ScrollView on Android (which a horizontal
          FlatList renders internally, same as the plain ScrollView this
          used to be) doesn't reliably respect a height set that way and
          was stretching to fill whatever vertical space happened to be
          free (visible as a huge gap before the first post whenever that
          free space was large, e.g. a Room with just one short post). A
          plain View's height is a hard Yoga constraint the list is then
          measured within. */}
      <View style={styles.storyScroll}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.storyRow}
          removeClippedSubviews
          windowSize={5}
          data={dedupeStoryAuthors(activeStories)}
          keyExtractor={(s) => s.author_id ?? s.id}
          ListHeaderComponent={
            <Link href={{ pathname: '/c/[communityId]/create-story', params: { communityId } }} asChild>
              <Pressable style={styles.storyItem}>
                <View style={styles.storyAddCircle}>
                  <Icon name="plus" size={22} color={colors.accent.DEFAULT} />
                </View>
                <Text style={styles.storyLabel}>Your story</Text>
              </Pressable>
            </Link>
          }
          renderItem={({ item: s }) => (
            <Pressable
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
          )}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {posts === null ? (
        <View>
          <PostCardSkeleton />
          <PostCardSkeleton bodyHeight={220} />
          <PostCardSkeleton bodyHeight={100} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(post) => post.id}
          contentContainerStyle={[
            styles.feedContent,
            { paddingBottom: canPost ? clearance + FAB_SIZE + Spacing[3] : clearance },
          ]}
          removeClippedSubviews
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={7}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => handleRefresh(room.id)}
              tintColor={colors.accent.DEFAULT}
            />
          }
          ListHeaderComponent={
            posts.length > 0 ? (
              <View style={styles.newestRow}>
                <View style={styles.newestRule} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="textLines"
              heading="No posts yet"
              message={canPost ? 'Be the first to post in this Room.' : 'Only mods can post in this Room.'}
            />
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.footerSpinner} color={colors.accent.DEFAULT} /> : null
          }
          onEndReached={() => handleLoadMore(room.id)}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              viewerId={session.user.id}
              viewerIsRoomOwner={membership.role === 'owner'}
              onPress={() =>
                router.push({
                  pathname: '/c/[communityId]/post/[postId]',
                  params: { communityId, postId: item.id },
                })
              }
              onToggleLike={() => handleToggleLike(item)}
              onVote={(optionId) => handleVote(item, optionId)}
              onHide={() => handleHidePost(item)}
              onDelete={() => handleDeletePost(item)}
            />
          )}
        />
      )}
      </BlurTargetView>

      <TabBar active="Home" communityId={communityId} userId={session.user.id} blurTarget={blurTargetRef} />
      {canPost && <PostFab communityId={communityId} />}
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
  // Caps the feed at a readable line length and centers it on a tablet —
  // a single-column social feed stretched edge-to-edge on a 10" screen
  // reads as unfinished, not "responsive".
  feedContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
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
    paddingTop: Spacing[4],
    paddingBottom: Spacing[4],
  },
  title: {
    flex: 1,
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: colors.text,
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
    backgroundColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  // Story item content (60px avatar + gap + label) plus storyRow's own
  // paddingBottom — matched explicitly rather than left for the
  // ScrollView to infer, see the comment where this is used.
  storyScroll: {
    height: 92,
  },
  storyRow: {
    flexDirection: 'row',
    gap: Spacing[4],
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[3],
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
    borderColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyLabel: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    color: colors.neutral[400],
  },
  newestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[2],
  },
  newestRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.divider,
  },
  emptyHeading: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
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
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: colors.bg,
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
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineCtaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: colors.text,
  },
});
