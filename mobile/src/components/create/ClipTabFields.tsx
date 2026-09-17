import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ReviewDetails from '@/components/create/ReviewDetails';
import Icon from '@/components/Icon';
import PostMediaCarousel, { FEED_MEDIA_MAX_HEIGHT_FRACTION, type CarouselMediaItem } from '@/components/PostMediaCarousel';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import type { PickedMedia } from '@/lib/media';
import type { TaggedPerson } from '@/lib/posts';

/**
 * The "review" half of the Clip tab — the same New Post layout as the Post
 * tab (PostTabFields): the clip previewed exactly as the feed will show it,
 * then the caption, Tag people and Add location (ReviewDetails).
 *
 * "Exactly as the feed will show it" is the feed's own carousel in clip-fill
 * mode with this clip's framing and displayed aspect — the same
 * framedVideoLayout() the feed uses — so a clip no longer shows up small
 * with side borders. Edit opens the photo editor in clip mode (shape +
 * drag/pinch, no rotate/flip); the full-screen viewer still plays the whole
 * video.
 *
 * Only ever rendered once `media` is set (create-post.tsx flips back to the
 * 'pick' phase the moment it's removed).
 */
export default function ClipTabFields({
  text,
  onChangeText,
  media,
  videoAspect,
  onVideoNaturalSize,
  onRemoveMedia,
  onEditClip,
  tags,
  onOpenTags,
  location,
  onOpenLocation,
  onClearLocation,
  submitting,
}: {
  text: string;
  onChangeText: (v: string) => void;
  media: Extract<PickedMedia, { kind: 'video' }>;
  /** Displayed width / height, or null until it's known. */
  videoAspect: number | null;
  onVideoNaturalSize: (width: number, height: number) => void;
  onRemoveMedia: () => void;
  onEditClip: () => void;
  tags: TaggedPerson[];
  onOpenTags: () => void;
  location: string;
  onOpenLocation: () => void;
  onClearLocation: () => void;
  submitting: boolean;
}) {
  const carouselMedia = useMemo<CarouselMediaItem[]>(
    () => [{ url: media.uri, kind: 'video', framing: media.framing ?? null, videoAspect }],
    [media.uri, media.framing, videoAspect],
  );

  return (
    <View style={styles.wrap}>
      <View>
        <PostMediaCarousel
          media={carouselMedia}
          maxHeightFraction={FEED_MEDIA_MAX_HEIGHT_FRACTION}
          videoControls={false}
          clipFill
          onVideoNaturalSize={onVideoNaturalSize}
        />
        <Pressable
          style={styles.remove}
          onPress={onRemoveMedia}
          disabled={submitting}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Remove clip"
        >
          <Icon name="close" size={14} color="#ffffff" />
        </Pressable>
        {/* Needs the clip's displayed aspect for the frame geometry — it's
            known immediately for a gallery clip, a moment after loading for
            a fresh recording. */}
        {videoAspect !== null && (
          <Pressable
            style={styles.editPill}
            onPress={onEditClip}
            disabled={submitting}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Edit how this clip shows in the feed"
          >
            <Icon name="crop" size={14} color="#ffffff" strokeWidth={2.25} />
            <Text style={styles.editPillText}>Edit</Text>
          </Pressable>
        )}
      </View>

      <ReviewDetails
        text={text}
        onChangeText={onChangeText}
        tags={tags}
        onOpenTags={onOpenTags}
        location={location}
        onOpenLocation={onOpenLocation}
        onClearLocation={onClearLocation}
        submitting={submitting}
      />
    </View>
  );
}

// Overlay controls sit on the video itself, so fixed white-on-dark in both
// themes, same as PostTabFields' photo overlays.
const styles = StyleSheet.create({
  wrap: {
    gap: Spacing[3],
  },
  remove: {
    position: 'absolute',
    left: 10,
    top: 10,
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPill: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editPillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    color: '#ffffff',
  },
});
