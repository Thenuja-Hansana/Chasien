import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import Avatar from '@/components/Avatar';
import BlockConfirmModal from '@/components/BlockConfirmModal';
import ConfirmModal from '@/components/ConfirmModal';
import EventCard from '@/components/EventCard';
import Icon from '@/components/Icon';
import PollCard from '@/components/PollCard';
import PostMediaCarousel, { FEED_MEDIA_MAX_HEIGHT_FRACTION } from '@/components/PostMediaCarousel';
import PostOptionsMenu from '@/components/PostOptionsMenu';
import { PostTagsLine, PostTagsOverlay } from '@/components/PostTags';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isClipPost, relativeTime, type FeedPost } from '@/lib/posts';
import { useUserPreview } from '@/lib/user-preview-context';

/** Leaves the rest of the window free for the caption/actions row below and a peek of the next card, the way Instagram's own feed keeps scrolling legible. */
/**
 * One post in a Room feed — ported from app_reference/src/screens/Home.jsx.
 *
 * One control from the mock is deliberately absent rather than drawn inert:
 * the bookmark/save toggle (nothing in the Phase 1 schema stores a saved
 * post — there's no `bookmarks` table to write to). It was local-only state
 * in the mock. Same standard the auth screens were held to in Phase 2: a
 * button that does nothing on tap is worse than no button. The mock's other
 * absent control, the `dotsH` overflow menu, is no longer absent —
 * PostOptionsMenu below.
 */
