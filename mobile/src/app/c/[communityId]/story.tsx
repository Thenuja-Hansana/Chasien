import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// Stories are Phase 5 (they share posts' media pipeline). Empty state only.
export default function StoryViewer() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headingText} numberOfLines={1}>
          {communityId}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="close" size={22} color={Colors.text} />
        </Pressable>
      </View>

      <View style={styles.empty}>
        <Text style={styles.body}>No active stories.</Text>
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
    fontFamily: Fonts?.heading,
    fontSize: 17,
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
