/**
 * Dane urządzenia do listy sesji w panelu (ADR 0076): platforma, wersja aplikacji i nazwa urządzenia. Wysyłane przy
 * weryfikacji kodu SMS (`POST /auth/otp/verify`), a platforma i wersja także przy odświeżaniu sesji
 * (`POST /auth/refresh`), bo po aktualizacji aplikacji sesja następna ma mieć nową wersję.
 */
import type { SessionPlatform } from '@hulajnogi/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

const PLATFORMS: Partial<Record<typeof Platform.OS, SessionPlatform>> = { ios: 'IOS', android: 'ANDROID', web: 'WEB' };

/** Platforma sesji; inne systemy (np. Windows w React Native) jako `null`. */
export function sessionPlatform(): SessionPlatform | null {
  return PLATFORMS[Platform.OS] ?? null;
}

/** Wersja z `app.json` (`expo.version`); limit długości jak w schemacie API. */
export function appVersion(): string | null {
  return Constants.expoConfig?.version?.trim().slice(0, 32) || null;
}

/**
 * Nazwa urządzenia: model z `expo-device` („iPhone 15”), w przeglądarce nazwa systemu („macOS”), inaczej `null`.
 * Nie wysyłamy nazwy nadanej przez właściciela (`Device.deviceName`, często imię i nazwisko) — to dane osobowe.
 */
export function deviceName(): string | null {
  const name = Device.modelName ?? (Platform.OS === 'web' ? Device.osName : null);
  return name?.trim().slice(0, 80) || null;
}

/** Pola żądania weryfikacji kodu. */
export function otpDeviceFields() {
  return { device: deviceName(), platform: sessionPlatform(), appVersion: appVersion() };
}

/** Pola żądania odświeżenia (schemat `refreshSchema` nie ma nazwy urządzenia). */
export function refreshDeviceFields() {
  return { platform: sessionPlatform(), appVersion: appVersion() };
}
