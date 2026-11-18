/**
 * Bieżący przejazd klienta (ADR 0036): stan źródłowy z `GET /rentals/current`, zmiany na żywo przez
 * Socket.IO (`rental.updated` w pokoju `user:{id}`), a gdy połączenia nie ma, odpytywanie REST. Liczniki
 * czasu i koszt aplikacja dolicza lokalnie od chwili otrzymania widoku (ADR 0042).
 */
import {
  OPEN_RENTAL_STATES,
  type ClientToServerEvents,
  type PaymentSource,
  type RentalHistoryItem,
  type RentalView,
  type ServerToClientEvents,
} from '@hulajnogi/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ApiError, api, API_URL, getAccessToken, refreshTokens } from './api';
import { notifyNotificationCreated } from './notifications';
import { useSession } from './session';
import { notifyTicketUpdated } from './tickets';
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
  /**
   * Zdjęcie parkowania (ADR 0057): powiązanie pliku z przejazdem. Przy zakończeniu bez łączności przejazd
   * czeka w `ENDING`; gdy API przyjmuje zdjęcie dopiero po `ENDED` (`RENTAL_NOT_ENDED`), aplikacja wiąże
   * je po zamknięciu przejazdu (`pending`).
   */
  attachParkingPhoto(rentalId: string, fileId: string): Promise<'attached' | 'pending'>;
  /** Zdjęcie przejazdu wysłane w tej sesji aplikacji (także czekające na `ENDED`). */
  photoSent(rentalId: string): boolean;
  /**
   * Zakończony przejazd z wymaganym zdjęciem bez zdjęcia (ADR 0056), wykryty po uruchomieniu aplikacji:
   * aplikacja raz wraca do ekranu zdjęcia.
   */
  photoDue: RentalView | null;
  clearPhotoDue(): void;
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

/** Zakończenie bez łączności: przejazd czeka w `ENDING` na blokadę do 10 min (ADR 0056). */
export const isOfflineEnding = (view: RentalView | undefined | null): boolean =>
  view?.state === 'ENDING' && view.endMode === 'CUSTOMER_OFFLINE';

/**
 * Ekran przejazdu przejmuje aplikację w stanach jazdy; przy zakończeniu bez łączności tylko do wysłania
 * zdjęcia, bo klient nie musi czekać na blokadę (makieta koniec-offline).
 */
export const holdsRideScreen = (view: RentalView | undefined | null, photoSent: boolean): boolean =>
  isRiding(view) && !(isOfflineEnding(view) && (photoSent || !!view?.parkingPhoto));

/**
 * Zdjęcie parkowania po zakończeniu: wymagane po zakończeniu bez łączności, a po zwykłym zakończeniu przez
 * klienta proponowane z „Pomiń” (makieta zdjecie-parkowania); po zakończeniu przez operatora go nie ma.
 */
export const wantsParkingPhoto = (view: RentalView): boolean =>
  !view.parkingPhoto && (!!view.parkingPhotoRequired || view.endMode === 'CUSTOMER');

/** Zakończony przejazd sprzed najwyżej doby jeszcze przypomina o wymaganym zdjęciu. */
const PHOTO_DUE_MS = 24 * 60 * 60 * 1000;

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
  // Zdjęcia parkowania wysłane w tej sesji i plik czekający na `ENDED` (zakończenie bez łączności).
  const [sentPhotos, setSentPhotos] = useState<ReadonlySet<string>>(() => new Set());
  const pendingPhoto = useRef<{ rentalId: string; fileId: string } | null>(null);
  const [photoDue, setPhotoDue] = useState<RentalView | null>(null);

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
    const pending = pendingPhoto.current;
    if (pending && pending.rentalId === view.id && (view.state === 'ENDED' || view.state === 'UNPAID')) {
      pendingPhoto.current = null;
      void api(`/rentals/${view.id}/parking-photo`, { method: 'POST', json: { fileId: pending.fileId } }).catch(
        () => undefined,
      );
    }
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

  // Stan po uruchomieniu aplikacji i po zalogowaniu (przejazd przejmuje aplikację także po restarcie). Bez
  // otwartego przejazdu ostatni zakończony może jeszcze wymagać zdjęcia parkowania (ADR 0056).
  useEffect(() => {
    if (!enabled) return;
    void refresh()
      .then(async () => {
        if (current.current) return;
        const [last] = await api<RentalHistoryItem[]>('/rentals?limit=1');
        if (!last?.endedAt || Date.now() - Date.parse(last.endedAt) > PHOTO_DUE_MS) return;
        const view = await api<RentalView>(`/rentals/${last.id}`);
        if (view.parkingPhotoRequired && !view.parkingPhoto) setPhotoDue(view);
      })
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
        notifyTicketUpdated(null);
      }
      reconnect = true;
    });
    socket.on('rental.updated', apply);
    socket.on('zones.changed', notifyZonesChanged);
    socket.on('wallet.updated', notifyWalletUpdated);
    socket.on('ticket.updated', notifyTicketUpdated);
    socket.on('notification.created', notifyNotificationCreated);
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
      attachParkingPhoto: async (rentalId, fileId) => {
        const sent = () => setSentPhotos((s) => new Set(s).add(rentalId));
        try {
          const view = await api<RentalView>(`/rentals/${rentalId}/parking-photo`, {
            method: 'POST',
            json: { fileId },
          });
          sent();
          if (current.current?.view.id === rentalId) apply(view);
          return 'attached';
        } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'RENTAL_NOT_ENDED') throw e;
          pendingPhoto.current = { rentalId, fileId };
          sent();
          return 'pending';
        }
      },
      photoSent: (rentalId) => sentPhotos.has(rentalId),
      photoDue,
      clearPhotoDue: () => setPhotoDue(null),
    };
  }, [rental, loaded, outcome, apply, refresh, sentPhotos, photoDue]);

  return <RentalContext.Provider value={value}>{children}</RentalContext.Provider>;
}

/**
 * Liczniki na chwilę `now` (ADR 0042): do wartości z widoku aplikacja dolicza czas od otrzymania widoku,
 * jazdę w `ACTIVE` i pauzę w `PAUSED`, dopóki naliczanie trwa (`billedUntil` puste, bez `billingStopped`). Oczekiwanie na
 * pauzę liczy się jeszcze jako jazda, a na wznowienie jako pauza, bo stan zmienia dopiero potwierdzenie.
 */
export function liveCounters(tracked: TrackedRental, now: number): { rideSeconds: number; pauseSeconds: number } {
  const { view } = tracked;
  // Naliczanie zatrzymane po 30 min bez łączności (ADR 0056): licznik pokazuje zatrzymaną wartość.
  const counting = view.startedAt && !view.billedUntil && !view.billingStopped;
  const elapsed = counting ? Math.max(0, (now - tracked.receivedAt) / 1000) : 0;
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
