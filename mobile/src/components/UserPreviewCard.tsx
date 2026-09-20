import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Shadows, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signMediaUrls } from '@/lib/media';
import { cachedImageSource } from '@/lib/mediaUtils';
import { fetchRecentPostsByAuthor, type AuthorPostPreview } from '@/lib/posts';
import { formatLastActive } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';

type PreviewProfile = { id: string; handle: string; name: string; bio: string | null; last_active_at: string | null };

/**
 * The Instagram-style "tap a person, see a small preview" card — every
 * post author, comment author, Room member, and search result opens this
 * instead of jumping straight to the full profile. One instance is
 * mounted globally (see lib/user-preview-context.tsx) rather than one per
 * screen, since the same popup behaves identically everywhere it's
 * triggered from.
 */
export default function UserPreviewCard({ userId, visible, onClose }: { userId: string | null; visible: boolean; onClose: () => void }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Keyed by the userId each result actually belongs to, not reset
  // synchronously when userId changes (that's a setState-in-effect-body
  // anti-pattern) — a mismatch between `.userId` and the current `userId`
  // prop is treated as "not loaded yet" during render instead, so
  // switching from one person to another can never flash the previous
  // person's stale data.
  const [profileResult, setProfileResult] = useState<{ userId: string; profile: PreviewProfile | null } | null>(null);
  const [postsResult, setPostsResult] = useState<{ userId: string; posts: AuthorPostPreview[] } | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());

  const profile = profileResult?.userId === userId ? profileResult.profile : 'loading';
  const posts = postsResult?.userId === userId ? postsResult.posts : null;

  useEffect(() => {
    if (!userId || !visible) return;
    supabase
      .from('profiles')
      .select('id, handle, name, bio, last_active_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => setProfileResult({ userId, profile: data }));
    fetchRecentPostsByAuthor(userId)
      .then((fetched) => setPostsResult({ userId, posts: fetched }))
      .catch(() => setPostsResult({ userId, posts: [] }));
  }, [userId, visible]);

  // Paths already handed to the signer. A ref rather than reading
  // `mediaUrls`, which this effect also writes: depending on `mediaUrls`
  // would loop forever over any path that fails to sign, because
  // signBucketUrls omits failures from its result instead of throwing, so
  // the path would stay unsigned and re-trigger the effect on every pass.
  // Reading a ref inside an effect is fine — only during render it isn't —
  // so this needs no eslint-disable, which would make the React Compiler
  // skip the whole component.
  const requestedPaths = useRef<Set<string>>(new Set());

  useEffect(() => {
    const paths = (posts ?? []).map((p) => p.mediaPath).filter((p): p is string => !!p);
    const unsigned = paths.filter((p) => !requestedPaths.current.has(p));
    if (unsigned.length === 0) return;
    for (const path of unsigned) requestedPaths.current.add(path);
    signMediaUrls(unsigned)
      .then((signed) => setMediaUrls((prev) => new Map([...prev, ...signed])))
      .catch(() => {});
  }, [posts]);

  function handleVisitProfile() {
    if (!userId) return;
    onClose();
    router.push({ pathname: '/u/[userId]', params: { userId } });
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows the backdrop's onPress so tapping inside the card doesn't close it. */}
        <Pressable style={styles.card} onPress={() => {}}>
          {profile === 'loading' || !profile ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.accent.DEFAULT} />
            </View>
          ) : (
            <>
              <Avatar gradient={profile.id} letter={profile.name.charAt(0).toUpperCase() || '?'} size={64} ring />
              <Text style={styles.name}>{profile.name}</Text>
              <Text style={styles.handle}>@{profile.handle}</Text>
              {profile.last_active_at && <Text style={styles.activeStatus}>{formatLastActive(profile.last_active_at)}</Text>}
              {profile.bio && (
                <Text style={styles.bio} numberOfLines={2}>
                  {profile.bio}
                </Text>
              )}

              <View style={styles.postsRow}>
                {posts === null ? (
                  <ActivityIndicator color={colors.accent.DEFAULT} />
                ) : posts.length === 0 ? (
                  <Text style={styles.noPosts}>No posts yet.</Text>
                ) : (
                  posts.map((post) => {
                    const url = post.mediaPath ? mediaUrls.get(post.mediaPath) : undefined;
                    return (
                      <View key={post.id} style={styles.postThumb}>
                        {url && post.mediaKind === 'video' ? (
                          <View style={styles.postThumbVideo}>
                            <Icon name="play" size={18} color={colors.text} />
                          </View>
                        ) : url ? (
                          <Image
                            source={cachedImageSource(url)}
                            style={styles.postThumbImage}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            transition={150}
                          />
                        ) : (
                          <Text style={styles.postThumbText} numberOfLines={4}>
                            {post.hasPoll ? '📊 Poll' : (post.text ?? '')}
                          </Text>
                        )}
                      </View>
                    );
                  })
                )}
              </View>

              <Pressable style={styles.visitButton} onPress={handleVisitProfile}>
                <Icon name="youTab" size={16} color={colors.bg} />
                <Text style={styles.visitButtonText}>View Full Profile</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[6],
  },
  card: {
    width: '100%',
    maxWidth: Math.min(MaxContentWidth, 360),
    borderRadius: Radius.lg,
    backgroundColor: colors.bg,
    paddingVertical: Spacing[6],
    paddingHorizontal: Spacing[4],
    alignItems: 'center',
    gap: Spacing[1],
    ...Shadows.lg,
  },
  loadingBox: {
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: colors.text,
    marginTop: Spacing[2],
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
  },
  activeStatus: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 12,
    color: colors.accent[300],
    marginTop: 2,
  },
  bio: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
    textAlign: 'center',
    marginTop: Spacing[2],
  },
  postsRow: {
    flexDirection: 'row',
    gap: Spacing[2],
    marginTop: Spacing[4],
    minHeight: 72,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noPosts: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[500],
  },
  postThumb: {
    // Fixed proportion of the row, not `flex: 1` — that sizes each tile
    // based on how many siblings it has, so a single post stretched to
    // fill the entire row (and, via aspectRatio, grew just as tall). 30%
    // keeps every tile the same size whether there are 1, 2, or 3 posts,
    // with enough slack left over for the two gaps between them.
    width: '30%',
    aspectRatio: 1,
    borderRadius: Radius.sm,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  postThumbImage: {
    width: '100%',
    height: '100%',
  },
  postThumbVideo: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  postThumbText: {
    fontFamily: Fonts.body,
    fontSize: 9.5,
    color: colors.neutral[400],
    textAlign: 'center',
  },
  visitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    height: 44,
    width: '100%',
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    marginTop: Spacing[4],
  },
  visitButtonText: {
    fontFamily: Fonts.heading,
    fontSize: 14,
    color: colors.bg,
  },
});
