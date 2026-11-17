import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MapPoint } from '../components/map/map-layers';

/** `undetermined`: klient jeszcze nie odpowiedział (ekran konto-lokalizacja przed mapą). */
export type LocationPermission = 'loading' | 'undetermined' | 'granted' | 'denied';

interface LocationValue {
  permission: LocationPermission;
  position: MapPoint | null;
  /** Systemowe okno zgody; `false`, gdy klient odmówił. */
  request(): Promise<boolean>;
  /** Klient wybrał „Nie teraz”; mapa działa bez lokalizacji do ponownego uruchomienia aplikacji. */
  skip(): void;
  skipped: boolean;
}

const LocationContext = createContext<LocationValue | null>(null);

export function useLocation(): LocationValue {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useLocation poza LocationProvider');
  return value;
}

/**
 * Lokalizacja klienta (ADR 0040): `expo-location` tylko na pierwszym planie, w wersji web geolokalizacja
 * przeglądarki. Pozycja służy do wyszukania hulajnóg w pobliżu i pokazania klienta na mapie; strefę
 * parkowania sprawdza API po pozycji hulajnogi.
 */
export function LocationProvider({ children }: { children: ReactNode }) {
  const [permission, setPermission] = useState<LocationPermission>('loading');
  const [position, setPosition] = useState<MapPoint | null>(null);
  const [skipped, setSkipped] = useState(false);
  const subscription = useRef<Location.LocationSubscription | null>(null);

  const watch = useCallback(async () => {
    if (subscription.current) return;
    try {
      subscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 },
        (loc) => setPosition({ lat: loc.coords.latitude, lon: loc.coords.longitude }),
      );
    } catch {
      // Usługi lokalizacji wyłączone w systemie: mapa działa jak bez zgody.
      setPermission('denied');
    }
  }, []);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync()
      .then((res) => {
        if (res.granted) {
          setPermission('granted');
          void watch();
        } else setPermission(res.canAskAgain ? 'undetermined' : 'denied');
      })
      .catch(() => setPermission('undetermined'));
    return () => {
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [watch]);

  const value = useMemo<LocationValue>(
    () => ({
      permission,
      position,
      skipped,
      skip: () => setSkipped(true),
      request: async () => {
        const res = await Location.requestForegroundPermissionsAsync().catch(() => null);
        const granted = res?.granted ?? false;
        setPermission(granted ? 'granted' : 'denied');
        if (granted) await watch();
        return granted;
      },
    }),
    [permission, position, skipped, watch],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}
