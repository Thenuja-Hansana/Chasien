import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ConfirmModal from '@/components/ConfirmModal';
import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteMyAccount, fetchDeletionPreview, type OwnedRoomPreview } from '@/lib/account';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/errors';

const DELETED = [
  'Your profile, and your name and handle',
  'Your posts, comments and stories, and the comments on them',
  'Your chat messages, and your direct message conversations, for both people',
  'Your likes, reactions, friends and blocks',
];

/**
 * Settings → Delete account (Phase 9; Apple 5.1.1(v), Google Play's User
 * Data policy). Says exactly what goes and what stays, shows who takes over
 * each Room the person owns, and asks for the password again: the server
 * only deletes an account whose password was entered in the last few
 * minutes (see lib/account.ts and the delete-account Edge Function).
 */
export default function DeleteAccount() {
  const { session } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rooms, setRooms] = useState<OwnedRoomPreview[] | null>(null);
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchDeletionPreview()
        .then(setRooms)
        .catch((e) => setError(errorMessage(e, 'Could not load your Rooms.')));
    }, []),
  );

  const email = session?.user.email;
  if (!session || !email) return null;

  function handleDelete() {
    if (!email) return;
    setConfirming(false);
    setDeleting(true);
    setError(null);
    deleteMyAccount(email, password)
      .then(() => router.replace('/login'))
      .catch((e) => {
        setError(errorMessage(e, 'Could not delete your account. Try again.'));
        setDeleting(false);
      });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerSide}
          hitSlop={8}
          onPress={() => router.back()}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Delete account
        </Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>Deleting your account is permanent. It can&apos;t be undone.</Text>

          <Text style={styles.sectionTitle}>What&apos;s deleted</Text>
          {DELETED.map((line) => (
            <View key={line} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={[styles.body, styles.bulletText]}>{line}</Text>
            </View>
          ))}

          <Text style={styles.sectionTitle}>What&apos;s kept</Text>
          <Text style={styles.body}>
            Reports you filed stay, without your name. Reports about you keep what was reported, as a safety record.
          </Text>

          <Text style={styles.sectionTitle}>Rooms you own</Text>
          {rooms === null ? (
            <ActivityIndicator style={styles.loading} color={colors.neutral[500]} />
          ) : rooms.length === 0 ? (
            <Text style={styles.body}>You don&apos;t own any Rooms.</Text>
          ) : (
            rooms.map((room) => (
              <View key={room.roomId} style={styles.roomRow}>
                <Text style={styles.roomName} numberOfLines={1}>
                  {room.roomName}
                </Text>
                <Text style={styles.roomFate} numberOfLines={2}>
                  {room.successorHandle ? `Goes to @${room.successorHandle}` : "Deleted: nobody else is in it"}
                </Text>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>Enter your password to continue</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.neutral[500]}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!deleting}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.deleteButton, (!password || deleting) && styles.deleteButtonDisabled]}
            onPress={() => setConfirming(true)}
            disabled={!password || deleting}
            accessibilityRole="button"
          >
            {deleting ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.deleteButtonText}>Delete my account</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={confirming}
        title="Delete your account?"
        body="Everything listed here is deleted for good. This can't be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirming(false)}
        onConfirm={handleDelete}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing[4],
      paddingTop: Spacing[4],
      paddingBottom: Spacing[3],
    },
    headerSide: {
      width: 32,
    },
    headerTitle: {
      fontFamily: Fonts.bodyBold,
      fontSize: 18,
      color: colors.text,
    },
    content: {
      paddingHorizontal: Spacing[6],
      paddingBottom: Spacing[8],
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    lead: {
      marginTop: Spacing[2],
      fontFamily: Fonts.bodySemibold,
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    sectionTitle: {
      marginTop: Spacing[6],
      marginBottom: Spacing[2],
      fontFamily: Fonts.bodyBold,
      fontSize: 15,
      color: colors.text,
    },
    // neutral[700], like the guidelines: readable paragraphs, not captions.
    body: {
      fontFamily: Fonts.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: colors.neutral[700],
    },
    bulletRow: {
      flexDirection: 'row',
      gap: Spacing[2],
    },
    bullet: {
      fontFamily: Fonts.body,
      fontSize: 14.5,
      lineHeight: 21,
      color: colors.neutral[700],
    },
    bulletText: {
      flex: 1,
    },
    loading: {
      alignSelf: 'flex-start',
    },
    roomRow: {
      paddingVertical: Spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      gap: 2,
    },
    roomName: {
      fontFamily: Fonts.bodySemibold,
      fontSize: 15,
      color: colors.text,
    },
    roomFate: {
      fontFamily: Fonts.body,
      fontSize: 13.5,
      color: colors.neutral[700],
    },
    input: {
      height: 52,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
      paddingHorizontal: 20,
      fontFamily: Fonts.body,
      fontSize: 16,
      color: colors.text,
    },
    error: {
      marginTop: Spacing[3],
      fontFamily: Fonts.body,
      fontSize: 13.5,
      color: colors.error,
    },
    deleteButton: {
      marginTop: Spacing[4],
      height: 50,
      borderRadius: Radius.pill,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteButtonDisabled: {
      opacity: 0.4,
    },
    deleteButtonText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 15,
      color: colors.bg,
    },
  });
