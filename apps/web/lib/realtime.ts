'use client';

/**
 * Połączenie Socket.IO panelu (ADR 0012, ADR 0036): pokoje `rentals` i `fleet` według potrzeb ekranu.
 * Zdarzenia tylko przyspieszają odświeżenie; po ponownym połączeniu ekran pobiera stan z REST.
 */
import type { ClientToServerEvents, FleetMapScooter, RentalListItem, ServerToClientEvents } from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken, refreshSession } from './api';

interface StaffFeed {
  /** Zmiana przejazdu (pokój `rentals`, uprawnienie `rentals.read`). */
  rentals?: (rental: RentalListItem) => void;
  /** Pozycje i statusy floty (pokój `fleet`, uprawnienie `scooters.read`). */
  fleet?: (updates: FleetMapScooter[]) => void;
  /** Ponowne połączenie po przerwie: zdarzenia z przerwy przepadły, stan trzeba pobrać od nowa. */
  reconnected?: () => void;
}

/** Zwraca, czy panel jest połączony i dołączył do wszystkich pokojów. */
export function useStaffFeed(feed: StaffFeed): boolean {
  const handlers = useRef(feed);
  handlers.current = feed;
  const [live, setLive] = useState(false);
  const wantsRentals = Boolean(feed.rentals);
  const wantsFleet = Boolean(feed.fleet);

  useEffect(() => {
    if (!wantsRentals && !wantsFleet) return;
    // Token dostępowy przy każdym połączeniu (także ponownym); serwer rozłącza klienta bez tokenu (ADR 0035).
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL, {
      transports: ['websocket'],
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    let connections = 0;
    socket.on('connect', () => {
      if (connections++ > 0) handlers.current.reconnected?.();
      const joins: Array<Promise<boolean>> = [];
      if (wantsRentals)
        joins.push(new Promise((resolve) => socket.emit('rentals.subscribe', (ack) => resolve(ack.ok))));
      if (wantsFleet) joins.push(new Promise((resolve) => socket.emit('fleet.subscribe', (ack) => resolve(ack.ok))));
      void Promise.all(joins).then((results) => setLive(results.every(Boolean)));
    });
    socket.on('disconnect', (reason) => {
      setLive(false);
      // Serwer rozłączył po wygaśnięciu tokenu: odświeżamy sesję i łączymy się ponownie.
      if (reason === 'io server disconnect') void refreshSession().then((s) => s && socket.connect());
    });
    socket.on('rentals.changed', (rental) => handlers.current.rentals?.(rental));
    socket.on('fleet.updates', (updates) => handlers.current.fleet?.(updates));
    return () => {
      socket.disconnect();
    };
  }, [wantsRentals, wantsFleet]);

  return live;
}
