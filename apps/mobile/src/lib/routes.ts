/**
 * Trasy z API (ADR 0048): trasa piesza do hulajnogi (`GET /scooters/{id}/walk`) i prowadzenie do
 * strefy parkowania (`GET /zones/nearest-parking`). Aplikacja prosi o nową trasę, gdy punkt startu
 * oddali się od linii o więcej niż 30 m, nie częściej niż co 10 s; między zapytaniami odległość
 * odlicza lokalnie (`routeProgress`).
 */
import type { NearestParkingRoute, RouteView } from '@hulajnogi/shared';
import { useEffect, useRef, useState } from 'react';
import { routeProgress, type MapPoint } from '../components/map/map-layers';
import { t } from '../i18n';
import { api } from './api';
import { distance } from './format';

export const OFF_ROUTE_M = 30;
export const ROUTE_REFRESH_MS = 10000;

const at = (p: MapPoint) => `lat=${p.lat.toFixed(6)}&lon=${p.lon.toFixed(6)}`;

export const loadWalk = (scooterId: string, from: MapPoint) =>
  api<RouteView>(`/scooters/${scooterId}/walk?${at(from)}`);
export const loadNearestParking = (from: MapPoint) =>
  api<NearestParkingRoute | null>(`/zones/nearest-parking?${at(from)}`);

export interface LiveRoute<T> {
  data: T | null;
  /** Ostatnie zapytanie się nie udało (np. 404 dla hulajnogi poza promieniem, limit zapytań). */
  failed: boolean;
  /** Liczba pobranych tras; zmiana przesuwa mapę na nową trasę. */
  revision: number;
}

/**
 * Trasa dla klucza (`null` wyłącza) od punktu `origin`, odświeżana po zejściu z niej. Odpowiedź dla
 * starego klucza albo wyprzedzona przez nowszą jest pomijana.
 */
export function useLiveRoute<T>(
  key: string | null,
  origin: MapPoint | null,
  load: (origin: MapPoint) => Promise<T | null>,
  lineOf: (data: T) => [number, number][],
): LiveRoute<T> {
  const [state, setState] = useState<LiveRoute<T> & { key: string | null }>({
    key: null,
    data: null,
    failed: false,
    revision: 0,
  });
  const lastFetch = useRef(0);
  const seq = useRef(0);
  const latest = useRef({ load, lineOf, origin });
  useEffect(() => {
    latest.current = { load, lineOf, origin };
  });

  const current = state.key === key ? state : null;
  const hasOrigin = !!origin;
  const off = current?.data && origin ? routeProgress(origin, lineOf(current.data)).offRouteM : 0;
  const needsFetch = !!key && hasOrigin && (!current || (!!current.data && off > OFF_ROUTE_M));

  useEffect(() => {
    if (!needsFetch || !key) return;
    const fetchNow = () => {
      const from = latest.current.origin;
      if (!from) return;
      lastFetch.current = Date.now();
      const id = ++seq.current;
      latest.current
        .load(from)
        .then((data) => {
          if (id === seq.current) setState((s) => ({ key, data, failed: false, revision: s.revision + 1 }));
        })
        .catch(() => {
          if (id === seq.current) setState((s) => ({ ...s, key, data: s.key === key ? s.data : null, failed: true }));
        });
    };
    // Pierwsza trasa dla klucza od razu, kolejne nie częściej niż co 10 s.
    const wait = current ? Math.max(0, lastFetch.current + ROUTE_REFRESH_MS - Date.now()) : 0;
    const timer = setTimeout(fetchNow, wait);
    return () => clearTimeout(timer);
    // Pozycja wchodzi przez `needsFetch`; po każdej odpowiedzi (`revision`) warunek liczy się od nowa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needsFetch, current?.revision]);

  return current
    ? { data: current.data, failed: current.failed, revision: current.revision }
    : { data: null, failed: false, revision: state.revision };
}

/** Pozostała część trasy od punktu: odległość i czas przeskalowane z odpowiedzi API. */
export function remaining(route: RouteView, from: MapPoint | null): { distanceM: number; durationSec: number | null } {
  if (!from) return { distanceM: route.distanceM, durationSec: route.durationSec };
  const { remainingM, totalM } = routeProgress(from, route.line);
  const ratio = totalM > 0 ? Math.min(1, remainingM / totalM) : 1;
  return {
    distanceM: route.distanceM * ratio,
    durationSec: route.durationSec === null ? null : route.durationSec * ratio,
  };
}

export const routeMinutes = (sec: number): number => Math.max(1, Math.round(sec / 60));

/**
 * Opis trasy pieszej (makieta hulajnoga-trasa, D6): „180 m · 3 min pieszo”, bez OSRM „180 m w linii
 * prostej”, a na profilu rowerowym „około 3 min pieszo (szacunkowo)”.
 */
export function walkLabel(route: RouteView, from: MapPoint | null): string {
  const left = remaining(route, from);
  if (route.approximate || left.durationSec === null)
    return t('route.straight', { distance: distance(left.distanceM) });
  if (route.profile === 'bike')
    return t('route.walkEstimate', { distance: distance(left.distanceM), minutes: routeMinutes(left.durationSec) });
  return t('route.walk', { distance: distance(left.distanceM), minutes: routeMinutes(left.durationSec) });
}

/** Opis prowadzenia do strefy: „90 m · około 1 min jazdy”, bez OSRM „90 m w linii prostej”. */
export function rideLabel(route: RouteView, from: MapPoint | null): string {
  const left = remaining(route, from);
  if (route.approximate || left.durationSec === null)
    return t('route.straight', { distance: distance(left.distanceM) });
  return t('route.ride', { distance: distance(left.distanceM), minutes: routeMinutes(left.durationSec) });
}
