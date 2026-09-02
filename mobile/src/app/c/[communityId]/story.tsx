import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { fetchRoomBySlug } from '@/lib/rooms';
import { relativeTime } from '@/lib/posts';
import { fetchActiveStories, signStoryUrls, type Story } from '@/lib/stories';

/**
 * Ported from app_reference/src/screens/StoryViewer.jsx, but grouped by
 * author rather than the mock's own flat STORIES[index] behavior — real
 * Instagram-style Stories page through one author's stories at a time,
 * then move to the next author, not interleave everyone's stories into
 * one sequence. (Caught in live device testing: the mock's flat-list
 * behavior was ported faithfully at first, and looked wrong immediately
 * once more than one account actually had an active story.) The mock's
 * reply input and like button are deliberately absent — not in Phase 7's
 * roadmap checklist, and a control that doesn't persist anything (same
 * standard Phase 5's PostCard was held to) is worse than not showing one.
 *
 * Author order matches the ring row's (dedupeStoryAuthors() in
 * c/[communityId]/index.tsx — first appearance in the oldest-first query,
 * same source data, so the two never disagree about ordering).
 *
 * Each story auto-advances once its progress segment fills, matching
 * Instagram's own behavior rather than the mock's static bars (which
 * never moved on their own). An image gets a fixed IMAGE_DURATION_MS;
 * a video's segment tracks its actual playback position via expo-video's
 * `timeUpdate` event and advances on `playToEnd`, not a fixed timer —
 * a 3-second clip and a 30-second one should each get their own real
 * length, not the same arbitrary duration.
 *
 * Progress is an Animated.Value, not React state — a `setState` tick
 * every 50ms (the first version of this did exactly that, via
 * setInterval) forces the whole screen through a React re-render 20
 * times a second, which is exactly the kind of thing that looks janky
 * on a real device even though it's invisible in isolation. Animated
 * updates the native view's `transform` directly, bypassing React's
 * render cycle entirely — `useNativeDriver: true` for the image timer
 * moves the whole animation onto the UI thread, and video's per-tick
 * `.setValue()` calls skip the render cycle the same way regardless.
 * Width itself can't be animated on the native driver (only transform
 * and opacity can), hence `scaleX` + `transformOrigin: 'left'` instead
 * of animating `width` directly.
 */
const IMAGE_DURATION_MS = 5000;

