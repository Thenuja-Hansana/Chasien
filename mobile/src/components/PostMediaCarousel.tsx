import { Image, type ImageLoadEventData } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type ViewToken } from 'react-native';

import { Fonts, Radius, type ThemeColors } from '@/constants/theme';
import { useCappedMediaHeight } from '@/hooks/use-capped-media-height';
import { useTheme } from '@/hooks/use-theme';
import { cachedImageSource, clipShape, feedShapeAspectRatio, framedVideoLayout, VIDEO_BUFFER_OPTIONS, type FeedShape, type MediaFraming } from '@/lib/mediaUtils';
import type { PostMediaItem } from '@/lib/posts';

/** Never depends on props/state, so a module-level constant is stable across every render without a ref. */
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 50 };

/**
 * The feed card's media height cap, as a fraction of the window's height.
 * Lives here rather than in PostCard.tsx because the Post composer's
 * review screen needs the exact same cap to preview a post at the size
 * the feed will actually draw it.
 *
 * Raised from 0.55 when portrait posts went from 4:5 to 3:4 (see
 * FEED_SHAPES in lib/mediaUtils.ts): a full-width 3:4 photo on a ~20:9
 * phone like the Galaxy A14 is roughly 54–58% of the window's height
 * (depending on whether that height includes the nav bar), so the old cap
 * could show the taller shape with bars on its sides.
 */
export const FEED_MEDIA_MAX_HEIGHT_FRACTION = 0.6;

/**
 * A carousel slide. `cropAspectRatio` is only set by the Post composer's
 * review screen, for a local photo that hasn't been uploaded yet: the
 * upload will crop it to the post's shape (lib/mediaUtils.ts's
 * `FEED_SHAPES`), so the preview draws that crop now instead of the
 * uncropped original — centered for an unedited photo, and the whole
 * rendered file for one the photo editor already cropped to that shape.
 * Posted media never sets it — its stored file is already cropped, so its
 * natural size *is* the crop.
 */
export type CarouselMediaItem = PostMediaItem & { cropAspectRatio?: number };

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
 *
 * A slide with `cropAspectRatio` follows the same rules, just with its
 * shape known up front instead of read from the loaded file: the box
 * takes the first slide's crop ratio, and each slide is drawn as its own
 * crop (a `cover` image in a box of that ratio) letterboxed inside it.
 */
