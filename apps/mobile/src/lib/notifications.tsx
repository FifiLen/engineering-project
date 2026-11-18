/**
 * Powiadomienia klienta (ADR 0058, makiety powiadomienia-zgoda, ustawienia-powiadomienia-wylaczone,
 * baner-powiadomienia):
 * - prośba przed systemowym oknem raz, przy pierwszej rezerwacji albo pierwszym starcie (nie w wersji web);
 *   „Nie teraz” jej nie ponawia;
 * - rejestracja tokenu Expo przy każdym starcie aplikacji, gdy system pozwala na powiadomienia;
 * - dotknięcie powiadomienia (także po zimnym starcie) otwiera ekran z `data.path`, gdy sesja jest gotowa;
 * - na ekranie jazdy powiadomienie na pierwszym planie jest ukryte;
 * - wersja web pokazuje baner z `notification.created` (Socket.IO w `rental.tsx`), aplikacja natywna to
 *   zdarzenie pomija, żeby nie dublować powiadomienia systemowego.
 */
import type { NotificationView } from '@hulajnogi/shared';
import { router, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import {
  configureForeground,
  onNotificationOpened,
  PUSH_SUPPORTED,
  pushPermission,
  requestPushPermission,
  type PushPermission,
} from './push';
import { registerPushToken } from './push-token';
import { useSession } from './session';
import { readSetting, saveSetting } from './storage';

type Listener = (notification: NotificationView) => void;
const listeners = new Set<Listener>();

/** Wywołuje gniazdo po `notification.created`. */
export function notifyNotificationCreated(notification: NotificationView): void {
  for (const listener of listeners) listener(notification);
}

/** Bieżąca ścieżka dla decyzji o powiadomieniu na pierwszym planie (poza drzewem Reacta). */
let currentPath = '/';
configureForeground(() => currentPath.startsWith('/przejazd'));

const ASKED_KEY = 'pushAsked';

interface NotificationsValue {
  /** Zgoda systemowa (`unsupported` w wersji web). */
  permission: PushPermission | null;
  /** Ponowne sprawdzenie zgody (otwarcie ustawień, powrót z tła). */
  refreshPermission(): Promise<PushPermission>;
  /**
   * Przed pierwszą rezerwacją albo startem: ekran prośby raz; obietnica kończy się po jego zamknięciu,
   * a przerwana akcja biegnie dalej.
   */
  askOnce(): Promise<void>;
  /** „Włącz powiadomienia”: okno systemu i rejestracja tokenu po zgodzie. */
  enable(): Promise<PushPermission>;
  /** Zamknięcie ekranu prośby („Nie teraz” albo po odpowiedzi w oknie systemu). */
  finishAsk(): void;
  /** Ekran prośby zniknął inaczej (systemowy przycisk wstecz): przerwana akcja biegnie dalej. */
  releaseAsk(): void;
  /** Baner w wersji web (ostatnie powiadomienie, nowe zastępuje poprzednie). */
  banner: NotificationView | null;
  dismissBanner(): void;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications(): NotificationsValue {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotifications poza NotificationsProvider');
  return value;
}

/** Niska bateria w jeździe nie ma banera, bo ekran jazdy ma własny komunikat (makieta baner-powiadomienia). */
const NO_BANNER = new Set(['battery_low']);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const pathname = usePathname();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [banner, setBanner] = useState<NotificationView | null>(null);
  // Ścieżka z dotkniętego powiadomienia; zmiana `opened` uruchamia nawigację.
  const pendingPath = useRef<string | null>(null);
  const [opened, setOpened] = useState(0);
  const resolveAsk = useRef<(() => void) | null>(null);
  const ready = status === 'signedIn' && !!me && me.nextStep === 'READY';

  useEffect(() => {
    currentPath = pathname;
  }, [pathname]);

  const refreshPermission = useCallback(async () => {
    const next = await pushPermission();
    setPermission(next);
    return next;
  }, []);

  useEffect(() => {
    void pushPermission().then(setPermission);
  }, []);

  // Token przy każdym starcie i po zalogowaniu innego klienta (upsert w API).
  const userId = ready ? me.id : null;
  useEffect(() => {
    if (userId && permission === 'granted') void registerPushToken();
  }, [userId, permission]);

  // Dotknięcie powiadomienia: ścieżka czeka, aż bramka przekieruje z ekranu startowego po odtworzeniu sesji.
  useEffect(
    () =>
      onNotificationOpened((path) => {
        pendingPath.current = path;
        setOpened((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    const path = pendingPath.current;
    if (!path || !ready || pathname === '/') return;
    pendingPath.current = null;
    router.push(path as never);
  }, [opened, ready, pathname]);

  // Baner w wersji web.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const listener: Listener = (n) => {
      if (!NO_BANNER.has(n.templateCode)) setBanner(n);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const releaseAsk = useCallback(() => {
    const resolve = resolveAsk.current;
    resolveAsk.current = null;
    resolve?.();
  }, []);

  const value = useMemo<NotificationsValue>(
    () => ({
      permission,
      refreshPermission,
      askOnce: async () => {
        if (!PUSH_SUPPORTED || (await readSetting(ASKED_KEY)) === '1') return;
        const current = await refreshPermission();
        await saveSetting(ASKED_KEY, '1');
        if (current !== 'undetermined') return;
        router.push('/powiadomienia');
        await new Promise<void>((resolve) => {
          resolveAsk.current = resolve;
        });
      },
      enable: async () => {
        const next = await requestPushPermission();
        setPermission(next);
        if (next === 'granted') await registerPushToken();
        return next;
      },
      finishAsk: () => {
        const resolve = resolveAsk.current;
        resolveAsk.current = null;
        if (router.canGoBack()) router.back();
        else router.replace('/mapa');
        resolve?.();
      },
      releaseAsk,
      banner,
      dismissBanner: () => setBanner(null),
    }),
    [permission, refreshPermission, releaseAsk, banner],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
