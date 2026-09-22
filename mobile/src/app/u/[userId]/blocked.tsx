import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import { Fonts, MaxContentWidth, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchBlockedUsers, unblockUser, type BlockedUser } from '@/lib/blocks';
import { errorMessage } from '@/lib/errors';

/**
 * Settings → Blocked: everyone the viewer has blocked, with Unblock.
 * Always the viewer's own list, whatever `userId` is in the route — the
 * blocks table's RLS only returns the caller's own blocks anyway. Rows
 * don't link to profiles: a blocked profile only shows its blocked state,
 * so Unblock here is the useful action.
 */
export default function Blocked() {
  const { session } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const myId = session?.user.id;

  useFocusEffect(
    useCallback(() => {
      if (!myId) return;
      fetchBlockedUsers(myId)
        .then(setBlocked)
        .catch((e) => setError(errorMessage(e, 'Failed to load blocked accounts.')));
    }, [myId]),
  );

  if (!session || !myId) return null;

  async function handleUnblock(person: BlockedUser) {
    if (!myId) return;
    setBusyId(person.id);
    setError(null);
    // No `finally`: the React Compiler skips a component that has one, and
    // the catch handles every error, so this is equivalent.
    try {
      await unblockUser(myId, person.id);
      setBlocked((prev) => prev?.filter((p) => p.id !== person.id) ?? prev);
    } catch (e) {
      setError(errorMessage(e, 'Could not unblock that account.'));
    }
    setBusyId(null);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerSide}
          hitSlop={8}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Blocked
        </Text>
        <View style={styles.headerSide} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {blocked === null ? (
        <View style={styles.list}>
          {[120, 90].map((width, i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={48} height={48} radius={999} />
              <View style={[styles.rowContent, { gap: 5 }]}>
                <Skeleton width={width} height={14} radius={6} />
                <Skeleton width={width - 30} height={12} radius={5} />
              </View>
            </View>
          ))}
        </View>
      ) : blocked.length === 0 ? (
        <EmptyState icon="noEntry" heading="No blocked accounts" message="When you block someone, they'll show up here." />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {blocked.map((person) => (
            <View key={person.id} style={styles.row}>
              <Avatar gradient={person.id} letter={person.name.charAt(0).toUpperCase()} size={48} />
              <View style={styles.rowContent}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {person.name}
                </Text>
                <Text style={styles.rowHandle} numberOfLines={1}>
                  @{person.handle}
                </Text>
              </View>
              <Pressable
                style={styles.unblockButton}
                onPress={() => handleUnblock(person)}
                disabled={busyId === person.id}
                accessibilityRole="button"
                accessibilityLabel={`Unblock @${person.handle}`}
              >
                {busyId === person.id ? <ActivityIndicator size="small" color={colors.text} /> : <Text style={styles.unblockText}>Unblock</Text>}
              </Pressable>
            </View>
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
  unblockButton: {
    minWidth: 88,
    height: 36,
    paddingHorizontal: Spacing[4],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14,
    color: colors.text,
  },
});