export default function PostMediaCarousel({
  media,
  maxHeightFraction,
  onPress,
  onActiveIndexChange,
  videoControls = true,
  clipFill = false,
  onVideoNaturalSize,
}: {
  media: CarouselMediaItem[];
  maxHeightFraction: number;
  onPress?: () => void;
  /**
   * The post is a clip: fill the box with the video, cropped to its framing
   * (or centre-cropped to its closest shape), instead of letterboxing it.
   * Letterboxing a portrait phone video under the feed's height cap is what
   * made clips look small with side borders — see
   * 20260917100000_clip_framing.sql.
   */
  clipFill?: boolean;
  /**
   * The first slide's video track size once it loads. Raw — expo-video
   * ignores the rotation flag — so it's only a fallback for a clip with no
   * rotation-corrected size of its own (an in-app camera recording; see
   * create-post.tsx).
   */
  onVideoNaturalSize?: (width: number, height: number) => void;
  /**
   * Native playback controls on video slides. The feed turns them off for a
   * clip: native controls swallow taps, and a tap on a clip should open the
   * full-screen clips viewer (onPress) instead of playing it inline.
   */
  videoControls?: boolean;
  /** Fires with the visible slide's index, so a parent can act on "the current slide" (the composer's remove button). */
  onActiveIndexChange?: (index: number) => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const maxHeight = useCappedMediaHeight(maxHeightFraction);

  const [aspectRatio, setAspectRatio] = useState(1);
  const [cardWidth, setCardWidth] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    setCardWidth(event.nativeEvent.layout.width);
    setCardHeight(event.nativeEvent.layout.height);
  };

  // A known crop ratio wins over the natural-size state below, and is read
  // fresh every render, so removing the first slide in the composer
  // reshapes the box to the new first slide immediately.
  const fillsClip = clipFill && media[0]?.kind === 'video';
  const clipBoxShape = fillsClip ? clipShape(media[0].framing, media[0].videoAspect) : null;
  const boxAspectRatio = clipBoxShape ? feedShapeAspectRatio(clipBoxShape) : (media[0]?.cropAspectRatio ?? aspectRatio);
  // Removing the last slide can leave activeIndex one past the end until
  // FlatList reports the new visible slide.
  const shownIndex = Math.min(activeIndex, Math.max(media.length - 1, 0));

  useEffect(() => {
    onActiveIndexChange?.(shownIndex);
  }, [shownIndex, onActiveIndexChange]);

  // Only the first slide's natural dimensions ever set the box's shape —
  // later slides letterbox inside whatever that first one established.
  const handleFirstImageLoad = (event: ImageLoadEventData) => {
    if (media[0]?.kind === 'image') setAspectRatio(event.source.width / event.source.height);
  };
  const handleFirstVideoSize = (width: number, height: number) => {
    if (media[0]?.kind === 'video') {
      setAspectRatio(width / height);
      onVideoNaturalSize?.(width, height);
    }
  };

  // setActiveIndex's own identity is stable across renders (a guarantee
  // React makes for every setState function), so this stays a single
  // stable reference across renders without needing a ref at all.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]?.index;
    if (first != null) setActiveIndex(first);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: CarouselMediaItem; index: number }) => {
      if (cardWidth === 0) return null;
      const slideStyle = { width: cardWidth, height: '100%' as const };
      if (item.kind === 'video') {
        return (
          <CarouselVideoSlide
            uri={item.url}
            active={index === activeIndex}
            style={slideStyle}
            controls={videoControls}
            onNaturalSize={index === 0 ? handleFirstVideoSize : undefined}
            fill={
              clipBoxShape
                ? { shape: clipBoxShape, framing: item.framing ?? null, videoAspect: item.videoAspect ?? null, boxWidth: cardWidth, boxHeight: cardHeight }
                : undefined
            }
          />
        );
      }
      if (item.cropAspectRatio && cardHeight > 0) {
        // `contain` for the crop box, `cover` for the photo inside it —
        // together they draw exactly the centered crop the upload will
        // make, letterboxed the way the posted file will be.
        const crop = item.cropAspectRatio;
        const cropBox =
          crop >= cardWidth / cardHeight ? { width: cardWidth, height: cardWidth / crop } : { width: cardHeight * crop, height: cardHeight };
        return (
          <View style={[slideStyle, styles.cropSlide]}>
            <Image source={cachedImageSource(item.url)} style={cropBox} contentFit="cover" />
          </View>
        );
      }
      return (
        <Image
          source={cachedImageSource(item.url)}
          style={slideStyle}
          contentFit="contain"
          transition={150}
          cachePolicy="memory-disk"
          onLoad={index === 0 ? handleFirstImageLoad : undefined}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleFirst*/media[0] are stable for a given card; only the layout size, activeIndex, videoControls and the clip's shape actually vary what's rendered.
    [cardWidth, cardHeight, activeIndex, videoControls, clipBoxShape],
  );

  if (media.length === 0) return null;

  const content = (
    <View style={[styles.wrap, { aspectRatio: boxAspectRatio, maxHeight }]} onLayout={handleLayout}>
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
          {shownIndex + 1}/{media.length}
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
  controls,
  onNaturalSize,
  fill,
}: {
  uri: string;
  active: boolean;
  style: { width: number; height: number | '100%' };
  controls: boolean;
  onNaturalSize?: (width: number, height: number) => void;
  /** A clip filling its box — see the carousel's `clipFill`. */
  fill?: { shape: FeedShape; framing: MediaFraming | null; videoAspect: number | null; boxWidth: number; boxHeight: number };
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.bufferOptions = VIDEO_BUFFER_OPTIONS;
  });

  useEffect(() => {
    if (!onNaturalSize) return;
    // A slide can become the first one after its video already loaded
    // (the composer removing the slide before it), and sourceLoad won't
    // fire a second time — so read an already-known size first.
    const knownSize = player.availableVideoTracks[0]?.size;
    if (knownSize && knownSize.width > 0 && knownSize.height > 0) onNaturalSize(knownSize.width, knownSize.height);
    const subscription = player.addListener('sourceLoad', ({ availableVideoTracks }) => {
      const size = availableVideoTracks[0]?.size;
      if (size && size.width > 0 && size.height > 0) onNaturalSize(size.width, size.height);
    });
    return () => subscription.remove();
  }, [player, onNaturalSize]);

  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  if (fill) {
    // With a known displayed aspect, draw the video at its framed size and
    // offset (larger than the box) and let the box clip it. Without one (a
    // clip posted before framing existed), `cover` still fills the box with
    // a centre crop — no side bars either way. `cover` rather than `fill` on
    // the sized view too, so a slightly-off stored aspect can't stretch it.
    // textureView: Android's default SurfaceView doesn't honour its parent's
    // clipping, so an oversized video would spill out of the card.
    //
    // pointerEvents none without controls: Android's VideoView takes any
    // touch that lands on it and re-sends it to JS in its own coordinates
    // instead of the screen's, so the first few pixels a finger moves during
    // a tap look like leaving the card and the carousel's onPress (open the
    // clips viewer) is cancelled. Found on the A14; a synthetic no-movement
    // tap still worked, which hid it. Keeping touches off the video sends
    // them to the Pressable the normal way.
    const layout =
      fill.videoAspect && fill.boxHeight > 0 ? framedVideoLayout(fill.boxWidth, fill.boxHeight, fill.videoAspect, fill.shape, fill.framing) : null;
    return (
      <View style={[style, slideStyles.clipSlide]} pointerEvents={controls ? 'auto' : 'none'}>
        <VideoView
          player={player}
          style={layout ? { position: 'absolute', width: layout.width, height: layout.height, left: layout.left, top: layout.top } : StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={controls}
          surfaceType="textureView"
        />
      </View>
    );
  }

  return <VideoView player={player} style={style} contentFit="contain" nativeControls={controls} />;
}

const slideStyles = StyleSheet.create({
  clipSlide: {
    overflow: 'hidden',
  },
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      width: '100%',
      borderRadius: Radius.md,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    cropSlide: {
      alignItems: 'center',
      justifyContent: 'center',
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
