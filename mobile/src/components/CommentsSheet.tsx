import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Avatar from '@/components/Avatar';
import BottomSheet, { BottomSheetFlatList } from '@/components/BottomSheet';
import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addComment, fetchComments, relativeTime, type Comment } from '@/lib/posts';

const QUICK_EMOJI = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

type Row = { comment: Comment; isReply: boolean };

/**
 * A post's comments as a bottom sheet over the feed (and the clips viewer),
 * replacing the tap-through to the post screen: newest top-level comments
 * first, each followed by its replies oldest-first; one level of replies,
 * same as the post screen and feed.sql's trigger.
 *
 * Out of scope for now, deliberately not drawn as dead controls: hearts on
 * comments, photo/GIF comments (both need backend work, and GIFs a third-
 * party API key), and translation (a paid API).
 *
 * Opened through its `open(postId)` handle rather than a `postId` prop, so
 * which post's comments are showing is this component's own state: opening
 * and closing re-render only the sheet, not the feed or clips viewer behind
 * it (see BottomSheet).
 */
export type CommentsSheetHandle = { open: (postId: string) => void };

const CommentsSheet = forwardRef<CommentsSheetHandle, { viewerId: string; onCommentAdded: (postId: string) => void }>(function CommentsSheet(
  { viewerId, onCommentAdded },
  ref,
) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  /** null = closed. */
  const [postId, setPostId] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ open: setPostId }), []);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different post (or reopening) starts clean.
  const [shownPostId, setShownPostId] = useState(postId);
  if (postId !== shownPostId) {
    setShownPostId(postId);
    setComments(null);
    setDraft('');
    setReplyTo(null);
    setError(null);
  }

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    fetchComments(postId)
      .then((list) => {
        if (!cancelled) setComments(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load comments.');
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const rows = useMemo<Row[]>(() => {
    if (!comments) return [];
    const topLevel = comments.filter((c) => !c.parentCommentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return topLevel.flatMap((parent) => [
      { comment: parent, isReply: false },
      ...comments
        .filter((c) => c.parentCommentId === parent.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((reply) => ({ comment: reply, isReply: true })),
    ]);
  }, [comments]);

  async function send() {
    const text = draft.trim();
    if (!postId || !text || sending) return;
    setSending(true);
    setError(null);
    try {
      await addComment(postId, viewerId, text, replyTo?.id ?? null);
      setDraft('');
      setReplyTo(null);
      setComments(await fetchComments(postId));
      onCommentAdded(postId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post your comment.');
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet visible={postId !== null} title="Comments" onClose={() => setPostId(null)}>
      {comments === null && !error ? (
        <ActivityIndicator style={styles.loading} color={colors.accent.DEFAULT} />
      ) : (
        <BottomSheetFlatList
          style={styles.flex}
          data={rows}
          keyExtractor={(r) => r.comment.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={rows.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No comments yet</Text>
              <Text style={styles.emptyBody}>Start the conversation.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.row, item.isReply && styles.replyRow]}>
              <Avatar
                gradient={item.comment.authorId ?? 'mara'}
                letter={item.comment.authorName.charAt(0).toUpperCase() || '?'}
                size={item.isReply ? 30 : 40}
              />
              <View style={styles.rowBody}>
                <Text style={styles.meta}>
                  <Text style={styles.handle}>{item.comment.authorHandle}</Text> <Text style={styles.time}>{relativeTime(item.comment.createdAt)}</Text>
                </Text>
                <Text style={styles.text}>{item.comment.text}</Text>
                {!item.isReply && (
                  <Pressable
                    onPress={() => setReplyTo(item.comment)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Reply to ${item.comment.authorHandle}`}
                  >
                    <Text style={styles.reply}>Reply</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.footer}>
        <View style={styles.emojiBar}>
          {QUICK_EMOJI.map((emoji) => (
            <Pressable key={emoji} onPress={() => setDraft((d) => d + emoji)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Add ${emoji}`}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>

        {replyTo && (
          <View style={styles.replyBanner}>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              Replying to <Text style={styles.handle}>{replyTo.authorHandle}</Text>
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel reply">
              <Icon name="close" size={14} color={colors.neutral[500]} />
            </Pressable>
          </View>
        )}

        <View style={styles.composer}>
          <View style={styles.me}>
            <Icon name="youTab" size={20} color={colors.neutral[500]} />
          </View>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={replyTo ? `Reply to ${replyTo.authorHandle}…` : 'Join the conversation…'}
              placeholderTextColor={colors.neutral[500]}
              multiline
              editable={!sending}
              accessibilityLabel="Write a comment"
            />
            {sending ? (
              <ActivityIndicator color={colors.accent.DEFAULT} />
            ) : (
              <Pressable
                onPress={send}
                disabled={!draft.trim()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Post comment"
                accessibilityState={{ disabled: !draft.trim() }}
              >
                <Icon name="send" size={20} color={draft.trim() ? colors.accent.DEFAULT : colors.neutral[300]} />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </BottomSheet>
  );
});

export default CommentsSheet;

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    loading: {
      marginTop: Spacing[8],
    },
    listContent: {
      paddingHorizontal: Spacing[4],
      paddingTop: Spacing[3],
      paddingBottom: Spacing[3],
    },
    emptyContainer: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    empty: {
      alignItems: 'center',
      gap: Spacing[1],
    },
    emptyTitle: {
      fontFamily: Fonts.bodyBold,
      fontSize: 16,
      color: colors.text,
    },
    emptyBody: {
      fontFamily: Fonts.body,
      fontSize: 13.5,
      color: colors.neutral[500],
    },
    row: {
      flexDirection: 'row',
      gap: Spacing[3],
      paddingVertical: Spacing[2],
    },
    replyRow: {
      marginLeft: 52,
    },
    rowBody: {
      flex: 1,
      gap: 2,
    },
    meta: {
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.text,
    },
    handle: {
      fontFamily: Fonts.bodySemibold,
      color: colors.text,
    },
    time: {
      color: colors.neutral[500],
    },
    text: {
      fontFamily: Fonts.body,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    reply: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 12.5,
      color: colors.neutral[500],
      marginTop: 2,
    },
    error: {
      fontFamily: Fonts.body,
      fontSize: 13,
      color: colors.error,
      textAlign: 'center',
      paddingHorizontal: Spacing[4],
      paddingBottom: Spacing[1],
    },
    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      paddingHorizontal: Spacing[4],
      paddingTop: Spacing[2],
      paddingBottom: Spacing[2],
      gap: Spacing[2],
    },
    emojiBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    emoji: {
      fontSize: 26,
    },
    replyBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing[2],
    },
    replyBannerText: {
      flex: 1,
      fontFamily: Fonts.body,
      fontSize: 12.5,
      color: colors.neutral[500],
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[2],
    },
    me: {
      width: 40,
      height: 40,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inputWrap: {
      flex: 1,
      minHeight: 44,
      maxHeight: 110,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.divider,
      paddingLeft: 16,
      paddingRight: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[2],
    },
    input: {
      flex: 1,
      paddingVertical: 10,
      fontFamily: Fonts.body,
      fontSize: 14.5,
      color: colors.text,
    },
  });
