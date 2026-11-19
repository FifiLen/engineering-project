/**
 * Treści aplikacji z bazy (ADR 0062): `GET /content/mobile` jedną odpowiedzią (sekcje `mobile.*`, FAQ, dane firmy,
 * grafiki systemowe), zapisane w pamięci telefonu przez Async Storage pod kluczem `content:mobile:v1` z ETag,
 * skrótem treści (`hash`, ten sam co w ETag) i czasem ostatniego udanego pobrania. Ekrany korzystają z pamięci także bez sieci (Pomoc pokazuje
 * „Ostatnia aktualizacja”), a bez pamięci i bez sieci pokazują ekran „Brak internetu” (rozstrzygnięcie ADR 0062:
 * treści nie mają kopii w paczce, poza renderami hulajnogi z ADR 0064).
 *
 * Odświeżanie:
 * - przy starcie (najpierw pamięć, potem żądanie z `If-None-Match`; `304` aktualizuje tylko czas pobrania);
 * - przy powrocie aplikacji na pierwszy plan;
 * - po każdym `content.updated` i po ponownym połączeniu gniazda (gniazdo jest w `rental.tsx`, więc zdarzenie
 *   dociera tylko do zalogowanych: serwer rozłącza połączenia bez tokenu). Rewizji ze zdarzenia nie porównujemy:
 *   licznik rośnie już w niezatwierdzonej transakcji, więc mógł trafić do pamięci razem ze starą treścią; zdarzenie
 *   wymusza żądanie warunkowe, a o świeżości decyduje skrót treści (`304` albo ten sam `hash` nic nie zmienia).
 *
 * Wersja web: Async Storage działa na `localStorage`, więc pamięć jest ta sama. Nagłówka `If-None-Match` aplikacja
 * w przeglądarce nie ustawia, bo CORS API go nie dopuszcza (`allowedHeaders`); odpowiedź ma `Cache-Control:
 * no-cache` z `ETag`, więc przeglądarka sama wysyła żądanie warunkowe i przy `304` oddaje treść ze swojej pamięci.
 */
import type {
  ContentSectionKey,
  ContentUpdated,
  MediaRef,
  PublicContent,
  PublicContentSection,
} from '@hulajnogi/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { API_URL } from './api';

const STORAGE_KEY = 'content:mobile:v1';

interface StoredContent {
  etag: string;
  /** Skrót treści z odpowiedzi (`PublicContent.hash`, ten sam co w ETag). */
  hash: string;
  /** Czas ostatniego udanego pobrania (`200` albo `304`), ISO. */
  fetchedAt: string;
  data: PublicContent;
}

/**
 * `loading`: odczyt pamięci albo pierwsze pobranie; `ready`: treść jest (z sieci albo z pamięci); `unavailable`:
 * pamięć pusta, a pobranie się nie udało.
 */
export type ContentStatus = 'loading' | 'ready' | 'unavailable';

/** Przyczyna ostatniego nieudanego pobrania: brak połączenia albo błąd serwera. */
export type ContentFailure = 'network' | 'server' | null;

interface ContentValue {
  status: ContentStatus;
  content: PublicContent | null;
  fetchedAt: string | null;
  failure: ContentFailure;
  /** Pobranie od nowa (przycisk „Spróbuj ponownie”, wejście na Pomoc). */
  refresh(): Promise<void>;
}

const ContentContext = createContext<ContentValue | null>(null);

export function useContent(): ContentValue {
  const value = useContext(ContentContext);
  if (!value) throw new Error('useContent poza ContentProvider');
  return value;
}

/** Opublikowana sekcja z elementami; `null`, gdy sekcja jest w szkicu albo archiwum albo treści jeszcze nie ma. */
export function useSection(key: ContentSectionKey & `mobile.${string}`): PublicContentSection | null {
  return useContent().content?.sections[key] ?? null;
}

/** Dane firmy (kontakt pomocy); `null` bez treści w pamięci. */
export function useCompany(): PublicContent['company'] | null {
  return useContent().content?.company ?? null;
}

/** Adres grafiki z biblioteki: widoki API podają ścieżkę względną `/media/{id}/{sha256}.{ext}` (ADR 0064). */
export const mediaUrl = (media: MediaRef): string =>
  /^https?:/.test(media.url) ? media.url : `${API_URL}${media.url}`;

/** Numer do `tel:` bez spacji („+48 32 000 00 00” → „+4832…”). */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;
export const mailtoHref = (email: string): string => `mailto:${email}`;

