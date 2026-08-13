import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

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
