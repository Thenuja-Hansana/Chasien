import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/errors';
import { fetchTaggableMembers, MAX_POST_TAGS, type TaggedPerson } from '@/lib/posts';

/**
 * The Post composer's "Tag people" sheet: search this Room's members and
 * tick who's in the post, up to MAX_POST_TAGS.
 *
 * Same bottom-sheet shell as LocationSheet, including its Android keyboard
 * handling ('height', never undefined — see the decision log's "Location
 * sheet hid behind the keyboard"). Edits a draft that's only handed back on
 * Done; backing out leaves the post's tags as they were. Members load each
 * time the sheet opens, so someone who just joined the Room shows up.
 */
export default function TagPeopleSheet({
  visible,
  roomId,
  userId,
  value,
  onDone,
  onClose,
}: {
  visible: boolean;
  roomId: string;
  userId: string;
  value: TaggedPerson[];
  onDone: (people: TaggedPerson[]) => void;
  onClose: () => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);

  const [draft, setDraft] = useState<TaggedPerson[]>(value);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<TaggedPerson[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Re-seed the draft and clear the search each time the sheet opens (adjusting
  // state on a prop transition during render, React's documented pattern).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(value);
      setQuery('');
      setMembers(null);
      setLoadError(null);
    }
  }

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchTaggableMembers(roomId, userId)
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e, 'Could not load this Room’s members.'));
      });
    return () => {
      cancelled = true;
    };
  }, [visible, roomId, userId]);

  const selectedIds = new Set(draft.map((p) => p.userId));
  const atLimit = draft.length >= MAX_POST_TAGS;
  const q = query.trim().toLowerCase();
  const filtered = (members ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.handle.toLowerCase().includes(q));

  function toggle(person: TaggedPerson) {
    setDraft((prev) => {
      if (prev.some((p) => p.userId === person.userId)) return prev.filter((p) => p.userId !== person.userId);
      if (prev.length >= MAX_POST_TAGS) return prev;
      return [...prev, person];
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          {/* Swallows the backdrop's onPress so tapping inside the sheet doesn't close it — same pattern as ConfirmModal. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Tag people</Text>
              <Text style={styles.count}>
                {draft.length}/{MAX_POST_TAGS}
              </Text>
            </View>

            <View style={styles.searchBox}>
              <Icon name="search" size={16} color={colors.neutral[500]} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search members"
                placeholderTextColor={colors.neutral[500]}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Search this Room's members"
              />
            </View>

            {draft.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                {draft.map((p) => (
                  <Pressable key={p.userId} style={styles.chip} onPress={() => toggle(p)} accessibilityRole="button" accessibilityLabel={`Untag ${p.name}`}>
                    <Text style={styles.chipText}>@{p.handle}</Text>
                    <Icon name="close" size={12} color={colors.bg} strokeWidth={3} />
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {loadError ? (
              <Text style={styles.message}>{loadError}</Text>
            ) : members === null ? (
              <ActivityIndicator style={styles.loading} color={colors.accent.DEFAULT} />
            ) : (
              <FlatList
                style={styles.list}
                data={filtered}
                keyExtractor={(m) => m.userId}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text style={styles.message}>{members.length === 0 ? 'No one else is in this Room yet.' : `No members match “${query.trim()}”.`}</Text>
                }
                renderItem={({ item }) => {
                  const selected = selectedIds.has(item.userId);
                  const disabled = !selected && atLimit;
                  return (
                    <Pressable
                      style={[styles.row, disabled && styles.rowDisabled]}
                      onPress={() => toggle(item)}
                      disabled={disabled}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled }}
                      accessibilityLabel={`${item.name}, @${item.handle}`}
                    >
                      <Avatar gradient={item.userId} letter={item.name.charAt(0).toUpperCase() || '?'} size={36} />
                      <View style={styles.rowText}>
                        <Text style={styles.name} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.handle} numberOfLines={1}>
                          @{item.handle}
                        </Text>
                      </View>
                      <View style={[styles.check, selected && styles.checkSelected]}>
                        {selected && <Icon name="check" size={13} color={colors.bg} strokeWidth={3} />}
                      </View>
                    </Pressable>
                  );
                }}
              />
            )}

            <Pressable style={styles.doneButton} onPress={() => onDone(draft)} accessibilityRole="button">
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      height: '85%',
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      backgroundColor: colors.bg,
      paddingTop: Spacing[6],
      paddingHorizontal: Spacing[6],
      paddingBottom: Spacing[4] + bottomInset,
      gap: Spacing[3],
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    title: {
      fontFamily: Fonts.heading,
      fontSize: 18,
      color: colors.text,
    },
    count: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 12,
      color: colors.neutral[500],
    },
    searchBox: {
      height: 44,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[2],
    },
    searchInput: {
      flex: 1,
      height: 44,
      fontSize: 15,
      color: colors.text,
      fontFamily: Fonts.body,
    },
    chips: {
      gap: Spacing[2],
    },
    chip: {
      height: 30,
      paddingHorizontal: 12,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    chipText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 12.5,
      color: colors.bg,
    },
    loading: {
      marginTop: Spacing[6],
    },
    list: {
      flex: 1,
    },
    message: {
      fontFamily: Fonts.body,
      fontSize: 14,
      color: colors.neutral[500],
      textAlign: 'center',
      marginTop: Spacing[6],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[3],
      minHeight: 56,
      paddingVertical: Spacing[2],
    },
    rowDisabled: {
      opacity: 0.4,
    },
    rowText: {
      flex: 1,
    },
    name: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 15,
      color: colors.text,
    },
    handle: {
      fontFamily: Fonts.body,
      fontSize: 12.5,
      color: colors.neutral[500],
    },
    check: {
      width: 24,
      height: 24,
      borderRadius: Radius.pill,
      borderWidth: 1.5,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkSelected: {
      backgroundColor: colors.accent.DEFAULT,
      borderColor: colors.accent.DEFAULT,
    },
    doneButton: {
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 14,
      color: colors.bg,
    },
  });
