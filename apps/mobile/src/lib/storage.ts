import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Token odświeżający (ADR 0035): na telefonie w Keychain/Keystore przez expo-secure-store, w wersji web
 * (podgląd w przeglądarce) w localStorage, bo Secure Store nie działa na webie (dokumentacja Expo SDK 58).
 */
const KEY = 'hulajnogi.refresh';

export async function readRefreshToken(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY);
}

export async function saveRefreshToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (token) globalThis.localStorage?.setItem(KEY, token);
    else globalThis.localStorage?.removeItem(KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  else await SecureStore.deleteItemAsync(KEY);
}
