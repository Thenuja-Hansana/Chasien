import { useMemo } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { ComposerMediaPreview } from '@/components/create/ComposerMediaTile';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PickedMedia } from '@/lib/media';

/**
 * The "review" half of the Clip tab — the recorded/picked video plus a
 * caption. Only ever rendered once `media` is set (create-post.tsx flips
 * back to the 'pick' phase, MediaGridPicker, the moment it's removed), so
 * this has no empty state of its own to render.
 */
export default function ClipTabFields({
  text,
  onChangeText,
  media,
  onRemoveMedia,
  focusedField,
  onFocusField,
  onBlurField,
  submitting,
}: {
  text: string;
  onChangeText: (v: string) => void;
  media: PickedMedia;
  onRemoveMedia: () => void;
  focusedField: string | null;
  onFocusField: (key: string) => void;
  onBlurField: (key: string) => void;
  submitting: boolean;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <>
      <ComposerMediaPreview media={media} onRemove={onRemoveMedia} disabled={submitting} />

      <TextInput
        style={[styles.caption, focusedField === 'clip-caption' && styles.captionFocused]}
        value={text}
        onChangeText={onChangeText}
        onFocus={() => onFocusField('clip-caption')}
        onBlur={() => onBlurField('clip-caption')}
        placeholder="Write a caption…"
        placeholderTextColor={colors.neutral[500]}
        multiline
        editable={!submitting}
      />
    </>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    caption: {
      minHeight: 70,
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      padding: Spacing[4],
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
      fontFamily: Fonts.body,
      textAlignVertical: 'top',
    },
    captionFocused: {
      backgroundColor: `${colors.accent.DEFAULT}0F`,
    },
  });
