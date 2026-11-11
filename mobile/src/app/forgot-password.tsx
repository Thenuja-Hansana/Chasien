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
import Icon from '@/components/Icon';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useResendCooldown } from '@/hooks/use-resend-cooldown';
import { useTheme } from '@/hooks/use-theme';
import {
  CODE_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  codeErrorMessage,
  sendPasswordResetCode,
  setNewPassword,
  verifyPasswordResetCode,
} from '@/lib/auth-codes';

/** The same minimum Auth enforces (`minimum_password_length`, supabase/config.toml) and signup checks. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * "Forgot password?" (Phase 11 slice 2; before this, someone who forgot
 * their password was locked out for good). Two steps: the email, then the
 * 6-digit code from it together with the new password. A correct code
 * signs the person in, and the new password is set straight after; if
 * that second call fails, the code isn't asked for again.
 *
 * A public route in AuthGate (app/_layout.tsx), so the session the code
 * creates doesn't bounce this screen to Home before the password is set.
 */
export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const colors = useTheme();
  const styles = useMemo(() => makeAuthStyles(colors), [colors]);
  const emailFocus = useFocusHighlight();
  const codeFocus = useFocusHighlight();
  const passwordFocus = useFocusHighlight();
  const cooldown = useResendCooldown(RESEND_COOLDOWN_SECONDS);

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  /** The code was accepted (so the person is signed in) but the password isn't set yet. */
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const address = email.trim();
  const canSetPassword = (codeAccepted || code.length === CODE_LENGTH) && password.length >= MIN_PASSWORD_LENGTH;

  async function handleSendCode() {
    if (!address || busy || cooldown.left > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // No `finally`: the React Compiler skips a component that has one.
    try {
      await sendPasswordResetCode(address);
      if (step === 'code') setNotice('We sent a new code. The old one no longer works.');
      setStep('code');
      cooldown.start();
    } catch (e) {
      setError(codeErrorMessage(e, 'Could not send a code. Try again.'));
    }
    setBusy(false);
  }

  async function handleSetPassword() {
    if (!canSetPassword || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!codeAccepted) {
        await verifyPasswordResetCode(address, code);
        setCodeAccepted(true);
      }
      await setNewPassword(password);
      router.replace('/');
    } catch (e) {
      setError(codeErrorMessage(e, 'Could not change your password. Try again.'));
    }
    setBusy(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Text style={styles.heading}>Reset your password</Text>

            {step === 'email' ? (
              <>
                <Text style={styles.tagline}>
                  Enter the email you signed up with and we&apos;ll send you a {CODE_LENGTH}-digit code.
                </Text>
                <View style={styles.fields}>
                  <TextInput
                    style={[styles.input, emailFocus.focused && styles.inputFocused]}
                    value={email}
                    onChangeText={setEmail}
                    onFocus={emailFocus.onFocus}
                    onBlur={emailFocus.onBlur}
                    placeholder="Email"
                    placeholderTextColor={colors.neutral[500]}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                  />
                </View>
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable
                  style={[styles.submitButton, (!address || busy) && styles.submitButtonDisabled]}
                  onPress={handleSendCode}
                  disabled={!address || busy}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitButtonText}>Send code</Text>}
                </Pressable>
                <View style={styles.links}>
                  <Link href="/login" style={styles.linkMuted}>
                    Back to login
                  </Link>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.tagline}>
                  If there&apos;s an account for <Text style={styles.strong}>{address}</Text>, we sent it a{' '}
                  {CODE_LENGTH}-digit code. Type it here with your new password.
                </Text>
                <View style={styles.fields}>
                  {!codeAccepted && (
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
                      accessibilityLabel="Reset code"
                    />
                  )}
                  <View style={[styles.passwordWrap, passwordFocus.focused && styles.inputFocused]}>
                    <TextInput
                      style={styles.passwordInput}
                      value={password}
                      onChangeText={setPassword}
                      onFocus={passwordFocus.onFocus}
                      onBlur={passwordFocus.onBlur}
                      placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
                      placeholderTextColor={colors.neutral[500]}
                      secureTextEntry={!passwordVisible}
                      autoCapitalize="none"
                      autoComplete="new-password"
                    />
                    <Pressable
                      onPress={() => setPasswordVisible((v) => !v)}
                      hitSlop={10}
                      style={styles.eyeButton}
                      accessibilityRole="button"
                      accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                    >
                      <Icon name={passwordVisible ? 'eyeOff' : 'eye'} size={19} color={colors.neutral[500]} />
                    </Pressable>
                  </View>
                </View>
                {error && <Text style={styles.error}>{error}</Text>}
                {notice && <Text style={styles.notice}>{notice}</Text>}
                <Pressable
                  style={[styles.submitButton, (!canSetPassword || busy) && styles.submitButtonDisabled]}
                  onPress={handleSetPassword}
                  disabled={!canSetPassword || busy}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitButtonText}>Set new password</Text>}
                </Pressable>
                {!codeAccepted && (
                  <View style={styles.links}>
                    {cooldown.left > 0 ? (
                      <Text style={styles.linkMuted}>Send a new code in {cooldown.left}s</Text>
                    ) : (
                      <Pressable onPress={handleSendCode} disabled={busy} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.link}>Send a new code</Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() => {
                        setStep('email');
                        setCode('');
                        setError(null);
                        setNotice(null);
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>Use a different email</Text>
                    </Pressable>
                    <Link href="/login" style={styles.linkMuted}>
                      Back to login
                    </Link>
                  </View>
                )}
              </>
            )}

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
