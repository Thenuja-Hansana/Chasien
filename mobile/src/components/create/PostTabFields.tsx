import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ReviewDetails from '@/components/create/ReviewDetails';
import Icon from '@/components/Icon';
import PostMediaCarousel, { FEED_MEDIA_MAX_HEIGHT_FRACTION, type CarouselMediaItem } from '@/components/PostMediaCarousel';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import type { PickedMedia } from '@/lib/media';
import { feedShapeAspectRatio, type FeedShape } from '@/lib/mediaUtils';
import type { TaggedPerson } from '@/lib/posts';

function toCarouselItem(media: PickedMedia, shape: FeedShape): CarouselMediaItem {
  // A lone video in a Post is a clip in the feed (isClipPost), so carry its
  // displayed aspect for the same fill the feed will use.
  if (media.kind === 'video') {
    return { url: media.uri, kind: 'video', videoAspect: media.width && media.height ? media.width / media.height : null };
  }
  // An edited photo's preview file is already cropped to the shape, so the
  // carousel's crop box shows all of it; an unedited one gets center-cropped
  // to the shape, exactly as the upload will.
  return { url: media.previewUri ?? media.uri, kind: 'image', cropAspectRatio: feedShapeAspectRatio(shape) };
}

/**
 * The "review" half of the Post tab, shown after "Next" — Instagram's New
 * Post screen: the media first, previewed at exactly the size and crop the
 * feed will draw it, then the post's details below it as a scrolling list.
 *
 * "Exactly" is literal, not approximate: the preview is the feed's own
 * PostMediaCarousel with the feed's own height cap, and each photo is
 * drawn as the crop `compressImageForUpload('feed')` will make on upload,
 * in the post's one shared `shape` (`cropAspectRatio` — see
 * PostMediaCarousel's comment). The composer's ScrollView padding matches
 * PostCard's, so the width matches too. Don't swap this for a
 * separately-styled preview; the two would drift apart.
 *
 * Only ever rendered once `media` is non-empty (create-post.tsx flips back
 * to the 'pick' phase, MediaGridPicker, whenever it would otherwise go
 * empty). Adding more media is the header's back arrow, back to the picker.
 */
export default function PostTabFields({
  text,
  onChangeText,
  media,
  shape,
  onRemoveMedia,
  onEditPhoto,
  tags,
  onOpenTags,
  location,
  onOpenLocation,
  onClearLocation,
  submitting,
}: {
  text: string;
  onChangeText: (v: string) => void;
  media: PickedMedia[];
  shape: FeedShape;
  onRemoveMedia: (index: number) => void;
  onEditPhoto: (index: number) => void;
  tags: TaggedPerson[];
  onOpenTags: () => void;
  /** '' when none is set. */
  location: string;
  onOpenLocation: () => void;
  onClearLocation: () => void;
  submitting: boolean;
}) {
  const carouselMedia = useMemo(() => media.map((item) => toCarouselItem(item, shape)), [media, shape]);
  const [activeIndex, setActiveIndex] = useState(0);
  const currentIndex = Math.min(activeIndex, media.length - 1);

  return (
    <View style={styles.wrap}>
      <View>
        <PostMediaCarousel
          media={carouselMedia}
          maxHeightFraction={FEED_MEDIA_MAX_HEIGHT_FRACTION}
          onActiveIndexChange={setActiveIndex}
          clipFill={media.length === 1 && media[0].kind === 'video'}
          videoControls={!(media.length === 1 && media[0].kind === 'video')}
        />
        {media.length > 0 && (
          <Pressable
            style={styles.remove}
            onPress={() => onRemoveMedia(currentIndex)}
            disabled={submitting}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={media.length > 1 ? `Remove item ${currentIndex + 1} of ${media.length}` : 'Remove'}
          >
            <Icon name="close" size={14} color="#ffffff" />
          </Pressable>
        )}
        {/* Photos only — the app has no way to process video. */}
        {media[currentIndex]?.kind === 'image' && (
          <Pressable
            style={styles.editPill}
            onPress={() => onEditPhoto(currentIndex)}
            disabled={submitting}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={media.length > 1 ? `Edit photo ${currentIndex + 1} of ${media.length}` : 'Edit photo'}
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

// Overlay controls sit on the media itself, so fixed white-on-dark in both
// themes. (The theme-dependent caption and rows moved to ReviewDetails.)
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