type Listener = (event: ContentUpdated | null) => void;
const listeners = new Set<Listener>();

/** Wywołuje gniazdo po `content.updated` i po ponownym połączeniu (`null`: sprawdź od nowa). */
export function notifyContentUpdated(event: ContentUpdated | null): void {
  for (const listener of listeners) listener(event);
}

async function readStored(): Promise<StoredContent | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredContent;
    // Pamięć sprzed skrótu treści (ETag z rewizji) traktujemy jak pustą: pierwsze pobranie ją zastąpi.
    return isContent(stored?.data) && typeof stored.etag === 'string' && typeof stored.hash === 'string'
      ? stored
      : null;
  } catch {
    return null;
  }
}

async function writeStored(stored: StoredContent): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Pełna pamięć: treść zostaje do końca sesji aplikacji.
  }
}

/** Minimalne sprawdzenie kształtu (pamięć ze starszej wersji aplikacji, odpowiedź pośrednika). */
function isContent(value: unknown): value is PublicContent {
  const v = value as Partial<PublicContent> | null;
  return (
    !!v &&
    typeof v.revision === 'number' &&
    typeof v.hash === 'string' &&
    !!v.sections &&
    !!v.company &&
    Array.isArray(v.faq) &&
    !!v.systemMedia
  );
}

type FetchResult =
  | { kind: 'fresh'; etag: string; data: PublicContent }
  | { kind: 'notModified' }
  | { kind: 'failed'; failure: 'network' | 'server' };

async function fetchContent(etag: string | null): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/content/mobile`, {
      headers: etag && Platform.OS !== 'web' ? { 'if-none-match': etag } : {},
    });
  } catch {
    return { kind: 'failed', failure: 'network' };
  }
  if (res.status === 304) return { kind: 'notModified' };
  if (!res.ok) return { kind: 'failed', failure: 'server' };
  const data: unknown = await res.json().catch(() => null);
  if (!isContent(data)) return { kind: 'failed', failure: 'server' };
  // Przeglądarka nie udostępnia nagłówka `ETag` bez `Access-Control-Expose-Headers`; ten sam skrót ma treść.
  return { kind: 'fresh', etag: res.headers.get('etag') ?? `"content-${data.hash}"`, data };
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredContent | null>(null);
  const [status, setStatus] = useState<ContentStatus>('loading');
  const [failure, setFailure] = useState<ContentFailure>(null);
  const current = useRef<StoredContent | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const apply = useCallback((next: StoredContent) => {
    current.current = next;
    setStored(next);
    setStatus('ready');
    void writeStored(next);
  }, []);

  const refresh = useCallback(() => {
    inFlight.current ??= (async () => {
      const known = current.current;
      // Ponowienie po „Brak internetu”: wskaźnik ładowania zamiast tego samego ekranu.
      if (!known) setStatus('loading');
      const result = await fetchContent(known?.etag ?? null);
      const fetchedAt = new Date().toISOString();
      if (result.kind === 'failed') {
        setFailure(result.failure);
        setStatus(current.current ? 'ready' : 'unavailable');
        return;
      }
      setFailure(null);
      if (result.kind === 'notModified') {
        if (known) apply({ ...known, fetchedAt });
        return;
      }
      // Ten sam skrót (np. w wersji web, gdzie przeglądarka zwraca `200` z własnej pamięci): bez przerysowania ekranów.
      if (known && known.hash === result.data.hash) {
        apply({ ...known, etag: result.etag, fetchedAt });
        return;
      }
      apply({ etag: result.etag, hash: result.data.hash, fetchedAt, data: result.data });
    })().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [apply]);

  // Start: pamięć telefonu, potem sieć.
  useEffect(() => {
    void readStored().then((saved) => {
      if (saved && !current.current) {
        current.current = saved;
        setStored(saved);
        setStatus('ready');
      }
      void refresh();
    });
  }, [refresh]);

  // Powrót z tła.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') void refresh();
      previous = next;
    });
    return () => subscription.remove();
  }, [refresh]);

  // Każde `content.updated` i ponowne połączenie gniazda: żądanie warunkowe (bez porównywania rewizji ze zdarzenia).
  useEffect(() => {
    // Zmiana tylko strony kończy się tanim `304`, bo skrót treści aplikacji się nie zmienia.
    const listener: Listener = () => {
      void refresh();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [refresh]);

  const value = useMemo<ContentValue>(
    () => ({ status, content: stored?.data ?? null, fetchedAt: stored?.fetchedAt ?? null, failure, refresh }),
    [status, stored, failure, refresh],
  );
  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}
