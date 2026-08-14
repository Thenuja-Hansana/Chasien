import { Link, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchMyMembership, fetchRoomBySlug, joinRoom, respondToInvite, type Membership, type Room } from '@/lib/rooms';

type LoadState = { room: Room | null; membership: Membership | null } | 'loading';

export default function RoomHome() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const [state, setState] = useState<LoadState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(() => {
    if (!userId) return;
    setState('loading');
    fetchRoomBySlug(communityId)
      .then(async (room) => {
        const membership = room ? await fetchMyMembership(room.id, userId) : null;
        setState({ room, membership });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load this Room.'));
  }, [communityId, userId]);

  useFocusEffect(useCallback(() => load(), [load]));

  if (!session) return null;

  async function handleJoin(room: Room) {
    setBusy(true);
    setError(null);
    try {
      await joinRoom(room.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteResponse(room: Room, accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      await respondToInvite(room.id, accept);
      if (accept) load();
      else router.replace('/discover');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not respond to the invite.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <ActivityIndicator color={Colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  const { room, membership } = state;

  if (!room) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>Room not found</Text>
        <Text style={styles.body}>It may not exist, or you don&apos;t have access to it.</Text>
        <Pressable style={styles.cta} onPress={() => router.replace('/discover')}>
          <Text style={styles.ctaText}>Back to Discover</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Not a member yet — a preview + the same join/request action Discover offers.
  if (!membership) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>{room.name}</Text>
        {room.description ? <Text style={styles.body}>{room.description}</Text> : null}
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={styles.cta} onPress={() => handleJoin(room)} disabled={busy}>
          {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={styles.ctaText}>{room.visibility === 'public' ? 'Join' : 'Request to join'}</Text>}
        </Pressable>
      </SafeAreaView>
    );
  }

  if (membership.join_state === 'pending') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>{room.name}</Text>
        <Text style={styles.body}>Your request to join is pending approval from a mod.</Text>
      </SafeAreaView>
    );
  }

  if (membership.join_state === 'invited') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.emptyHeading}>{room.name}</Text>
        <Text style={styles.body}>You&apos;ve been invited to join this Room.</Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.inviteActions}>
          <Pressable style={[styles.cta, styles.inviteCta]} onPress={() => handleInviteResponse(room, true)} disabled={busy}>
            <Text style={styles.ctaText}>Accept</Text>
          </Pressable>
          <Pressable style={[styles.declineCta, styles.inviteCta]} onPress={() => handleInviteResponse(room, false)} disabled={busy}>
            <Text style={styles.declineCtaText}>Decline</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {room.name}
        </Text>
        <View style={styles.headerActions}>
          <Link href="/notifications" asChild>
            <Pressable hitSlop={8}>
              <Icon name="bell" size={20} color={Colors.text} />
            </Pressable>
          </Link>
          <Link href="/search" asChild>
            <Pressable hitSlop={8}>
              <Icon name="search" size={20} color={Colors.text} />
            </Pressable>
          </Link>
          <Link href={{ pathname: '/c/[communityId]/settings', params: { communityId } }} asChild>
            <Pressable hitSlop={8}>
              <Icon name="settings" size={20} color={Colors.text} />
            </Pressable>
          </Link>
        </View>
      </View>

      <View style={styles.empty}>
        <Text style={styles.emptyHeading}>No posts yet</Text>
        <Text style={styles.body}>Be the first to post in this Room.</Text>
        <Link href={{ pathname: '/c/[communityId]/create-post', params: { communityId } }} style={styles.cta}>
          New post
        </Link>
      </View>

      <TabBar active="Home" communityId={communityId} userId={session.user.id} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },
  title: {
    flex: 1,
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: Colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing[4],
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
    textAlign: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.bg,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginTop: Spacing[4],
  },
  inviteCta: {
    flex: 1,
    marginTop: 0,
  },
  declineCta: {
    flex: 1,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineCtaText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.text,
  },
});
