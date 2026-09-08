import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchFriends, type Friend } from '@/lib/friends';

export default function Friends() {
  const { session } = useAuth();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      fetchFriends(userId)
        .then(setFriends)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load friends.'));
    }, [userId]),
  );

  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.headerSide} hitSlop={8} onPress={() => router.back()}>
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Friends
        </Text>
        <View style={styles.headerSide} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {friends === null ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.accent.DEFAULT} />
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.body}>No friends yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {friends.map((friend) => (
            <Pressable
              key={friend.id}
              style={styles.row}
              onPress={() => router.push({ pathname: '/u/[userId]', params: { userId: friend.id } })}
            >
              <Avatar gradient={friend.id} letter={friend.name.charAt(0).toUpperCase()} size={48} />
              <View style={styles.rowContent}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {friend.name}
                </Text>
                <Text style={styles.rowHandle} numberOfLines={1}>
                  @{friend.handle}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  headerSide: {
    width: 32,
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: colors.text,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
  },
  list: {
    paddingBottom: Spacing[8],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
    paddingVertical: 10,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 15.5,
    color: colors.text,
  },
  rowHandle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
  },
});
