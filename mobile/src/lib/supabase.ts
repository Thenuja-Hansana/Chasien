import 'react-native-get-random-values';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Expo's SecureStore (iOS Keychain / Android Keystore) is genuinely
 * encrypted at rest, but caps individual values at ~2048 bytes — a
 * Supabase session (access token + refresh token + user object, as one
 * JSON blob) can exceed that. AsyncStorage has no such limit but stores
 * plain text, which is exactly what "not AsyncStorage in plaintext"
 * (docs/roadmap.md, Phase 2) rules out.
 *
 * This is Supabase's own documented pattern for Expo apps, reproduced
 * here rather than improvised: a fresh AES-256 key lives in SecureStore
 * (small, fits easily); the session itself is encrypted with that key
 * and the ciphertext — unreadable without the Keychain/Keystore-held
 * key — goes into AsyncStorage, which no longer has anything sensitive
 * to leak even if read directly off the device.
 * https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native?auth-store=secure-store
 *
 * `expo-secure-store` has no web implementation at all (there's no
 * Keychain/Keystore equivalent in a browser) — it throws on every call
 * there. Chasien ships mobile-only, but `expo start --web` still needs to
 * run for local dev, so the encryption key falls back to `localStorage`
 * on web specifically. That's no less secure than the plaintext
 * AsyncStorage-on-web this was avoiding for native — web was never this
 * app's protected target.
 */
class LargeSecureStore {
  // AsyncStorage's web backend writes straight to `localStorage[key]` with
  // no prefix of its own — reusing `key` here for the encryption key would
  // collide with (and immediately get clobbered by) `setItem`'s own
  // `AsyncStorage.setItem(key, encrypted)` call below, on the same tick.
  private _webKeyStorageKey(key: string) {
    return `${key}-secure-store-key`;
  }

  private async _encrypt(key: string, value: string) {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));

    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    const encryptionKeyHex = aesjs.utils.hex.fromBytes(encryptionKey);

    if (Platform.OS === 'web') {
      localStorage.setItem(this._webKeyStorageKey(key), encryptionKeyHex);
    } else {
      await SecureStore.setItemAsync(key, encryptionKeyHex);
    }

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string) {
    const encryptionKeyHex =
      Platform.OS === 'web' ? localStorage.getItem(this._webKeyStorageKey(key)) : await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) {
      return null;
    }

    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1),
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) {
      return encrypted;
    }

    return await this._decrypt(key, encrypted);
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    if (Platform.OS === 'web') {
      localStorage.removeItem(this._webKeyStorageKey(key));
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  }

  async setItem(key: string, value: string) {
    const encrypted = await this._encrypt(key, value);

    await AsyncStorage.setItem(key, encrypted);
  }
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy mobile/.env.example to mobile/.env.local and fill them in (see `supabase status` for local values).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
