/**
 * Wersja web bez powiadomień systemowych (ADR 0058, D2): token Expo nie działa w przeglądarce, więc
 * powiadomienia przychodzą jako baner z `notification.created` w Socket.IO (`notifications.tsx`).
 */
import type { PushPlatform } from '@hulajnogi/shared';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export const PUSH_SUPPORTED = false;

export const pushPermission = async (): Promise<PushPermission> => 'unsupported';

export const requestPushPermission = async (): Promise<PushPermission> => 'unsupported';

export const obtainPushToken = async (): Promise<{ token: string; platform: PushPlatform } | null> => null;

export function configureForeground(_hide: () => boolean): void {}

export function onNotificationOpened(_open: (path: string) => void): () => void {
  return () => undefined;
}
