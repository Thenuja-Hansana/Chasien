import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// The root "/" — the mock hardcodes a default Room (`grit-club`) here, but a
// real account starts in no Room at all. This is that empty state; once
// membership exists (Phase 4), this becomes a Room switcher instead.
export default function Index() {
  const { session } = useAuth();

  // AuthGate redirects away from here once it notices there's no session,
  // but that happens in an effect after this still renders once — guard
  // rather than assume `session` is non-null.
  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.brand}>chasien</Text>
      </View>

      <View style={styles.empty}>
        <Text style={styles.heading}>No Rooms yet</Text>
        <Text style={styles.body}>Join or start a Room to see its feed here.</Text>
        <Link href="/discover" style={styles.cta}>
          Find a Room
        </Link>
      </View>

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
    fontFamily: Fonts?.heading,
    fontSize: 22,
    color: Colors.text,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[6],
  },
  heading: {
    fontFamily: Fonts?.heading,
    fontSize: 22,
    color: Colors.text,
  },
  body: {
    fontFamily: Fonts?.body,
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
    fontFamily: Fonts?.heading,
    fontSize: 15,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
  },
});
