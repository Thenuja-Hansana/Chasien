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

// Apple/Google buttons and "Forgot password?" from the mock are left out
// here deliberately — neither has a backend yet (no OAuth app registered,
// no reset-password screen/deep link wired), and a button that does
// nothing on tap is worse than not showing it. See docs/phase/phase02.md.
export default function Login() {
  const { signIn } = useAuth();
  const colors = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const emailFocus = useFocusHighlight();
  const passwordFocus = useFocusHighlight();

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (signInError) {
      setError(
        signInError.message === 'Email not confirmed'
          ? 'Check your email for a confirmation link before logging in.'
          : 'Wrong email or password.',
      );
      return;
    }
    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Text style={styles.brand}>chasien</Text>
            <Text style={styles.tagline}>
              Small rooms, in order. Everything newest-first, nothing ranked.
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
              <View style={[styles.passwordWrap, passwordFocus.focused && styles.inputFocused]}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={passwordFocus.onFocus}
                  onBlur={passwordFocus.onBlur}
                  placeholder="Password"
                  placeholderTextColor={colors.neutral[500]}
                  secureTextEntry={!passwordVisible}
                  autoCapitalize="none"
                  autoComplete="password"
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
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.submitButtonText}>Log in</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New here? </Text>
            <Link href="/signup" style={styles.footerLink}>
              Create an account
            </Link>
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
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  brand: {
    fontFamily: Fonts?.heading,
    fontSize: 38,
    color: colors.text,
    marginBottom: Spacing[2],
  },
  tagline: {
    fontFamily: Fonts?.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[400],
    maxWidth: 280,
    marginBottom: Spacing[8],
  },
  fields: {
    gap: Spacing[3],
    marginBottom: Spacing[4],
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
  // Applied to whichever field currently has focus — previously
  // hardcoded onto the password field permanently, regardless of focus.
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
  error: {
    fontFamily: Fonts?.body,
    fontSize: 13,
    color: colors.accent.DEFAULT,
    marginBottom: Spacing[3],
  },
  submitButton: {
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontFamily: Fonts?.heading,
    fontSize: 16,
    color: colors.bg,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[4],
    paddingBottom: Spacing[4],
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  footerText: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: colors.neutral[400],
  },
  footerLink: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent[300],
  },
});
