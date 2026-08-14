import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
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
import Icon from '@/components/Icon';
import PollCard from '@/components/PollCard';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  addComment,
  fetchComments,
  fetchPost,
  relativeTime,
  setLiked,
  votePoll,
  type Comment,
  type FeedPost,
} from '@/lib/posts';

export default function PostDetail() {
  const { session } = useAuth();
  const { communityId, postId } = useLocalSearchParams<{ communityId: string; postId: string }>();

  const [post, setPost] = useState<FeedPost | null | 'loading'>('loading');
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  /** Non-null when the composer is replying to a specific top-level comment. */
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [fresh, freshComments] = await Promise.all([fetchPost(postId, userId), fetchComments(postId)]);
      setPost(fresh);
      setComments(freshComments);
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
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <ActivityIndicator color={Colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.body}>This post isn&apos;t available.</Text>
        <Pressable style={styles.backCta} onPress={() => router.back()}>
          <Text style={styles.backCtaText}>Go back</Text>
        </Pressable>
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Icon name="back" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Post</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {communityId}
            </Text>
          </View>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {post.imageUrls.length > 0 && (
            <Image source={{ uri: post.imageUrls[0] }} style={styles.heroImage} contentFit="cover" transition={150} />
          )}

          <View style={styles.section}>
            <View style={styles.actions}>
              <Pressable style={styles.action} onPress={handleToggleLike} hitSlop={6}>
                <Icon
                  name="heart"
                  size={23}
                  filled={post.likedByMe}
                  color={post.likedByMe ? Colors.accent.DEFAULT : Colors.text}
                />
                <Text style={styles.actionCount}>{post.likeCount}</Text>
              </Pressable>
              <View style={styles.action}>
                <Icon name="comment" size={23} color={Colors.text} />
                <Text style={styles.actionCount}>{post.commentCount}</Text>
              </View>
            </View>

            <View style={styles.authorRow}>
              <Avatar
                gradient={post.authorId ?? 'mara'}
                letter={post.authorName.charAt(0).toUpperCase() || '?'}
                size={34}
              />
              <View style={styles.flex}>
                <Text style={styles.postBody}>
                  <Text style={styles.authorHandle}>{post.authorHandle} </Text>
                  {post.text}
                  {post.tag ? <Text style={styles.tag}> {post.tag}</Text> : null}
                </Text>
                <Text style={styles.time}>{relativeTime(post.createdAt)}</Text>
              </View>
            </View>

            {post.poll && <PollCard poll={post.poll} onVote={handleVote} />}

            <View style={styles.rule} />

            {topLevel.length === 0 ? (
              <Text style={styles.noComments}>No comments yet.</Text>
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
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <Icon name="close" size={14} color={Colors.neutral[400]} />
              </Pressable>
            </View>
          )}
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              value={draft}
              onChangeText={setDraft}
              placeholder={replyTo ? `Reply to ${replyTo.authorHandle}…` : 'Add a comment…'}
              placeholderTextColor={Colors.neutral[500]}
              editable={!sending}
            />
            <Pressable
              style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
            >
              {sending ? <ActivityIndicator size="small" color={Colors.bg} /> : <Icon name="send" size={18} color={Colors.bg} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  return (
    <View style={styles.commentRow}>
      <Avatar
        gradient={comment.authorId ?? 'mara'}
        letter={comment.authorName.charAt(0).toUpperCase() || '?'}
        size={isReply ? 28 : 32}
      />
      <View style={styles.flex}>
        <Text style={styles.commentText}>
          <Text style={styles.authorHandle}>{comment.authorHandle} </Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
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
    paddingTop: Spacing[3],
    paddingBottom: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: Colors.text,
  },
  headerSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.accent[300],
  },
  content: {
    paddingBottom: Spacing[6],
  },
  heroImage: {
    width: '100%',
    height: 330,
    backgroundColor: Colors.surface,
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
    color: Colors.text,
  },
  authorRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  postBody: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.text,
  },
  authorHandle: {
    fontFamily: Fonts.bodyBold,
  },
  tag: {
    color: Colors.accent[300],
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.neutral[500],
    marginTop: 5,
  },
  rule: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing[4],
  },
  noComments: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.neutral[500],
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
    color: Colors.text,
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
    color: Colors.neutral[500],
  },
  replyAction: {
    fontFamily: Fonts.bodyBold,
    fontSize: 11.5,
    color: Colors.neutral[400],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    marginTop: Spacing[3],
  },
  backCta: {
    height: 44,
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backCtaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.text,
  },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    backgroundColor: Colors.surface,
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
    color: Colors.neutral[400],
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
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 16,
    fontSize: 13.5,
    color: Colors.text,
    fontFamily: Fonts.body,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
