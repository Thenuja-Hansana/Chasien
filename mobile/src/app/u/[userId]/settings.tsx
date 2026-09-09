import { router } from 'expo-router';
import { useMemo, useState, type ComponentProps } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { useThemeContext } from '@/lib/theme-context';

type IconName = ComponentProps<typeof Icon>['name'];
type Row = { icon: IconName; label: string; value?: string; subtitle?: string };
type Section = { title: string; rows: Row[] };

/**
 * Ported from Instagram's own "Settings and activity" screen — the
 * reference the user handed over as screenshots — trimmed to what's
 * relevant to a Room-based app instead of a Meta product: no Threads,
 * Edits, or "More from Meta" cross-promotion, no tablet-specific row, no
 * Family Centre/teen supervision, no Meta-branded subscriptions or
 * cross-posting. Every row below is a deliberate placeholder — the ask
 * was explicitly to build this screen's front end first and wire up the
 * real settings later, which is why tapping one surfaces an honest "not
 * built yet" instead of doing nothing (a button that does nothing on tap
 * reads as broken; this app's own standard elsewhere, e.g. Login's
 * dropped Apple/Google buttons, has always been to say so instead).
 * Dark Mode and Log out are the two exceptions — real, already-working
 * features carried over from the drawer this screen replaces
 * (SettingsDrawer, now deleted), kept outside the search filter below
 * since burying your only working toggle or your way out of the app
 * behind a search box would be a step backward from the old drawer.
 */
const SECTIONS: Section[] = [
  {
    title: 'Your account',
    rows: [{ icon: 'youTab', label: 'Account Centre', subtitle: 'Password, security, personal details, and more' }],
  },
  {
    title: 'How you use Chasien',
    rows: [
      { icon: 'bookmark', label: 'Saved' },
      { icon: 'history', label: 'Archive' },
      { icon: 'chartLine', label: 'Your activity' },
      { icon: 'bell', label: 'Notifications' },
      { icon: 'clock', label: 'Time management' },
    ],
  },
  {
    title: 'Who can see your content',
    rows: [
      { icon: 'lock', label: 'Account privacy', value: 'Public' },
      { icon: 'star', label: 'Close Friends', value: '0' },
    ],
  },
  {
    title: 'How others can interact with you',
    rows: [
      { icon: 'send', label: 'Messages and story replies' },
      { icon: 'tag', label: 'Tags and mentions' },
      { icon: 'comment', label: 'Comments' },
      { icon: 'noEntry', label: 'Restricted', value: '0' },
      { icon: 'alertCircle', label: 'Limit interactions', value: 'Off' },
      { icon: 'textLines', label: 'Hidden words' },
    ],
  },
  {
    title: 'What you see',
    rows: [
      { icon: 'star', label: 'Favourites', value: '0' },
      { icon: 'bellSlash', label: 'Muted accounts', value: '0' },
    ],
  },
  {
    title: 'Your app and media',
    rows: [
      { icon: 'device', label: 'Device permissions' },
      { icon: 'download', label: 'Archiving and downloading' },
      { icon: 'eye', label: 'Accessibility' },
      { icon: 'globe', label: 'Language and translations' },
      { icon: 'chartLine', label: 'Data usage and media quality' },
    ],
  },
  {
    title: 'Purchases and insights',
    rows: [
      { icon: 'chartLine', label: 'Account type and tools' },
      { icon: 'star', label: 'Manage subscription', value: 'Not subscribed' },
      { icon: 'receipt', label: 'Orders and payments' },
    ],
  },
  {
    title: 'More info and support',
    rows: [
      { icon: 'help', label: 'Help' },
      { icon: 'shield', label: 'Account Status' },
      { icon: 'lock', label: 'Privacy Policy' },
      { icon: 'info', label: 'About' },
    ],
  },
];

export default function SettingsAndActivity() {
  const colors = useTheme();
  const { mode, toggleMode } = useThemeContext();
  const { signOut } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.label.toLowerCase().includes(q)),
    })).filter((section) => section.rows.length > 0);
  }, [query]);

  function handleRowPress(label: string) {
    Alert.alert(label, "This isn't wired up yet — the front end came first.");
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable hitSlop={8} onPress={() => router.back()} style={styles.backButton}>
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.heading}>Settings and activity</Text>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={17} color={colors.neutral[400]} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={colors.neutral[500]}
          returnKeyType="search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Appearance</Text>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="moon" size={20} color={colors.text} strokeWidth={1.8} />
            </View>
            <Text style={styles.rowLabel}>Dark Mode</Text>
            <Switch
              value={mode === 'dark'}
              onValueChange={toggleMode}
              trackColor={{ false: colors.neutral[300], true: colors.accent.DEFAULT }}
            />
          </View>
        </View>

        {filteredSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            {section.rows.map((row) => (
              <Pressable key={row.label} style={styles.row} onPress={() => handleRowPress(row.label)}>
                <View style={styles.rowIcon}>
                  <Icon name={row.icon} size={20} color={colors.text} strokeWidth={1.8} />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {row.label}
                  </Text>
                  {row.subtitle && (
                    <Text style={styles.rowSubtitle} numberOfLines={2}>
                      {row.subtitle}
                    </Text>
                  )}
                </View>
                {row.value && <Text style={styles.rowValue}>{row.value}</Text>}
                <Icon name="chevronRight" size={16} color={colors.neutral[400]} strokeWidth={2.2} />
              </Pressable>
            ))}
          </View>
        ))}

        {query.trim().length > 0 && filteredSections.length === 0 && (
          <EmptyState icon="search" message={`No settings match "${query}"`} />
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Login</Text>
          <Pressable style={styles.row} onPress={() => signOut()}>
            <Text style={styles.logOutText}>Log out</Text>
          </Pressable>
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
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing[2],
      marginHorizontal: Spacing[6],
      marginTop: Spacing[2],
      marginBottom: Spacing[3],
      height: 42,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing[4],
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    searchInput: {
      flex: 1,
      fontFamily: Fonts.body,
      fontSize: 14.5,
      color: colors.text,
      height: '100%',
    },
    scrollContent: {
      paddingHorizontal: Spacing[6],
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
    rowTextWrap: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    // flex: 1 matters for the Dark Mode row above, where this Text is a
    // direct `row` child (no rowTextWrap) that needs to push the Switch to
    // the end; a no-op inside rowTextWrap's own already-flexed column.
    rowLabel: {
      flex: 1,
      fontFamily: Fonts.body,
      fontSize: 15,
      color: colors.text,
    },
    rowSubtitle: {
      fontFamily: Fonts.body,
      fontSize: 12.5,
      lineHeight: 17,
      color: colors.neutral[400],
    },
    rowValue: {
      fontFamily: Fonts.body,
      fontSize: 13.5,
      color: colors.neutral[400],
    },
    logOutText: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 15,
      color: colors.error,
    },
  });
