import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import Skeleton from '@/components/Skeleton';
import { Fonts, MaxContentWidth, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { pickImage, type PickedImage } from '@/lib/media';
import { cachedImageSource } from '@/lib/mediaUtils';
import { fetchRoomNotificationsMuted, setRoomNotificationsMuted } from '@/lib/notifications';
import { signRoomMediaUrls, uploadRoomAvatar, uploadRoomBanner } from '@/lib/roomMedia';
import { PUBLIC_OPTION, PRIVATE_JOIN_TYPES, isValidDomain } from '@/lib/roomVisibility';
import { useUserPreview } from '@/lib/user-preview-context';
import {
  changeRole,
  fetchMyMembership,
  fetchRoomBySlug,
  fetchRoomMembers,
  leaveRoom,
  removeFromRoom,
  respondToRequest,
  ROOM_CATEGORIES,
  updateRoomSettings,
  type Room,
  type RoomCategory,
  type RoomMember,
  type RoomRole,
  type RoomVisibility,
} from '@/lib/rooms';

const ROLE_LABEL: Record<RoomRole, string> = { owner: 'Owner', admin: 'Admin', mod: 'Mod', member: 'Member' };
// owner > admin > mod > member — mirrors ROLE_RANK in the room-membership
// Edge Function exactly, so the UI never offers an action the backend
// would reject (an admin never sees "Make Admin", a mod never sees a
// manage button on the owner, etc).
const ROLE_RANK: Record<RoomRole, number> = { owner: 3, admin: 2, mod: 1, member: 0 };

export default function CommunitySettings() {
  const { session } = useAuth();
  const { open: openUserPreview } = useUserPreview();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [room, setRoom] = useState<Room | null | 'loading'>('loading');
  // null = not yet known — distinct from `false` (confirmed non-moderator)
  // so the plain member view doesn't flash on screen for the moment
  // between `room` resolving and this membership check's own await
  // finishing (see load() below).
  const [isModerator, setIsModerator] = useState<boolean | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [description, setDescription] = useState('');
  const descriptionFocus = useFocusHighlight();
  // Android's multiline TextInput scrolls to show the cursor once its
  // controlled `value` carries real text, and defaults that cursor to
  // the *end* of the string rather than the start — found on-device at
  // a larger system font-scale setting (the field's first several lines
  // were invisible, scrolled above the visible box), but the same
  // scrolled-to-end position exists at any font scale, just less
  // noticeable when the whole description fits without wrapping.
  // Forcing selection to {0,0} until the field is actually focused pins
  // the initial render to the top; once focused, `selection` goes back
  // to undefined so typing isn't fighting a pinned cursor.
  const [descriptionSelection, setDescriptionSelection] = useState<{ start: number; end: number } | undefined>({
    start: 0,
    end: 0,
  });
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [requiredDomain, setRequiredDomain] = useState('');
  const domainFocus = useFocusHighlight();
  const [category, setCategory] = useState<RoomCategory | null>(null);
  const [membersCanPost, setMembersCanPost] = useState(true);
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [avatarImage, setAvatarImage] = useState<PickedImage | null>(null);
  const [bannerImage, setBannerImage] = useState<PickedImage | null>(null);
  const [existingAvatarUrl, setExistingAvatarUrl] = useState<string | null>(null);
  const [existingBannerUrl, setExistingBannerUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [manageTarget, setManageTarget] = useState<RoomMember | null>(null);
  const [leaving, setLeaving] = useState(false);

  const userId = session?.user.id;

  const load = useCallback(() => {
    if (!userId) return;
    fetchRoomBySlug(communityId)
      .then(async (r) => {
        setRoom(r);
        if (!r) return;
        const membership = await fetchMyMembership(r.id, userId);
        const moderator =
          membership?.join_state === 'approved' &&
          (membership.role === 'owner' || membership.role === 'admin' || membership.role === 'mod');
        setIsModerator(moderator);
        setDescription(r.description ?? '');
        setVisibility(r.visibility);
        setRequiredDomain(r.required_email_domain ?? '');
        setCategory(r.category);
        setMembersCanPost(r.members_can_post);
        setNotificationsMuted(await fetchRoomNotificationsMuted(r.id, userId));

        const mediaPaths = [r.avatar_url, r.banner_url].filter((p): p is string => !!p);
        if (mediaPaths.length > 0) {
          const signed = await signRoomMediaUrls(mediaPaths);
          setExistingAvatarUrl(r.avatar_url ? (signed.get(r.avatar_url) ?? null) : null);
          setExistingBannerUrl(r.banner_url ? (signed.get(r.banner_url) ?? null) : null);
        }

        if (moderator) {
          setMembers(await fetchRoomMembers(r.id));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load Room settings.'));
  }, [communityId, userId]);

  useFocusEffect(useCallback(() => load(), [load]));

  if (!session) return null;

  if (room === 'loading' || (room && isModerator === null)) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={[styles.content, styles.settingsSkeletonTop]}>
          <Skeleton width="100%" height={140} radius={Radius.lg} />
          <View style={styles.settingsSkeletonFields}>
            <Skeleton width={90} height={11} radius={5} />
            <Skeleton width="100%" height={44} radius={Radius.md} />
            <Skeleton width={90} height={11} radius={5} />
            <Skeleton width="100%" height={80} radius={Radius.md} />
            <Skeleton width={130} height={11} radius={5} />
            <Skeleton width="100%" height={44} radius={Radius.md} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!room) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top', 'bottom']}>
        <Text style={styles.body}>Room not found.</Text>
      </SafeAreaView>
    );
  }

  // A fresh binding with its own narrowed type — `room` itself stays a
  // `Room | 'loading'` union as far as TS is concerned inside a closure,
  // even though the guards above already ruled out anything but `Room`.
  const currentRoom: Room = room;
  const currentUserId = session.user.id;
  const isPrivate = visibility !== 'public';
  const needsDomain = visibility === 'domain_verified';

  // Public needs no further choice, so picking it sets the real
  // visibility directly. Private isn't itself a RoomVisibility value —
  // it's the umbrella over the three real ones in PRIVATE_JOIN_TYPES —
  // so tapping it just reveals that list, defaulting to the first entry
  // the way a radio group defaults to its first option.
  function handleTopChoice(choice: 'public' | 'private') {
    if (choice === 'public') {
      setVisibility('public');
    } else if (visibility === 'public') {
      setVisibility(PRIVATE_JOIN_TYPES[0].key);
    }
  }

  async function handleToggleMute() {
    const next = !notificationsMuted;
    setNotificationsMuted(next);
    try {
      await setRoomNotificationsMuted(currentRoom.id, next);
    } catch (e) {
      setNotificationsMuted(!next);
      setError(e instanceof Error ? e.message : 'Could not update notification settings.');
    }
  }

  if (!isModerator) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headingText} numberOfLines={1}>
            {room.name}
          </Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            style={styles.toggleRow}
            onPress={handleToggleMute}
            accessibilityRole="switch"
            accessibilityLabel="Mute notifications"
            accessibilityState={{ checked: notificationsMuted }}
          >
            <View style={styles.toggleText}>
              <Text style={styles.toggleTitle}>Mute notifications</Text>
              <Text style={styles.toggleDesc}>Stop activity from this Room notifying you</Text>
            </View>
            <View style={[styles.toggle, notificationsMuted && styles.toggleOn]}>
              <View style={styles.toggleThumb} />
            </View>
          </Pressable>
          <Pressable style={styles.leaveRow} onPress={handleLeave} disabled={leaving}>
            {leaving ? <ActivityIndicator color={colors.accent.DEFAULT} /> : <Text style={styles.leaveText}>Leave Room</Text>}
          </Pressable>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
      </SafeAreaView>
    );
  }

  async function handlePickAvatar() {
    // Same square crop as Room creation's own avatar picker — matches
    // previewAvatar's shape below.
    const image = await pickImage({ allowsEditing: true, aspect: [1, 1] });
    if (image) setAvatarImage(image);
  }

  async function handlePickBanner() {
    // Same wide crop as Room creation's own banner picker — matches
    // previewBannerWrap's proportions below.
    const image = await pickImage({ allowsEditing: true, aspect: [3, 1] });
    if (image) setBannerImage(image);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const [avatar_url, banner_url] = await Promise.all([
        avatarImage ? uploadRoomAvatar(avatarImage, currentRoom.id, currentUserId) : Promise.resolve(undefined),
        bannerImage ? uploadRoomBanner(bannerImage, currentRoom.id, currentUserId) : Promise.resolve(undefined),
      ]);
      await updateRoomSettings(currentRoom.id, {
        description,
        visibility,
        category,
        members_can_post: membersCanPost,
        required_email_domain: needsDomain ? requiredDomain.trim().toLowerCase() : null,
        ...(avatar_url ? { avatar_url } : {}),
        ...(banner_url ? { banner_url } : {}),
      });
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

  async function handleRoleChange(targetUserId: string, newRole: RoomRole) {
    setManageTarget(null);
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

  async function handleRemove(targetUserId: string) {
    setManageTarget(null);
    setBusyUserId(targetUserId);
    setError(null);
    try {
      await removeFromRoom(currentRoom.id, targetUserId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that member.');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleLeave() {
    setLeaving(true);
    setError(null);
    try {
      await leaveRoom(currentRoom.id);
      router.replace('/discover');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not leave this Room.');
      setLeaving(false);
    }
  }

  const approvedMembers = members.filter((m) => m.join_state === 'approved');
  const pendingRequests = members.filter((m) => m.join_state === 'pending');
  const myRole = approvedMembers.find((m) => m.user_id === session.user.id)?.role ?? 'member';
  const myRank = ROLE_RANK[myRole];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headingText} numberOfLines={1}>
          {room.name}
        </Text>
        <Pressable onPress={handleSave} disabled={saving || (needsDomain && !isValidDomain(requiredDomain))}>
          {saving ? <ActivityIndicator color={colors.accent.DEFAULT} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.previewCard}>
          <Pressable
            onPress={handlePickBanner}
            style={styles.previewBannerWrap}
            accessibilityRole="button"
            accessibilityLabel={bannerImage || existingBannerUrl ? 'Change cover photo' : 'Add cover photo'}
          >
            {bannerImage || existingBannerUrl ? (
              <>
                <Image
                  source={cachedImageSource(bannerImage?.uri ?? existingBannerUrl!)}
                  style={styles.previewBannerImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                <View style={styles.bannerEditButton}>
                  <Icon name="camera" size={18} color="#ffffff" />
                </View>
              </>
            ) : (
              <View style={styles.previewBanner}>
                <View style={styles.bannerEmptyIconCircle}>
                  <Icon name="camera" size={24} color="#000000" />
                </View>
                <Text style={styles.bannerEmptyText}>Add cover photo</Text>
              </View>
            )}
          </Pressable>

          <View style={styles.previewRow}>
            <Pressable
              onPress={handlePickAvatar}
              style={styles.avatarRing}
              accessibilityRole="button"
              accessibilityLabel="Change Room icon"
            >
              {avatarImage || existingAvatarUrl ? (
                <Image
                  source={cachedImageSource(avatarImage?.uri ?? existingAvatarUrl!)}
                  style={styles.previewAvatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.previewAvatar, { backgroundColor: currentRoom.accent_color ?? colors.neutral[700] }]}>
                  <Text style={styles.previewAvatarLetter}>{currentRoom.name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.avatarAddBadge}>
                <Icon name="addPhoto" size={16} color="#000000" />
              </View>
            </Pressable>
            <View style={styles.previewNameArea}>
              <Text style={styles.previewName} numberOfLines={1}>
                {currentRoom.name}
              </Text>
              <Text style={styles.previewMeta}>
                {currentRoom.member_count} member{currentRoom.member_count === 1 ? '' : 's'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textarea, descriptionFocus.focused && styles.inputFocused]}
          value={description}
          onChangeText={setDescription}
          selection={descriptionSelection}
          onFocus={() => {
            descriptionFocus.onFocus();
            setDescriptionSelection(undefined);
          }}
          onBlur={descriptionFocus.onBlur}
          placeholder="What's this Room about?"
          placeholderTextColor={colors.neutral[500]}
          multiline
          scrollEnabled={false}
        />

        <Text style={styles.label}>Who can join</Text>
        <View style={styles.joinTypeList}>
          <Pressable
            onPress={() => handleTopChoice('public')}
            style={[styles.joinTypeRow, !isPrivate && styles.joinTypeRowActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: !isPrivate }}
          >
            <Icon name={PUBLIC_OPTION.icon} size={19} color={!isPrivate ? colors.accent.DEFAULT : colors.neutral[400]} />
            <View style={styles.joinTypeText}>
              <Text style={styles.joinTypeTitle}>{PUBLIC_OPTION.title}</Text>
              <Text style={styles.joinTypeDesc}>{PUBLIC_OPTION.desc}</Text>
            </View>
            <View style={[styles.radio, !isPrivate && styles.radioActive]}>
              {!isPrivate && <Icon name="check" size={11} color={colors.bg} strokeWidth={3.6} />}
            </View>
          </Pressable>

          <Pressable
            onPress={() => handleTopChoice('private')}
            style={[styles.joinTypeRow, isPrivate && styles.joinTypeRowActive]}
            accessibilityRole="radio"
            accessibilityState={{ checked: isPrivate }}
          >
            <Icon name="lock" size={19} color={isPrivate ? colors.accent.DEFAULT : colors.neutral[400]} />
            <View style={styles.joinTypeText}>
              <Text style={styles.joinTypeTitle}>Private</Text>
              <Text style={styles.joinTypeDesc}>Choose exactly how people get in</Text>
            </View>
            <View style={[styles.radio, isPrivate && styles.radioActive]}>
              {isPrivate && <Icon name="check" size={11} color={colors.bg} strokeWidth={3.6} />}
            </View>
          </Pressable>

          {isPrivate && (
            <View style={styles.privateSubList}>
              {PRIVATE_JOIN_TYPES.map((j) => {
                const active = visibility === j.key;
                return (
                  <Pressable
                    key={j.key}
                    onPress={() => setVisibility(j.key)}
                    style={[styles.joinTypeRow, styles.joinTypeRowNested, active && styles.joinTypeRowActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                  >
                    <Icon name={j.icon} size={17} color={active ? colors.accent.DEFAULT : colors.neutral[400]} />
                    <View style={styles.joinTypeText}>
                      <Text style={styles.joinTypeTitle}>{j.title}</Text>
                      <Text style={styles.joinTypeDesc}>{j.desc}</Text>
                    </View>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active && <Icon name="check" size={11} color={colors.bg} strokeWidth={3.6} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {needsDomain && (
          <View style={styles.domainSection}>
            <Text style={styles.label}>Required email domain</Text>
            <TextInput
              style={[styles.input, styles.domainInput, domainFocus.focused && styles.inputFocused]}
              value={requiredDomain}
              onChangeText={setRequiredDomain}
              onFocus={domainFocus.onFocus}
              onBlur={domainFocus.onBlur}
              placeholder="e.g. iit.ac.lk"
              placeholderTextColor={colors.neutral[500]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.domainHint}>
              Anyone can request to join, but only someone who verifies an email ending in{' '}
              <Text style={styles.domainHintAccent}>@{requiredDomain.trim() || 'your-domain.edu'}</Text> actually gets in.
            </Text>
          </View>
        )}

        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryGrid}>
          {ROOM_CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.categoryChip, active && styles.categoryChipActive]}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
              >
                <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={styles.toggleRow}
          onPress={() => setMembersCanPost((v) => !v)}
          accessibilityRole="switch"
          accessibilityLabel="Members can post"
          accessibilityState={{ checked: membersCanPost }}
        >
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Members can post</Text>
            <Text style={styles.toggleDesc}>Off = only mods post</Text>
          </View>
          <View style={[styles.toggle, membersCanPost && styles.toggleOn]}>
            <View style={styles.toggleThumb} />
          </View>
        </Pressable>

        <Pressable
          style={styles.toggleRow}
          onPress={handleToggleMute}
          accessibilityRole="switch"
          accessibilityLabel="Mute notifications"
          accessibilityState={{ checked: notificationsMuted }}
        >
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Mute notifications</Text>
            <Text style={styles.toggleDesc}>Stop activity from this Room notifying you</Text>
          </View>
          <View style={[styles.toggle, notificationsMuted && styles.toggleOn]}>
            <View style={styles.toggleThumb} />
          </View>
        </Pressable>

        {pendingRequests.length > 0 && (
          <>
            <Text style={styles.label}>Requests to join</Text>
            <View style={styles.memberList}>
              {pendingRequests.map((m) => (
                <View key={m.user_id} style={styles.memberRow}>
                  <Pressable onPress={() => openUserPreview(m.user_id)}>
                    <Text style={styles.memberName}>{m.name}</Text>
                  </Pressable>
                  {busyUserId === m.user_id ? (
                    <ActivityIndicator color={colors.accent.DEFAULT} />
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
          {approvedMembers.map((m) => {
            const canManage = m.user_id !== session.user.id && myRank > ROLE_RANK[m.role] && busyUserId !== m.user_id;
            return (
              <View key={m.user_id} style={styles.memberRow}>
                <Pressable onPress={() => openUserPreview(m.user_id)}>
                  <Text style={styles.memberName}>{m.name}</Text>
                </Pressable>
                <View style={styles.memberRoleArea}>
                  <Text style={styles.roleBadge}>{ROLE_LABEL[m.role]}</Text>
                  {canManage && (
                    <Pressable onPress={() => setManageTarget(m)}>
                      <Text style={styles.manageText}>Manage</Text>
                    </Pressable>
                  )}
                  {busyUserId === m.user_id && <ActivityIndicator color={colors.accent.DEFAULT} />}
                </View>
              </View>
            );
          })}
        </View>

        <Pressable style={styles.leaveRow} onPress={handleLeave} disabled={leaving}>
          {leaving ? <ActivityIndicator color={colors.accent.DEFAULT} /> : <Text style={styles.leaveText}>Leave Room</Text>}
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <ManageMemberSheet
        member={manageTarget}
        myRank={myRank}
        onClose={() => setManageTarget(null)}
        onChangeRole={handleRoleChange}
        onRemove={handleRemove}
      />
    </SafeAreaView>
  );
}

function ManageMemberSheet({
  member,
  myRank,
  onClose,
  onChangeRole,
  onRemove,
}: {
  member: RoomMember | null;
  myRank: number;
  onClose: () => void;
  onChangeRole: (userId: string, role: RoomRole) => void;
  onRemove: (userId: string) => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const roleOptions = (['admin', 'mod', 'member'] as RoomRole[]).filter(
    (role) => member && role !== member.role && ROLE_RANK[role] < myRank,
  );

  return (
    <Modal visible={!!member} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        {member && (
          <View style={styles.sheetCard}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {member.name}
            </Text>
            {roleOptions.map((role) => (
              <Pressable key={role} style={styles.sheetOption} onPress={() => onChangeRole(member.user_id, role)}>
                <Text style={styles.sheetOptionText}>Make {ROLE_LABEL[role]}</Text>
              </Pressable>
            ))}
            {myRank === ROLE_RANK.owner && (
              <Pressable style={styles.sheetOption} onPress={() => onChangeRole(member.user_id, 'owner')}>
                <Text style={styles.sheetOptionText}>Transfer Ownership</Text>
              </Pressable>
            )}
            <Pressable style={styles.sheetOption} onPress={() => onRemove(member.user_id)}>
              <Text style={[styles.sheetOptionText, styles.sheetDangerText]}>Remove from Community</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={onClose}>
              <Text style={[styles.sheetOptionText, styles.sheetCancelText]}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  settingsSkeletonTop: {
    paddingTop: Spacing[4],
  },
  settingsSkeletonFields: {
    gap: Spacing[3],
    marginTop: Spacing[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[4],
  },
  headingText: {
    flex: 1,
    fontFamily: Fonts.heading,
    fontSize: 17,
    color: colors.text,
    textAlign: 'center',
  },
  saveText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent[300],
  },
  content: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: colors.neutral[400],
    textAlign: 'center',
  },
  label: {
    ...Typography.label,
    color: colors.neutral[500],
    marginBottom: Spacing[2],
    marginTop: Spacing[6],
  },
  previewCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: Spacing[6],
  },
  previewBannerWrap: {
    height: 140,
  },
  previewBanner: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    backgroundColor: '#B8B8B8',
  },
  previewBannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerEmptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerEmptyText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 13.5,
    color: '#000000',
  },
  bannerEditButton: {
    position: 'absolute',
    right: Spacing[3],
    bottom: Spacing[3],
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  previewRow: {
    backgroundColor: colors.surface,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[4],
  },
  // `Radius.lg`, not a hand-picked literal — matches `create-community.tsx`'s
  // own fix for the identical block; see that file's comment and
  // decision-log, 2026-09-11.
  avatarRing: {
    position: 'absolute',
    left: Spacing[4],
    top: -46,
    padding: 4,
    borderRadius: Radius.lg + 4,
    backgroundColor: colors.surface,
    zIndex: 2,
  },
  previewAvatar: {
    width: 84,
    height: 84,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarAddBadge: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  previewAvatarLetter: {
    fontFamily: Fonts.heading,
    fontSize: 30,
    color: colors.bg,
  },
  previewNameArea: {
    marginLeft: Spacing[4] + 92 + Spacing[3],
    paddingBottom: Spacing[1],
  },
  previewName: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: colors.text,
  },
  previewMeta: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[400],
  },
  input: {
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 20,
    fontSize: 15,
    // Without this, Android clips the first line's ascenders in the
    // multiline `textarea` below at a larger system font-scale setting —
    // create-post.tsx's own caption field (fontSize 15, lineHeight 22)
    // never had this bug, and was the tell: an explicit lineHeight is
    // what a top-aligned multiline TextInput needs to actually reserve
    // enough vertical room, `minHeight` growing the box wasn't it. Found
    // on-device during the touch-target/accessibility pass's font-scale
    // check, 2026-09-15.
    lineHeight: 22,
    color: colors.text,
    fontFamily: Fonts.body,
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  textarea: {
    // minHeight, not height — a fixed height would separately clip
    // multi-line content that needs more room than one line's worth.
    minHeight: 88,
    borderRadius: Radius.md,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  joinTypeList: {
    gap: Spacing[2],
    marginBottom: Spacing[4],
  },
  joinTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    padding: Spacing[3],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  joinTypeRowActive: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
    backgroundColor: `${colors.accent.DEFAULT}22`,
  },
  privateSubList: {
    gap: Spacing[2],
    marginLeft: Spacing[4],
    paddingLeft: Spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: colors.divider,
  },
  joinTypeRowNested: {
    padding: Spacing[2],
  },
  joinTypeText: {
    flex: 1,
    gap: 2,
  },
  joinTypeTitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  joinTypeDesc: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[400],
  },
  domainSection: {
    marginTop: Spacing[6],
    marginBottom: Spacing[2],
    padding: Spacing[4],
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  domainInput: {
    marginBottom: Spacing[3],
  },
  domainHint: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral[400],
  },
  domainHintAccent: {
    color: colors.accent2[300],
    fontWeight: '600',
  },
  radio: {
    width: 19,
    height: 19,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    backgroundColor: colors.accent.DEFAULT,
    borderWidth: 0,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  categoryChip: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryChipActive: {
    backgroundColor: colors.accent.DEFAULT,
    borderColor: colors.accent.DEFAULT,
  },
  categoryChipText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  categoryChipTextActive: {
    color: colors.bg,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[4],
    marginTop: Spacing[4],
    borderTopWidth: 1,
    borderColor: colors.divider,
  },
  toggleText: {
    flex: 1,
  },
  toggleTitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  toggleDesc: {
    fontFamily: Fonts.body,
    fontSize: 11.5,
    color: colors.neutral[500],
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.divider,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'flex-end',
  },
  // Same `colors.bg` regardless of on/off — `toggle`'s own track already
  // changes color (`colors.divider` off, `colors.accent.DEFAULT` on), and
  // bg/accent are always each other's inverse in this palette
  // (black-on-white in Light, near-white-on-near-black in Dark), so a
  // fixed bg-colored thumb contrasts against either track for free.
  // Previously `colors.neutral[300]` when off — invisible in Light mode
  // specifically, since `colors.divider` (rgba(17,17,17,0.12)) composites
  // to the exact same `#E0E0E0` over a white screen that `neutral[300]`
  // already is, so the "off" thumb was a same-color circle on a
  // same-color track. Found by actually looking at the unmuted state on a
  // real device, not by re-deriving it from the color values — see
  // decision-log, 2026-09-10.
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: colors.bg,
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
    color: colors.text,
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
    color: colors.accent[300],
    backgroundColor: `${colors.accent.DEFAULT}33`,
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
  },
  manageText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.accent2[300],
  },
  requestActions: {
    flexDirection: 'row',
    gap: Spacing[4],
  },
  approveText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent2[300],
  },
  denyText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent.DEFAULT,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    marginTop: Spacing[4],
  },
  leaveRow: {
    marginTop: Spacing[6],
    paddingVertical: Spacing[4],
    borderTopWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
  },
  leaveText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent.DEFAULT,
  },
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[8],
  },
  sheetCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: Radius.lg,
    backgroundColor: colors.surface,
    paddingVertical: Spacing[2],
    overflow: 'hidden',
  },
  sheetTitle: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: colors.neutral[500],
    textAlign: 'center',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[2],
  },
  sheetOption: {
    paddingHorizontal: Spacing[6],
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  sheetOptionText: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
  },
  sheetDangerText: {
    color: colors.accent.DEFAULT,
  },
  sheetCancelText: {
    color: colors.neutral[500],
  },
});
