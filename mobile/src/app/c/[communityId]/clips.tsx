import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import CommentsSheet, { type CommentsSheetHandle } from '@/components/CommentsSheet';
import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { VIDEO_BUFFER_OPTIONS } from '@/lib/mediaUtils';
import { cursorOf, fetchPost, fetchRoomClips, isClipPost, setLiked, type FeedCursor, type FeedPost } from '@/lib/posts';
import { fetchMyMembership } from '@/lib/rooms';

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 80 };

/**
 * The full-screen clips viewer, opened by tapping a clip in a Room's feed:
 * one clip per screen, swipe up for the next. Starts on the clip that was
 * tapped, with the Room's newer clips above it and older ones below, loading
 * more older ones as you reach the end — reverse-chronological like the
 * feed, never ranked.
 *
 * Built on the existing posts data (a clip is a single-video post — see
 * isClipPost), so no backend work yet. Later, when it's worth it: view
 * counts, poster thumbnails (there's no thumbnail extraction step today, so
 * a clip shows black until its first frame), preloading, video compression.
 *
 * Memory: only the visible clip and its immediate neighbours have a video
 * player at all; the rest render as black placeholders. Each player is
 * created when its slide comes near and released when it leaves, which
 * matters on a low-end phone like the Galaxy A14.
 */
export default function Clips() {
  const { postId } = useLocalSearchParams<{ communityId: string; postId: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { height } = useWindowDimensions();

  const [clips, setClips] = useState<FeedPost[] | null>(null);
  const [initialIndex, setInitialIndex] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [olderCursor, setOlderCursor] = useState<FeedCursor | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Which post's comments are open lives in the sheet, so opening it doesn't
  // re-render the clips list (and its video players) behind it.
  const commentsSheetRef = useRef<CommentsSheetHandle>(null);
  const [error, setError] = useState<string | null>(null);
  // Owner/admin/mod of the clips' Room: offered "Remove" on other people's comments.
  const [canModerate, setCanModerate] = useState(false);

  useEffect(() => {
    if (!userId || !postId) return;
    let cancelled = false;
    // .catch() rather than try/catch: the React Compiler can't compile the
    // conditionals below inside a try, and skips the whole screen.
    const loadAround = async () => {
      const start = await fetchPost(postId, userId);
      if (!start || !isClipPost(start)) {
        if (!cancelled) setError('This clip isn’t available any more.');
        return;
      }
      const [newer, older] = await Promise.all([
        fetchRoomClips(start.roomId, userId, cursorOf(start), 'newer'),
        fetchRoomClips(start.roomId, userId, cursorOf(start), 'older'),
      ]);
      if (cancelled) return;
      setClips([...newer.clips, start, ...older.clips]);
      setInitialIndex(newer.clips.length);
      setActiveIndex(newer.clips.length);
      setOlderCursor(older.nextCursor);
      setReachedEnd(older.reachedEnd);
      fetchMyMembership(start.roomId, userId)
        .then((m) => setCanModerate(m?.join_state === 'approved' && m.role !== 'member'))
        .catch(() => {});
    };
    loadAround().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load clips.');
    });
    return () => {
      cancelled = true;
    };
  }, [postId, userId]);

  // setActiveIndex is stable, so this callback is too — FlatList requires
  // onViewableItemsChanged not to change identity between renders.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]?.index;
    if (first != null) setActiveIndex(first);
  }, []);

  async function loadOlder() {
    if (!userId || !clips || reachedEnd || loadingMore || !olderCursor) return;
    setLoadingMore(true);
    // No `finally`: the React Compiler skips a component that has one, and
    // the catch handles every error, so this is equivalent.
    try {
      const roomId = clips[0].roomId;
      const page = await fetchRoomClips(roomId, userId, olderCursor, 'older');
      setClips((prev) => [...(prev ?? []), ...page.clips]);
      setOlderCursor(page.nextCursor);
      setReachedEnd(page.reachedEnd);
    } catch {
      setReachedEnd(true);
    }
    setLoadingMore(false);
  }

  async function toggleLike(post: FeedPost) {
    if (!userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const update = (liked: boolean) =>
      setClips((prev) =>
        prev?.map((c) => (c.id === post.id ? { ...c, likedByMe: liked, likeCount: c.likeCount + (liked ? 1 : -1) } : c)) ?? prev,
      );
    update(!post.likedByMe);
    try {
      await setLiked(post.id, userId, !post.likedByMe);
    } catch {
      update(post.likedByMe);
    }
  }

  if (!userId) return null;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {clips === null ? (
        <View style={styles.centered}>
          {error ? <Text style={styles.message}>{error}</Text> : <ActivityIndicator color="#ffffff" />}
        </View>
      ) : (
        <FlatList
          data={clips}
          keyExtractor={(c) => c.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          viewabilityConfig={VIEWABILITY_CONFIG}
          onViewableItemsChanged={onViewableItemsChanged}
          onEndReached={loadOlder}
          onEndReachedThreshold={1}
          renderItem={({ item, index }) => (
            <ClipSlide
              post={item}
              height={height}
              active={index === activeIndex}
              nearby={Math.abs(index - activeIndex) <= 1}
              onToggleLike={() => toggleLike(item)}
              onOpenComments={() => commentsSheetRef.current?.open(item.id)}
            />
          )}
        />
      )}

      <BackButton />

      <CommentsSheet
        ref={commentsSheetRef}
        viewerId={userId}
        viewerCanModerate={canModerate}
        onCommentCountChange={(id, delta) =>
          setClips((prev) => prev?.map((c) => (c.id === id ? { ...c, commentCount: Math.max(0, c.commentCount + delta) } : c)) ?? prev)
        }
      />
    </View>
  );
}

