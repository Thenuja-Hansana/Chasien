import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, Typography, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { fetchRoomBySlug } from '@/lib/rooms';
import { createSubgroup, type SubgroupVisibility } from '@/lib/subgroups';

const VISIBILITY_OPTIONS: { value: SubgroupVisibility; label: string; description: string }[] = [
  { value: 'public', label: 'Public', description: 'Anyone in the Community can join instantly.' },
  { value: 'request', label: 'Request to join', description: 'Anyone can ask to join; a mod approves.' },
  { value: 'invite', label: 'Invite only', description: 'Only people a mod invites can join.' },
];

export default function CreateSubgroup() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const nameFocus = useFocusHighlight();
  const descriptionFocus = useFocusHighlight();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<SubgroupVisibility>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Give the sub-group a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const room = await fetchRoomBySlug(communityId);
      if (!room) throw new Error('Room not found.');
      await createSubgroup(room.id, name.trim(), visibility, description.trim() || undefined);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that sub-group.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={() => router.back()}>
          <Icon name="close" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle}>New Sub-group</Text>
        <Pressable hitSlop={8} onPress={handleCreate} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.accent.DEFAULT} /> : <Text style={styles.createText}>Create</Text>}
        </Pressable>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.form}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={[styles.input, nameFocus.focused && styles.inputFocused]}
          value={name}
          onChangeText={setName}
          onFocus={nameFocus.onFocus}
          onBlur={nameFocus.onBlur}
          placeholder="e.g. Class B"
          placeholderTextColor={colors.neutral[500]}
        />

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          style={[styles.input, descriptionFocus.focused && styles.inputFocused]}
          value={description}
          onChangeText={setDescription}
          onFocus={descriptionFocus.onFocus}
          onBlur={descriptionFocus.onBlur}
          placeholder="What's this sub-group about?"
          placeholderTextColor={colors.neutral[500]}
        />

        <Text style={styles.label}>Who can join</Text>
        {VISIBILITY_OPTIONS.map((option) => (
          <Pressable key={option.value} style={styles.visibilityOption} onPress={() => setVisibility(option.value)}>
            <View style={[styles.radio, visibility === option.value && styles.radioActive]} />
            <View style={styles.visibilityTextWrap}>
              <Text style={styles.visibilityLabel}>{option.label}</Text>
              <Text style={styles.visibilityDescription}>{option.description}</Text>
            </View>
          </Pressable>
        ))}
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
    paddingBottom: Spacing[3],
  },
  headerTitle: {
    fontFamily: Fonts.bodyBold,
    fontSize: 17,
    color: colors.text,
  },
  createText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 15,
    color: colors.accent.DEFAULT,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[2],
  },
  form: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[2],
  },
  label: {
    ...Typography.label,
    color: colors.neutral[500],
    marginTop: Spacing[4],
  },
  input: {
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 16,
    fontSize: 15,
    color: colors.text,
    fontFamily: Fonts.body,
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  visibilityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[2],
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  radioActive: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 6,
  },
  visibilityTextWrap: {
    flex: 1,
    gap: 1,
  },
  visibilityLabel: {
    fontFamily: Fonts.bodySemibold,
    fontSize: 14.5,
    color: colors.text,
  },
  visibilityDescription: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: colors.neutral[400],
  },
});
