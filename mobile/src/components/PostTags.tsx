import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TaggedPerson } from '@/lib/posts';

/**
 * How a post shows who's tagged in it — two forms, one rule: a post with
 * photos/video gets Instagram's person badge on the media (tap to reveal the
 * names over it); a post without media has nowhere to put a badge, so it
 * gets a small "with …" line instead. Names open the same profile preview
 * the author's name does.
 */

/** Absolutely positioned — render inside the media's own wrapper, after the carousel. */
export function PostTagsOverlay({ tags, onPressPerson }: { tags: TaggedPerson[]; onPressPerson: (userId: string) => void }) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  if (tags.length === 0) return null;

  return (
    <>
      {open && (
        <View style={styles.overlayNames} pointerEvents="box-none">
          {tags.map((t) => (
            <Pressable
              key={t.userId}
              style={styles.nameChip}
              onPress={() => onPressPerson(t.userId)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`View ${t.name}'s profile`}
            >
              <Text style={styles.nameChipText} numberOfLines={1}>
                @{t.handle}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable
        style={[styles.badge, open && styles.badgeOpen]}
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide tagged people' : `Show ${tags.length} tagged ${tags.length === 1 ? 'person' : 'people'}`}
      >
        <Icon name="youTab" size={15} color="#ffffff" strokeWidth={2.5} />
      </Pressable>
    </>
  );
}

const LINE_PREVIEW_COUNT = 2;

export function PostTagsLine({
  tags,
  onPressPerson,
  style,
}: {
  tags: TaggedPerson[];
  onPressPerson: (userId: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);

  if (tags.length === 0) return null;
  const shown = expanded ? tags : tags.slice(0, LINE_PREVIEW_COUNT);
  const hidden = tags.length - shown.length;

  return (
    <View style={[styles.lineRow, style]}>
      <Icon name="youTab" size={12} color={colors.neutral[500]} strokeWidth={2.25} />
      <Text style={styles.lineText}>
        with{' '}
        {shown.map((t, i) => (
          <Text key={t.userId}>
            <Text style={styles.lineName} onPress={() => onPressPerson(t.userId)} accessibilityRole="link">
              @{t.handle}
            </Text>
            {i < shown.length - 1 ? ', ' : ''}
          </Text>
        ))}
        {hidden > 0 && (
          <Text style={styles.lineName} onPress={() => setExpanded(true)} accessibilityRole="button">
            {' '}+{hidden}
          </Text>
        )}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    badge: {
      position: 'absolute',
      left: 10,
      bottom: 10,
      width: 30,
      height: 30,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeOpen: {
      backgroundColor: 'rgba(0,0,0,0.8)',
    },
    overlayNames: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 48,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing[1],
    },
    nameChip: {
      maxWidth: '100%',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: Radius.sm,
      backgroundColor: 'rgba(0,0,0,0.72)',
    },
    nameChipText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 12.5,
      color: '#ffffff',
    },
    lineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 1,
    },
    lineText: {
      flexShrink: 1,
      fontFamily: Fonts.body,
      fontSize: 11.5,
      color: colors.neutral[500],
    },
    lineName: {
      fontFamily: Fonts.bodySemibold,
      color: colors.text,
    },
  });
