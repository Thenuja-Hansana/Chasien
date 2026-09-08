import { BlurTargetView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import TabBar from '@/components/TabBar';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { searchProfiles, type ProfileSearchResult } from '@/lib/profiles';
import { fetchDiscoverRooms, fetchMyMembershipMap, joinRoom, type Membership, type Room } from '@/lib/rooms';
import { useUserPreview } from '@/lib/user-preview-context';

const VISIBILITY_LABEL: Record<Room['visibility'], string> = {
  public: 'Public',
  request: 'Request to join',
  invite: 'Invite only',
  domain_verified: 'Domain verified',
};

/**
 * Client-side substring match over name/description/category — every
 * discoverable Room already comes down in one query (fetchDiscoverRooms,
 * same as Discover), and this app's Room count is small enough that a
 * dedicated search RPC/index isn't worth it yet. Revisit if that stops
 * being true.
 */
function matches(room: Room, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    room.name.toLowerCase().includes(q) ||
    (room.description?.toLowerCase().includes(q) ?? false) ||
    (room.category?.toLowerCase().includes(q) ?? false)
  );
}

export default function Search() {
  const { session } = useAuth();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? '');
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [memberships, setMemberships] = useState<Map<string, Membership>>(new Map());
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [people, setPeople] = useState<ProfileSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const clearance = useTabBarClearance();
  const blurTargetRef = useRef<View>(null);
  const searchFocus = useFocusHighlight();

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    Promise.all([fetchDiscoverRooms(), fetchMyMembershipMap(userId)])
      .then(([roomList, membershipMap]) => {
        setRooms(roomList);
        setMemberships(membershipMap);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Rooms.'));
  }, [userId]);

  // Debounced, unlike Rooms above — that's one full fetch of a small,
  // stable list filtered client-side (fetchDiscoverRooms's own comment),
  // but People is a real round trip per keystroke otherwise.
  useEffect(() => {
    // searchProfiles() itself resolves an empty/whitespace query to [] —
    // no separate early-return branch needed here, which would otherwise
    // mean a synchronous setState in the effect body for that case.
    const timeout = setTimeout(() => {
      searchProfiles(query).then(setPeople).catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  if (!session) return null;

  async function handleJoin(room: Room) {
    if (room.visibility === 'domain_verified') {
      router.push({ pathname: '/c/[communityId]/verify-email', params: { communityId: room.slug } });
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setJoiningId(room.id);
    setError(null);
    try {
      await joinRoom(room.id);
      const join_state = room.visibility === 'public' ? 'approved' : 'pending';
      setMemberships((prev) => new Map(prev).set(room.id, { role: 'member', join_state }));
      if (join_state === 'approved') {
        router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } });
      }
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(e instanceof Error ? e.message : 'Could not join that Room.');
    } finally {
      setJoiningId(null);
    }
  }

  const results = rooms?.filter((r) => matches(r, query)) ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
      <View style={styles.header}>
        <TextInput
          style={[styles.input, searchFocus.focused && styles.inputFocused]}
          value={query}
          onChangeText={setQuery}
          onFocus={searchFocus.onFocus}
          onBlur={searchFocus.onBlur}
          placeholder="Search Rooms or people"
          placeholderTextColor={colors.neutral[500]}
          autoFocus={!q}
          returnKeyType="search"
        />
        <Pressable onPress={() => router.back()}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {rooms === null ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={44} height={44} radius={999} />
              <View style={[styles.rowContent, { gap: 6 }]}>
                <Skeleton width={130} height={13} radius={6} />
                <Skeleton width={90} height={10} radius={5} />
              </View>
            </View>
          ))}
        </View>
      ) : query.trim().length === 0 ? (
        <EmptyState icon="search" message="Search for a Room by name, category, or what it's about — or find someone by handle or name." />
      ) : results.length === 0 && people.length === 0 ? (
        <EmptyState icon="search" message={`No results for "${query}"`} />
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: clearance }]}>
          {people.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>People</Text>
              {people.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </>
          )}
          {results.length > 0 && (
            <>
              {people.length > 0 && <Text style={styles.sectionLabel}>Rooms</Text>}
              {results.map((room) => (
                <ResultRow
                  key={room.id}
                  room={room}
                  membership={memberships.get(room.id)}
                  joining={joiningId === room.id}
                  onJoin={() => handleJoin(room)}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
      </BlurTargetView>

      <TabBar active="Explore" userId={session.user.id} blurTarget={blurTargetRef} />
    </SafeAreaView>
  );
}

function ResultRow({
  room,
  membership,
  joining,
  onJoin,
}: {
  room: Room;
  membership: Membership | undefined;
  joining: boolean;
  onJoin: () => void;
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

  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } })}
    >
      <View style={[styles.roomIcon, { backgroundColor: room.accent_color ?? colors.accent.DEFAULT }]}>
        <Text style={styles.roomIconLetter}>{room.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.roomName}>{room.name}</Text>
        <Text style={styles.roomMeta}>
          {room.category ? `${room.category} · ` : ''}
          {VISIBILITY_LABEL[room.visibility]}
        </Text>
      </View>
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
    </Pressable>
  );
}

function PersonRow({ person }: { person: ProfileSearchResult }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { open: openUserPreview } = useUserPreview();

  return (
    <Pressable style={styles.row} onPress={() => openUserPreview(person.id)}>
      <Avatar gradient={person.id} letter={person.name.charAt(0).toUpperCase() || '?'} size={44} />
      <View style={styles.rowContent}>
        <Text style={styles.roomName}>{person.name}</Text>
        <Text style={styles.roomMeta}>@{person.handle}</Text>
      </View>
    </Pressable>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  input: {
    flex: 1,
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 18,
    fontSize: 15,
    color: colors.text,
    fontFamily: Fonts.body,
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  cancel: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[400],
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.error,
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[2],
  },
  list: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[8],
    gap: Spacing[3],
  },
  sectionLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.neutral[500],
    marginTop: Spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[3],
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  roomIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomIconLetter: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: '#f6e7d2',
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  roomName: {
    fontFamily: Fonts.body,
    fontSize: 14.5,
    fontWeight: '700',
    color: colors.text,
  },
  roomMeta: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[400],
  },
  joinButton: {
    height: 32,
    paddingHorizontal: 16,
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
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.bg,
  },
  joinButtonTextSecondary: {
    color: colors.accent2[300],
  },
});