export default function PostCard({
  post,
  viewerId,
  viewerIsRoomOwner,
  viewerCanModerate,
  onOpenComments,
  onOpenLikes,
  onOpenClip,
  onToggleLike,
  onVote,
  onHide,
  onDelete,
  onRemoveTag,
  onTogglePin,
  onBlockAuthor,
}: {
  post: FeedPost;
  viewerId: string;
  viewerIsRoomOwner: boolean;
  /** Owner/admin/mod — can pin. Pinning used to live only on the post screen, which the feed no longer opens. */
  viewerCanModerate: boolean;
  onOpenComments: () => void;
  onOpenLikes: () => void;
  /** Only called for clips (isClipPost). */
  onOpenClip: () => void;
  onToggleLike: () => void;
  onVote: (optionId: string) => Promise<void>;
  onHide: () => void;
  onDelete: () => void;
  onRemoveTag: () => void;
  onTogglePin: () => void;
  /** Someone else's post only — the menu doesn't offer it on your own, or when the author deleted their account. */
  onBlockAuthor: () => void;
}) {
  const isModerator = post.authorRole === 'owner' || post.authorRole === 'mod';
  const canDelete = post.authorId === viewerId || viewerIsRoomOwner;
  const isClip = isClipPost(post);
  const viewerIsTagged = post.tags.some((t) => t.userId === viewerId);
  const { open: openUserPreview } = useUserPreview();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const canBlockAuthor = post.authorId !== null && post.authorId !== viewerId;

  // A quick pop on the heart itself when a like lands, on top of the
  // existing haptic — set directly on press rather than watched via an
  // effect on post.likedByMe, so it fires immediately instead of a frame
  // behind the tap, and only for *this* like (not a like arriving from a
  // realtime update to someone else's tap). Animation polish pass,
  // 2026-09-15 — react-native-reanimated was already a dependency but had
  // no real call site anywhere in the app until this one.
  const likeScale = useSharedValue(1);
  const likeAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: likeScale.get() }] }));

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
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
            {post.location && (
              <View style={styles.locationRow}>
                <Icon name="location" size={12} color={colors.neutral[500]} strokeWidth={2.25} />
                <Text style={styles.location} numberOfLines={1}>
                  {post.location}
                </Text>
              </View>
            )}
            {/* No media to put the tag badge on — see PostTags.tsx. */}
            {post.media.length === 0 && <PostTagsLine tags={post.tags} onPressPerson={openUserPreview} />}
          </View>
        </Pressable>
        <Pressable
          style={styles.optionsButton}
          onPress={() => setMenuOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Post options"
        >
          <Icon name="dotsH" size={18} color={colors.neutral[500]} />
        </Pressable>
      </View>

      {post.text ? (
        <Text style={styles.body}>
          {post.text}
          {post.tag ? <Text style={styles.tag}> {post.tag}</Text> : null}
        </Text>
      ) : null}

      {post.media.length > 0 && (
        <View style={styles.mediaWrap}>
          {/* Tapping a post no longer opens the post screen. A clip is the
              exception: it opens the full-screen clips viewer, so it's shown
              without native controls (they'd swallow the tap) and with a
              play badge saying so. */}
          <PostMediaCarousel
            media={post.media}
            maxHeightFraction={FEED_MEDIA_MAX_HEIGHT_FRACTION}
            onPress={isClip ? onOpenClip : undefined}
            videoControls={!isClip}
            clipFill={isClip}
          />
          {isClip && (
            <View style={styles.clipBadge} pointerEvents="none">
              <Icon name="play" size={22} color="#ffffff" />
            </View>
          )}
          <PostTagsOverlay tags={post.tags} onPressPerson={openUserPreview} />
        </View>
      )}

      {post.poll && <PollCard poll={post.poll} onVote={onVote} />}
      {post.event && <EventCard event={post.event} />}

      <View style={styles.actions}>
        {/* The heart likes; the number next to it opens who liked (Instagram's
            split). Two tap targets, so the count doesn't also toggle a like. */}
        <View style={styles.action}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              if (!post.likedByMe) {
                // .set(), not `.value =`: the React Compiler treats a write to
                // `.value` as mutating a hook value and skips the whole card.
                likeScale.set(withSequence(withTiming(1.3, { duration: 100 }), withTiming(1, { duration: 120 })));
              }
              onToggleLike();
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={post.likedByMe ? 'Unlike' : 'Like'}
            accessibilityState={{ selected: post.likedByMe }}
          >
            <Animated.View style={likeAnimatedStyle}>
              <Icon
                name="heart"
                size={21}
                filled={post.likedByMe}
                color={post.likedByMe ? colors.accent.DEFAULT : colors.text}
              />
            </Animated.View>
          </Pressable>
          <Pressable
            onPress={onOpenLikes}
            disabled={post.likeCount === 0}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${post.likeCount} like${post.likeCount === 1 ? '' : 's'}, see who liked this`}
          >
            <Text style={styles.actionCount}>{post.likeCount}</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.action}
          onPress={onOpenComments}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Comment, ${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}`}
        >
          <Icon name="comment" size={21} color={colors.text} />
          <Text style={styles.actionCount}>{post.commentCount}</Text>
        </Pressable>
      </View>

      <PostOptionsMenu
        visible={menuOpen}
        canDelete={canDelete}
        canRemoveTag={viewerIsTagged}
        canPin={viewerCanModerate}
        pinned={post.pinned}
        blockHandle={canBlockAuthor ? post.authorHandle : undefined}
        onBlock={() => {
          setMenuOpen(false);
          setConfirmingBlock(true);
        }}
        onTogglePin={() => {
          setMenuOpen(false);
          onTogglePin();
        }}
        onClose={() => setMenuOpen(false)}
        onHide={() => {
          setMenuOpen(false);
          onHide();
        }}
        onRemoveTag={() => {
          setMenuOpen(false);
          onRemoveTag();
        }}
        onDelete={() => {
          setMenuOpen(false);
          setConfirmingDelete(true);
        }}
      />
      <ConfirmModal
        visible={confirmingDelete}
        title="Delete this post?"
        body="Everyone in this Room will lose access to it. This can't be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete();
        }}
      />
      <BlockConfirmModal
        visible={confirmingBlock}
        handle={post.authorHandle}
        onCancel={() => setConfirmingBlock(false)}
        onConfirm={() => {
          setConfirmingBlock(false);
          onBlockAuthor();
        }}
      />
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing[2],
  },
  authorRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  optionsButton: {
    padding: Spacing[1],
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
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 1,
  },
  location: {
    flexShrink: 1,
    fontFamily: Fonts.bodySemibold,
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
  mediaWrap: {
    marginTop: Spacing[2],
  },
  clipBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 52,
    height: 52,
    marginTop: -26,
    marginLeft: -26,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
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
