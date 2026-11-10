import { useNetworkState } from 'expo-network';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

/**
 * Whether the phone has an internet connection, for the "No connection"
 * banner and for reloading a screen when the connection comes back (Phase
 * 10 slice 9, "online-only but honest" — there's no offline queue).
 *
 * From `expo-network`. On Android, reachable means the active network has
 * internet capability and Android has validated it. A state the phone
 * hasn't reported yet counts as online, so the banner never flashes on
 * at launch.
 *
 * Locally, this says nothing about the Supabase stack: the dev client
 * reaches it over USB (`adb reverse`), so with the phone's Wi-Fi off the
 * banner shows while every request still works. A real build talks to
 * the hosted backend over the same internet this reports on.
 */

const NetworkContext = createContext<boolean>(true);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const state = useNetworkState();
  const online = state.isConnected !== false && state.isInternetReachable !== false;
  return <NetworkContext value={online}>{children}</NetworkContext>;
}

/** False only when the phone has said it has no internet. */
export function useOnline(): boolean {
  return useContext(NetworkContext);
}

/**
 * Calls `callback` when the connection comes back after being lost. A
 * screen passes the same load it runs on focus: Realtime reconnects on
 * its own, but nothing replays what was sent while the phone was offline,
 * so a chat would otherwise miss those messages until it's reopened.
 */
export function useOnReconnect(callback: () => void) {
  const online = useOnline();
  const wasOnline = useRef(online);
  const latest = useRef(callback);

  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (online && !wasOnline.current) latest.current();
    wasOnline.current = online;
  }, [online]);
}
