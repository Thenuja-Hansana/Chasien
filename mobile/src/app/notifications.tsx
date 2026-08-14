import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TabBar from '@/components/TabBar';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Real notifications land with Phase 4+ (they're driven by Room activity
// that doesn't exist yet). Mirrors the mock's active="Home" tab choice.
export default function Notifications() {
  const { session } = useAuth();

  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Activity</Text>
      </View>

      <View style={styles.empty}>
        <Text style={styles.body}>Nothing here yet.</Text>
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
    paddingBottom: Spacing[2],
  },
  heading: {
    fontFamily: Fonts?.heading,
    fontSize: 22,
    color: Colors.text,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
  },
});
