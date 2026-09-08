import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { pickImage, type PickedImage } from '@/lib/media';
import { createRoom, updateRoomSettings, ROOM_CATEGORIES, type RoomCategory, type RoomVisibility } from '@/lib/rooms';
import { uploadRoomAvatar, uploadRoomBanner } from '@/lib/roomMedia';
import { PUBLIC_OPTION, PRIVATE_JOIN_TYPES, isValidDomain } from '@/lib/roomVisibility';

// A Room's accent color is its own identity (the small swatch shown next
// to its name in Home/Discover — lib/rooms.ts's `accent_color`), separate
// from the app's own black/white chrome, so this picker deliberately stays
// a real grayscale ramp rather than collapsing to one flat brand color.
function themeColorsFor(colors: ThemeColors) {
  return [colors.neutral[900], colors.neutral[700], colors.neutral[500], colors.neutral[300], colors.accent.DEFAULT];
}

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export default function CreateCommunity() {
  const { session } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const THEME_COLORS = useMemo(() => themeColorsFor(colors), [colors]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accent, setAccent] = useState(THEME_COLORS[0]);
  const [category, setCategory] = useState<RoomCategory | null>(null);
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [requiredDomain, setRequiredDomain] = useState('');
  const [avatarImage, setAvatarImage] = useState<PickedImage | null>(null);
  const [bannerImage, setBannerImage] = useState<PickedImage | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const nameFocus = useFocusHighlight();
  const descriptionFocus = useFocusHighlight();
  const domainFocus = useFocusHighlight();

  const slug = useMemo(() => slugify(name), [name]);
  const isPrivate = visibility !== 'public';
  const needsDomain = visibility === 'domain_verified';
  const canSubmit =
    name.trim().length > 0 && slug.length >= 3 && category !== null && (!needsDomain || isValidDomain(requiredDomain));

  // Anything worth losing — the theme swatch is left out on purpose,
  // its default is already a real (if arbitrary) choice, not "untouched".
  const hasChanges =
    name.trim().length > 0 ||
    description.trim().length > 0 ||
    category !== null ||
    visibility !== 'public' ||
    !!avatarImage ||
    !!bannerImage;

  function handleClose() {
    if (hasChanges) {
      setShowDiscardConfirm(true);
    } else {
      router.back();
    }
  }

  // Public needs no further choice, so picking it sets the real
  // visibility directly. Private isn't itself a RoomVisibility value —
  // it's the umbrella over the three real ones in PRIVATE_JOIN_TYPES —
  // so tapping it just reveals that list, defaulting to the first entry
  // (Request to join) the way a radio group defaults to its first option.
  function handleTopChoice(choice: 'public' | 'private') {
    if (choice === 'public') {
      setVisibility('public');
    } else if (visibility === 'public') {
      setVisibility(PRIVATE_JOIN_TYPES[0].key);
    }
  }

  async function handlePickAvatar() {
    // Square, matching previewAvatar's own shape — lets people choose
    // which part of the photo is the profile picture instead of
    // whatever crop the picker happened to hand back.
    const image = await pickImage({ allowsEditing: true, aspect: [1, 1] });
    if (image) setAvatarImage(image);
  }

  async function handlePickBanner() {
    // Matches previewBannerWrap's own wide proportions (full width, 140
    // fixed height) so the crop the user picks is the crop they get.
    const image = await pickImage({ allowsEditing: true, aspect: [3, 1] });
    if (image) setBannerImage(image);
  }

  async function handleCreate() {
    if (!canSubmit || submitting || !session) return;
    setSubmitting(true);
    setError(null);
    try {
      const room = await createRoom({
        slug,
        name: name.trim(),
        description: description.trim(),
        visibility,
        accent_color: accent,
        category,
        required_email_domain: needsDomain ? requiredDomain.trim().toLowerCase() : null,
      });

      // Uploaded after the Room row exists, not before — the bucket's own
      // RLS (20260908120000_room_avatar_banner.sql) checks is_room_admin()
      // against a real room_id, and the object path itself is scoped by
      // it too.
      if (avatarImage || bannerImage) {
        const userId = session.user.id;
        const [avatar_url, banner_url] = await Promise.all([
          avatarImage ? uploadRoomAvatar(avatarImage, room.id, userId) : Promise.resolve(undefined),
          bannerImage ? uploadRoomBanner(bannerImage, room.id, userId) : Promise.resolve(undefined),
        ]);
        await updateRoomSettings(room.id, {
          ...(avatar_url ? { avatar_url } : {}),
          ...(banner_url ? { banner_url } : {}),
        });
      }

      router.replace({ pathname: '/c/[communityId]', params: { communityId: room.slug } });
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('duplicate')
          ? 'A Room with that name already exists — try another.'
          : e instanceof Error
            ? e.message
            : 'Could not create that Room.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={handleClose} hitSlop={12}>
          <Icon name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headingText}>New Room</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.previewCard}>
          {/* The whole banner is one big tap target, not a small corner
              badge — an empty banner shows a large centered "add cover
              photo" prompt so there's no guessing where to tap; once set,
              a clearly-sized (not tiny) edit button stays in the corner
              instead of covering the photo. */}
          <Pressable onPress={handlePickBanner} style={styles.previewBannerWrap}>
            {bannerImage ? (
              <>
                <Image source={{ uri: bannerImage.uri }} style={styles.previewBannerImage} contentFit="cover" />
                <View style={styles.bannerEditButton}>
                  <Icon name="camera" size={18} color="#ffffff" />
                </View>
              </>
            ) : (
              // A fixed neutral placeholder, deliberately not `accent` —
              // that swatch can be picked as light or dark (it's the same
              // ramp Home's Room icons use, see themeColorsFor's own
              // comment), and text/icon color has to stay legible against
              // whichever one's active, not just whichever one happened
              // to be selected when this was last checked.
              <View style={styles.previewBanner}>
                <View style={styles.bannerEmptyIconCircle}>
                  <Icon name="camera" size={24} color="#000000" />
                </View>
                <Text style={styles.bannerEmptyText}>Add cover photo</Text>
              </View>
            )}
          </Pressable>

          <View style={styles.previewRow}>
            {/* Absolutely positioned against the card itself (not a
                negative-margin flow trick) so exactly how much of the
                circle sits on the banner vs. below the seam is explicit
                and can't come out clipped depending on layout — half on
                the cover photo, half over the border, left-aligned,
                the same "cover photo + overlapping avatar" header every
                major app uses. */}
            <Pressable onPress={handlePickAvatar} style={styles.avatarRing}>
              {avatarImage ? (
                <Image source={{ uri: avatarImage.uri }} style={styles.previewAvatar} contentFit="cover" />
              ) : (
                <View style={[styles.previewAvatar, { backgroundColor: accent }]}>
                  <Text style={styles.previewAvatarLetter}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
                </View>
              )}
              <View style={styles.avatarAddBadge}>
                <Icon name="addPhoto" size={16} color="#000000" />
              </View>
            </Pressable>
            <View style={styles.previewNameArea}>
              <Text style={styles.previewName}>{name.trim() || 'Untitled Room'}</Text>
              <Text style={styles.previewMeta}>Preview · 1 member</Text>
            </View>
          </View>
        </View>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={[styles.input, nameFocus.focused && styles.inputFocused]}
          value={name}
          onChangeText={setName}
          onFocus={nameFocus.onFocus}
          onBlur={nameFocus.onBlur}
          placeholder="Your Room's name"
          placeholderTextColor={colors.neutral[500]}
        />
        {slug.length > 0 && (
          <Text style={styles.slugPreview}>
            chasien.app/<Text style={styles.slugPreviewAccent}>{slug}</Text>
          </Text>
        )}

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textarea, descriptionFocus.focused && styles.inputFocused]}
          value={description}
          onChangeText={setDescription}
          onFocus={descriptionFocus.onFocus}
          onBlur={descriptionFocus.onBlur}
          placeholder="What's this Room about?"
          placeholderTextColor={colors.neutral[500]}
          multiline
        />

        <Text style={styles.label}>Theme</Text>
        <View style={styles.swatchRow}>
          {THEME_COLORS.map((c, i) => (
            <Pressable
              // Index, not the color itself: in Dark mode neutral[900] and
              // accent.DEFAULT are the exact same hex (#F2F2F2 — see
              // constants/theme.ts), so two entries in this fixed 5-item
              // list can collide on value even though they're meant to be
              // distinct picks.
              key={i}
              onPress={() => setAccent(c)}
              style={[styles.swatch, { backgroundColor: c }, accent === c && styles.swatchActive]}
            />
          ))}
        </View>

        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryGrid}>
          {ROOM_CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.categoryChip, active && styles.categoryChipActive]}
              >
                <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Who can join</Text>
        <View style={styles.joinTypeList}>
          <Pressable
            onPress={() => handleTopChoice('public')}
            style={[styles.joinTypeRow, !isPrivate && styles.joinTypeRowActive]}
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

          {/* Not a popup — this drops open inline, right under Private,
              the same list it's always been, just nested under the
              choice that actually needs it instead of sitting flush
              with Public. */}
          {isPrivate && (
            <View style={styles.privateSubList}>
              {PRIVATE_JOIN_TYPES.map((j) => {
                const active = visibility === j.key;
                return (
                  <Pressable
                    key={j.key}
                    onPress={() => setVisibility(j.key)}
                    style={[styles.joinTypeRow, styles.joinTypeRowNested, active && styles.joinTypeRowActive]}
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

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          onPress={handleCreate}
          disabled={!canSubmit || submitting}
        >
          {submitting ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitButtonText}>Create Room</Text>}
        </Pressable>
      </View>

      <Modal visible={showDiscardConfirm} transparent animationType="fade" onRequestClose={() => setShowDiscardConfirm(false)}>
        <Pressable style={styles.confirmBackdrop} onPress={() => setShowDiscardConfirm(false)}>
          <Pressable style={styles.confirmCard} onPress={() => {}}>
            <Text style={styles.confirmTitle}>Discard this Room?</Text>
            <Text style={styles.confirmBody}>Everything you&apos;ve entered so far will be lost — this can&apos;t be undone.</Text>
            <View style={styles.confirmActions}>
              <Pressable style={styles.confirmCancelButton} onPress={() => setShowDiscardConfirm(false)}>
                <Text style={styles.confirmCancelText}>Keep Editing</Text>
              </Pressable>
              <Pressable style={styles.confirmDiscardButton} onPress={() => router.back()}>
                <Text style={styles.confirmDiscardText}>Discard</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[4],
  },
  headingText: {
    fontFamily: Fonts.heading,
    fontSize: 17,
    color: colors.text,
  },
  content: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[6],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
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
  // A fixed mid-gray, not derived from `colors` — every neutral step in
  // the theme scale flips between light and dark depending on mode (see
  // constants/theme.ts), so a "safe" gray picked against Light mode can
  // still turn light-on-light in Dark mode. This one hex is deliberately
  // the same in both, since the black icon/text over it depend on it
  // never getting light enough to wash them out.
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
  // The empty-state prompt: large, centered, unmissable — not a small
  // corner badge someone has to already know to look for.
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
  // The filled-state button sits on top of an arbitrary photo (any
  // color at all), unlike the fixed-gray empty state above — a dark
  // translucent badge with a white icon is the one treatment that stays
  // legible regardless of what's under it, so this one's deliberately
  // not matched to the empty state's black-on-gray.
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
  // Absolute, anchored to previewRow (React Native treats every View as
  // a containing block for its own absolutely-positioned children, not
  // just ones marked `position: relative` the way web does) — so `top`
  // here is relative to previewRow's own top edge, which sits exactly at
  // the banner/body seam. Negative by half the ring's own size (84px
  // avatar + 4px padding each side = 92) pulls it up so it straddles
  // that seam evenly, rather than sitting entirely below it.
  avatarRing: {
    position: 'absolute',
    left: Spacing[4],
    top: -46,
    padding: 4,
    borderRadius: 22,
    backgroundColor: colors.surface,
    zIndex: 2,
  },
  previewAvatar: {
    width: 84,
    height: 84,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Negative right/bottom, not 0 — flush with the edge kept the badge
  // sitting entirely inside the avatar's own bounds instead of poking
  // out past the corner the way a real "edit" badge should (Instagram,
  // WhatsApp's profile-edit badges all hang partially outside the photo
  // itself, not tucked inside it).
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
  // Manually offset past where avatarRing sits (it's position: 'absolute'
  // now, so it no longer pushes this over via normal flow/gap the way an
  // in-flow sibling would) — 92 is the ring's own total size (the 84px
  // avatar plus its 4px padding on each side).
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
  label: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.neutral[500],
    marginBottom: Spacing[2],
  },
  input: {
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 20,
    fontSize: 15,
    color: colors.text,
    fontFamily: Fonts.body,
    marginBottom: Spacing[2],
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  textarea: {
    height: 88,
    borderRadius: Radius.md,
    paddingTop: 14,
    textAlignVertical: 'top',
    marginBottom: Spacing[6],
  },
  slugPreview: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[500],
    paddingLeft: 6,
    marginBottom: Spacing[6],
  },
  slugPreviewAccent: {
    color: colors.accent2[300],
  },
  // A distinct card, not just more text stacked under the join-type
  // list — this is a required field for the option just picked, and
  // needs its own visual space to read that way rather than looking
  // like it's crammed onto the end of the list above it.
  domainSection: {
    marginTop: Spacing[6],
    marginBottom: Spacing[6],
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
  swatchRow: {
    flexDirection: 'row',
    gap: Spacing[3],
    marginBottom: Spacing[6],
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 999,
  },
  swatchActive: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[6],
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
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    marginTop: Spacing[3],
  },
  footer: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
  },
  submitButton: {
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    fontFamily: Fonts.heading,
    fontSize: 16,
    color: colors.bg,
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[6],
  },
  confirmCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Radius.lg,
    backgroundColor: colors.bg,
    padding: Spacing[6],
  },
  confirmTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: colors.text,
    marginBottom: Spacing[2],
  },
  confirmBody: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.neutral[400],
    marginBottom: Spacing[6],
  },
  confirmActions: {
    flexDirection: 'row',
    gap: Spacing[3],
  },
  confirmCancelButton: {
    flex: 1,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  // The one deliberate departure from the app's otherwise monochrome
  // palette — a destructive action gets the near-universal red
  // convention (iOS/Android system "delete" red) instead of blending
  // into the black/white chrome, since this one's irreversible.
  confirmDiscardButton: {
    flex: 1,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: '#E5484D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDiscardText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
