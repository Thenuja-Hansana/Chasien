import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Deleting an account (Phase 9). The work happens in the `delete-account`
 * Edge Function and 20260922120000_account_deletion.sql: owned Rooms are
 * handed to the next admin/mod/member (or deleted when nobody else is in
 * them), everything the person posted is deleted, then the account itself
 * and their files.
 */

/** A Room the person owns, and who it would go to. `successorHandle` null: nobody else is in it, so it's deleted. */
export type OwnedRoomPreview = { roomId: string; roomName: string; successorHandle: string | null };

export async function fetchDeletionPreview(): Promise<OwnedRoomPreview[]> {
  const { data, error } = await supabase.rpc('account_deletion_preview');
  if (error) throw error;
  return ((data ?? []) as { room_id: string; room_name: string; successor_handle: string | null }[]).map((row) => ({
    roomId: row.room_id,
    roomName: row.room_name,
    successorHandle: row.successor_handle,
  }));
}

export type DeletionResult = {
  summary: {
    rooms_handed_over: number;
    rooms_deleted: number;
    posts: number;
    comments: number;
    messages: number;
    stories: number;
  };
  files: { removed: number; failed: number };
};

async function callDeleteAccount(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('delete-account', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const parsed = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(parsed?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  return data;
}

// Read by the login screen to say the account was deleted. A flag here
// rather than a route param: signing out makes AuthGate redirect to /login
// on its own, and whichever of the two redirects lands last would decide
// whether a param survived.
let accountJustDeleted = false;

export function wasAccountJustDeleted(): boolean {
  return accountJustDeleted;
}

export function clearAccountDeletedNotice() {
  accountJustDeleted = false;
}

/**
 * Deletes the signed-in account. Signs in again with the password first:
 * the function refuses unless the password was entered in the last few
 * minutes, so a signed-in session alone (an unlocked phone) isn't enough.
 * Afterwards only the local session needs clearing; the server has already
 * ended every session along with the account.
 */
export async function deleteMyAccount(email: string, password: string): Promise<void> {
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error("That password isn't right.");
  }
  await callDeleteAccount({});
  accountJustDeleted = true;
  await supabase.auth.signOut({ scope: 'local' });
}

// ── App admins: requests sent by email ─────────────────────────────────

export type FoundAccount = { userId: string; handle: string; name: string; isAppAdmin: boolean };

/** The account behind an emailed deletion request. Only app admins get an answer. */
export async function lookupAccountByEmail(email: string): Promise<FoundAccount> {
  const data = (await callDeleteAccount({ action: 'lookup', email: email.trim() })) as { account: FoundAccount };
  return data.account;
}

export async function deleteAccountAsAdmin(userId: string): Promise<DeletionResult> {
  return (await callDeleteAccount({ action: 'delete_user', user_id: userId })) as DeletionResult;
}
