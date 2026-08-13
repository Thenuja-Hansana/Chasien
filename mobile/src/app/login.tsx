import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

// Apple/Google buttons and "Forgot password?" from the mock are left out
// here deliberately — neither has a backend yet (no OAuth app registered,
// no reset-password screen/deep link wired), and a button that does
// nothing on tap is worse than not showing it. See docs/phase/phase02.md.
export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.brand}>chasien</Text>
        <Text style={styles.tagline}>
          Small rooms, in order. Everything newest-first, nothing ranked.
        </Text>

        <View style={styles.fields}>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={Colors.neutral[500]}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <TextInput
            style={[styles.input, styles.passwordInput]}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={Colors.neutral[500]}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.bg} />
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  brand: {
    fontFamily: Fonts?.heading,
    fontSize: 38,
    color: Colors.text,
    marginBottom: Spacing[2],
  },
  tagline: {
    fontFamily: Fonts?.body,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.neutral[400],
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingHorizontal: 20,
    fontSize: 15,
    color: Colors.text,
    fontFamily: Fonts?.body,
  },
  passwordInput: {
    borderColor: Colors.accent.DEFAULT,
    borderWidth: 1.5,
  },
  error: {
    fontFamily: Fonts?.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    marginBottom: Spacing[3],
  },
  submitButton: {
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontFamily: Fonts?.heading,
    fontSize: 16,
    color: Colors.bg,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
  },
  footerText: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    color: Colors.neutral[400],
  },
  footerLink: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent[300],
  },
});
