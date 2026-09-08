import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

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
  signOut: () => ReturnType<typeof supabase.auth.signOut>;
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
    signOut: () => supabase.auth.signOut(),
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
