/**
 * Strefy na mapie aplikacji (`GET /zones`, ADR 0046): tylko strefy z `visibleInApp`. Zdarzenie
 * Socket.IO `zones.changed` (gniazdo klienta w `rental.tsx`) prosi wszystkie ekrany z mapą o ponowne
 * pobranie, więc zmiana w panelu działa w aplikacji bez ponownego uruchomienia.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ZoneCollection, ZoneProperties } from '../components/map/map-layers';
import { api } from './api';

const listeners = new Set<() => void>();

/** Wywołuje gniazdo po zdarzeniu `zones.changed` i po ponownym połączeniu. */
export function notifyZonesChanged(): void {
  for (const listener of listeners) listener();
}

export interface ZonesState {
  zones: ZoneCollection | null;
  /** Błąd ostatniego pobrania (`ApiError`), np. brak sieci na mapie. */
  error: unknown;
  reload(): void;
}

export function useZones(): ZonesState {
  const [zones, setZones] = useState<ZoneCollection | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(() => {
    api<ZoneCollection>('/zones')
      .then((all) => {
        setZones({ ...all, features: all.features.filter((f) => f.properties.visibleInApp) });
        setError(null);
      })
      .catch(setError);
  }, []);

  useEffect(() => {
    reload();
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);

  return { zones, error, reload };
}

/** Rodzaje stref w legendzie (`mapa-strefy`) w kolejności z makiety; obszar działania nie ma wiersza. */
export const LEGEND_TYPES = ['PARKING', 'SLOW', 'NO_RIDE'] as const;

/** Limity stref wolnej jazdy widocznych w aplikacji, rosnąco i bez powtórzeń. */
export function slowLimits(zones: ZoneCollection | null): number[] {
  const limits = (zones?.features ?? [])
    .map((f: { properties: ZoneProperties }) => f.properties)
    .filter((p) => p.type === 'SLOW' && p.speedLimitKmh !== null)
    .map((p) => p.speedLimitKmh!);
  return [...new Set(limits)].sort((a, b) => a - b);
}
