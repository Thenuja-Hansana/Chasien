import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/errors';
import { fetchMyRooms, type Room, type RoomRole } from '@/lib/rooms';
import { signRoomMediaUrls } from '@/lib/roomMedia';

type JoinedRoom = Room & { myRole: RoomRole; myNotificationsMuted: boolean };

/** The You page's own "View All Rooms" overflow — same reasoning as
 * friends.tsx sitting alongside it: the profile itself only ever shows
 * the first three, this is where the rest live. */
export default function AllRooms() {
  const { session } = useAuth();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rooms, setRooms] = useState<JoinedRoom[] | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      fetchMyRooms(userId)
        .then((roomList) => {
          setRooms(roomList);
          const paths = roomList.flatMap((r) => [r.avatar_url, r.banner_url]).filter((p): p is string => !!p);
          if (paths.length > 0) signRoomMediaUrls(paths).then(setMediaUrls).catch(() => {});
        })
        .catch((e) => setError(errorMessage(e, 'Failed to load Rooms.')));
    }, [userId]),
  );

  if (!session) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
          Rooms
        </Text>
        <View style={styles.headerSide} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {rooms === null ? (
        <View style={styles.list}>
          {[130, 100, 150].map((width, i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={48} height={48} radius={Radius.sm} />
              <View style={[styles.rowContent, { gap: 5 }]}>
                <Skeleton width={width} height={14} radius={6} />
                <Skeleton width={70} height={12} radius={5} />
              </View>
            </View>
          ))}
        </View>
      ) : rooms.length === 0 ? (
        <EmptyState icon="globe" heading="No Rooms yet" message="Rooms you join will show up here." />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rooms.map((room) => {
            const iconUrl = room.avatar_url ? mediaUrls.get(room.avatar_url) : undefined;
            return (
              <Pressable
                key={room.id}
                style={styles.row}
                onPress={() => router.push({ pathname: '/c/[communityId]', params: { communityId: room.slug } })}
              >
                <Avatar
                  gradient={room.id}
                  color={room.accent_color}
                  imageUrl={iconUrl}
                  letter={room.name.charAt(0).toUpperCase()}
                  size={48}
                  shape="square"
                />
                <View style={styles.rowContent}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {room.name}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {room.member_count} member{room.member_count === 1 ? '' : 's'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
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
  rowMeta: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
  },
});
