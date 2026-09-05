import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useFocusHighlight } from '@/hooks/use-focus-highlight';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';

// Matches the CHECK constraint on profiles.handle (identity_and_rooms
// migration) — validated here too so a bad handle fails with a clear
// message before hitting the network, not as a raw constraint error
// surfaced through the signup response.
const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

export default function SignUp() {
  const { signUp } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const emailFocus = useFocusHighlight();
  const handleFocus = useFocusHighlight();
  const nameFocus = useFocusHighlight();
  const passwordFocus = useFocusHighlight();

  const handleValid = HANDLE_PATTERN.test(handle);
  const canSubmit = email.trim().length > 0 && handleValid && name.trim().length > 0 && password.length >= 6 && agree;

  const strength = useMemo(() => Math.min(4, Math.max(password.length === 0 ? 0 : 1, Math.ceil(password.length / 3))), [password]);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setError(null);
    setSubmitting(true);
    const { data, error: signUpError } = await signUp({
      email: email.trim(),
      password,
      handle: handle.trim(),
      name: name.trim(),
    });
    setSubmitting(false);

    if (signUpError) {
      setError(
        signUpError.message.includes('already registered')
          ? 'An account with that email already exists.'
          : signUpError.message.includes('duplicate') || signUpError.message.includes('handle_format')
            ? 'That handle is taken or invalid — try another.'
            : signUpError.message,
      );
      return;
    }

    // enable_confirmations = true locally (supabase/config.toml) means
    // signUp() succeeds without a session until the email is confirmed —
    // this is the expected path, not an error.
    if (!data.session) {
      setCheckEmail(true);
      return;
    }

    router.replace('/');
  }

  if (checkEmail) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={['top', 'bottom']}>
        <Text style={styles.heading}>Check your email</Text>
        <Text style={styles.tagline}>
          We sent a confirmation link to {email}. Open it to activate your account, then log in.
        </Text>
        <Link href="/login" style={styles.footerLink}>
          Back to login
        </Link>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Text style={styles.heading}>Create your account</Text>
            <Text style={styles.tagline}>This is how people find you across every room.</Text>

            <View style={styles.fields}>
              <View>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={[styles.input, emailFocus.focused && styles.inputFocused]}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={emailFocus.onFocus}
                  onBlur={emailFocus.onBlur}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.neutral[500]}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                />
              </View>

              <View>
                <Text style={styles.label}>Handle</Text>
                <TextInput
                  style={[styles.input, handleFocus.focused && styles.inputFocused]}
                  value={handle}
                  onChangeText={(v) => setHandle(v.replace(/\s/g, '').toLowerCase())}
                  onFocus={handleFocus.onFocus}
                  onBlur={handleFocus.onBlur}
                  placeholder="lowercase, numbers, underscores"
                  placeholderTextColor={colors.neutral[500]}
                  autoCapitalize="none"
                />
                <Text style={styles.hint}>
                  {handle.length === 0 ? '3-30 characters, lowercase' : handleValid ? 'Looks good' : 'Lowercase letters, numbers, underscores only'}
                </Text>
              </View>

              <View>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  style={[styles.input, nameFocus.focused && styles.inputFocused]}
                  value={name}
                  onChangeText={setName}
                  onFocus={nameFocus.onFocus}
                  onBlur={nameFocus.onBlur}
                  placeholder="Your name"
                  placeholderTextColor={colors.neutral[500]}
                />
              </View>

              <View>
                <Text style={styles.label}>Password</Text>
                <View style={[styles.passwordWrap, passwordFocus.focused && styles.inputFocused]}>
                  <TextInput
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    onFocus={passwordFocus.onFocus}
                    onBlur={passwordFocus.onBlur}
                    placeholder="At least 6 characters"
                    placeholderTextColor={colors.neutral[500]}
                    secureTextEntry={!passwordVisible}
                    autoCapitalize="none"
                  />
                  <Pressable
                    onPress={() => setPasswordVisible((v) => !v)}
                    hitSlop={10}
                    style={styles.eyeButton}
                    accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={passwordVisible ? 'eyeOff' : 'eye'} size={19} color={colors.neutral[500]} />
                  </Pressable>
                </View>
                <View style={styles.strengthRow}>
                  {[0, 1, 2, 3].map((i) => (
                    <View
                      key={i}
                      style={[styles.strengthBar, i < strength && styles.strengthBarFilled]}
                    />
                  ))}
                </View>
              </View>
            </View>

            <Pressable style={styles.agreeRow} onPress={() => setAgree((v) => !v)}>
              <View style={[styles.checkbox, agree && styles.checkboxChecked]}>
                {agree && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={styles.agreeText}>I&apos;m 16 or older and accept the community guidelines.</Text>
            </Pressable>

            {error && <Text style={styles.error}>{error}</Text>}
          </View>

          <View style={styles.footer}>
            <Pressable
              style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.submitButtonText}>Create account</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  centered: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
    gap: Spacing[3],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[8],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  heading: {
    fontFamily: Fonts?.heading,
    fontSize: 30,
    color: colors.text,
    marginBottom: Spacing[2],
  },
  tagline: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[400],
    marginBottom: Spacing[6],
  },
  fields: {
    gap: Spacing[4],
  },
  label: {
    fontFamily: Fonts?.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.neutral[500],
    marginBottom: Spacing[2],
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
    fontFamily: Fonts?.body,
  },
  inputFocused: {
    borderColor: colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingLeft: 20,
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    fontFamily: Fonts?.body,
    height: '100%',
  },
  eyeButton: {
    paddingHorizontal: 16,
    height: '100%',
    justifyContent: 'center',
  },
  hint: {
    fontFamily: Fonts?.body,
    fontSize: 12,
    color: colors.accent2[300],
    marginTop: Spacing[2],
    paddingLeft: 6,
  },
  strengthRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: Spacing[2],
    paddingHorizontal: 6,
  },
  strengthBar: {
    flex: 1,
    height: 3,
    borderRadius: Radius.pill,
    backgroundColor: colors.divider,
  },
  strengthBarFilled: {
    backgroundColor: colors.accent2.DEFAULT,
  },
  agreeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
    marginTop: Spacing[6],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent.DEFAULT,
    borderWidth: 0,
  },
  checkboxMark: {
    color: colors.bg,
    fontSize: 13,
    fontWeight: '700',
  },
  agreeText: {
    flex: 1,
    fontFamily: Fonts?.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.neutral[400],
  },
  error: {
    fontFamily: Fonts?.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    marginTop: Spacing[3],
  },
  submitButton: {
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontFamily: Fonts?.heading,
    fontSize: 16,
    color: colors.bg,
  },
  footer: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[4],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  footerLink: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent[300],
  },
});
