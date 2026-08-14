import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchDiscoverRooms, fetchMyMembershipMap, joinRoom, type Membership, type Room } from '@/lib/rooms';

const VISIBILITY_LABEL: Record<Room['visibility'], string> = {
  public: 'Public',
  request: 'Request to join',
  invite: 'Invite only',
};

export default function Discover() {
  const { session } = useAuth();
  const [query, setQuery] = useState('');
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [memberships, setMemberships] = useState<Map<string, Membership>>(new Map());
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchDiscoverRooms(), fetchMyMembershipMap()])
      .then(([roomList, membershipMap]) => {
        setRooms(roomList);
        setMemberships(membershipMap);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Rooms.'));
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  if (!session) return null;

  function handleSearchSubmit() {
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  async function handleJoin(room: Room) {
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
      setError(e instanceof Error ? e.message : 'Could not join that Room.');
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Find your Rooms</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearchSubmit}
          placeholder="Search Rooms"
          placeholderTextColor={Colors.neutral[500]}
          returnKeyType="search"
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {rooms === null ? (
        <View style={styles.empty}>
          <ActivityIndicator color={Colors.accent.DEFAULT} />
        </View>
      ) : rooms.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyHeading}>No Rooms yet</Text>
          <Text style={styles.body}>Public Rooms will show up here once there are some to join.</Text>
          <Pressable style={styles.cta} onPress={() => router.push('/create-community')}>
            <Text style={styles.ctaText}>Start a Room</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              membership={memberships.get(room.id)}
              joining={joiningId === room.id}
              onJoin={() => handleJoin(room)}
            />
          ))}
          <Pressable style={styles.startRoomCta} onPress={() => router.push('/create-community')}>
            <Text style={styles.ctaText}>Start a Room</Text>
          </Pressable>
        </ScrollView>
      )}

      <TabBar active="Explore" userId={session.user.id} />
    </SafeAreaView>
  );
}

function RoomRow({
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
  const buttonLabel = !membership
    ? room.visibility === 'public'
      ? 'Join'
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
      <View style={[styles.roomIcon, { backgroundColor: room.accent_color ?? Colors.accent.DEFAULT }]}>
        <Text style={styles.roomIconLetter}>{room.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.roomName}>{room.name}</Text>
        <Text style={styles.roomMeta}>{VISIBILITY_LABEL[room.visibility]}</Text>
      </View>
      <Pressable
        style={[styles.joinButton, (membership || joining) && styles.joinButtonSecondary]}
        onPress={onJoin}
        disabled={disabled}
      >
        {joining ? (
          <ActivityIndicator size="small" color={Colors.accent.DEFAULT} />
        ) : (
          <Text style={[styles.joinButtonText, (membership || joining) && styles.joinButtonTextSecondary]}>
            {buttonLabel}
          </Text>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    gap: Spacing[3],
  },
  heading: {
    fontFamily: Fonts.heading,
    fontSize: 26,
    color: Colors.text,
  },
  input: {
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 18,
    fontSize: 15,
    color: Colors.text,
    fontFamily: Fonts.body,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[2],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
  },
  emptyHeading: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: Colors.text,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
  cta: {
    marginTop: Spacing[4],
    height: 44,
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startRoomCta: {
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing[2],
  },
  ctaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.accent.DEFAULT,
  },
  list: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[8],
    gap: Spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[3],
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  roomIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
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
    color: Colors.text,
  },
  roomMeta: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.neutral[400],
  },
  joinButton: {
    height: 32,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.accent2.DEFAULT,
  },
  joinButtonText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.bg,
  },
  joinButtonTextSecondary: {
    color: Colors.accent2[300],
  },
});
