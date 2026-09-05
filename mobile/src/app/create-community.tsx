import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { createRoom, ROOM_CATEGORIES, type RoomCategory, type RoomVisibility } from '@/lib/rooms';

// A Room's accent color is its own identity (the small swatch shown next
// to its name in Home/Discover — lib/rooms.ts's `accent_color`), separate
// from the app's own black/white chrome, so this picker deliberately stays
// a real grayscale ramp rather than collapsing to one flat brand color.
function themeColorsFor(colors: ThemeColors) {
  return [colors.neutral[900], colors.neutral[700], colors.neutral[500], colors.neutral[300], colors.accent.DEFAULT];
}

const JOIN_TYPES: { key: RoomVisibility; icon: 'globe' | 'lock' | 'mail'; title: string; desc: string }[] = [
  { key: 'public', icon: 'globe', title: 'Public', desc: 'Listed in Discover, anyone joins' },
  { key: 'request', icon: 'lock', title: 'Request to join', desc: 'Listed, but mods approve' },
  { key: 'invite', icon: 'mail', title: 'Invite only', desc: 'Hidden from Discover' },
];

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export default function CreateCommunity() {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const THEME_COLORS = useMemo(() => themeColorsFor(colors), [colors]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accent, setAccent] = useState(THEME_COLORS[0]);
  const [category, setCategory] = useState<RoomCategory | null>(null);
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameFocus = useFocusHighlight();
  const descriptionFocus = useFocusHighlight();

  const slug = useMemo(() => slugify(name), [name]);
  const canSubmit = name.trim().length > 0 && slug.length >= 3 && category !== null;

  async function handleCreate() {
    if (!canSubmit || submitting) return;
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
      });
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
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headingText}>New Room</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.previewCard}>
          <View style={[styles.previewBanner, { backgroundColor: accent }]} />
          <View style={styles.previewRow}>
            <View style={[styles.previewAvatar, { backgroundColor: accent }]}>
              <Text style={styles.previewAvatarLetter}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
            </View>
            <View>
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
          {JOIN_TYPES.map((j) => {
            const active = visibility === j.key;
            return (
              <Pressable
                key={j.key}
                onPress={() => setVisibility(j.key)}
                style={[styles.joinTypeRow, active && styles.joinTypeRowActive]}
              >
                <Icon name={j.icon} size={19} color={active ? colors.accent.DEFAULT : colors.neutral[400]} />
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
  previewBanner: {
    height: 70,
    opacity: 0.5,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    backgroundColor: colors.surface,
    padding: Spacing[3],
  },
  previewAvatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewAvatarLetter: {
    fontFamily: Fonts.heading,
    fontSize: 19,
    color: colors.bg,
  },
  previewName: {
    fontFamily: Fonts.heading,
    fontSize: 17,
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
});
