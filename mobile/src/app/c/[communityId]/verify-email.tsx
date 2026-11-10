import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import LoadError from '@/components/LoadError';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { fetchMyVerificationStatus, requestRoomVerification, type VerificationStatus } from '@/lib/domainVerification';
import { errorMessage } from '@/lib/errors';
import { useOnReconnect } from '@/lib/network';
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
  /** True once "Resend email" has gone through, until the next attempt. */
  const [resent, setResent] = useState(false);
  /**
   * True while someone replaces the address a link already went to. The
   * server keeps one link per person per Room and replaces it on every
   * send (request-room-verification), so the link sent to a mistyped
   * address stops working once a new one goes out.
   */
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id;

  const load = useCallback(() => {
      if (!userId) return;
      setError(null);
      // .catch() rather than try/catch: the React Compiler can't compile the
      // conditionals below inside a `try`, and skips the whole screen.
      const loadRoom = async () => {
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
      };
      loadRoom().catch((e) => {
        setError(errorMessage(e, 'Failed to load this Room.'));
      });
  }, [communityId, userId]);

  useFocusEffect(load);
  useOnReconnect(() => {
    if (room === 'loading') load();
  });

  if (!session) return null;

  async function handleSend() {
    if (room === 'loading' || !room || sending) return;
    // "Resend email" has no input to read from: it sends to the address the
    // link already went to. It used to read `email`, the input's state, like
    // the first send does. That worked right after sending, while the state
    // still held what was typed, and did nothing once the screen had been
    // left and reopened: the "check your inbox" state comes back from the
    // database, the input's state comes back empty, and this returned early.
    // Outside the try: the React Compiler can't compile a conditional in one.
    const awaiting = status && !status.verifiedAt && !changing ? status : null;
    const address = (awaiting ? awaiting.email : email).trim();
    if (!address) return;
    setSending(true);
    setError(null);
    setResent(false);
    // No `finally`: the React Compiler skips a component that has one, and
    // the catch handles every error, so this is equivalent.
    try {
      await requestRoomVerification(room.id, address);
      setStatus({ email: address.toLowerCase(), verifiedAt: null, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      setChanging(false);
      // The first send changes the whole screen. A resend changes nothing
      // on it, so it has to say that it happened.
      setResent(awaiting !== null);
    } catch (e) {
      setError(errorMessage(e, 'Could not send that verification email.'));
    }
    setSending(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="back" size={22} color={colors.text} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headingText}>Verify to join</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.content}>
        {room === 'loading' && error ? (
          <LoadError message={error} onRetry={load} />
        ) : room === 'loading' ? (
          <ActivityIndicator color={colors.accent.DEFAULT} style={styles.loading} />
        ) : !room ? (
          <EmptyState icon="alertCircle" message="Room not found." />
        ) : status && !status.verifiedAt && !changing ? (
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
            {resent && <Text style={styles.notice}>Sent again. Check your inbox.</Text>}
            <Pressable style={styles.secondaryButton} onPress={handleSend} disabled={sending}>
              {sending ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryButtonText}>Resend email</Text>}
            </Pressable>
            <Pressable
              onPress={() => {
                setEmail(status.email);
                setChanging(true);
                setError(null);
                setResent(false);
              }}
              disabled={sending}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>Use a different email</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.title}>{room.name}</Text>
            <Text style={styles.body}>
              {changing ? (
                <>
                  Enter the right address on <Text style={styles.accentText}>@{room.required_email_domain}</Text> and
                  we&apos;ll send a new link. The one already sent will stop working.
                </>
              ) : (
                <>
                  This Room only admits people with an email on{' '}
                  <Text style={styles.accentText}>@{room.required_email_domain}</Text>. Enter yours and we&apos;ll send a
                  link to confirm it.
                </>
              )}
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
            {changing && (
              <Pressable
                onPress={() => {
                  setChanging(false);
                  setError(null);
                }}
                disabled={sending}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={styles.linkText}>Cancel</Text>
              </Pressable>
            )}
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
  notice: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: colors.neutral[400],
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
  linkText: {
    marginTop: Spacing[3],
    fontFamily: Fonts.bodySemibold,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
    textDecorationLine: 'underline',
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
