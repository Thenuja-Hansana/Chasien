import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { SUPPORT_EMAIL } from '@/constants/contact';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteAccountAsAdmin, lookupAccountByEmail, type DeletionResult, type FoundAccount } from '@/lib/account';
import { errorMessage } from '@/lib/errors';
import { fetchAmIAppAdmin } from '@/lib/reports';

/**
 * App admins only (Phase 9): deleting an account someone asked about by
 * email, for people who can't use the app (Google Play requires a way to
 * ask without it). Find the account by the address the request came from,
 * then delete it the same way Settings → Delete account does. The server
 * checks the caller is an app admin and refuses another admin's account;
 * this screen only decides what to show.
 */
export default function AdminDeleteAccount() {
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState<FoundAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ handle: string; result: DeletionResult } | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchAmIAppAdmin()
        .then(setIsAdmin)
        .catch(() => setIsAdmin(false));
    }, []),
  );

  function handleLookup() {
    setBusy(true);
    setError(null);
    setAccount(null);
    setResult(null);
    lookupAccountByEmail(email)
      .then(setAccount)
      .catch((e) => setError(errorMessage(e, 'Could not look that up.')))
      .finally(() => setBusy(false));
  }

  function handleDelete() {
    const target = account;
    setConfirming(false);
    if (!target) return;
    setBusy(true);
    setError(null);
    deleteAccountAsAdmin(target.userId)
      .then((r) => {
        setResult({ handle: target.handle, result: r });
        setAccount(null);
        setEmail('');
      })
      .catch((e) => setError(errorMessage(e, 'Could not delete that account.')))
      .finally(() => setBusy(false));
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.headerSide} hitSlop={8} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Delete an account
        </Text>
        <View style={styles.headerSide} />
      </View>

      {isAdmin === false ? (
        <EmptyState icon="shield" heading="App admins only" message="Accounts are deleted on request by the people who run Chasien." />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.body}>
              For deletion requests emailed to {SUPPORT_EMAIL}. Only act on a request sent from the address the account signed up
              with, and check it really is that account before deleting.
            </Text>

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Their email address"
              placeholderTextColor={colors.neutral[500]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
            />
            <Pressable
              style={[styles.button, (!email.trim() || busy) && styles.buttonDisabled]}
              onPress={handleLookup}
              disabled={!email.trim() || busy}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Find account</Text>
            </Pressable>

            {busy && <ActivityIndicator style={styles.spinner} color={colors.neutral[500]} />}
            {error && <Text style={styles.error}>{error}</Text>}

            {account && (
              <View style={styles.card}>
                <Text style={styles.cardName}>{account.name}</Text>
                <Text style={styles.cardHandle}>@{account.handle}</Text>
                {account.isAppAdmin ? (
                  <Text style={styles.body}>This is an app admin. Their account can&apos;t be deleted from here.</Text>
                ) : (
                  <Pressable
                    style={[styles.deleteButton, busy && styles.buttonDisabled]}
                    onPress={() => setConfirming(true)}
                    disabled={busy}
                    accessibilityRole="button"
                  >
                    <Text style={styles.deleteButtonText}>Delete this account</Text>
                  </Pressable>
                )}
              </View>
            )}

            {result && (
              <View style={styles.card}>
                <Text style={styles.cardName}>Deleted @{result.handle}</Text>
                <Text style={styles.body}>
                  {result.result.summary.posts} posts, {result.result.summary.comments} comments, {result.result.summary.messages} messages
                  and {result.result.summary.stories} stories deleted. Rooms handed on: {result.result.summary.rooms_handed_over}; Rooms
                  deleted: {result.result.summary.rooms_deleted}. Files removed: {result.result.files.removed}
                  {result.result.files.failed > 0 ? ` (${result.result.files.failed} couldn't be removed)` : ''}.
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <ConfirmModal
        visible={confirming}
        title={`Delete @${account?.handle ?? ''}'s account?`}
        body="Everything they posted is deleted, and Rooms they own are handed on. This can't be undone."
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
      gap: Spacing[3],
    },
    body: {
      fontFamily: Fonts.body,
      fontSize: 14.5,
      lineHeight: 21,
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
    button: {
      height: 48,
      borderRadius: Radius.pill,
      backgroundColor: colors.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    buttonText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 15,
      color: colors.bg,
    },
    spinner: {
      alignSelf: 'flex-start',
    },
    error: {
      fontFamily: Fonts.body,
      fontSize: 13.5,
      color: colors.error,
    },
    card: {
      padding: Spacing[4],
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.divider,
      gap: Spacing[2],
    },
    cardName: {
      fontFamily: Fonts.bodyBold,
      fontSize: 16,
      color: colors.text,
    },
    cardHandle: {
      fontFamily: Fonts.body,
      fontSize: 14,
      color: colors.neutral[700],
    },
    deleteButton: {
      marginTop: Spacing[2],
      height: 46,
      borderRadius: Radius.pill,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteButtonText: {
      fontFamily: Fonts.bodyBold,
      fontSize: 15,
      color: colors.bg,
    },
  });
