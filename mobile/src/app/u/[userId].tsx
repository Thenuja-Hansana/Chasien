import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Real profile data (handle, bio, Room memberships) needs a `profiles`
// fetch that's out of scope for Phase 3's shell — this renders the
// account's own auth identity, which is real. Sign out lives here since
// the mock has no equivalent screen for it (it never modeled real auth).
export default function Profile() {
  const { session, signOut } = useAuth();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  if (!session) return null;

  const isOwnProfile = userId === session.user.id;
  const email = session.user.email ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <Avatar gradient={session.user.id} letter={email.charAt(0).toUpperCase() || '?'} size={72} ring />
          <Text style={styles.email}>{email}</Text>
        </View>

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
    gap: Spacing[8],
  },
  identity: {
    alignItems: 'center',
    gap: Spacing[3],
  },
  email: {
    fontFamily: Fonts?.body,
    fontSize: 15,
    color: Colors.text,
  },
  section: {
    gap: Spacing[3],
  },
  sectionLabel: {
    fontFamily: Fonts?.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.neutral[500],
  },
  body: {
    fontFamily: Fonts?.body,
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
    fontFamily: Fonts?.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
});
