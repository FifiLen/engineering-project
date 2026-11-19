'use client';

/**
 * Połączenie Socket.IO panelu (ADR 0012, ADR 0036, ADR 0055, ADR 0059): jedno połączenie na kartę, wspólne dla
 * nawigacji i ekranu. Ekran dołącza do pokojów według potrzeb (`rentals`, `fleet`, `tickets`, `service`,
 * `simulator`), a zmiany stref (`zones.changed`) przychodzą do wszystkich połączonych bez dołączania do pokoju.
 * Gotowe wydruki operatora (`document.ready`) przychodzą do jego pokoju `staff:{id}` (ADR 0066).
 * Zdarzenia tylko przyspieszają odświeżenie; po ponownym połączeniu ekran pobiera stan z REST.
 */
import type {
  ClientToServerEvents,
  DocumentReady,
  FleetMapScooter,
  RentalListItem,
  ServerToClientEvents,
  ServiceTaskUpdated,
  SimulatorResult,
  SimulatorStatusView,
  TicketUpdated,
  ZonesChanged,
} from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken, refreshSession } from './api';

interface StaffFeed {
  /** Zmiana przejazdu (pokój `rentals`, uprawnienie `rentals.read`). */
  rentals?: (rental: RentalListItem) => void;
  /** Pozycje i statusy floty (pokój `fleet`, uprawnienie `scooters.read`). */
  fleet?: (updates: FleetMapScooter[]) => void;
  /** Zmiana stref u innego operatora albo w tej karcie (ADR 0047). */
  zones?: (event: ZonesChanged) => void;
  /** Zmiana zgłoszenia (pokój `tickets`, uprawnienie `tickets.read`). */
  tickets?: (ticket: TicketUpdated) => void;
  /** Zmiana zadania serwisowego (pokój `service`, uprawnienie `service.read`). */
  service?: (task: ServiceTaskUpdated) => void;
  /** Stan symulatora (pokój `simulator`, uprawnienie `simulator.manage`). */
  simulatorStatus?: (status: SimulatorStatusView) => void;
  /** Wynik polecenia symulatora (pokój `simulator`). */
  simulatorResult?: (result: SimulatorResult) => void;
  /**
   * Wydruk tego operatora w stanie końcowym (`document.ready`, ADR 0066): pokój `staff:{id}` gniazdo dostaje przy
   * połączeniu, więc nie ma osobnej subskrypcji.
   */
  documentReady?: (document: DocumentReady) => void;
  /** Ponowne połączenie po przerwie: zdarzenia z przerwy przepadły, stan trzeba pobrać od nowa. */
  reconnected?: () => void;
}

type Room = 'rentals' | 'fleet' | 'tickets' | 'service' | 'simulator';
type Handlers = { current: StaffFeed };
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SUBSCRIBE = {
  rentals: 'rentals.subscribe',
  fleet: 'fleet.subscribe',
  tickets: 'tickets.subscribe',
  service: 'service.subscribe',
  simulator: 'simulator.subscribe',
} as const satisfies Record<Room, keyof ClientToServerEvents>;

/** Wspólne połączenie karty; zamykane chwilę po odejściu ostatniego odbiorcy (przejście między ekranami). */
let socket: AppSocket | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<Handlers>();
/** Wynik dołączenia do pokoju w bieżącym połączeniu; po rozłączeniu pokoje dołącza się od nowa. */
const joined = new Map<Room, Promise<boolean>>();
const stateListeners = new Set<() => void>();

const notify = () => stateListeners.forEach((listener) => listener());

function join(room: Room): Promise<boolean> {
  const s = socket;
  if (!s?.connected) return Promise.resolve(false);
  let pending = joined.get(room);
  if (!pending) {
    pending = new Promise<boolean>((resolve) => s.emit(SUBSCRIBE[room], (ack) => resolve(ack.ok)));
    joined.set(room, pending);
  }
  return pending;
}

function connect(): AppSocket {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (socket) return socket;
  // Token dostępowy przy każdym połączeniu (także ponownym); serwer rozłącza klienta bez tokenu (ADR 0035).
  const s: AppSocket = io(API_URL, { transports: ['websocket'], auth: (cb) => cb({ token: getAccessToken() }) });
  let connections = 0;
  const each = (fn: (feed: StaffFeed) => void) => subscribers.forEach((h) => fn(h.current));
  s.on('connect', () => {
    joined.clear();
    if (connections++ > 0) each((f) => f.reconnected?.());
    notify();
  });
  s.on('disconnect', (reason) => {
    joined.clear();
    notify();
    // Serwer rozłączył po wygaśnięciu tokenu: odświeżamy sesję i łączymy się ponownie.
    if (reason === 'io server disconnect') void refreshSession().then((session) => session && s.connect());
  });
  s.on('rentals.changed', (rental) => each((f) => f.rentals?.(rental)));
  s.on('fleet.updates', (updates) => each((f) => f.fleet?.(updates)));
  s.on('zones.changed', (event) => each((f) => f.zones?.(event)));
  s.on('ticket.updated', (ticket) => each((f) => f.tickets?.(ticket)));
  s.on('service-task.updated', (task) => each((f) => f.service?.(task)));
  s.on('simulator.status', (status) => each((f) => f.simulatorStatus?.(status)));
  s.on('simulator.result', (result) => each((f) => f.simulatorResult?.(result)));
  s.on('document.ready', (document) => each((f) => f.documentReady?.(document)));
  socket = s;
  return s;
}

function release(handlers: Handlers): void {
  subscribers.delete(handlers);
  if (subscribers.size > 0 || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (subscribers.size > 0) return;
    socket?.disconnect();
    socket = null;
    joined.clear();
  }, 2000);
}

/** Zwraca, czy panel jest połączony i dołączył do wszystkich pokojów potrzebnych temu odbiorcy. */
export function useStaffFeed(feed: StaffFeed): boolean {
  const handlers = useRef(feed);
  handlers.current = feed;
  const [live, setLive] = useState(false);
  const rooms: Room[] = [];
  if (feed.rentals) rooms.push('rentals');
  if (feed.fleet) rooms.push('fleet');
  if (feed.tickets) rooms.push('tickets');
  if (feed.service) rooms.push('service');
  if (feed.simulatorStatus || feed.simulatorResult) rooms.push('simulator');
  const key = rooms.join(',');
  const wanted = key !== '' || Boolean(feed.zones) || Boolean(feed.documentReady) || Boolean(feed.reconnected);

  useEffect(() => {
    if (!wanted) return;
    const list = key ? (key.split(',') as Room[]) : [];
    const s = connect();
    subscribers.add(handlers);
    let current = true;
    const update = () => {
      if (!s.connected) {
        setLive(false);
        return;
      }
      void Promise.all(list.map(join)).then((results) => current && setLive(results.every(Boolean)));
    };
    stateListeners.add(update);
    update();
    return () => {
      current = false;
      stateListeners.delete(update);
      release(handlers);
    };
  }, [key, wanted]);

  return live;
}
