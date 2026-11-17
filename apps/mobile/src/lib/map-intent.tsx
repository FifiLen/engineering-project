/**
 * Co mapa ma pokazać po powrocie z innego ekranu: cel z wyszukiwania (makieta szukaj-wynik) i trasę
 * pieszą do hulajnogi po „Trasa” na ekranie hulajnogi (hulajnoga-trasa). Do tego „Ostatnio wyszukiwane”:
 * 5 ostatnich wybranych miejsc tylko na urządzeniu (ADR 0045, decyzja D4), zapisanych jak ustawienia.
 */
import type { PlaceResult } from '@hulajnogi/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isRiding, useRental } from './rental';
import { readSetting, saveSetting } from './storage';

export type Place = Pick<PlaceResult, 'id' | 'name' | 'description' | 'lat' | 'lon'>;

const RECENT_KEY = 'recentPlaces';
export const RECENT_LIMIT = 5;

interface MapIntent {
  destination: Place | null;
  setDestination(place: Place | null): void;
  /** Hulajnoga, do której mapa rysuje trasę pieszą bez rezerwacji. */
  walkTo: string | null;
  setWalkTo(scooterId: string | null): void;
  recent: Place[];
  /** Wybrane miejsce na początek listy ostatnich (bez powtórzeń, najwyżej 5). */
  remember(place: Place): void;
  clearRecent(): void;
}

const MapIntentContext = createContext<MapIntent | null>(null);

export function useMapIntent(): MapIntent {
  const value = useContext(MapIntentContext);
  if (!value) throw new Error('useMapIntent poza MapIntentProvider');
  return value;
}

const isPlace = (v: unknown): v is Place =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Place).name === 'string' &&
  typeof (v as Place).lat === 'number' &&
  typeof (v as Place).lon === 'number';

export function MapIntentProvider({ children }: { children: ReactNode }) {
  const { rental } = useRental();
  const [destination, setDestination] = useState<Place | null>(null);
  const [walkTo, setWalkTo] = useState<string | null>(null);
  const [recent, setRecent] = useState<Place[]>([]);

  useEffect(() => {
    void readSetting(RECENT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecent(parsed.filter(isPlace).slice(0, RECENT_LIMIT));
      } catch {
        // Uszkodzony wpis: lista zaczyna się od nowa.
      }
    });
  }, []);

  // Cel i trasa piesza znikają po rozpoczęciu przejazdu (makieta szukaj-wynik); zmiana stanu w trakcie
  // renderowania, bez efektu, jak w dokumentacji Reacta („adjusting state when a prop changes”).
  const riding = isRiding(rental?.view);
  const [wasRiding, setWasRiding] = useState(riding);
  if (riding !== wasRiding) {
    setWasRiding(riding);
    if (riding) {
      setDestination(null);
      setWalkTo(null);
    }
  }

  const value = useMemo<MapIntent>(
    () => ({
      destination,
      setDestination,
      walkTo,
      setWalkTo,
      recent,
      remember: (place) => {
        const entry: Place = {
          id: place.id,
          name: place.name,
          description: place.description,
          lat: place.lat,
          lon: place.lon,
        };
        setRecent((list) => {
          const next = [entry, ...list.filter((p) => p.id !== entry.id)].slice(0, RECENT_LIMIT);
          void saveSetting(RECENT_KEY, JSON.stringify(next));
          return next;
        });
      },
      clearRecent: () => {
        setRecent([]);
        void saveSetting(RECENT_KEY, '[]');
      },
    }),
    [destination, walkTo, recent],
  );
  return <MapIntentContext.Provider value={value}>{children}</MapIntentContext.Provider>;
}
