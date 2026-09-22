import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import TabBar from '@/components/TabBar';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/errors';
import { cachedImageSource } from '@/lib/mediaUtils';
import { cacheJoinedRoom } from '@/lib/room-cache';
import {
  fetchDiscoverRooms,
  fetchMyMembershipMap,
  joinRoom,
  ROOM_CATEGORIES,
  type Membership,
  type Room,
  type RoomCategory,
} from '@/lib/rooms';
import { signRoomMediaUrls } from '@/lib/roomMedia';

const VISIBILITY_LABEL: Record<Room['visibility'], string> = {
  public: 'Public',
  request: 'Request to join',
  invite: 'Invite only',
  domain_verified: 'Domain verified',
};

type CategoryFilter = 'all' | RoomCategory;
const FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...ROOM_CATEGORIES.map((c) => ({ key: c, label: c })),
];

export default function Discover() {
  const { session } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [memberships, setMemberships] = useState<Map<string, Membership>>(new Map());
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    Promise.all([fetchDiscoverRooms(), fetchMyMembershipMap(session.user.id)])
      .then(([roomList, membershipMap]) => {
        setRooms(roomList);
        setMemberships(membershipMap);
        const paths = roomList.flatMap((r) => [r.avatar_url, r.banner_url]).filter((p): p is string => !!p);
        if (paths.length > 0) signRoomMediaUrls(paths).then(setMediaUrls).catch(() => {});
        // Same reasoning as index.tsx's Home list — a row here for a Room
        // you're already in is another way into it besides Home, so it
        // gets the same cache treatment. See lib/room-cache.ts.
        for (const room of roomList) {
          const membership = membershipMap.get(room.id);
          if (membership?.join_state === 'approved') cacheJoinedRoom(room, membership.role);
        }
      })
      .catch((e) => setError(errorMessage(e, 'Failed to load Rooms.')));
  }, [session]);

  useFocusEffect(useCallback(() => load(), [load]));

  if (!session) return null;

  async function handleJoin(room: Room) {
    // Domain Verified rooms never go through the ordinary
    // pending/approved join_state machine — joining means proving
    // control of a matching email address first (lib/domainVerification.ts).
    if (room.visibility === 'domain_verified') {
      router.push({ pathname: '/c/[communityId]/verify-email', params: { communityId: room.slug } });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setJoiningId(room.id);
    setError(null);
    // A nested function with promise .catch()/.finally() rather than
    // try/catch/finally: the React Compiler can't compile a `finally`, or the
    // conditionals in this body inside a `try`, and skips the whole screen.
    const doJoin = async () => {
      await joinRoom(room.id);
      const join_state = room.visibility === 'public' ? 'approved' : 'pending';
      setMemberships((prev) => new Map(prev).set(room.id, { role: 'member', join_state }));
      if (join_state === 'approved') {
        router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } });
      }
    };
    await doJoin()
      .catch((e) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setError(errorMessage(e, 'Could not join that Room.'));
      })
      .finally(() => setJoiningId(null));
  }

  const filteredRooms = rooms?.filter((r) => filter === 'all' || r.category === filter) ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.flex}>
      <ScrollView>
        {/* No top-edge SafeAreaView on the screen itself — that padded
            the status-bar area with the screen's own (white, in Light
            mode) background before this banner ever got a chance to
            paint, leaving a bare strip above "FIND YOUR ROOM" instead of
            the banner running edge-to-edge behind the status bar the way
            a full-bleed colored header should. The inset goes into the
            banner's own paddingTop instead, so the color reaches y: 0 and
            only the heading/subtext are pushed clear of the notch.
            `container`'s own background is the same accent color, not
            `colors.bg` — belt and braces against whatever was actually
            leaving a real device's status-bar row showing the screen's
            base color instead of this banner's, moving that padding
            alone didn't fully fix. With the base color already right,
            any residual native-inset rounding shows accent, not white,
            and `body` below explicitly owns the white the rest of the
            screen needs instead of inheriting it from `container`. */}
        <View style={[styles.banner, { paddingTop: insets.top + Spacing[8] }]}>
          <Text style={styles.bannerHeading}>FIND YOUR{'\n'}ROOM</Text>
          <Text style={styles.bannerSubtext}>From climbing crews to sourdough starters — there&apos;s a Room for you.</Text>
        </View>

        <View style={[styles.body, { paddingBottom: clearance }]}>
          <View style={styles.filterRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={styles.searchButton}
              onPress={() => router.push('/search')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Search"
            >
              <Icon name="search" size={20} color={colors.text} />
            </Pressable>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          {rooms === null ? (
            <View style={styles.listWrap}>
              <Skeleton width={120} height={17} radius={6} />
              <View style={[styles.list, { marginTop: Spacing[4] }]}>
                {[0, 1].map((i) => (
                  <View key={i} style={styles.card}>
                    <Skeleton width="100%" height={96} radius={0} />
                    <View style={styles.cardBody}>
                      <View style={[styles.cardTopRow, { alignItems: 'center' }]}>
                        <Skeleton width={64} height={64} radius={999} />
                      </View>
                      <Skeleton width={150} height={16} radius={6} />
                      <View style={{ height: 6 }} />
                      <Skeleton width="80%" height={12} radius={5} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.listWrap}>
              <Text style={styles.sectionLabel}>{filter === 'all' ? 'Featured Rooms' : filter}</Text>

              {rooms.length === 0 ? (
                <EmptyState
                  icon="globe"
                  heading="No Rooms yet"
                  message="Public Rooms will show up here once there are some to join."
                />
              ) : filteredRooms && filteredRooms.length === 0 ? (
                <EmptyState icon="globe" message={`No Rooms in ${filter} yet — try another category.`} />
              ) : (
                <View style={styles.list}>
                  {filteredRooms?.map((room) => (
                    <RoomCard
                      key={room.id}
                      room={room}
                      membership={memberships.get(room.id)}
                      joining={joiningId === room.id}
                      onJoin={() => handleJoin(room)}
                      mediaUrls={mediaUrls}
                    />
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
      </View>

      <StartRoomFab />
      <TabBar active="Explore" userId={session.user.id} />
    </View>
  );
}

/**
 * Same round, floating treatment and position as PostFab
 * (components/PostFab.tsx) — but a pencil, not a "+": this button doesn't
 * add an item to a list the way PostFab's "+" does, it opens a whole new
 * Room's worth of things to fill in (name, description, category,
 * visibility), which reads closer to "compose/create" than "add".
 */
function StartRoomFab() {
  const colors = useTheme();
  const clearance = useTabBarClearance();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Pressable
      style={[styles.fab, { bottom: clearance }]}
      onPress={() => router.push('/create-community')}
      accessibilityRole="button"
      accessibilityLabel="Start a new Room"
    >
      <Icon name="edit" size={22} color={colors.bg} />
    </Pressable>
  );
}

function RoomCard({
  room,
  membership,
  joining,
  onJoin,
  mediaUrls,
}: {
  room: Room;
  membership: Membership | undefined;
  joining: boolean;
  onJoin: () => void;
  mediaUrls: Map<string, string>;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const buttonLabel = !membership
    ? room.visibility === 'public'
      ? 'Join'
      : room.visibility === 'domain_verified'
        ? 'Verify'
        : 'Request'
    : membership.join_state === 'approved'
      ? 'Open'
      : membership.join_state === 'pending'
        ? 'Requested'
        : 'Invited';
  const disabled = membership?.join_state === 'pending' || joining;
  const accent = room.accent_color ?? colors.accent.DEFAULT;
  const bannerUrl = room.banner_url ? mediaUrls.get(room.banner_url) : undefined;
  const avatarUrl = room.avatar_url ? mediaUrls.get(room.avatar_url) : undefined;

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } })}
    >
      <View style={[styles.cardBanner, { backgroundColor: accent }]}>
        {bannerUrl && (
          <Image
            source={cachedImageSource(bannerUrl)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
        )}
        <LinearGradient
          colors={['rgba(255,255,255,0.35)', 'rgba(0,0,0,0.25)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          {avatarUrl ? (
            // The accent+letter fallback renders underneath, not instead of,
            // the photo — otherwise this card shows nothing at all while
            // avatarUrl's signed URL loads. Same fix as Avatar.tsx, image
            // caching pass, 2026-09-15.
            <View style={styles.cardLogo}>
              <View style={[StyleSheet.absoluteFill, styles.cardLogoFill, { backgroundColor: accent }]}>
                <Text style={styles.cardLogoLetter}>{room.name.charAt(0).toUpperCase()}</Text>
              </View>
              <Image
                source={cachedImageSource(avatarUrl)}
                style={[StyleSheet.absoluteFill, styles.cardLogoFill]}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
            </View>
          ) : (
            <View style={[styles.cardLogo, { backgroundColor: accent }]}>
              <Text style={styles.cardLogoLetter}>{room.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Pressable
            style={[styles.joinButton, (membership || joining) && styles.joinButtonSecondary]}
            onPress={onJoin}
            disabled={disabled}
          >
            {joining ? (
              <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
            ) : (
              <Text style={[styles.joinButtonText, (membership || joining) && styles.joinButtonTextSecondary]}>
                {buttonLabel}
              </Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.cardTitle}>{room.name}</Text>
        {room.description ? (
          <Text style={styles.cardBio} numberOfLines={2}>
            {room.description}
          </Text>
        ) : null}

        <View style={styles.cardStatsRow}>
          <View style={[styles.statDot, { backgroundColor: colors.neutral[400] }]} />
          <Text style={styles.cardStatsText}>
            {room.member_count} {room.member_count === 1 ? 'member' : 'members'}
          </Text>
          <Text style={styles.cardStatsSep}>·</Text>
          <Text style={styles.cardStatsText}>{VISIBILITY_LABEL[room.visibility]}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // The banner's own color, not colors.bg — see the comment above the
  // banner's own JSX for why. The white the rest of the screen needs
  // lives on `body` instead.
  container: {
    flex: 1,
    backgroundColor: colors.accent.DEFAULT,
  },
  flex: {
    flex: 1,
  },
  body: {
    backgroundColor: colors.bg,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing[6],
    paddingRight: Spacing[4],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: Spacing[2],
  },
  filterScroll: {
    gap: Spacing[2],
    paddingRight: Spacing[2],
  },
  filterChip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: colors.accent.DEFAULT,
    borderColor: colors.accent.DEFAULT,
  },
  filterChipText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.text,
  },
  filterChipTextActive: {
    color: colors.bg,
  },
  searchButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  banner: {
    backgroundColor: colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[8],
    paddingBottom: Spacing[7],
  },
  bannerHeading: {
    fontFamily: Fonts.heading,
    fontSize: 34,
    lineHeight: 38,
    color: colors.bg,
  },
  bannerSubtext: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.bg,
    opacity: 0.75,
    marginTop: Spacing[3],
    maxWidth: 320,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.error,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
  },
  listWrap: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
  },
  sectionLabel: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: colors.text,
    marginBottom: Spacing[4],
  },
  list: {
    gap: Spacing[6],
  },
  fab: {
    position: 'absolute',
    right: Spacing[4],
    width: 54,
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardBanner: {
    height: 96,
  },
  cardBody: {
    padding: Spacing[4],
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: -38,
    marginBottom: Spacing[3],
  },
  // Circular, matching Home's Room icon — this and Search's used to be a
  // rounded square while Home was circular, a shape inconsistency the
  // design audit flagged; every surface now agrees on one shape.
  cardLogo: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
  },
  // Just the round clip, for the fallback/photo layers stacked inside
  // cardLogo's own border+centering box — see the imageUrl branch above.
  cardLogoFill: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLogoLetter: {
    fontFamily: Fonts.heading,
    fontSize: 26,
    color: colors.onAccent,
  },
  cardTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: colors.text,
    marginBottom: Spacing[1],
  },
  cardBio: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral[400],
    marginBottom: Spacing[3],
  },
  cardStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  cardStatsText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[500],
  },
  cardStatsSep: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[500],
  },
  joinButton: {
    height: 34,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent2.DEFAULT,
  },
  joinButtonText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: colors.bg,
  },
  joinButtonTextSecondary: {
    color: colors.accent2[300],
  },
});
