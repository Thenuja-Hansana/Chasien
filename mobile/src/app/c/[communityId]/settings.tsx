import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// Visibility/role/member management (owner-only, RLS-backed) is Phase 4.
export default function CommunitySettings() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headingText} numberOfLines={1}>
          {communityId}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.empty}>
        <Text style={styles.body}>Room settings arrive in Phase 4.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
  },
  headingText: {
    flex: 1,
    fontFamily: Fonts?.heading,
    fontSize: 17,
    color: Colors.text,
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
});
