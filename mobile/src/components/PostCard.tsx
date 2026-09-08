import { Image, type ImageLoadEventData } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import PollCard from '@/components/PollCard';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useCappedMediaHeight } from '@/hooks/use-capped-media-height';
import { useTheme } from '@/hooks/use-theme';
import { relativeTime, type FeedPost } from '@/lib/posts';
import { useUserPreview } from '@/lib/user-preview-context';

/** Leaves the rest of the window free for the caption/actions row below and a peek of the next card, the way Instagram's own feed keeps scrolling legible. */
const MAX_IMAGE_HEIGHT_FRACTION = 0.55;

/**
 * One post in a Room feed — ported from app_reference/src/screens/Home.jsx.
 *
 * Two controls from the mock are deliberately absent rather than drawn
 * inert: the bookmark/save toggle (nothing in the Phase 1 schema stores a
 * saved post — there's no `bookmarks` table to write to) and the `dotsH`
 * overflow menu (its contents are report/remove, which is Phase 9's
 * trust-and-safety work). Both were local-only state in the mock. Same
 * standard the auth screens were held to in Phase 2: a button that does
 * nothing on tap is worse than no button.
 */
export default function PostCard({
  post,
  onPress,
  onToggleLike,
  onVote,
}: {
  post: FeedPost;
  onPress: () => void;
  onToggleLike: () => void;
  onVote: (optionId: string) => Promise<void>;
}) {
  const isModerator = post.authorRole === 'owner' || post.authorRole === 'mod';
  const { open: openUserPreview } = useUserPreview();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Uploads are pre-cropped to one of the feed's fixed ratios (square, 4:5
  // portrait, or 1.91:1 landscape — see compressImageForUpload()'s 'feed'
  // variant), but that ratio isn't stored anywhere, so the card sizes
  // itself from the loaded image's own dimensions rather than a fixed
  // height that would just re-crop it a second time on top of the first.
  const [aspectRatio, setAspectRatio] = useState(1);
  const handleImageLoad = (event: ImageLoadEventData) => setAspectRatio(event.source.width / event.source.height);
  const maxImageHeight = useCappedMediaHeight(MAX_IMAGE_HEIGHT_FRACTION);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.authorRow}
        disabled={!post.authorId}
        onPress={() => openUserPreview(post.authorId as string)}
      >
        <Avatar gradient={post.authorId ?? 'mara'} letter={post.authorName.charAt(0).toUpperCase() || '?'} size={38} />
        <View style={styles.authorText}>
          <View style={styles.authorNameRow}>
            <Text style={styles.authorName} numberOfLines={1}>
              {post.authorName}
            </Text>
            {isModerator && (
              <Text style={styles.modBadge}>{post.authorRole === 'owner' ? 'OWNER' : 'MOD'}</Text>
            )}
          </View>
          <Text style={styles.time}>
            @{post.authorHandle} · {relativeTime(post.createdAt)}
          </Text>
        </View>
      </Pressable>

      {post.text ? (
        <Text style={styles.body}>
          {post.text}
          {post.tag ? <Text style={styles.tag}> {post.tag}</Text> : null}
        </Text>
      ) : null}

      {post.imageUrls.length > 0 && (
        <Pressable style={[styles.imageWrap, { aspectRatio, maxHeight: maxImageHeight }]} onPress={onPress}>
          <Image
            source={{ uri: post.imageUrls[0] }}
            style={styles.image}
            contentFit="contain"
            transition={150}
            onLoad={handleImageLoad}
          />
          {post.imageCount > 1 && <Text style={styles.imageCount}>1/{post.imageCount}</Text>}
        </Pressable>
      )}

      {post.poll && <PollCard poll={post.poll} onVote={onVote} />}

      <View style={styles.actions}>
        <Pressable
          style={styles.action}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onToggleLike();
          }}
          hitSlop={6}
        >
          <Icon
            name="heart"
            size={21}
            filled={post.likedByMe}
            color={post.likedByMe ? colors.accent.DEFAULT : colors.text}
          />
          <Text style={styles.actionCount}>{post.likeCount}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={onPress} hitSlop={6}>
          <Icon name="comment" size={21} color={colors.text} />
          <Text style={styles.actionCount}>{post.commentCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginBottom: Spacing[2],
  },
  authorText: {
    flex: 1,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  authorName: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14.5,
    color: colors.text,
    flexShrink: 1,
  },
  modBadge: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: colors.accent[300],
    backgroundColor: `${colors.accent.DEFAULT}38`,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[500],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.text,
  },
  tag: {
    color: colors.accent[300],
  },
  imageWrap: {
    marginTop: Spacing[2],
    borderRadius: Radius.md,
    overflow: 'hidden',
    width: '100%',
    backgroundColor: colors.surface,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageCount: {
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[6],
    marginTop: Spacing[3],
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    color: colors.text,
  },
});
