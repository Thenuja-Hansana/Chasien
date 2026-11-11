import { Link, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { makeAuthStyles } from '@/components/auth/auth-styles';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useResendCooldown } from '@/hooks/use-resend-cooldown';
import { useTheme } from '@/hooks/use-theme';
import {
  CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  codeErrorMessage,
  confirmSignupCode,
  resendSignupCode,
} from '@/lib/auth-codes';

/**
 * Finishing signup with the 6-digit code from the confirmation email
 * (Phase 11 slice 2). Reached from signup, and from login when the account
 * isn't confirmed yet; either way a code has just been sent, so the
 * countdown to "Send a new code" starts on arrival. A correct code signs
 * the person in, and AuthGate (app/_layout.tsx) takes them to Home: this
 * is one of its auth routes.
 */
export default function ConfirmEmail() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeAuthStyles(colors), [colors]);
  const codeFocus = useFocusHighlight();
  const cooldown = useResendCooldown(RESEND_COOLDOWN_SECONDS, true);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleResend() {
    if (!email || resending || cooldown.left > 0) return;
    setResending(true);
    setError(null);
    setNotice(null);
    // No `finally`: the React Compiler skips a component that has one.
    try {
      await resendSignupCode(email);
      setNotice('We sent a new code. The old one no longer works.');
      cooldown.start();
    } catch (e) {
      setError(codeErrorMessage(e, 'Could not send a new code. Try again.'));
    }
    setResending(false);
  }

  async function handleConfirm() {
    if (code.length !== CODE_LENGTH || submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await confirmSignupCode(email, code);
      // Signed in now; AuthGate moves on to Home.
    } catch (e) {
      setError(codeErrorMessage(e, 'Could not confirm that code. Try again.'));
    }
    setSubmitting(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Text style={styles.heading}>Check your email</Text>
            <Text style={styles.tagline}>
              We sent a {CODE_LENGTH}-digit code to <Text style={styles.strong}>{email}</Text>. Type it here to finish
              creating your account.
            </Text>

            <View style={styles.fields}>
              <TextInput
                style={[styles.codeInput, codeFocus.focused && styles.inputFocused]}
                value={code}
                onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                onFocus={codeFocus.onFocus}
                onBlur={codeFocus.onBlur}
                placeholder={'•'.repeat(CODE_LENGTH)}
                placeholderTextColor={colors.neutral[500]}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={CODE_LENGTH}
                autoFocus
                accessibilityLabel="Confirmation code"
              />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}
            {notice && <Text style={styles.notice}>{notice}</Text>}

            <Pressable
              style={[styles.submitButton, (code.length !== CODE_LENGTH || submitting) && styles.submitButtonDisabled]}
              onPress={handleConfirm}
              disabled={code.length !== CODE_LENGTH || submitting}
              accessibilityRole="button"
            >
              {submitting ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitButtonText}>Confirm</Text>}
            </Pressable>

            <View style={styles.links}>
              {cooldown.left > 0 ? (
                <Text style={styles.linkMuted}>Send a new code in {cooldown.left}s</Text>
              ) : (
                <Pressable onPress={handleResend} disabled={resending} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.link}>{resending ? 'Sending…' : 'Send a new code'}</Text>
                </Pressable>
              )}
              <Pressable onPress={() => router.replace('/signup')} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>Wrong address? Sign up again</Text>
              </Pressable>
              <Link href="/login" style={styles.linkMuted}>
                Back to login
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
