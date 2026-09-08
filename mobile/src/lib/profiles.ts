import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  /** Storage paths (not URLs — the bucket is private), signed at render time via lib/profileMedia.ts's signProfileMediaUrls(). Null until the user sets one. */
  avatar_url: string | null;
  banner_url: string | null;
  last_active_at: string | null;
};

const PROFILE_COLUMNS = 'id, handle, name, bio, avatar_url, banner_url, last_active_at';

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateProfile(userId: string, params: Partial<Pick<Profile, 'name' | 'bio' | 'avatar_url' | 'banner_url'>>) {
  const { error } = await supabase.from('profiles').update(params).eq('id', userId);
  if (error) throw error;
}

/** "Active now" within 5 minutes accounts for the heartbeat's own 2-minute interval (auth-context.tsx) — a timestamp that's 3 minutes old is still genuinely "now" given how often it's actually written. */
export function formatLastActive(iso: string | null): string {
  if (!iso) return '';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 5) return 'Active now';
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  return `Active ${Math.floor(hours / 24)}d ago`;
}

export type ProfileSearchResult = { id: string; handle: string; name: string };

/** Routed through the search_profiles RPC (not a client-side ilike filter) so the caller's raw query text never gets spliced into a PostgREST filter string. */
export async function searchProfiles(query: string): Promise<ProfileSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.rpc('search_profiles', { q });
  if (error) throw error;
  return (data ?? []) as ProfileSearchResult[];
}
