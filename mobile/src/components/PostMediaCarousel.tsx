import { Image, type ImageLoadEventData } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type ViewToken } from 'react-native';

import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useCappedMediaHeight } from '@/hooks/use-capped-media-height';
import { useTheme } from '@/hooks/use-theme';
import type { PostMediaItem } from '@/lib/posts';

/** Never depends on props/state, so a module-level constant is stable across every render without a ref. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 };

/**
 * A post's media, as an IG-style horizontal carousel — used by both
 * PostCard (the feed) and the post detail screen, replacing what used to
 * be a single `imageUrls[0]` render. Ported to a real carousel now that
 * `create-post.tsx` can actually attach more than one item; PostCard's
 * "1/N" badge existed for this since before there was anything behind
 * it.
 *
 * Sizing follows `useCappedMediaHeight`'s own documented rule: a photo is
 * letterboxed, never cropped further, to fit a height cap. The box's
 * aspect ratio is fixed from the *first* slide only (matching Instagram's
 * own carousel behavior — later slides don't resize the box); every
 * slide renders `contentFit="contain"` inside that fixed box, so a
 * differently-shaped later slide letterboxes instead of getting cropped
 * to force uniformity with the first.
 */
export default function PostMediaCarousel({
  media,
  maxHeightFraction,
  onPress,
}: {
  media: PostMediaItem[];
  maxHeightFraction: number;
  onPress?: () => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const maxHeight = useCappedMediaHeight(maxHeightFraction);

  const [aspectRatio, setAspectRatio] = useState(1);
  const [cardWidth, setCardWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => setCardWidth(event.nativeEvent.layout.width);

  // Only the first slide's natural dimensions ever set the box's shape —
  // later slides letterbox inside whatever that first one established.
  const handleFirstImageLoad = (event: ImageLoadEventData) => {
    if (media[0]?.kind === 'image') setAspectRatio(event.source.width / event.source.height);
  };
  const handleFirstVideoSize = (width: number, height: number) => {
    if (media[0]?.kind === 'video') setAspectRatio(width / height);
  };

  // setActiveIndex's own identity is stable across renders (a guarantee
  // React makes for every setState function), so this stays a single
  // stable reference across renders without needing a ref at all.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]?.index;
    if (first != null) setActiveIndex(first);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: PostMediaItem; index: number }) => {
      if (cardWidth === 0) return null;
      const slideStyle = { width: cardWidth, height: '100%' as const };
      if (item.kind === 'video') {
        return (
          <CarouselVideoSlide
            uri={item.url}
            active={index === activeIndex}
            style={slideStyle}
            onNaturalSize={index === 0 ? handleFirstVideoSize : undefined}
          />
        );
      }
      return (
        <Image
          source={{ uri: item.url }}
          style={slideStyle}
          contentFit="contain"
          transition={150}
          cachePolicy="memory-disk"
          onLoad={index === 0 ? handleFirstImageLoad : undefined}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleFirst*/media[0] are stable for a given card; only cardWidth/activeIndex actually vary what's rendered.
    [cardWidth, activeIndex],
  );

  if (media.length === 0) return null;

  const content = (
    <View style={[styles.wrap, { aspectRatio, maxHeight }]} onLayout={handleLayout}>
      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews
        windowSize={3}
        data={media}
        keyExtractor={(item) => item.url}
        renderItem={renderItem}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={onViewableItemsChanged}
        scrollEnabled={media.length > 1}
      />
      {media.length > 1 && (
        <Text style={styles.indexBadge}>
          {activeIndex + 1}/{media.length}
        </Text>
      )}
    </View>
  );

  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

/**
 * A feed video is a deliberate divergence from the story viewer's
 * autoplay/muted/no-controls treatment (story.tsx) — that's the right
 * call for a full-screen, one-at-a-time story, not for a card scrolling
 * past in a list. Paused until its slide is the active one, with native
 * controls so a tap can actually play/seek/mute it.
 */
function CarouselVideoSlide({
  uri,
  active,
  style,
  onNaturalSize,
}: {
  uri: string;
  active: boolean;
  style: { width: number; height: number | '100%' };
  onNaturalSize?: (width: number, height: number) => void;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (!onNaturalSize) return;
    const subscription = player.addListener('sourceLoad', ({ availableVideoTracks }) => {
      const size = availableVideoTracks[0]?.size;
      if (size && size.width > 0 && size.height > 0) onNaturalSize(size.width, size.height);
    });
    return () => subscription.remove();
  }, [player, onNaturalSize]);

  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  return <VideoView player={player} style={style} contentFit="contain" nativeControls />;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      width: '100%',
      borderRadius: Radius.md,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    indexBadge: {
      position: 'absolute',
      right: 10,
      top: 10,
      fontFamily: Fonts.bodyBold,
      fontSize: 10.5,
      color: colors.text,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: Radius.pill,
      overflow: 'hidden',
    },
  });
