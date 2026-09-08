import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchMyVerificationStatus, requestRoomVerification, type VerificationStatus } from '@/lib/domainVerification';
import { fetchMyMembership, fetchRoomBySlug, type Room } from '@/lib/rooms';

/**
 * The join flow for a Domain Verified Room — reached from Discover,
 * Search, or the Room's own "not a member yet" screen whenever
 * room.visibility === 'domain_verified' (none of them call joinRoom()
 * directly for this visibility; see each one's handleJoin()). Sending
 * the email and actually granting membership both happen server-side
 * (request-room-verification / verify-room-email Edge Functions) — this
 * screen only collects the address and reflects whatever state comes
 * back.
 */
export default function VerifyEmail() {
  const { session } = useAuth();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const emailFocus = useFocusHighlight();

  const [room, setRoom] = useState<Room | null | 'loading'>('loading');
  const [status, setStatus] = useState<VerificationStatus>(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      (async () => {
        try {
          const r = await fetchRoomBySlug(communityId);
          setRoom(r);
          if (!r) return;

          const membership = await fetchMyMembership(r.id, userId);
          if (membership?.join_state === 'approved') {
            router.replace({ pathname: '/c/[communityId]', params: { communityId } });
            return;
          }

          const existing = await fetchMyVerificationStatus(r.id, userId);
          setStatus(existing);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load this Room.');
        }
      })();
    }, [communityId, userId]),
  );

  if (!session) return null;

  async function handleSend() {
    if (room === 'loading' || !room || !email.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await requestRoomVerification(room.id, email.trim());
      setStatus({ email: email.trim().toLowerCase(), verifiedAt: null, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that verification email.');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headingText}>Verify to join</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        {room === 'loading' ? (
          <ActivityIndicator color={colors.accent.DEFAULT} style={styles.loading} />
        ) : !room ? (
          <Text style={styles.body}>Room not found.</Text>
        ) : status && !status.verifiedAt ? (
          <View style={styles.sentState}>
            <View style={styles.iconCircle}>
              <Icon name="mail" size={26} color={colors.accent.DEFAULT} />
            </View>
            <Text style={styles.title}>Check your inbox</Text>
            <Text style={styles.body}>
              We sent a verification link to <Text style={styles.accentText}>{status.email}</Text>. Click it to join{' '}
              {room.name} — you can close this screen and come back later.
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable style={styles.secondaryButton} onPress={handleSend} disabled={sending}>
              {sending ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryButtonText}>Resend email</Text>}
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.title}>{room.name}</Text>
            <Text style={styles.body}>
              This Room only admits people with an email on{' '}
              <Text style={styles.accentText}>@{room.required_email_domain}</Text>. Enter yours and we&apos;ll send a link
              to confirm it.
            </Text>

            <TextInput
              style={[styles.input, emailFocus.focused && styles.inputFocused]}
              value={email}
              onChangeText={setEmail}
              onFocus={emailFocus.onFocus}
              onBlur={emailFocus.onBlur}
              placeholder={`you@${room.required_email_domain}`}
              placeholderTextColor={colors.neutral[500]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={styles.submitButton} onPress={handleSend} disabled={!email.trim() || sending}>
              {sending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitButtonText}>Send verification email</Text>}
            </Pressable>
          </>
        )}
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
    paddingBottom: Spacing[4],
  },
  headingText: {
    fontFamily: Fonts.heading,
    fontSize: 17,
    color: colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  loading: {
    marginTop: Spacing[8],
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    color: colors.text,
    marginBottom: Spacing[2],
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral[400],
    marginBottom: Spacing[6],
  },
  accentText: {
    color: colors.accent2[300],
    fontWeight: '600',
  },
  input: {
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 20,
    fontSize: 15,
    color: colors.text,
    fontFamily: Fonts.body,
    marginBottom: Spacing[3],
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    marginBottom: Spacing[3],
  },
  submitButton: {
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontFamily: Fonts.heading,
    fontSize: 15,
    color: colors.bg,
  },
  sentState: {
    alignItems: 'center',
    paddingTop: Spacing[8],
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: `${colors.accent.DEFAULT}1A`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing[4],
  },
  secondaryButton: {
    height: 48,
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
});
