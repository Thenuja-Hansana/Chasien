import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { fetchRoomNotificationsMuted, setRoomNotificationsMuted } from '@/lib/notifications';
import {
  changeRole,
  fetchMyMembership,
  fetchRoomBySlug,
  fetchRoomMembers,
  respondToRequest,
  updateRoomSettings,
  type Room,
  type RoomMember,
  type RoomVisibility,
} from '@/lib/rooms';

const VISIBILITY_OPTIONS: { key: RoomVisibility; label: string }[] = [
  { key: 'public', label: 'Public' },
  { key: 'request', label: 'Request to join' },
  { key: 'invite', label: 'Invite only' },
];

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', mod: 'Mod', member: 'Member' };

export default function CommunitySettings() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();

  const [room, setRoom] = useState<Room | null | 'loading'>('loading');
  const [isModerator, setIsModerator] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [membersCanPost, setMembersCanPost] = useState(true);
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(() => {
    if (!userId) return;
    fetchRoomBySlug(communityId)
      .then(async (r) => {
        setRoom(r);
        if (!r) return;
        const membership = await fetchMyMembership(r.id, userId);
        const moderator = membership?.join_state === 'approved' && (membership.role === 'owner' || membership.role === 'mod');
        setIsModerator(moderator);
        setDescription(r.description ?? '');
        setVisibility(r.visibility);
        setMembersCanPost(r.members_can_post);
        setNotificationsMuted(await fetchRoomNotificationsMuted(r.id, userId));
        if (moderator) {
          setMembers(await fetchRoomMembers(r.id));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Room settings.'));
  }, [communityId, userId]);

  useFocusEffect(useCallback(() => load(), [load]));

  if (!session) return null;

  if (room === 'loading') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <ActivityIndicator color={Colors.accent.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!room) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top']}>
        <Text style={styles.body}>Room not found.</Text>
      </SafeAreaView>
    );
  }

  // A fresh binding with its own narrowed type — `room` itself stays a
  // `Room | 'loading'` union as far as TS is concerned inside a closure,
  // even though the guards above already ruled out anything but `Room`.
  const currentRoom: Room = room;
  const currentUserId = session.user.id;

  async function handleToggleMute() {
    const next = !notificationsMuted;
    setNotificationsMuted(next);
    try {
      await setRoomNotificationsMuted(currentRoom.id, currentUserId, next);
    } catch (e) {
      setNotificationsMuted(!next);
      setError(e instanceof Error ? e.message : 'Could not update notification settings.');
    }
  }

  if (!isModerator) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Icon name="back" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.headingText} numberOfLines={1}>
            {room.name}
          </Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable style={styles.toggleRow} onPress={handleToggleMute}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleTitle}>Mute notifications</Text>
              <Text style={styles.toggleDesc}>Stop activity from this Room notifying you</Text>
            </View>
            <View style={[styles.toggle, notificationsMuted && styles.toggleOn]}>
              <View style={[styles.toggleThumb, notificationsMuted && styles.toggleThumbOn]} />
            </View>
          </Pressable>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </SafeAreaView>
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateRoomSettings(currentRoom.id, { description, visibility, members_can_post: membersCanPost });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRespond(targetUserId: string, approve: boolean) {
    setBusyUserId(targetUserId);
    setError(null);
    try {
      await respondToRequest(currentRoom.id, targetUserId, approve);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not respond to that request.');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRoleChange(targetUserId: string, newRole: 'mod' | 'member') {
    setBusyUserId(targetUserId);
    setError(null);
    try {
      await changeRole(currentRoom.id, targetUserId, newRole);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that member’s role.');
    } finally {
      setBusyUserId(null);
    }
  }

  const approvedMembers = members.filter((m) => m.join_state === 'approved');
  const pendingRequests = members.filter((m) => m.join_state === 'pending');
  const isOwner = approvedMembers.some((m) => m.user_id === session.user.id && m.role === 'owner');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.headingText} numberOfLines={1}>
          {room.name}
        </Text>
        <Pressable onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.accent.DEFAULT} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.textarea}
          value={description}
          onChangeText={setDescription}
          placeholder="What's this Room about?"
          placeholderTextColor={Colors.neutral[500]}
          multiline
        />

        <Text style={styles.label}>Who can join</Text>
        <View style={styles.visibilityList}>
          {VISIBILITY_OPTIONS.map((opt) => {
            const active = visibility === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setVisibility(opt.key)}
                style={[styles.visibilityRow, active && styles.visibilityRowActive]}
              >
                <Text style={styles.visibilityLabel}>{opt.label}</Text>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active && <Icon name="check" size={11} color={Colors.bg} strokeWidth={3.6} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.toggleRow} onPress={() => setMembersCanPost((v) => !v)}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Members can post</Text>
            <Text style={styles.toggleDesc}>Off = only mods post</Text>
          </View>
          <View style={[styles.toggle, membersCanPost && styles.toggleOn]}>
            <View style={[styles.toggleThumb, membersCanPost && styles.toggleThumbOn]} />
          </View>
        </Pressable>

        <Pressable style={styles.toggleRow} onPress={handleToggleMute}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Mute notifications</Text>
            <Text style={styles.toggleDesc}>Stop activity from this Room notifying you</Text>
          </View>
          <View style={[styles.toggle, notificationsMuted && styles.toggleOn]}>
            <View style={[styles.toggleThumb, notificationsMuted && styles.toggleThumbOn]} />
          </View>
        </Pressable>

        {pendingRequests.length > 0 && (
          <>
            <Text style={styles.label}>Requests to join</Text>
            <View style={styles.memberList}>
              {pendingRequests.map((m) => (
                <View key={m.user_id} style={styles.memberRow}>
                  <Text style={styles.memberName}>{m.name}</Text>
                  {busyUserId === m.user_id ? (
                    <ActivityIndicator color={Colors.accent.DEFAULT} />
                  ) : (
                    <View style={styles.requestActions}>
                      <Pressable onPress={() => handleRespond(m.user_id, true)}>
                        <Text style={styles.approveText}>Approve</Text>
                      </Pressable>
                      <Pressable onPress={() => handleRespond(m.user_id, false)}>
                        <Text style={styles.denyText}>Deny</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.label}>Roles</Text>
        <View style={styles.memberList}>
          {approvedMembers.map((m) => (
            <View key={m.user_id} style={styles.memberRow}>
              <Text style={styles.memberName}>{m.name}</Text>
              <View style={styles.memberRoleArea}>
                <Text style={styles.roleBadge}>{ROLE_LABEL[m.role]}</Text>
                {isOwner && m.user_id !== session.user.id && busyUserId !== m.user_id && (
                  <Pressable onPress={() => handleRoleChange(m.user_id, m.role === 'mod' ? 'member' : 'mod')}>
                    <Text style={styles.manageText}>{m.role === 'mod' ? 'Make member' : 'Make mod'}</Text>
                  </Pressable>
                )}
                {busyUserId === m.user_id && <ActivityIndicator color={Colors.accent.DEFAULT} />}
              </View>
            </View>
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
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
    fontFamily: Fonts.heading,
    fontSize: 17,
    color: Colors.text,
    textAlign: 'center',
  },
  saveText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent[300],
  },
  content: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.neutral[400],
    textAlign: 'center',
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.neutral[500],
    marginBottom: Spacing[2],
    marginTop: Spacing[6],
  },
  textarea: {
    minHeight: 88,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    padding: Spacing[3],
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text,
    fontFamily: Fonts.body,
    textAlignVertical: 'top',
  },
  visibilityList: {
    gap: Spacing[2],
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  visibilityRowActive: {
    borderColor: Colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  visibilityLabel: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  radio: {
    width: 19,
    height: 19,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    backgroundColor: Colors.accent.DEFAULT,
    borderWidth: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[4],
    marginTop: Spacing[4],
    borderTopWidth: 1,
    borderColor: Colors.divider,
  },
  toggleText: {
    flex: 1,
  },
  toggleTitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  toggleDesc: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: Colors.neutral[500],
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: Colors.divider,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'flex-end',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: Colors.neutral[300],
  },
  toggleThumbOn: {
    backgroundColor: '#f6e7d2',
  },
  memberList: {
    gap: Spacing[3],
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing[2],
  },
  memberName: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  memberRoleArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  roleBadge: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accent[300],
    backgroundColor: `${Colors.accent.DEFAULT}33`,
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
  },
  manageText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.accent2[300],
  },
  requestActions: {
    flexDirection: 'row',
    gap: Spacing[4],
  },
  approveText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent2[300],
  },
  denyText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent.DEFAULT,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    marginTop: Spacing[4],
  },
});
