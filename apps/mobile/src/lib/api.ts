/**
 * Klient API aplikacji (ADR 0004, ADR 0035). Token dostępowy jest w pamięci, token odświeżający w Secure
 * Store; odpowiedź 401 wywołuje jedno wspólne odświeżenie i ponowienie żądania. Błędy mają format
 * `{ code, message, details }`, a tekst dla klienta pochodzi z pliku tłumaczeń (`error.<code>`).
 */
import type { CustomerTokens } from '@hulajnogi/shared';
import { t } from '../i18n';
import { readRefreshToken, saveRefreshToken } from './storage';

/** Symulator iOS i przeglądarka widzą API na localhost; telefon w sieci wymaga adresu komputera. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export async function storeTokens(tokens: CustomerTokens | null): Promise<void> {
  accessToken = tokens?.accessToken ?? null;
  await saveRefreshToken(tokens?.refreshToken ?? null);
}

/** Nowa para tokenów z zapisanego tokenu odświeżającego; `false`, gdy sesji nie ma albo wygasła. */
export function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    const refreshToken = await readRefreshToken();
    if (!refreshToken) return false;
    try {
      await storeTokens(await request<CustomerTokens>('/auth/refresh', { method: 'POST', json: { refreshToken } }));
      return true;
    } catch (error) {
      // Sieć niedostępna: zostawiamy token, żeby spróbować ponownie; odrzucona sesja jest usuwana.
      if (error instanceof ApiError && error.status === 401) await storeTokens(null);
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'UNAUTHENTICATED' || path.startsWith('/auth/')) throw error;
    if (!(await refreshTokens())) throw error;
    return request<T>(path, init);
  }
}

async function request<T>(path: string, { method = 'GET', json }: { method?: string; json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.code ?? 'INTERNAL_ERROR', body?.details);
  return body as T;
}

/** Tekst błędu dla klienta; szczegóły (np. liczba prób, minuty) wstawiane do komunikatu. */
/** „+48 512 345 678”; numery spoza Polski bez zmian. */
export function formatPhone(phone: string): string {
  return phone.replace(/^\+48(\d{3})(\d{3})(\d{3})$/, '+48 $1 $2 $3');
}

export function errorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(error instanceof ApiError ? (error.details ?? {}) : {})) {
    if (typeof v === 'string' || typeof v === 'number') values[k] = v;
  }
  if (typeof values.retryAfterSeconds === 'number') values.retryAfterMinutes = Math.ceil(values.retryAfterSeconds / 60);
  return t.has(`error.${code}`) ? t.dynamic(`error.${code}`, values) : t('error.unknown', { code });
}
