import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Phase 2 placeholder — this screen only exists to prove the auth loop
// (sign up, restart, still logged in, log out) works end to end. Real
// navigation/screens land in Phase 3, mirroring app_reference's routes
// (Rooms, Discover, Chats, ...).
export default function Index() {
  const { session, signOut } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Chasien</Text>
      <Text style={styles.body}>Signed in as {session?.user.email}</Text>
      <Pressable style={styles.signOutButton} onPress={() => signOut()}>
        <Text style={styles.signOutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[3],
    backgroundColor: Colors.bg,
  },
  heading: {
    fontFamily: Fonts?.heading,
    fontSize: 32,
    color: Colors.text,
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
  },
  signOutButton: {
    marginTop: Spacing[4],
    height: 44,
    paddingHorizontal: Spacing[6],
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
