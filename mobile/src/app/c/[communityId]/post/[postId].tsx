import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// Real posts/comments are Phase 5. Any :postId here is unreachable from
// real navigation yet (there's nothing to link to it) — this just proves
// the route renders and backs out cleanly.
export default function PostDetail() {
  const { postId } = useLocalSearchParams<{ postId: string }>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headingText}>Post</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.empty}>
        <Text style={styles.body}>Post {postId} isn&apos;t available.</Text>
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
    paddingHorizontal: Spacing[6],
  },
  body: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
});