function BackButton() {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      style={[styles.back, { top: insets.top + Spacing[2] }]}
      onPress={() => router.back()}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="Close clips"
    >
      <Icon name="back" size={24} color="#ffffff" />
    </Pressable>
  );
}

function ClipSlide({
  post,
  height,
  active,
  nearby,
  onToggleLike,
  onOpenComments,
}: {
  post: FeedPost;
  height: number;
  active: boolean;
  nearby: boolean;
  onToggleLike: () => void;
  onOpenComments: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [paused, setPaused] = useState(false);

  // Scrolling away and back resumes playback rather than staying paused.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setPaused(false);
  }

  const url = post.media[0]?.url;

  return (
    <View style={[styles.slide, { height }]}>
      {nearby && url ? <ClipVideo uri={url} playing={active && !paused} /> : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setPaused((p) => !p)}
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Play clip' : 'Pause clip'}
      >
        {paused && (
          <View style={styles.pausedBadge}>
            <Icon name="play" size={34} color="#ffffff" />
          </View>
        )}
      </Pressable>

      <View style={[styles.caption, { bottom: insets.bottom + Spacing[6] }]} pointerEvents="box-none">
        <View style={styles.authorRow}>
          <Avatar gradient={post.authorId ?? 'mara'} letter={post.authorName.charAt(0).toUpperCase() || '?'} size={34} />
          <Text style={styles.authorName} numberOfLines={1}>
            {post.authorName}
          </Text>
        </View>
        {post.text ? (
          <Text style={styles.captionText} numberOfLines={3}>
            {post.text}
          </Text>
        ) : null}
        {post.location ? (
          <View style={styles.locationRow}>
            <Icon name="location" size={13} color="rgba(255,255,255,0.85)" strokeWidth={2.25} />
            <Text style={styles.locationText} numberOfLines={1}>
              {post.location}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.actions, { bottom: insets.bottom + Spacing[6] }]}>
        <Pressable
          style={styles.actionButton}
          onPress={onToggleLike}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${post.likedByMe ? 'Unlike' : 'Like'}, ${post.likeCount} like${post.likeCount === 1 ? '' : 's'}`}
          accessibilityState={{ selected: post.likedByMe }}
        >
          <Icon name="heart" size={30} filled={post.likedByMe} color={post.likedByMe ? '#FF4D6D' : '#ffffff'} />
          <Text style={styles.actionCount}>{post.likeCount}</Text>
        </Pressable>
        <Pressable
          style={styles.actionButton}
          onPress={onOpenComments}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Comments, ${post.commentCount}`}
        >
          <Icon name="comment" size={30} color="#ffffff" />
          <Text style={styles.actionCount}>{post.commentCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ClipVideo({ uri, playing }: { uri: string; playing: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.bufferOptions = VIDEO_BUFFER_OPTIONS;
  });

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);

  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />;
}

// A dark, media-first surface in both themes (like the story viewer), so
// fixed colors rather than theme tokens.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  message: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: '#ffffff',
    textAlign: 'center',
  },
  slide: {
    width: '100%',
    backgroundColor: '#000000',
  },
  back: {
    position: 'absolute',
    left: Spacing[4],
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 72,
    height: 72,
    marginTop: -36,
    marginLeft: -36,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    position: 'absolute',
    left: Spacing[4],
    right: 88,
    gap: Spacing[2],
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  authorName: {
    flexShrink: 1,
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: '#ffffff',
  },
  captionText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 19,
    color: '#ffffff',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemibold,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.85)',
  },
  actions: {
    position: 'absolute',
    right: Spacing[3],
    alignItems: 'center',
    gap: Spacing[6],
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
  },
  actionCount: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13,
    color: '#ffffff',
  },
});
