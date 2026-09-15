import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { pickImage, type PickedImage } from '@/lib/media';
import { signProfileMediaUrls, uploadProfileAvatar, uploadProfileBanner } from '@/lib/profileMedia';
import { fetchProfile, updateProfile } from '@/lib/profiles';

/** Linked from Settings and activity's "Account Centre" card (the You
 * page's own "Edit Profile" button was removed in favor of that single
 * entry point), but guarded against a direct deep link to someone else's
 * edit URL anyway — the update itself would be rejected by profiles' own
 * RLS regardless (auth.uid() = id), this just avoids showing the form at
 * all in that case. */
export default function EditProfile() {
  const { session } = useAuth();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const nameFocus = useFocusHighlight();
  const bioFocus = useFocusHighlight();

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarImage, setAvatarImage] = useState<PickedImage | null>(null);
  const [bannerImage, setBannerImage] = useState<PickedImage | null>(null);
  const [existingAvatarUrl, setExistingAvatarUrl] = useState<string | null>(null);
  const [existingBannerUrl, setExistingBannerUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myId = session?.user.id;
  const isOwnProfile = userId === myId;

  useFocusEffect(
    useCallback(() => {
      if (!isOwnProfile) return;
      (async () => {
        try {
          const profile = await fetchProfile(userId);
          if (!profile) return;
          setName(profile.name);
          setBio(profile.bio ?? '');

          const mediaPaths = [profile.avatar_url, profile.banner_url].filter((p): p is string => !!p);
          if (mediaPaths.length > 0) {
            const signed = await signProfileMediaUrls(mediaPaths);
            setExistingAvatarUrl(profile.avatar_url ? (signed.get(profile.avatar_url) ?? null) : null);
            setExistingBannerUrl(profile.banner_url ? (signed.get(profile.banner_url) ?? null) : null);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load your profile.');
        } finally {
          setLoaded(true);
        }
      })();
    }, [userId, isOwnProfile]),
  );

  if (!session || !isOwnProfile) return null;

  async function handlePickAvatar() {
    const image = await pickImage({ allowsEditing: true, aspect: [1, 1] });
    if (image) setAvatarImage(image);
  }

  async function handlePickBanner() {
    const image = await pickImage({ allowsEditing: true, aspect: [3, 1] });
    if (image) setBannerImage(image);
  }

  async function handleSave() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const [avatar_url, banner_url] = await Promise.all([
        avatarImage ? uploadProfileAvatar(avatarImage, userId) : Promise.resolve(undefined),
        bannerImage ? uploadProfileBanner(bannerImage, userId) : Promise.resolve(undefined),
      ]);
      await updateProfile(userId, {
        name: name.trim(),
        bio: bio.trim() || null,
        ...(avatar_url ? { avatar_url } : {}),
        ...(banner_url ? { banner_url } : {}),
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  const avatarUri = avatarImage?.uri ?? existingAvatarUrl;
  const bannerUri = bannerImage?.uri ?? existingBannerUrl;
  const canSubmit = name.trim().length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headingText}>Edit Profile</Text>
        <Pressable onPress={handleSave} disabled={!canSubmit || saving}>
          {saving ? <ActivityIndicator color={colors.accent.DEFAULT} /> : <Text style={[styles.saveText, !canSubmit && styles.saveTextDisabled]}>Save</Text>}
        </Pressable>
      </View>

      {!loaded ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent.DEFAULT} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Same banner + overlapping-avatar preview as Room creation
              (create-community.tsx) — the same "large, unmissable tap
              target" reasoning applies here too. */}
          <Pressable onPress={handlePickBanner} style={styles.bannerWrap}>
            {bannerUri ? (
              <>
                <Image source={{ uri: bannerUri }} style={styles.bannerImage} contentFit="cover" />
                <View style={styles.bannerEditButton}>
                  <Icon name="camera" size={18} color="#ffffff" />
                </View>
              </>
            ) : (
              <View style={styles.bannerEmpty}>
                <View style={styles.bannerEmptyIconCircle}>
                  <Icon name="camera" size={24} color="#000000" />
                </View>
                <Text style={styles.bannerEmptyText}>Add cover photo</Text>
              </View>
            )}
          </Pressable>

          <Pressable onPress={handlePickAvatar} style={styles.avatarRing}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                <Text style={styles.avatarPlaceholderLetter}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
              </View>
            )}
            <View style={styles.avatarAddBadge}>
              <Icon name="addPhoto" size={16} color="#000000" />
            </View>
          </Pressable>

          <View style={styles.fields}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={[styles.input, nameFocus.focused && styles.inputFocused]}
              value={name}
              onChangeText={setName}
              onFocus={nameFocus.onFocus}
              onBlur={nameFocus.onBlur}
              placeholder="Your name"
              placeholderTextColor={colors.neutral[500]}
            />

            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.textarea, bioFocus.focused && styles.inputFocused]}
              value={bio}
              onChangeText={setBio}
              onFocus={bioFocus.onFocus}
              onBlur={bioFocus.onBlur}
              placeholder="Tell people a bit about yourself"
              placeholderTextColor={colors.neutral[500]}
              multiline
            />

            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const AVATAR_SIZE = 108;

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: colors.text,
  },
  saveText: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent[300],
  },
  saveTextDisabled: {
    color: colors.neutral[500],
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingBottom: Spacing[8],
  },
  bannerWrap: {
    height: 160,
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  // Fixed mid-gray in both themes, deliberately not theme-derived — same
  // reasoning as create-community's previewBanner: the black icon/text
  // over it needs a background that never gets light enough to wash them
  // out, regardless of mode.
  bannerEmpty: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    backgroundColor: '#B8B8B8',
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
    fontSize: 14,
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
  // Absolute against the ScrollView's own content (the nearest ancestor
  // View, exactly like create-community's avatarRing) — pulled up by half
  // its own height so it straddles the banner/body seam.
  avatarRing: {
    position: 'absolute',
    left: Spacing[6],
    top: 160 - AVATAR_SIZE / 2,
    padding: 4,
    borderRadius: (AVATAR_SIZE + 8) / 2,
    backgroundColor: colors.bg,
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 999,
  },
  avatarPlaceholder: {
    backgroundColor: colors.neutral[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderLetter: {
    fontFamily: Fonts.heading,
    fontSize: 40,
    color: colors.bg,
  },
  // Same "hangs outside the corner" treatment as Room creation's own
  // avatar badge (create-community.tsx) — kept in sync deliberately, not
  // shared as a component, since the two sit on differently-shaped
  // avatars (circle here, rounded square there).
  avatarAddBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  fields: {
    marginTop: AVATAR_SIZE / 2 + Spacing[4],
    paddingHorizontal: Spacing[6],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  label: {
    ...Typography.label,
    color: colors.neutral[500],
    marginBottom: Spacing[2],
  },
  input: {
    width: '100%',
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 20,
    fontSize: 16,
    color: colors.text,
    fontFamily: Fonts.body,
    marginBottom: Spacing[6],
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  textarea: {
    height: 96,
    borderRadius: Radius.md,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    color: colors.accent.DEFAULT,
    textAlign: 'center',
  },
});
