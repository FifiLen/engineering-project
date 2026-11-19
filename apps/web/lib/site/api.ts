/**
 * Dane strony promocyjnej (ADR 0065): odczyt publicznych punktów API po stronie serwera, z Data Cache `fetch`
 * z tagami i czasem zapasowym 5 min. `connection()` przed każdym odczytem sprawia, że żadna strona z treścią nie
 * powstaje w czasie budowania, więc `pnpm build` nie woła API (CI buduje bez niego). API odświeża dane po zmianie
 * w panelu wywołaniem `POST /api/revalidate` z tagiem (`content`, `tariff`, `scooters`).
 */
import 'server-only';
import type {
  PublicContent,
  PublicLegalVersionItem,
  PublicLegalVersionView,
  PublicNewsArticle,
  PublicNewsPage,
  PublicScooterView,
  TariffDetailsView,
} from '@hulajnogi/shared';
import { connection } from 'next/server';

/** Tagi cache odświeżane przez API (zadanie `site.revalidate`); biała lista w `POST /api/revalidate`. */
export const SITE_TAGS = ['content', 'tariff', 'scooters'] as const;
export type SiteTag = (typeof SITE_TAGS)[number];

/** Czas zapasowy, gdy wywołanie odświeżenia zginie (ADR 0065). */
const REVALIDATE_SECONDS = 300;
const TIMEOUT_MS = 5_000;

/** Adres API z serwera strony; w sieci wewnętrznej może się różnić od adresu z przeglądarki. */
const apiUrl = () => process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** Adres API widziany z przeglądarki: grafiki z biblioteki mediów (`/media/...`) ładuje przeglądarka. */
export const publicApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** Adres grafiki z biblioteki (adres względny z API doklejony do adresu API). */
export const mediaSrc = (url: string) => `${publicApiUrl()}${url}`;

export class SiteFetchError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`API ${status} dla ${path}`);
  }
}

/**
 * Odczyt z API z tagami cache. `404` daje `null` (strona woła `notFound()`), inny błąd rzuca wyjątek, który pokazuje
 * `error.tsx` („Strona chwilowo niedostępna”) zamiast pustej treści.
 */
export async function siteFetch<T>(path: string, tags: SiteTag[]): Promise<T | null> {
  await connection();
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS, tags },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new SiteFetchError(path, 0);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new SiteFetchError(path, res.status);
  return (await res.json()) as T;
}

/** Treści strony: sekcje, FAQ, dane firmy, modele (`GET /content/web`). */
export async function getContent(): Promise<PublicContent> {
  const content = await siteFetch<PublicContent>('/content/web', ['content']);
  if (!content) throw new SiteFetchError('/content/web', 404);
  return content;
}

/**
 * Treści do nagłówka i stopki: przy awarii API stopka zostaje bez danych firmy (np. strona 404). `connection()` jest
 * poza `catch`, żeby nie połknąć sygnału renderowania przy żądaniu.
 */
export async function getContentSafe(): Promise<PublicContent | null> {
  await connection();
  return getContent().catch(() => null);
}

/** Obowiązujący cennik (`GET /tariff`); brak cennika nie wyłącza strony. */
export async function getTariff(): Promise<TariffDetailsView | null> {
  await connection();
  return siteFetch<TariffDetailsView>('/tariff', ['tariff']).catch(() => null);
}

export const getNewsPage = (page: number, pageSize: number) =>
  siteFetch<PublicNewsPage>(`/news?page=${page}&pageSize=${pageSize}`, ['content']);

export const getArticle = (slug: string) => siteFetch<PublicNewsArticle>(`/news/${slug}`, ['content']);

export const getLegalVersions = (slug: string) =>
  siteFetch<PublicLegalVersionItem[]>(`/legal/${slug}/versions`, ['content']);

export const getLegalVersion = (slug: string, versionNo: number) =>
  siteFetch<PublicLegalVersionView>(`/legal/${slug}/versions/${versionNo}`, ['content']);

export const getPublicScooter = (number: string) =>
  siteFetch<PublicScooterView>(`/public/scooters/${number}`, ['scooters']);
