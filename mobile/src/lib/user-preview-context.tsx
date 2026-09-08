import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import UserPreviewCard from '@/components/UserPreviewCard';

type UserPreviewContextValue = { open: (userId: string) => void };

const UserPreviewContext = createContext<UserPreviewContextValue | null>(null);

/**
 * One popup instance mounted once at the app root (see _layout.tsx),
 * rather than one per screen that opens it — every trigger (a post
 * author, a comment, a Room member row, a search result) wants the exact
 * same card, so there's nothing screen-specific for a local copy to add.
 */
export function UserPreviewProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const value = useMemo<UserPreviewContextValue>(() => ({ open: (id) => setUserId(id) }), []);

  return (
    <UserPreviewContext.Provider value={value}>
      {children}
      <UserPreviewCard userId={userId} visible={!!userId} onClose={() => setUserId(null)} />
    </UserPreviewContext.Provider>
  );
}

export function useUserPreview() {
  const ctx = useContext(UserPreviewContext);
  if (!ctx) {
    throw new Error('useUserPreview() must be called within a UserPreviewProvider');
  }
  return ctx;
}
