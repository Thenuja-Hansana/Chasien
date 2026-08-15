import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { startDm } from '@/lib/chat';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type ProfileRow = { id: string; handle: string; name: string; bio: string | null };

// Real profile data (handle, bio, Room memberships) needs a `profiles`
// fetch that's out of scope for Phase 3's shell — this renders the
// account's own auth identity, which is real. Sign out lives here since
// the mock has no equivalent screen for it (it never modeled real auth).
export default function Profile() {
  const { session, signOut } = useAuth();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const [profile, setProfile] = useState<ProfileRow | null | 'loading'>('loading');
  const [messaging, setMessaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setProfile('loading');
      (async () => {
        try {
          const { data, error: fetchError } = await supabase.from('profiles').select('id, handle, name, bio').eq('id', userId).maybeSingle();
          if (fetchError) throw fetchError;
          setProfile(data);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load this profile.');
        }
      })();
    }, [userId]),
  );

  if (!session) return null;

  const isOwnProfile = userId === session.user.id;

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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {profile === 'loading' ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.accent.DEFAULT} />
          </View>
        ) : (
          <View style={styles.identity}>
            <Avatar
              gradient={userId}
              letter={(isOwnProfile ? session.user.email : profile?.handle)?.charAt(0).toUpperCase() || '?'}
              size={72}
              ring
            />
            <Text style={styles.name}>{isOwnProfile ? (session.user.email ?? '') : (profile?.name ?? 'Unknown')}</Text>
            {profile && !isOwnProfile && <Text style={styles.handle}>@{profile.handle}</Text>}
            {profile?.bio && <Text style={styles.bio}>{profile.bio}</Text>}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {!isOwnProfile && profile && (
          <Pressable style={styles.messageButton} onPress={handleMessage} disabled={messaging}>
            {messaging ? <ActivityIndicator color={Colors.bg} /> : <Text style={styles.messageButtonText}>Message</Text>}
          </Pressable>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Rooms</Text>
          <Text style={styles.body}>You haven&apos;t joined any Rooms yet.</Text>
        </View>

        {isOwnProfile && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Account</Text>
            <Pressable style={styles.signOutButton} onPress={() => signOut()}>
              <Text style={styles.signOutText}>Log out</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <TabBar active="You" userId={session.user.id} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  content: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
    paddingBottom: Spacing[8],
    gap: Spacing[6],
  },
  loading: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: Spacing[2],
  },
  name: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: Colors.text,
  },
  handle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.neutral[400],
  },
  bio: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: Colors.neutral[400],
    textAlign: 'center',
    marginTop: Spacing[1],
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    textAlign: 'center',
  },
  messageButton: {
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageButtonText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: Colors.bg,
  },
  section: {
    gap: Spacing[3],
  },
  sectionLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.neutral[500],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.neutral[400],
  },
  signOutButton: {
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
});
