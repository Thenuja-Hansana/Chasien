import { useMemo, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { Fonts, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The one icon+heading+subtext(+action) shape for every "nothing here"
 * screen — Home, Discover, Search, Notifications each drew their own ad
 * hoc empty state before this (some with a heading and a button, some
 * just a line of gray text), which is exactly the inconsistency the
 * design audit's "Fixes at a glance" flagged. `heading` is optional for
 * the narrower case — a filtered list that came back empty inside a
 * screen that already has content elsewhere (e.g. one Explore category)
 * doesn't need the full weight of a heading, just the icon and a reason.
 */
export default function EmptyState({
  icon,
  heading,
  message,
  actionLabel,
  onAction,
}: {
  icon: ComponentProps<typeof Icon>['name'];
  heading?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={24} color={colors.text} strokeWidth={2} />
      </View>
      {heading ? <Text style={styles.heading}>{heading}</Text> : null}
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable style={styles.action} onPress={onAction}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      gap: Spacing[2],
      paddingHorizontal: Spacing[6],
      paddingVertical: Spacing[6],
    },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: Radius.pill,
      backgroundColor: `${colors.text}0F`,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing[1],
    },
    heading: {
      fontFamily: Fonts.heading,
      fontSize: 18,
      color: colors.text,
      textAlign: 'center',
    },
    message: {
      fontFamily: Fonts.body,
      fontSize: 13,
      lineHeight: 19,
      color: colors.neutral[400],
      textAlign: 'center',
      maxWidth: 260,
    },
    action: {
      marginTop: Spacing[2],
      height: 44,
      paddingHorizontal: Spacing[6],
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionText: {
      fontFamily: Fonts.heading,
      fontSize: 15,
      color: colors.bg,
    },
  });
