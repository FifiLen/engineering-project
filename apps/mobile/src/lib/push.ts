/**
 * Powiadomienia systemowe w aplikacji natywnej (ADR 0058) przez `expo-notifications`: zgoda, kanał Androida
 * `default` przed tokenem, token Expo z `projectId` projektu EAS, dotknięcie powiadomienia (także po zimnym
 * starcie) i decyzja o pokazaniu powiadomienia na pierwszym planie. Wersja web ma zaślepki (`push.web.ts`).
 */
import type { PushPlatform } from '@hulajnogi/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { Platform } from 'react-native';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** Wersja web nie ma powiadomień systemowych (baner z Socket.IO, D2). */
export const PUSH_SUPPORTED = true;

const status = (p: Notifications.NotificationPermissionsStatus): PushPermission =>
  p.granted || p.ios?.status === IosAuthorizationStatus.PROVISIONAL
    ? 'granted'
    : p.canAskAgain && p.status !== 'denied'
      ? 'undetermined'
      : 'denied';

export async function pushPermission(): Promise<PushPermission> {
  try {
    return status(await Notifications.getPermissionsAsync());
  } catch {
    return 'unsupported';
  }
}

/** Systemowe okno zgody (iOS pozwala zapytać tylko raz). */
export async function requestPushPermission(): Promise<PushPermission> {
  try {
    return status(await Notifications.requestPermissionsAsync());
  } catch {
    return 'unsupported';
  }
}

/** `projectId` projektu EAS z konfiguracji aplikacji; bez niego Expo nie wyda tokenu. */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/**
 * Token Expo do `POST /me/push-tokens`. `null` bez zgody, na symulatorze Androida, bez `projectId`
 * (projekt EAS zakłada autor, ADR 0058) albo gdy serwer Expo nie odpowiada: aplikacja działa wtedy dalej
 * bez powiadomień, a klient nie widzi błędu.
 */
export async function obtainPushToken(): Promise<{ token: string; platform: PushPlatform } | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (Platform.OS === 'android' && !Device.isDevice) return null;
  const id = projectId();
  if (!id) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: AndroidImportance.HIGH,
      });
    }
    if ((await pushPermission()) !== 'granted') return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return { token: data, platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID' };
  } catch {
    return null;
  }
}

/**
 * Powiadomienie na pierwszym planie: `hide` decyduje (ekran jazdy ma własne komunikaty, np. niskiej baterii),
 * w pozostałych przypadkach baner i lista jak w tle.
 */
export function configureForeground(hide: () => boolean): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const show = !hide();
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}

const pathOf = (response: Notifications.NotificationResponse | null): string | null => {
  const path = response?.notification.request.content.data?.path;
  return typeof path === 'string' && path.startsWith('/') ? path : null;
};

/**
 * Dotknięcie powiadomienia otwiera ekran z `data.path` (Expo Router); po zimnym starcie ostatnia
 * odpowiedź jest obsłużona raz i czyszczona.
 */
export function onNotificationOpened(open: (path: string) => void): () => void {
  const last = pathOf(Notifications.getLastNotificationResponse());
  if (last) {
    Notifications.clearLastNotificationResponse();
    open(last);
  }
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const path = pathOf(response);
    if (path) open(path);
  });
  return () => subscription.remove();
}
