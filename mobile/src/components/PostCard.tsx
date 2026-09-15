import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import Avatar from '@/components/Avatar';
import ConfirmModal from '@/components/ConfirmModal';
import Icon from '@/components/Icon';
import PollCard from '@/components/PollCard';
import PostMediaCarousel from '@/components/PostMediaCarousel';
import PostOptionsMenu from '@/components/PostOptionsMenu';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { relativeTime, type FeedPost } from '@/lib/posts';
import { useUserPreview } from '@/lib/user-preview-context';

/** Leaves the rest of the window free for the caption/actions row below and a peek of the next card, the way Instagram's own feed keeps scrolling legible. */
const MAX_IMAGE_HEIGHT_FRACTION = 0.55;

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
  onPress,
  onToggleLike,
  onVote,
  onHide,
  onDelete,
}: {
  post: FeedPost;
  viewerId: string;
  viewerIsRoomOwner: boolean;
  onPress: () => void;
  onToggleLike: () => void;
  onVote: (optionId: string) => Promise<void>;
  onHide: () => void;
  onDelete: () => void;
}) {
  const isModerator = post.authorRole === 'owner' || post.authorRole === 'mod';
  const canDelete = post.authorId === viewerId || viewerIsRoomOwner;
  const { open: openUserPreview } = useUserPreview();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A quick pop on the heart itself when a like lands, on top of the
  // existing haptic — set directly on press rather than watched via an
  // effect on post.likedByMe, so it fires immediately instead of a frame
  // behind the tap, and only for *this* like (not a like arriving from a
  // realtime update to someone else's tap). Animation polish pass,
  // 2026-09-15 — react-native-reanimated was already a dependency but had
  // no real call site anywhere in the app until this one.
  const likeScale = useSharedValue(1);
  const likeAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: likeScale.value }] }));

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
          <PostMediaCarousel media={post.media} maxHeightFraction={MAX_IMAGE_HEIGHT_FRACTION} onPress={onPress} />
        </View>
      )}

      {post.poll && <PollCard poll={post.poll} onVote={onVote} />}

      <View style={styles.actions}>
        <Pressable
          style={styles.action}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            if (!post.likedByMe) {
              // eslint-disable-next-line react-hooks/immutability -- a Reanimated shared value's .value is deliberately mutable, the same escape hatch Skeleton.tsx's Animated.Value ref already needs — the compiler's static analysis has no way to know that.
              likeScale.value = withSequence(withTiming(1.3, { duration: 100 }), withTiming(1, { duration: 120 }));
            }
            onToggleLike();
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Like, ${post.likeCount} like${post.likeCount === 1 ? '' : 's'}`}
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
          <Text style={styles.actionCount}>{post.likeCount}</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={onPress}
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
        onClose={() => setMenuOpen(false)}
        onHide={() => {
          setMenuOpen(false);
          onHide();
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
