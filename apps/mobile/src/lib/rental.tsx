/**
 * Bieżący przejazd klienta (ADR 0036): stan źródłowy z `GET /rentals/current`, zmiany na żywo przez
 * Socket.IO (`rental.updated` w pokoju `user:{id}`), a gdy połączenia nie ma, odpytywanie REST. Liczniki
 * czasu i koszt aplikacja dolicza lokalnie od chwili otrzymania widoku (ADR 0042).
 */
import {
  OPEN_RENTAL_STATES,
  type ClientToServerEvents,
  type PaymentSource,
  type RentalView,
  type ServerToClientEvents,
} from '@hulajnogi/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, API_URL, getAccessToken, refreshTokens } from './api';
import { useSession } from './session';
import { notifyWalletUpdated } from './wallet';
import { notifyZonesChanged } from './zones';

/** Widok z chwilą otrzymania (zegar urządzenia), od której aplikacja dolicza upływ czasu. */
export interface TrackedRental {
  view: RentalView;
  receivedAt: number;
}

/** Zamknięty przejazd, o którym aplikacja jeszcze informuje (mapa, ekran nieudanego odblokowania, podsumowanie). */
export interface RentalOutcome {
  view: RentalView;
  cause: 'cancelled' | 'expired' | 'unlockFailed' | 'ended';
}

/**
 * Źródło płatności wybrane przy rezerwacji albo starcie (ADR 0049): bez niego portfel, a start
 * z rezerwacji zachowuje źródło rezerwacji. Karta przy `CARD`, bez niej domyślna.
 */
export interface PaymentChoice {
  paymentSource: PaymentSource;
  paymentMethodId?: string | null;
}

interface RentalValue {
  rental: TrackedRental | null;
  loaded: boolean;
  outcome: RentalOutcome | null;
  reserve(scooterId: string, payment?: PaymentChoice): Promise<RentalView>;
  cancelReservation(): Promise<RentalView>;
  start(scooterId: string, payment?: PaymentChoice): Promise<RentalView>;
  pause(): Promise<RentalView>;
  resume(): Promise<RentalView>;
  end(): Promise<RentalView>;
  refresh(): Promise<void>;
  clearOutcome(): void;
}

const RentalContext = createContext<RentalValue | null>(null);

export function useRental(): RentalValue {
  const value = useContext(RentalContext);
  if (!value) throw new Error('useRental poza RentalProvider');
  return value;
}

const isOpen = (view: RentalView) => (OPEN_RENTAL_STATES as readonly string[]).includes(view.state);
/** Stany, w których ekran przejazdu przejmuje aplikację. */
export const RIDE_STATES = ['UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING'] as const;
export const isRiding = (view: RentalView | undefined | null): boolean =>
  !!view && (RIDE_STATES as readonly string[]).includes(view.state);

/**
 * Odpytywanie: szybkie przy oczekiwaniu na potwierdzenie komendy, wolniejsze w trakcie jazdy (źródło
 * dystansu, prędkości i trasy z telemetrii przejazdu między zdarzeniami).
 */
const pollInterval = (view: RentalView): number =>
  view.state === 'UNLOCKING' || view.state === 'ENDING' || view.pendingCommand
    ? 2000
    : view.state === 'RESERVED'
      ? 10000
      : 5000;

/**
 * Stan przejazdu należy do zalogowanego klienta: zmiana klienta (wylogowanie, inne konto) tworzy stan
 * od nowa, więc poprzedni przejazd nie wycieka do kolejnej sesji.
 */
export function RentalProvider({ children }: { children: ReactNode }) {
  const { status, me } = useSession();
  const enabled = status === 'signedIn' && !!me && me.nextStep !== 'PROFILE' && me.nextStep !== 'BLOCKED';
  return (
    <RentalState key={enabled ? me!.id : 'off'} enabled={enabled}>
      {children}
    </RentalState>
  );
}

