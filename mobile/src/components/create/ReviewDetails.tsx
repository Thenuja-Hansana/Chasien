import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import Icon from '@/components/Icon';
import { Fonts, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TaggedPerson } from '@/lib/posts';

/**
 * Everything under the media on a New Post / New Clip review screen: the
 * borderless caption, then Instagram's detail rows — Tag people, then Add
 * location, in Instagram's order. Shared so the Post and Clip tabs can't
 * drift apart. Renders three siblings (no wrapper), so the parent's `gap`
 * spaces them like the media above.
 */
export default function ReviewDetails({
  text,
  onChangeText,
  tags,
  onOpenTags,
  location,
  onOpenLocation,
  onClearLocation,
  submitting,
}: {
  text: string;
  onChangeText: (v: string) => void;
  tags: TaggedPerson[];
  onOpenTags: () => void;
  /** '' when none is set. */
  location: string;
  onOpenLocation: () => void;
  onClearLocation: () => void;
  submitting: boolean;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <>
      {/* No box, by design — a bare writing area closed off by one hairline,
          like Instagram's caption field. It's multiline, so it isn't
          subject to the single-line empty-input caret bug GroupedTextInput
          works around. */}
      <View>
        <TextInput
          style={styles.caption}
          value={text}
          onChangeText={onChangeText}
          placeholder="Write a caption…"
          placeholderTextColor={colors.neutral[500]}
          multiline
          editable={!submitting}
          accessibilityLabel="Caption"
        />
        <View style={styles.divider} />
      </View>

      <View>
        <Pressable
          style={styles.detailRow}
          onPress={onOpenTags}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={tags.length > 0 ? `Tagged: ${tags.map((t) => t.name).join(', ')}. Tap to change` : 'Tag people'}
        >
          <Icon name="youTab" size={22} color={colors.text} strokeWidth={2} />
          <Text style={[styles.detailLabel, tags.length > 0 && styles.detailValue]} numberOfLines={1}>
            {tags.length === 0
              ? 'Tag people'
              : tags.length <= 2
                ? tags.map((t) => `@${t.handle}`).join(', ')
                : `@${tags[0].handle}, @${tags[1].handle} +${tags.length - 2}`}
          </Text>
          <Icon name="chevronRight" size={18} color={colors.neutral[500]} />
        </Pressable>
        <View style={styles.divider} />
      </View>

      <View>
        <Pressable
          style={styles.detailRow}
          onPress={onOpenLocation}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={location ? `Location: ${location}. Tap to change` : 'Add location'}
        >
          <Icon name="location" size={22} color={colors.text} strokeWidth={2} />
          <Text style={[styles.detailLabel, location.length > 0 && styles.detailValue]} numberOfLines={1}>
            {location || 'Add location'}
          </Text>
          {location ? (
            <Pressable onPress={onClearLocation} disabled={submitting} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove location">
              <Icon name="close" size={16} color={colors.neutral[500]} />
            </Pressable>
          ) : (
            <Icon name="chevronRight" size={18} color={colors.neutral[500]} />
          )}
        </Pressable>
        <View style={styles.divider} />
      </View>
    </>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    caption: {
      minHeight: 96,
      paddingHorizontal: 0,
      paddingVertical: Spacing[3],
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
      fontFamily: Fonts.body,
      textAlignVertical: 'top',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[3],
      minHeight: 56,
      paddingVertical: Spacing[3],
    },
    detailLabel: {
      flex: 1,
      fontFamily: Fonts.body,
      fontSize: 15.5,
      color: colors.text,
    },
    detailValue: {
      fontFamily: Fonts.bodySemibold,
    },
  });
