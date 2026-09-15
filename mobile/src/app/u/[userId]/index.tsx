import { BlurTargetView } from 'expo-blur';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import TabBar from '@/components/TabBar';
import { Fonts, MaxContentWidth, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { startDm } from '@/lib/chat';
import { useAuth } from '@/lib/auth-context';
import { acceptFriendRequest, fetchFriendCount, fetchFriendshipStatus, removeFriendship, sendFriendRequest, type FriendshipStatus } from '@/lib/friends';
import { signProfileMediaUrls } from '@/lib/profileMedia';
import { fetchProfile, formatLastActive, type Profile } from '@/lib/profiles';
import { fetchRecentPostsByAuthor, type AuthorPostPreview } from '@/lib/posts';
import { signMediaUrls } from '@/lib/media';
import { fetchMyRooms, type Room, type RoomRole } from '@/lib/rooms';
import { signRoomMediaUrls } from '@/lib/roomMedia';

type JoinedRoom = Room & { myRole: RoomRole; myNotificationsMuted: boolean };

export default function ProfileScreen() {
  const { session } = useAuth();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const blurTargetRef = useRef<View>(null);
  const [profile, setProfile] = useState<Profile | null | 'loading'>('loading');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [rooms, setRooms] = useState<JoinedRoom[] | null>(null);
  const [roomMediaUrls, setRoomMediaUrls] = useState<Map<string, string>>(new Map());
  const [posts, setPosts] = useState<AuthorPostPreview[] | null>(null);
  const [postMediaUrls, setPostMediaUrls] = useState<Map<string, string>>(new Map());
  const [messaging, setMessaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friendshipStatus, setFriendshipStatus] = useState<FriendshipStatus>('none');
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [friendActionBusy, setFriendActionBusy] = useState(false);

  const myId = session?.user.id;
  const isOwnProfile = userId === myId;

  useFocusEffect(
    useCallback(() => {
      setProfile('loading');
      setAvatarUrl(null);
      setBannerUrl(null);
      setRooms(null);
      setPosts(null);
      (async () => {
        try {
          const [p, roomList, postList] = await Promise.all([
            fetchProfile(userId),
            fetchMyRooms(userId),
            fetchRecentPostsByAuthor(userId, 9),
          ]);
          setProfile(p);
          setRooms(roomList);
          setPosts(postList);

          const profileMediaPaths = [p?.avatar_url, p?.banner_url].filter((path): path is string => !!path);
          if (profileMediaPaths.length > 0) {
            const signed = await signProfileMediaUrls(profileMediaPaths);
            setAvatarUrl(p?.avatar_url ? (signed.get(p.avatar_url) ?? null) : null);
            setBannerUrl(p?.banner_url ? (signed.get(p.banner_url) ?? null) : null);
          }

          const roomPaths = roomList.flatMap((r) => [r.avatar_url, r.banner_url]).filter((path): path is string => !!path);
          if (roomPaths.length > 0) signRoomMediaUrls(roomPaths).then(setRoomMediaUrls).catch(() => {});

          const postPaths = postList.map((post) => post.imagePath).filter((path): path is string => !!path);
          if (postPaths.length > 0) signMediaUrls(postPaths).then(setPostMediaUrls).catch(() => {});
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load this profile.');
        }
      })();
    }, [userId]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      fetchFriendCount(userId).then(setFriendCount).catch(() => {});
      if (myId && userId !== myId) {
        fetchFriendshipStatus(myId, userId).then(setFriendshipStatus).catch(() => {});
      }
    }, [userId, myId]),
  );

  if (!session) return null;

  async function handleMessage() {
    if (!userId) return;
    setMessaging(true);
    setError(null);
    try {
      const conversationId = await startDm(userId);
      router.push({ pathname: '/chats/[chatId]', params: { chatId: conversationId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start that conversation.');
    } finally {
      setMessaging(false);
    }
  }

  async function handleAddFriend() {
    if (!userId || !myId) return;
    setFriendActionBusy(true);
    setError(null);
    try {
      await sendFriendRequest(myId, userId);
      setFriendshipStatus('pending_sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that friend request.');
    } finally {
      setFriendActionBusy(false);
    }
  }

  async function handleCancelRequest() {
    if (!userId || !myId) return;
    setFriendActionBusy(true);
    setError(null);
    try {
      await removeFriendship(myId, userId);
      setFriendshipStatus('none');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel that request.');
    } finally {
      setFriendActionBusy(false);
    }
  }

  async function handleAcceptRequest() {
    if (!userId || !myId) return;
    setFriendActionBusy(true);
    setError(null);
    try {
      await acceptFriendRequest(myId, userId);
      setFriendshipStatus('friends');
      setFriendCount((c) => (c ?? 0) + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept that request.');
    } finally {
      setFriendActionBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: clearance }]}>
        {profile === 'loading' ? (
          <View>
            <Skeleton width="100%" height={BANNER_HEIGHT} radius={0} />
            <View style={styles.avatarRing}>
              <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius={999} />
            </View>
            <View style={styles.contentBody}>
              <View style={styles.identity}>
                <Skeleton width={160} height={20} radius={8} />
                <Skeleton width={100} height={14} radius={6} />
                <Skeleton width={220} height={13} radius={6} />
              </View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.bannerWrap}>
              {/* bannerEmpty renders underneath regardless of bannerUrl, not
                  just as the no-banner fallback — otherwise a real banner
                  shows nothing while its signed URL loads. Image caching
                  pass, 2026-09-15. */}
              <View style={styles.bannerEmpty} />
              {bannerUrl && (
                <Image
                  source={{ uri: bannerUrl }}
                  style={[StyleSheet.absoluteFill, styles.bannerImage]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
              )}
              {isOwnProfile && (
                <Pressable
                  style={styles.settingsButton}
                  hitSlop={8}
                  onPress={() => router.push({ pathname: '/u/[userId]/settings', params: { userId } })}
                  accessibilityRole="button"
                  accessibilityLabel="Settings and activity"
                >
                  <Icon name="menu" size={20} color="#ffffff" />
                </Pressable>
              )}
            </View>

            <View style={styles.avatarRing}>
              <Avatar gradient={userId} imageUrl={avatarUrl} letter={profile?.name.charAt(0).toUpperCase() || '?'} size={104} ring />
            </View>

            <View style={styles.contentBody}>
              <View style={styles.identity}>
                <Text style={styles.name}>{profile?.name ?? 'Unknown'}</Text>
                {profile && <Text style={styles.handle}>@{profile.handle}</Text>}
                {!isOwnProfile && profile?.last_active_at && <Text style={styles.activeStatus}>{formatLastActive(profile.last_active_at)}</Text>}
                {profile?.bio && <Text style={styles.bio}>{profile.bio}</Text>}
                {profile && friendCount !== null && (
                  <Pressable onPress={() => router.push({ pathname: '/u/[userId]/friends', params: { userId } })} hitSlop={6}>
                    <Text style={styles.friendCount}>
                      {friendCount} friend{friendCount === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                )}
              </View>

              {error && <Text style={styles.error}>{error}</Text>}

              {!isOwnProfile && profile && (
                <View style={styles.actionsRow}>
                  {friendshipStatus === 'friends' && (
                    <Pressable style={styles.messageButton} onPress={handleMessage} disabled={messaging}>
                      {messaging ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.messageButtonText}>Message</Text>}
                    </Pressable>
                  )}
                  {friendshipStatus === 'none' && (
                    <Pressable style={styles.messageButton} onPress={handleAddFriend} disabled={friendActionBusy}>
                      {friendActionBusy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.messageButtonText}>Add Friend</Text>}
                    </Pressable>
                  )}
                  {friendshipStatus === 'pending_sent' && (
                    <Pressable style={styles.pendingButton} onPress={handleCancelRequest} disabled={friendActionBusy}>
                      {friendActionBusy ? (
                        <ActivityIndicator color={colors.text} />
                      ) : (
                        <Text style={styles.pendingButtonText}>Request Sent · Cancel</Text>
                      )}
                    </Pressable>
                  )}
                  {friendshipStatus === 'pending_received' && (
                    <View style={styles.pendingReceivedRow}>
                      {friendActionBusy ? (
                        <ActivityIndicator color={colors.accent.DEFAULT} />
                      ) : (
                        <>
                          <Pressable style={styles.acceptBtn} onPress={handleAcceptRequest}>
                            <Text style={styles.acceptText}>Accept</Text>
                          </Pressable>
                          <Pressable style={styles.declineBtn} onPress={handleCancelRequest}>
                            <Text style={styles.declineText}>Decline</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Rooms</Text>
                {rooms === null ? (
                  <View style={styles.roomList}>
                    {[130, 100].map((width, i) => (
                      <View key={i} style={styles.roomRow}>
                        <Skeleton width={48} height={48} radius={Radius.sm} />
                        <View style={styles.roomText}>
                          <Skeleton width={width} height={14} radius={6} />
                          <Skeleton width={70} height={12} radius={5} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : rooms.length === 0 ? (
                  <EmptyState
                    icon="globe"
                    message={isOwnProfile ? "You haven't joined any Rooms yet." : 'No Rooms in common.'}
                  />
                ) : (
                  <>
                    <View style={styles.roomList}>
                      {rooms.slice(0, 3).map((room) => {
                        const iconUrl = room.avatar_url ? roomMediaUrls.get(room.avatar_url) : undefined;
                        return (
                          <Pressable
                            key={room.id}
                            style={styles.roomRow}
                            onPress={() => router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } })}
                          >
                            <Avatar
                              gradient={room.id}
                              color={room.accent_color}
                              imageUrl={iconUrl}
                              letter={room.name.charAt(0).toUpperCase()}
                              size={48}
                              shape="square"
                            />
                            <View style={styles.roomText}>
                              <Text style={styles.roomName} numberOfLines={1}>
                                {room.name}
                              </Text>
                              <Text style={styles.roomMeta}>
                                {room.member_count} member{room.member_count === 1 ? '' : 's'}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                    {rooms.length > 3 && (
                      <Pressable
                        style={styles.viewAllButton}
                        onPress={() => router.push({ pathname: '/u/[userId]/rooms', params: { userId } })}
                      >
                        <Text style={styles.viewAllButtonText}>View All Rooms ({rooms.length})</Text>
                        <Icon name="chevronRight" size={16} color={colors.text} strokeWidth={2.4} />
                      </Pressable>
                    )}
                  </>
                )}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Posts</Text>
                {posts === null ? (
                  <View style={styles.postGrid}>
                    {/* Plain colors.surface boxes, not shimmering Skeletons
                        — postThumb's own resting background already reads
                        as a placeholder, and Skeleton's height prop is a
                        fixed number, not the aspectRatio: 1 these tiles
                        actually need. */}
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <View key={i} style={styles.postThumb} />
                    ))}
                  </View>
                ) : posts.length === 0 ? (
                  <EmptyState icon="textLines" message="No posts yet." />
                ) : (
                  <View style={styles.postGrid}>
                    {posts.map((post) => {
                      const url = post.imagePath ? postMediaUrls.get(post.imagePath) : undefined;
                      return (
                        <Pressable
                          key={post.id}
                          style={styles.postThumb}
                          disabled={!post.roomSlug}
                          onPress={() =>
                            router.push({ pathname: '/c/[communityId]/post/[postId]', params: { communityId: post.roomSlug, postId: post.id } })
                          }
                        >
                          {url ? (
                            <Image
                              source={{ uri: url }}
                              style={styles.postThumbImage}
                              contentFit="cover"
                              cachePolicy="memory-disk"
                              transition={150}
                            />
                          ) : (
                            <Text style={styles.postThumbText} numberOfLines={5}>
                              {post.hasPoll ? '📊 Poll' : (post.text ?? '')}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
      </BlurTargetView>

      <TabBar active="You" userId={session.user.id} blurTarget={blurTargetRef} />
    </SafeAreaView>
  );
}

const AVATAR_SIZE = 104;
const BANNER_HEIGHT = 170;

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: Spacing[8],
  },
  bannerWrap: {
    height: BANNER_HEIGHT,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  // A fixed mid-gray in both themes, same reasoning as Room/edit-profile's
  // own empty banner state — a swatch derived from `colors` can't be
  // trusted to stay a fixed lightness across Light/Dark mode.
  bannerEmpty: {
    width: '100%',
    height: '100%',
    backgroundColor: '#B8B8B8',
  },
  settingsButton: {
    position: 'absolute',
    right: Spacing[4],
    top: Spacing[4],
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Absolute against the ScrollView's own content (the nearest ancestor
  // View — RN treats every View as a containing block, not just ones
  // marked position:'relative' the way web does), pulled up so it
  // straddles the banner/body seam the same way create-community's own
  // avatarRing does.
  avatarRing: {
    position: 'absolute',
    left: Spacing[6],
    top: BANNER_HEIGHT - AVATAR_SIZE / 2,
  },
  contentBody: {
    marginTop: AVATAR_SIZE / 2 + Spacing[3],
    paddingHorizontal: Spacing[6],
    gap: Spacing[7],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  identity: {
    gap: Spacing[2],
  },
  name: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: colors.text,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: colors.neutral[400],
  },
  activeStatus: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.accent[300],
  },
  bio: {
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.neutral[400],
    marginTop: Spacing[1],
  },
  friendCount: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14.5,
    color: colors.accent[300],
    marginTop: Spacing[1],
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    textAlign: 'center',
  },
  actionsRow: {
    gap: Spacing[2],
  },
  messageButton: {
    height: 50,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageButtonText: {
    fontFamily: Fonts.heading,
    fontSize: 16,
    color: colors.bg,
  },
  pendingButton: {
    height: 50,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingButtonText: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.neutral[400],
  },
  pendingReceivedRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  acceptBtn: {
    flex: 1,
    height: 50,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: {
    fontFamily: Fonts.heading,
    fontSize: 16,
    color: colors.bg,
  },
  declineBtn: {
    flex: 1,
    height: 50,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  section: {
    gap: Spacing[3],
  },
  sectionLabel: {
    ...Typography.label,
    color: colors.neutral[500],
  },
  roomList: {
    gap: Spacing[4],
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  roomText: {
    flex: 1,
    gap: 2,
  },
  roomName: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 16,
    color: colors.text,
  },
  roomMeta: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[500],
  },
  viewAllButton: {
    marginTop: Spacing[1],
    height: 44,
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewAllButtonText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14,
    color: colors.text,
  },
  postGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  // Fixed proportion of the row, not `flex: 1` — a single-post row
  // stretched to fill the entire width otherwise (see PostCard's own
  // postThumb, which hit the same bug for the same reason).
  postThumb: {
    width: '32.4%',
    aspectRatio: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  postThumbImage: {
    width: '100%',
    height: '100%',
  },
  postThumbText: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[400],
    textAlign: 'center',
  },
});
