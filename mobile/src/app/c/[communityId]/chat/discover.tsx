import { BlurTargetView } from 'expo-blur';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchRoomBySlug, type Room } from '@/lib/rooms';
import {
  fetchMySubgroupParticipations,
  fetchRoomSubgroups,
  joinSubgroup,
  respondToSubgroupInvite,
  type Subgroup,
  type SubgroupParticipation,
} from '@/lib/subgroups';

const VISIBILITY_LABEL = {
  public: 'Public',
  request: 'Request to join',
  invite: 'Invite only',
} as const;

/** Every sub-group in the Room, joined or not — visibility is independent of membership, so this is how someone finds a sub-group they weren't auto-added to. */
export default function DiscoverSubgroups() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const blurTargetRef = useRef<View>(null);

  const [room, setRoom] = useState<Room | null>(null);
  const [subgroups, setSubgroups] = useState<Subgroup[] | null>(null);
  const [participations, setParticipations] = useState<Map<string, SubgroupParticipation>>(new Map());
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetchRoomBySlug(communityId);
      setRoom(r);
      if (!r) return;
      const list = await fetchRoomSubgroups(r.id);
      setSubgroups(list);
      setParticipations(await fetchMySubgroupParticipations(list.map((s) => s.id), userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sub-groups.');
    }
  }, [communityId, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!session) return null;

  async function handleJoin(subgroup: Subgroup) {
    const invited = participations.get(subgroup.id)?.join_state === 'invited';
    setJoiningId(subgroup.id);
    setError(null);
    try {
      if (invited) {
        await respondToSubgroupInvite(subgroup.id, true);
      } else {
        await joinSubgroup(subgroup.id);
      }
      const approved = invited || subgroup.visibility === 'public';
      setParticipations((prev) =>
        new Map(prev).set(subgroup.id, { join_state: approved ? 'approved' : 'pending', banned: false, posting_disabled: false }),
      );
      if (approved) {
        router.push({ pathname: '/chats/[chatId]', params: { chatId: subgroup.id } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that sub-group.');
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
        <View style={styles.header}>
          <Pressable style={styles.back} hitSlop={8} onPress={() => router.back()}>
            <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {room ? `${room.name} · Sub-groups` : 'Sub-groups'}
          </Text>
          <View style={styles.back} />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        {subgroups === null ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent.DEFAULT} />
          </View>
        ) : subgroups.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.body}>No sub-groups in this Room yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {subgroups.map((s) => (
              <SubgroupRow
                key={s.id}
                subgroup={s}
                participation={participations.get(s.id)}
                joining={joiningId === s.id}
                onJoin={() => handleJoin(s)}
                onOpen={() => router.push({ pathname: '/chats/[chatId]', params: { chatId: s.id } })}
              />
            ))}
          </ScrollView>
        )}
      </BlurTargetView>
    </SafeAreaView>
  );
}

function SubgroupRow({
  subgroup,
  participation,
  joining,
  onJoin,
  onOpen,
}: {
  subgroup: Subgroup;
  participation: SubgroupParticipation | undefined;
  joining: boolean;
  onJoin: () => void;
  onOpen: () => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  let actionLabel: string;
  let disabled = false;
  if (participation?.banned) {
    actionLabel = 'Removed';
    disabled = true;
  } else if (participation?.join_state === 'approved') {
    actionLabel = 'Open';
  } else if (participation?.join_state === 'pending') {
    actionLabel = 'Requested';
    disabled = true;
  } else if (participation?.join_state === 'invited') {
    actionLabel = 'Accept';
  } else if (subgroup.visibility === 'invite') {
    actionLabel = 'Invite only';
    disabled = true;
  } else {
    actionLabel = subgroup.visibility === 'public' ? 'Join' : 'Request';
  }

  const isOpen = actionLabel === 'Open';
  const secondaryStyle = isOpen || disabled;

  return (
    <Pressable style={styles.subgroupRow} onPress={isOpen ? onOpen : undefined}>
      <View style={styles.subgroupIcon}>
        <Text style={styles.subgroupIconLetter}>{subgroup.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.subgroupContent}>
        <Text style={styles.subgroupName} numberOfLines={1}>
          {subgroup.name}
        </Text>
        <Text style={styles.subgroupMeta} numberOfLines={1}>
          {subgroup.member_count} member{subgroup.member_count === 1 ? '' : 's'} · {VISIBILITY_LABEL[subgroup.visibility]}
        </Text>
      </View>
      <Pressable
        style={[styles.actionButton, secondaryStyle && styles.actionButtonSecondary]}
        onPress={isOpen ? onOpen : onJoin}
        disabled={disabled || joining}
      >
        {joining ? (
          <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
        ) : (
          <Text style={[styles.actionText, secondaryStyle && styles.actionTextSecondary]}>{actionLabel}</Text>
        )}
      </Pressable>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[3],
  },
  back: {
    width: 32,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: colors.text,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[2],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
    textAlign: 'center',
  },
  list: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[8],
    gap: Spacing[3],
  },
  subgroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[3],
    backgroundColor: colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  subgroupIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subgroupIconLetter: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: colors.bg,
  },
  subgroupContent: {
    flex: 1,
    gap: 2,
  },
  subgroupName: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14.5,
    color: colors.text,
  },
  subgroupMeta: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[400],
  },
  actionButton: {
    height: 32,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  actionText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.bg,
  },
  actionTextSecondary: {
    color: colors.neutral[400],
  },
});