function RentalState({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [rental, setRental] = useState<TrackedRental | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [outcome, setOutcome] = useState<RentalOutcome | null>(null);
  const current = useRef<TrackedRental | null>(null);
  const cancelled = useRef(new Set<string>());
  const closed = useRef(new Set<string>());

  const apply = useCallback((view: RentalView) => {
    const previous = current.current?.view;
    // Starszy widok (np. odpowiedź REST wyprzedzona przez zdarzenie) nie nadpisuje nowszego, a otwarty
    // widok spóźniony po zamknięciu przejazdu go nie wskrzesza.
    if (previous && previous.id === view.id && Date.parse(view.asOf) < Date.parse(previous.asOf)) return;
    if (isOpen(view) && closed.current.has(view.id)) return;
    if (isOpen(view)) {
      const tracked = { view, receivedAt: Date.now() };
      current.current = tracked;
      setRental(tracked);
      return;
    }
    // Zamknięty przejazd: pokazujemy skutek tylko dla przejazdu, który aplikacja śledziła albo właśnie uruchomiła.
    if (previous && previous.id !== view.id) return;
    closed.current.add(view.id);
    current.current = null;
    setRental(null);
    const cause: RentalOutcome['cause'] =
      view.state === 'EXPIRED'
        ? cancelled.current.has(view.id)
          ? 'cancelled'
          : 'expired'
        : view.state === 'UNLOCK_FAILED'
          ? 'unlockFailed'
          : 'ended';
    setOutcome({ view, cause });
  }, []);

  const refresh = useCallback(
    () =>
      api<{ rental: RentalView | null }>('/rentals/current').then(async ({ rental: fresh }) => {
        if (fresh) return apply(fresh);
        const known = current.current?.view;
        if (!known) return setRental(null);
        // Przejazd zamknął się bez zdarzenia (np. po utracie połączenia): stan końcowy ze szczegółów.
        apply(await api<RentalView>(`/rentals/${known.id}`));
      }),
    [apply],
  );

  // Stan po uruchomieniu aplikacji i po zalogowaniu (przejazd przejmuje aplikację także po restarcie).
  useEffect(() => {
    if (!enabled) return;
    void refresh()
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [enabled, refresh]);

  // Zdarzenia na żywo; po ponownym połączeniu stan źródłowy pobieramy od nowa.
  useEffect(() => {
    if (!enabled) return;
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, {
      transports: ['websocket'],
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    let reconnect = false;
    socket.on('connect', () => {
      void refresh().catch(() => undefined);
      // Po przerwie w połączeniu zmiany stref i portfela mogły przepaść: ekrany pobierają je ponownie.
      if (reconnect) {
        notifyZonesChanged();
        notifyWalletUpdated(null);
      }
      reconnect = true;
    });
    socket.on('rental.updated', apply);
    socket.on('zones.changed', notifyZonesChanged);
    socket.on('wallet.updated', notifyWalletUpdated);
    socket.on('disconnect', (reason) => {
      // Serwer rozłącza po wygaśnięciu tokenu: nowy token i ponowne połączenie.
      if (reason === 'io server disconnect') void refreshTokens().then((ok) => ok && socket.connect());
    });
    return () => {
      socket.disconnect();
    };
  }, [enabled, apply, refresh]);

  // Odpytywanie jako zabezpieczenie i źródło dystansu oraz pozycji w trakcie jazdy.
  const view = rental?.view;
  useEffect(() => {
    if (!enabled || !view) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), pollInterval(view));
    return () => clearInterval(timer);
  }, [enabled, view, refresh]);

  const value = useMemo<RentalValue>(() => {
    const act = async (path: string, init: { method: string; json?: unknown }) => {
      const result = await api<RentalView>(path, init);
      apply(result);
      return result;
    };
    return {
      rental,
      loaded,
      outcome,
      reserve: (scooterId, payment) => {
        setOutcome(null);
        return act('/reservations', { method: 'POST', json: { scooterId, ...payment } });
      },
      cancelReservation: () => {
        if (current.current) cancelled.current.add(current.current.view.id);
        return act('/reservations/current', { method: 'DELETE' });
      },
      start: (scooterId, payment) => {
        setOutcome(null);
        return act('/rentals', { method: 'POST', json: { scooterId, ...payment } });
      },
      pause: () => act('/rentals/current/pause', { method: 'POST' }),
      resume: () => act('/rentals/current/resume', { method: 'POST' }),
      end: () => act('/rentals/current/end', { method: 'POST' }),
      refresh,
      clearOutcome: () => setOutcome(null),
    };
  }, [rental, loaded, outcome, apply, refresh]);

  return <RentalContext.Provider value={value}>{children}</RentalContext.Provider>;
}

/**
 * Liczniki na chwilę `now` (ADR 0042): do wartości z widoku aplikacja dolicza czas od otrzymania widoku,
 * jazdę w `ACTIVE` i pauzę w `PAUSED`, dopóki naliczanie trwa (`billedUntil` puste). Oczekiwanie na
 * pauzę liczy się jeszcze jako jazda, a na wznowienie jako pauza, bo stan zmienia dopiero potwierdzenie.
 */
export function liveCounters(tracked: TrackedRental, now: number): { rideSeconds: number; pauseSeconds: number } {
  const { view } = tracked;
  const elapsed = view.startedAt && !view.billedUntil ? Math.max(0, (now - tracked.receivedAt) / 1000) : 0;
  return {
    rideSeconds: view.rideSeconds + (view.state === 'ACTIVE' ? elapsed : 0),
    pauseSeconds: view.pauseSeconds + (view.state === 'PAUSED' ? elapsed : 0),
  };
}

/**
 * Koszt do wyświetlenia między odświeżeniami: reguła z ADR 0042 (opłata za odblokowanie, każda rozpoczęta
 * minuta jazdy, co najmniej jedna, i każda rozpoczęta minuta pauzy) na stawkach z widoku. Kwotę wiążącą
 * liczy API (`price` w widoku, `total_amount` przy zakończeniu).
 */
export function liveTotal(tracked: TrackedRental, now: number): number {
  const { view } = tracked;
  if (!view.startedAt) return 0;
  const { rideSeconds, pauseSeconds } = liveCounters(tracked, now);
  const { unlockFee, minuteRate, pauseMinuteRate } = view.tariff;
  return (
    unlockFee + Math.max(1, Math.ceil(rideSeconds / 60)) * minuteRate + Math.ceil(pauseSeconds / 60) * pauseMinuteRate
  );
}

/** Sekundy do wygaśnięcia rezerwacji, liczone od widoku (odporne na różnicę zegarów urządzenia i serwera). */
export function reservationSecondsLeft(tracked: TrackedRental, now: number): number {
  const { view } = tracked;
  if (!view.reservationExpiresAt) return 0;
  const atView = (Date.parse(view.reservationExpiresAt) - Date.parse(view.asOf)) / 1000;
  return Math.max(0, atView - (now - tracked.receivedAt) / 1000);
}

/** Zegar odświeżający ekran co sekundę (liczniki jazdy, pauzy i rezerwacji). */
export function useNow(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
