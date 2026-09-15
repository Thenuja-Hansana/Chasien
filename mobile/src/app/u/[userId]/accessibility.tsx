import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemeContext } from '@/lib/theme-context';

/**
 * Linked from Settings and activity's "Your app and media" > Accessibility
 * row — the one row in that list that's real instead of the section's
 * usual "not wired up yet" alert. Dark Mode used to live inline on the
 * main Settings screen under an "Appearance" heading; it moved to its own
 * screen so Accessibility behaves like every other row there (tap ->
 * dedicated screen) instead of being a special case rendered above the
 * list.
 */
export default function Accessibility() {
  const colors = useTheme();
  const { mode, toggleMode } = useThemeContext();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.heading}>Accessibility</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Display</Text>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="moon" size={20} color={colors.text} strokeWidth={1.8} />
            </View>
            <Text style={styles.rowLabel}>Dark Mode</Text>
            <Switch
              value={mode === 'dark'}
              onValueChange={toggleMode}
              accessibilityLabel="Dark Mode"
              trackColor={{ false: colors.neutral[300], true: colors.accent.DEFAULT }}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[2],
      paddingHorizontal: Spacing[6],
      paddingTop: Spacing[4],
      paddingBottom: Spacing[2],
    },
    backButton: {
      marginLeft: -Spacing[1],
    },
    heading: {
      fontFamily: Fonts.heading,
      fontSize: 20,
      color: colors.text,
    },
    scrollContent: {
      paddingHorizontal: Spacing[6],
      paddingTop: Spacing[3],
      paddingBottom: Spacing[8],
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    section: {
      paddingTop: Spacing[4],
      paddingBottom: Spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    sectionLabel: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 13,
      color: colors.neutral[500],
      marginBottom: Spacing[2],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[3],
      paddingVertical: 11,
    },
    rowIcon: {
      width: 26,
      alignItems: 'center',
    },
    // flex: 1 pushes the trailing Switch to the row's end — this Text is a
    // direct `row` child, not wrapped in a rowTextWrap column like a
    // navigational row with a subtitle would use.
    rowLabel: {
      flex: 1,
      fontFamily: Fonts.body,
      fontSize: 15,
      color: colors.text,
    },
  });
