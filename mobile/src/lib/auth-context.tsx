import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { isNetworkError } from '@/lib/errors';
import { unregisterThisDevice } from '@/lib/push';
import { supabase } from '@/lib/supabase';

/** How often to bump profiles.last_active_at while the app is open and in the foreground — a plain heartbeat, not real-time presence (see the migration's own comment for why). */
const LAST_ACTIVE_INTERVAL_MS = 2 * 60 * 1000;

type SignUpParams = {
  email: string;
  password: string;
  handle: string;
  name: string;
};

type AuthContextValue = {
  session: Session | null;
  /** True only until the initial session is read from storage on cold start. */
  loading: boolean;
  signUp: (params: SignUpParams) => ReturnType<typeof supabase.auth.signUp>;
  signIn: (email: string, password: string) => ReturnType<typeof supabase.auth.signInWithPassword>;
  /** Rejects with a message for people when it can't sign out (no connection). */
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Fires on sign-in, sign-out, and silent token refresh — this is the
    // single source of truth for session state everywhere in the app,
    // not just right after an explicit signIn()/signOut() call.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;

    const bump = () => {
      supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', userId).then(() => {});
    };
    bump();

    const interval = setInterval(bump, LAST_ACTIVE_INTERVAL_MS);
    // Bumping only on the interval would leave a stale timestamp for
    // however long someone had the app backgrounded before reopening it —
    // catching the foreground transition directly makes "Active now"
    // actually mean now.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') bump();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [session?.user.id]);

  const value: AuthContextValue = {
    session,
    loading,
    signUp: ({ email, password, handle, name }) =>
      supabase.auth.signUp({
        email,
        password,
        // Picked up by the handle_new_user() trigger (Phase 1,
        // identity_and_rooms migration) via raw_user_meta_data — the
        // profile row is created server-side, not by a second client call.
        options: { data: { handle, name } },
      }),
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: async () => {
      // This phone's push token goes first, while there's still a session
      // to delete it with. Offline it can't, and signing out anyway would
      // leave the phone getting this account's notifications, so it's
      // refused. Any other failure doesn't trap anyone signed in.
      try {
        await unregisterThisDevice();
      } catch (e) {
        if (isNetworkError(e)) {
          throw new Error("You're offline. Connect to sign out, so this phone stops getting this account's notifications.");
        }
      }
      // This phone only. The default, 'global', signed the account out of
      // every device, whose push tokens then stayed registered.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() must be called within an AuthProvider');
  }
  return ctx;
}
