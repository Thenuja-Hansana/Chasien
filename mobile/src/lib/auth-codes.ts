import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Signup confirmation and password reset by 6-digit code (Phase 11 slice
 * 2), instead of links. A link has to open somewhere: on the local stack
 * it pointed at 127.0.0.1, and hosted it would have needed a web page or a
 * deep link set up in Auth's redirect URLs. A code is typed into the app,
 * works when the email is read on another device, and needs neither. The
 * emails are supabase/templates/confirmation.html and recovery.html; the
 * length and lifetime (6 digits, an hour) are `otp_length`/`otp_expiry` in
 * supabase/config.toml.
 */

/** Digits in a code, the same as `otp_length` in supabase/config.toml. */
export const CODE_LENGTH = 6;

/** How long to wait before offering another code, a little over Auth's own minimum interval. */
export const RESEND_COOLDOWN_SECONDS = 60;

export async function confirmSignupCode(email: string, code: string) {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
}

export async function resendSignupCode(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw error;
}

/**
 * Asks for a reset code. Auth answers the same way whether or not an
 * account has that address, so this can't be used to find out who's on
 * Chasien; the screen says "if there's an account".
 */
export async function sendPasswordResetCode(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

/** A correct code signs the person in; the new password is set after it. */
export async function verifyPasswordResetCode(email: string, code: string) {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (error) throw error;
}

export async function setNewPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

/** Auth refused to send another code this soon: one may already be on its way. */
export function isTooSoon(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return code === 'over_email_send_rate_limit';
}

/**
 * Auth's own wording ("Token has expired or is invalid") isn't written for
 * people, so the codes these calls fail with get sentences of their own.
 * Anything else goes through errorMessage(), which already words a dropped
 * connection.
 */
export function codeErrorMessage(e: unknown, fallback: string): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  switch (code) {
    case 'otp_expired':
      return 'That code is wrong or has expired. Check it, or send a new one.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many tries. Wait a minute and try again.';
    case 'same_password':
      return "That's your current password. Choose a different one.";
    case 'weak_password':
      return 'Choose a longer password: at least 6 characters.';
    default:
      return errorMessage(e, fallback);
  }
}
