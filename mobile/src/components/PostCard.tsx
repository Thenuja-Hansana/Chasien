import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import PollCard from '@/components/PollCard';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { relativeTime, type FeedPost } from '@/lib/posts';

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

  return (
    <View style={styles.container}>
      <View style={styles.authorRow}>
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
      </View>

      {post.text ? (
        <Text style={styles.body}>
          {post.text}
          {post.tag ? <Text style={styles.tag}> {post.tag}</Text> : null}
        </Text>
      ) : null}

      {post.imageUrls.length > 0 && (
        <Pressable style={styles.imageWrap} onPress={onPress}>
          <Image source={{ uri: post.imageUrls[0] }} style={styles.image} contentFit="cover" transition={150} />
          {post.imageCount > 1 && <Text style={styles.imageCount}>1/{post.imageCount}</Text>}
        </Pressable>
      )}

      {post.poll && <PollCard poll={post.poll} onVote={onVote} />}

      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={onToggleLike} hitSlop={6}>
          <Icon
            name="heart"
            size={21}
            filled={post.likedByMe}
            color={post.likedByMe ? Colors.accent.DEFAULT : Colors.text}
          />
          <Text style={styles.actionCount}>{post.likeCount}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={onPress} hitSlop={6}>
          <Icon name="comment" size={21} color={Colors.text} />
          <Text style={styles.actionCount}>{post.commentCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
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
    color: Colors.text,
    flexShrink: 1,
  },
  modBadge: {
    fontFamily: Fonts.bodyBold,
    fontSize: 9.5,
    color: Colors.accent[300],
    backgroundColor: `${Colors.accent.DEFAULT}38`,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.neutral[500],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14.5,
    lineHeight: 21,
    color: Colors.text,
  },
  tag: {
    color: Colors.accent[300],
  },
  imageWrap: {
    marginTop: Spacing[2],
    borderRadius: Radius.md,
    overflow: 'hidden',
    height: 230,
    backgroundColor: Colors.surface,
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
    color: Colors.text,
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
    color: Colors.text,
  },
});
