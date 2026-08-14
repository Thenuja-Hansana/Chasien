import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import TabBar from '@/components/TabBar';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// A Room's real feed (posts, stories, membership header) is Phase 4/5. This
// is the reachable shell for a given :communityId — no mock room data.
export default function RoomHome() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {communityId}
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
    fontFamily: Fonts?.heading,
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
    fontFamily: Fonts?.heading,
    fontSize: 20,
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
