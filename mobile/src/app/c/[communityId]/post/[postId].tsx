import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import PollCard from '@/components/PollCard';
import PostCardSkeleton from '@/components/PostCardSkeleton';
import PostMediaCarousel from '@/components/PostMediaCarousel';
import PostOptionsMenu from '@/components/PostOptionsMenu';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { togglePostPin } from '@/lib/notifications';
import { useUserPreview } from '@/lib/user-preview-context';
import {
  addComment,
  deletePost,
  fetchComments,
  fetchPost,
  hidePost,
  relativeTime,
  setLiked,
  votePoll,
  type Comment,
  type FeedPost,
} from '@/lib/posts';
import { fetchMyMembership } from '@/lib/rooms';

/** Smaller than the feed card's own cap — this is a dedicated post screen, not a scrolling list, so the goal is just keeping the author row/actions/comments visibly within reach below it rather than the photo alone filling the screen. */
const MAX_HERO_HEIGHT_FRACTION = 0.5;

export default function PostDetail() {
  const { session } = useAuth();
  const { open: openUserPreview } = useUserPreview();
  const { communityId, postId } = useLocalSearchParams<{ communityId: string; postId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [post, setPost] = useState<FeedPost | null | 'loading'>('loading');
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const commentFocus = useFocusHighlight();
  /** Non-null when the composer is replying to a specific top-level comment. */
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [isRoomOwner, setIsRoomOwner] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [fresh, freshComments] = await Promise.all([fetchPost(postId, userId), fetchComments(postId)]);
      setPost(fresh);
      setComments(freshComments);
      if (fresh) {
        const membership = await fetchMyMembership(fresh.roomId, userId);
        const approved = membership?.join_state === 'approved';
        setIsModerator(approved && (membership.role === 'owner' || membership.role === 'admin' || membership.role === 'mod'));
        setIsRoomOwner(approved && membership.role === 'owner');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load this post.');
      setPost(null);
    }
  }, [postId, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!session) return null;

  async function handleToggleLike() {
    if (!userId || post === 'loading' || !post) return;
    const nextLiked = !post.likedByMe;
    const snapshot = post;
    setPost({ ...post, likedByMe: nextLiked, likeCount: post.likeCount + (nextLiked ? 1 : -1) });
    try {
      await setLiked(post.id, userId, nextLiked);
    } catch (e) {
      setPost(snapshot);
      setError(e instanceof Error ? e.message : 'Could not update that like.');
    }
  }

  async function handleVote(optionId: string) {
    if (!userId || post === 'loading' || !post?.poll) return;
    try {
      await votePoll(post.poll.id, optionId, userId, post.poll.myOptionId);
      const fresh = await fetchPost(post.id, userId);
      if (fresh) setPost(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that vote.');
    }
  }

  async function handleTogglePin() {
    if (post === 'loading' || !post || pinning) return;
    const nextPinned = !post.pinned;
    setPinning(true);
    setError(null);
    try {
      await togglePostPin(post.id, nextPinned);
      setPost({ ...post, pinned: nextPinned });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the pin.');
    } finally {
      setPinning(false);
    }
  }

  // Hiding or deleting the post the viewer is currently looking at leaves
  // nothing to keep showing them, so both navigate back on success rather
  // than trying to render an empty/removed state on this same screen.
  async function handleHide() {
    if (post === 'loading' || !post || !userId) return;
    try {
      await hidePost(post.id, userId);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hide that post.');
    }
  }

  async function handleDelete() {
    if (post === 'loading' || !post) return;
    try {
      await deletePost(post.id);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that post.');
    }
  }

  async function handleSend() {
    if (!userId || !draft.trim() || sending || post === 'loading' || !post) return;
    setSending(true);
    setError(null);
    try {
      await addComment(post.id, userId, draft, replyTo?.id ?? null);
      setDraft('');
      setReplyTo(null);
      const [fresh, freshComments] = await Promise.all([fetchPost(post.id, userId), fetchComments(post.id)]);
      if (fresh) setPost(fresh);
      setComments(freshComments);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that comment.');
    } finally {
      setSending(false);
    }
  }

  if (post === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <PostCardSkeleton bodyHeight={280} />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top', 'bottom']}>
        <EmptyState
          icon="alertCircle"
          message="This post isn't available."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  // Comments come back flat and chronological; a reply is any comment
  // with a parent. One level deep is enforced by a trigger in feed.sql,
  // so grouping replies under their parent can't recurse.
  const topLevel = comments.filter((c) => !c.parentCommentId);
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (!c.parentCommentId) continue;
    repliesByParent.set(c.parentCommentId, [...(repliesByParent.get(c.parentCommentId) ?? []), c]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* 'height' on Android — see chats/[chatId].tsx's comment: adjustResize
          alone doesn't reliably resize content under Expo's default
          edge-to-edge display, so the comment composer needs its own
          JS-driven keyboard-height adjustment too. */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Post</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {communityId}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {isModerator && (
              <Pressable
                onPress={handleTogglePin}
                hitSlop={12}
                disabled={pinning}
                accessibilityRole="button"
                accessibilityLabel={post.pinned ? 'Unpin post' : 'Pin post'}
                accessibilityState={{ selected: post.pinned }}
              >
                {pinning ? (
                  <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
                ) : (
                  <Icon name="pin" size={20} filled={post.pinned} color={post.pinned ? colors.accent.DEFAULT : colors.text} />
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Post options"
            >
              <Icon name="dotsH" size={20} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {post.media.length > 0 && (
            <View style={styles.heroWrap}>
              <PostMediaCarousel media={post.media} maxHeightFraction={MAX_HERO_HEIGHT_FRACTION} />
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.actions}>
              <Pressable
                style={styles.action}
                onPress={handleToggleLike}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Like, ${post.likeCount} like${post.likeCount === 1 ? '' : 's'}`}
                accessibilityState={{ selected: post.likedByMe }}
              >
                <Icon
                  name="heart"
                  size={23}
                  filled={post.likedByMe}
                  color={post.likedByMe ? colors.accent.DEFAULT : colors.text}
                />
                <Text style={styles.actionCount}>{post.likeCount}</Text>
              </Pressable>
              <View style={styles.action}>
                <Icon name="comment" size={23} color={colors.text} />
                <Text style={styles.actionCount}>{post.commentCount}</Text>
              </View>
            </View>

            <View style={styles.authorRow}>
              <Pressable
                disabled={!post.authorId}
                onPress={() => openUserPreview(post.authorId as string)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`View ${post.authorName}'s profile`}
              >
                <Avatar
                  gradient={post.authorId ?? 'mara'}
                  letter={post.authorName.charAt(0).toUpperCase() || '?'}
                  size={34}
                />
              </Pressable>
              <View style={styles.flex}>
                <Text style={styles.postBody}>
                  <Text
                    style={styles.authorHandle}
                    onPress={post.authorId ? () => openUserPreview(post.authorId as string) : undefined}
                  >
                    {post.authorHandle}{' '}
                  </Text>
                  {post.text}
                  {post.tag ? <Text style={styles.tag}> {post.tag}</Text> : null}
                </Text>
                <Text style={styles.time}>{relativeTime(post.createdAt)}</Text>
              </View>
            </View>

            {post.poll && <PollCard poll={post.poll} onVote={handleVote} />}

            <View style={styles.rule} />

            {topLevel.length === 0 ? (
              <EmptyState icon="comment" message="No comments yet." />
            ) : (
              <View style={styles.comments}>
                {topLevel.map((comment) => (
                  <View key={comment.id} style={styles.commentGroup}>
                    <CommentRow comment={comment} onReply={() => setReplyTo(comment)} />
                    {(repliesByParent.get(comment.id) ?? []).map((reply) => (
                      <View key={reply.id} style={styles.replyIndent}>
                        <CommentRow comment={reply} isReply />
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        </ScrollView>

        <View style={styles.composerWrap}>
          {replyTo && (
            <View style={styles.replyingBanner}>
              <Text style={styles.replyingText} numberOfLines={1}>
                Replying to {replyTo.authorHandle}
              </Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
                <Icon name="close" size={14} color={colors.neutral[400]} />
              </Pressable>
            </View>
          )}
          <View style={styles.composer}>
            <TextInput
              style={[styles.composerInput, commentFocus.focused && styles.composerInputFocused]}
              value={draft}
              onChangeText={setDraft}
              onFocus={commentFocus.onFocus}
              onBlur={commentFocus.onBlur}
              placeholder={replyTo ? `Reply to ${replyTo.authorHandle}…` : 'Add a comment…'}
              placeholderTextColor={colors.neutral[500]}
              editable={!sending}
            />
            <Pressable
              style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={replyTo ? 'Send reply' : 'Post comment'}
            >
              {sending ? <ActivityIndicator size="small" color={colors.bg} /> : <Icon name="send" size={18} color={colors.bg} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <PostOptionsMenu
        visible={menuOpen}
        canDelete={post.authorId === userId || isRoomOwner}
        onClose={() => setMenuOpen(false)}
        onHide={() => {
          setMenuOpen(false);
          handleHide();
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
          handleDelete();
        }}
      />
    </SafeAreaView>
  );
}

function CommentRow({
  comment,
  isReply = false,
  onReply,
}: {
  comment: Comment;
  isReply?: boolean;
  onReply?: () => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { open: openUserPreview } = useUserPreview();
  return (
    <View style={styles.commentRow}>
      <Pressable
        disabled={!comment.authorId}
        onPress={() => openUserPreview(comment.authorId as string)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`View ${comment.authorName}'s profile`}
      >
        <Avatar
          gradient={comment.authorId ?? 'mara'}
          letter={comment.authorName.charAt(0).toUpperCase() || '?'}
          size={isReply ? 28 : 32}
        />
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.commentText}>
          <Text
            style={styles.authorHandle}
            onPress={comment.authorId ? () => openUserPreview(comment.authorId as string) : undefined}
          >
            {comment.authorHandle}{' '}
          </Text>
          {comment.text}
        </Text>
        <View style={styles.commentMeta}>
          <Text style={styles.commentMetaText}>{relativeTime(comment.createdAt)}</Text>
          {/* Only top-level comments offer Reply — feed.sql's trigger rejects a reply to a reply. */}
          {onReply && (
            <Pressable onPress={onReply} hitSlop={6}>
              <Text style={styles.replyAction}>Reply</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerText: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: colors.text,
  },
  headerSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.accent[300],
  },
  content: {
    paddingBottom: Spacing[6],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  heroWrap: {
    width: '100%',
  },
  section: {
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[6],
    marginBottom: Spacing[3],
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13.5,
    color: colors.text,
  },
  authorRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  postBody: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  authorHandle: {
    fontFamily: Fonts.bodyBold,
  },
  tag: {
    color: colors.accent[300],
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[500],
    marginTop: 5,
  },
  rule: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: Spacing[4],
  },
  comments: {
    gap: Spacing[4],
  },
  commentGroup: {
    gap: Spacing[3],
  },
  commentRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  replyIndent: {
    paddingLeft: 42,
  },
  commentText: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.text,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    marginTop: 4,
  },
  commentMetaText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[500],
  },
  replyAction: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: colors.neutral[400],
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
    marginTop: Spacing[3],
  },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
    paddingBottom: Spacing[6],
  },
  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
  },
  replyingText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[400],
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
  },
  composerInput: {
    flex: 1,
    height: 42,
    borderRadius: Radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 16,
    fontSize: 13.5,
    color: colors.text,
    fontFamily: Fonts.body,
  },
  composerInputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
