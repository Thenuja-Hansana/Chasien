import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchMyRooms, type Room, type RoomRole } from '@/lib/rooms';

// The root "/" — the mock hardcodes a default Room (`grit-club`) here, but a
// real account starts in no Room at all. Now a real Room switcher: lists
// every Room you've actually joined, or the empty state if there are none.
export default function Index() {
  const { session } = useAuth();
  const [rooms, setRooms] = useState<(Room & { myRole: RoomRole })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      fetchMyRooms(session.user.id)
        .then(setRooms)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load your Rooms.'));
    }, [session]),
  );

  // AuthGate redirects away from here once it notices there's no session,
  // but that happens in an effect after this still renders once — guard
  // rather than assume `session` is non-null.
  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.brand}>chasien</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {rooms === null ? (
        <View style={styles.empty}>
          <ActivityIndicator color={Colors.accent.DEFAULT} />
        </View>
      ) : rooms.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.heading}>No Rooms yet</Text>
          <Text style={styles.body}>Join or start a Room to see its feed here.</Text>
          <Link href="/discover" style={styles.cta}>
            Find a Room
          </Link>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rooms.map((room) => (
            <Pressable
              key={room.id}
              style={styles.roomRow}
              onPress={() => router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } })}
            >
              <View style={[styles.roomIcon, { backgroundColor: room.accent_color ?? Colors.accent.DEFAULT }]}>
                <Text style={styles.roomIconLetter}>{room.name.charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.roomName}>{room.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <TabBar active="Home" userId={session.user.id} />
    </SafeAreaView>
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
    paddingBottom: Spacing[4],
  },
  brand: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    color: Colors.text,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
  },
  heading: {
    fontFamily: Fonts.heading,
    fontSize: 22,
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
    backgroundColor: Colors.accent.DEFAULT,
    color: Colors.bg,
    fontFamily: Fonts.heading,
    fontSize: 15,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
  },
  list: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[8],
    gap: Spacing[3],
  },
  roomRow: {
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
  roomName: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
});