export default function StoryViewer() {
  const { communityId, authorId } = useLocalSearchParams<{ communityId: string; authorId?: string }>();
  const [stories, setStories] = useState<Story[] | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());
  const [authorIndex, setAuthorIndex] = useState(0);
  const [storyIndex, setStoryIndex] = useState(0);
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const runningAnimation = useRef<Animated.CompositeAnimation | null>(null);

  const load = useCallback(async () => {
    try {
      const room = await fetchRoomBySlug(communityId);
      if (!room) return;
      setRoomName(room.name);
      const active = await fetchActiveStories(room.id);
      setStories(active);
      if (active.length > 0) {
        const signed = await signStoryUrls(active.map((s) => s.media_url));
        setMediaUrls(signed);
      }

      const authorOrder = groupByAuthor(active).map(([id]) => id);
      const startAt = authorId ? authorOrder.indexOf(authorId) : 0;
      setAuthorIndex(startAt >= 0 ? startAt : 0);
      setStoryIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stories.');
    }
  }, [communityId, authorId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function goHome() {
    router.back();
  }

  const groups = useMemo(() => (stories ? groupByAuthor(stories) : []), [stories]);

  const prev = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex((i) => i - 1);
    } else if (authorIndex > 0) {
      const prevGroup = groups[authorIndex - 1];
      setAuthorIndex((a) => a - 1);
      setStoryIndex(prevGroup[1].length - 1);
    } else {
      goHome();
    }
  }, [storyIndex, authorIndex, groups]);

  const next = useCallback(() => {
    const current = groups[authorIndex];
    if (current && storyIndex < current[1].length - 1) {
      setStoryIndex((i) => i + 1);
    } else if (authorIndex < groups.length - 1) {
      setAuthorIndex((a) => a + 1);
      setStoryIndex(0);
    } else {
      goHome();
    }
  }, [storyIndex, authorIndex, groups]);

  const currentStoryId = groups[authorIndex]?.[1][storyIndex]?.id;

  // setValue() is a direct mutation, not a React setState call — no
  // re-render, and nothing for react-hooks/set-state-in-effect to flag.
  const handleVideoProgress = useCallback((fraction: number) => progressAnim.setValue(fraction), [progressAnim]);

  // Auto-advance timer for images only — video's is driven by StoryVideo's
  // playToEnd/timeUpdate listeners below, since a fixed duration would be
  // wrong for anything but a coincidentally IMAGE_DURATION_MS-long clip.
  useEffect(() => {
    runningAnimation.current?.stop();
    progressAnim.setValue(0);
    if (!currentStoryId) return;
    const kind = groups[authorIndex]?.[1][storyIndex]?.kind;
    if (kind !== 'image') return;

    const animation = Animated.timing(progressAnim, {
      toValue: 1,
      duration: IMAGE_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    runningAnimation.current = animation;
    animation.start(({ finished }) => {
      if (finished) next();
    });
    return () => animation.stop();
    // currentStoryId alone is the real key here — it changes exactly when
    // the displayed story does, whether from a manual tap or auto-advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoryId]);

  if (stories === null) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <ActivityIndicator color={Colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (error || groups.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headingText} numberOfLines={1}>
            {communityId}
          </Text>
          <Pressable onPress={goHome} hitSlop={12}>
            <Icon name="close" size={22} color={Colors.text} />
          </Pressable>
        </View>
        <View style={styles.empty}>
          <Text style={styles.body}>{error ?? 'No active stories.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const [, authorStories] = groups[authorIndex] ?? groups[0];
  const story = authorStories[storyIndex] ?? authorStories[0];
  const url = mediaUrls.get(story.media_url);

  return (
    <View style={styles.container}>
      {url && (
        story.kind === 'video' ? (
          <StoryVideo key={story.id} uri={url} onProgress={handleVideoProgress} onEnd={next} />
        ) : (
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        )
      )}
      <LinearGradient colors={['rgba(0,0,0,.65)', 'transparent']} style={styles.topShade} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,.75)']} style={styles.bottomShade} />

      <SafeAreaView edges={['top']} style={styles.foreground}>
        <View style={styles.progressRow}>
          {/* eslint-disable-next-line react-hooks/refs -- progressAnim is
              an Animated.Value, not a plain ref: reading it in a style
              prop during render is the standard, idiomatic way to use
              react-native's Animated API, unlike a plain ref's .current. */}
          {authorStories.map((s, i) => (
            <View key={s.id} style={styles.progressTrack}>
              {i < storyIndex ? (
                <View style={[styles.progressFill, styles.progressFillStatic]} />
              ) : i === storyIndex ? (
                <Animated.View
                  style={[styles.progressFill, styles.progressFillAnimated, { transform: [{ scaleX: progressAnim }] }]}
                />
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.headerRow}>
          <Avatar gradient={story.author_id ?? 'mara'} letter={story.authorName.charAt(0).toUpperCase()} size={36} ring />
          <View style={styles.headerText}>
            <Text style={styles.authorName}>{story.authorHandle || story.authorName}</Text>
            <Text style={styles.headerMeta}>
              {roomName} · {relativeTime(story.created_at)}
            </Text>
          </View>
          <Pressable onPress={goHome} hitSlop={12}>
            <Icon name="close" size={21} color="rgba(242,230,212,.9)" />
          </Pressable>
        </View>

        <Pressable onPress={prev} style={styles.prevZone} accessibilityLabel="Previous story" />
        <Pressable onPress={next} style={styles.nextZone} accessibilityLabel="Next story" />

        <View style={styles.spacer} />

        {story.caption && (
          <View style={styles.captionWrap}>
            <Text style={styles.caption}>{story.caption}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

/** Preserves first-appearance order from the oldest-first query — the same order dedupeStoryAuthors() derives the ring row from. */
function groupByAuthor(stories: Story[]): [string, Story[]][] {
  const order: string[] = [];
  const map = new Map<string, Story[]>();
  for (const s of stories) {
    const key = s.author_id ?? s.id;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(s);
  }
  return order.map((key) => [key, map.get(key)!]);
}

/**
 * Not looped — a story video is meant to play through once and then
 * advance, the same as an image's fixed-duration timer. `timeUpdate`
 * only fires at all once `timeUpdateEventInterval` is set (0 — the
 * expo-video default — means it never fires); 0.1s is frequent enough
 * for a smooth-looking progress bar without flooding re-renders.
 */
function StoryVideo({ uri, onProgress, onEnd }: { uri: string; onProgress: (fraction: number) => void; onEnd: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 0.1;
    p.play();
  });

  useEffect(() => {
    const progressSub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (player.duration > 0) onProgress(Math.min(1, currentTime / player.duration));
    });
    const endSub = player.addListener('playToEnd', onEnd);
    return () => {
      progressSub.remove();
      endSub.remove();
    };
  }, [player, onProgress, onEnd]);

  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a08',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },
  headingText: {
    fontFamily: Fonts.heading,
    fontSize: 17,
    color: Colors.text,
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
  topShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  bottomShade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  foreground: {
    flex: 1,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(242,230,212,.28)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(242,230,212,.95)',
  },
  progressFillStatic: {
    width: '100%',
  },
  progressFillAnimated: {
    width: '100%',
    // scaleX animates from the left edge, not the center RN defaults
    // to — without this, the fill would appear to grow from the middle
    // outward instead of filling left-to-right like a loading bar.
    transformOrigin: 'left',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  headerText: {
    flex: 1,
  },
  authorName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    color: Colors.text,
  },
  headerMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: 'rgba(242,230,212,.6)',
  },
  prevZone: {
    position: 'absolute',
    left: 0,
    top: 120,
    bottom: 120,
    width: '33%',
  },
  nextZone: {
    position: 'absolute',
    right: 0,
    top: 120,
    bottom: 120,
    width: '67%',
  },
  spacer: {
    flex: 1,
  },
  captionWrap: {
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  caption: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,.42)',
    fontFamily: Fonts.body,
    fontSize: 14.5,
    lineHeight: 20,
    color: Colors.text,
    maxWidth: 270,
  },
});
