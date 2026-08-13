import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
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

// Matches the CHECK constraint on profiles.handle (identity_and_rooms
// migration) — validated here too so a bad handle fails with a clear
// message before hitting the network, not as a raw constraint error
// surfaced through the signup response.
const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

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
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.heading}>Check your email</Text>
        <Text style={styles.tagline}>
          We sent a confirmation link to {email}. Open it to activate your account, then log in.
        </Text>
        <Link href="/login" style={styles.footerLink}>
          Back to login
        </Link>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.heading}>Create your account</Text>
        <Text style={styles.tagline}>This is how people find you across every room.</Text>

        <View style={styles.fields}>
          <View>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.neutral[500]}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
          </View>

          <View>
            <Text style={styles.label}>Handle</Text>
            <TextInput
              style={styles.input}
              value={handle}
              onChangeText={(v) => setHandle(v.replace(/\s/g, '').toLowerCase())}
              placeholder="lowercase, numbers, underscores"
              placeholderTextColor={Colors.neutral[500]}
              autoCapitalize="none"
            />
            <Text style={styles.hint}>
              {handle.length === 0 ? '3-30 characters, lowercase' : handleValid ? 'Looks good' : 'Lowercase letters, numbers, underscores only'}
            </Text>
          </View>

          <View>
            <Text style={styles.label}>Display name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={Colors.neutral[500]}
            />
          </View>

          <View>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={Colors.neutral[500]}
              secureTextEntry
              autoCapitalize="none"
            />
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
            <ActivityIndicator color={Colors.bg} />
          ) : (
            <Text style={styles.submitButtonText}>Create account</Text>
          )}
        </Pressable>
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
  centered: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
    gap: Spacing[3],
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[8],
  },
  heading: {
    fontFamily: Fonts?.heading,
    fontSize: 30,
    color: Colors.text,
    marginBottom: Spacing[2],
  },
  tagline: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    lineHeight: 21,
    color: Colors.neutral[400],
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
    color: Colors.neutral[500],
    marginBottom: Spacing[2],
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
  hint: {
    fontFamily: Fonts?.body,
    fontSize: 12,
    color: Colors.accent2[300],
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
    backgroundColor: Colors.divider,
  },
  strengthBarFilled: {
    backgroundColor: Colors.accent2.DEFAULT,
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
    borderColor: Colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.accent.DEFAULT,
    borderWidth: 0,
  },
  checkboxMark: {
    color: Colors.bg,
    fontSize: 13,
    fontWeight: '700',
  },
  agreeText: {
    flex: 1,
    fontFamily: Fonts?.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.neutral[400],
  },
  error: {
    fontFamily: Fonts?.body,
    fontSize: 13,
    color: Colors.accent.DEFAULT,
    marginTop: Spacing[3],
  },
  submitButton: {
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontFamily: Fonts?.heading,
    fontSize: 16,
    color: Colors.bg,
  },
  footer: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[8],
  },
  footerLink: {
    fontFamily: Fonts?.body,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent[300],
  },
});
