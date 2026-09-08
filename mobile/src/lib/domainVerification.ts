import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Sends the "verify your institutional email" link for a domain_verified
 * Room (see request-room-verification Edge Function) — mirrors
 * lib/rooms.ts's callRoomMembership() error-unwrapping, since both go
 * through the same functions.invoke() shape.
 */
export async function requestRoomVerification(roomId: string, email: string): Promise<void> {
  const { error } = await supabase.functions.invoke('request-room-verification', {
    body: { room_id: roomId, email },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? error.message);
    }
    throw new Error(error.message);
  }
}

export type VerificationStatus = { email: string; verifiedAt: string | null; expiresAt: string } | null;

/** For showing "we sent a link to x@y.edu, check your inbox" if the member navigates away and back before clicking it. */
export async function fetchMyVerificationStatus(roomId: string, userId: string): Promise<VerificationStatus> {
  const { data, error } = await supabase
    .from('room_email_verifications')
    .select('email, verified_at, expires_at')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { email: data.email, verifiedAt: data.verified_at, expiresAt: data.expires_at } : null;
}
