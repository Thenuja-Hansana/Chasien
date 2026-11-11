import { StyleSheet } from 'react-native';

import { Fonts, MaxContentWidth, Radius, Spacing, type ThemeColors } from '@/constants/theme';

/**
 * Styles for the two code screens (Phase 11 slice 2: app/confirm-email.tsx
 * and app/forgot-password.tsx), the same look as login and signup, whose
 * own copies predate these.
 */
export const makeAuthStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    scrollContent: { flexGrow: 1, justifyContent: 'space-between' },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Spacing[6],
      width: '100%',
      maxWidth: MaxContentWidth,
      alignSelf: 'center',
    },
    heading: { fontFamily: Fonts.heading, fontSize: 30, color: colors.text, marginBottom: Spacing[2] },
    tagline: {
      fontFamily: Fonts.body,
      fontSize: 15,
      lineHeight: 22,
      color: colors.neutral[400],
      marginBottom: Spacing[6],
    },
    strong: { fontFamily: Fonts.bodySemibold, color: colors.text },
    fields: { gap: Spacing[3], marginBottom: Spacing[4] },
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
    },
    codeInput: {
      height: 60,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
      fontSize: 26,
      letterSpacing: 10,
      textAlign: 'center',
      color: colors.text,
      fontFamily: Fonts.bodyBold,
    },
    inputFocused: { borderColor: colors.accent.DEFAULT, borderWidth: 1.5 },
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
    passwordInput: { flex: 1, fontSize: 15, color: colors.text, fontFamily: Fonts.body, height: '100%' },
    eyeButton: { paddingHorizontal: 16, height: '100%', justifyContent: 'center' },
    error: { fontFamily: Fonts.body, fontSize: 13, color: colors.accent.DEFAULT, marginBottom: Spacing[3] },
    notice: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: colors.text, marginBottom: Spacing[3] },
    submitButton: {
      height: 54,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitButtonDisabled: { opacity: 0.6 },
    submitButtonText: { fontFamily: Fonts.heading, fontSize: 16, color: colors.bg },
    links: { alignItems: 'center', gap: Spacing[3], marginTop: Spacing[6] },
    link: { fontFamily: Fonts.bodySemibold, fontSize: 14, color: colors.text, textDecorationLine: 'underline' },
    linkMuted: { fontFamily: Fonts.body, fontSize: 14, color: colors.neutral[400] },
  });
