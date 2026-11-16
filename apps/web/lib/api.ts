/**
 * Klient API panelu. Panel zna tylko API (ADR 0004); błędy mają format `{ code, message, details }`
 * (arc42 §8.8), a tekst dla operatora pochodzi z pliku tłumaczeń pod kluczem `error.<code>`.
 *
 * Sesja (ADR 0035): token dostępowy jest tylko w pamięci tej karty, token odświeżający w ciasteczku
 * httpOnly API (ścieżka `/admin/auth`). Odpowiedź 401 wywołuje jedno wspólne odświeżenie i ponowienie.
 */
import type { StaffSession } from '@hulajnogi/shared';
import { t } from './i18n';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const AUTH_PATH = '/admin/auth';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<StaffSession | null> | null = null;
const listeners = new Set<(session: StaffSession | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

/** Sesja z logowania albo odświeżenia; powiadamia dostawcę sesji (nawigacja, uprawnienia). */
export function applySession(session: StaffSession | null): void {
  accessToken = session?.accessToken ?? null;
  for (const listener of listeners) listener(session);
}

export function onSessionChange(listener: (session: StaffSession | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Nowy token z ciasteczka; równoległe wywołania czekają na jedno żądanie (rotacja tokenu). */
export function refreshSession(): Promise<StaffSession | null> {
  refreshing ??= request<StaffSession>(`${AUTH_PATH}/refresh`, { method: 'POST' })
    .then((session) => {
      applySession(session);
      return session;
    })
    .catch(() => {
      applySession(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    // Wygasły token dostępowy: jedno odświeżenie i ponowienie; brak sesji kończy się powrotem do logowania.
    if (!(error instanceof ApiRequestError) || error.code !== 'UNAUTHENTICATED' || path.startsWith(AUTH_PATH)) throw error;
    if (!(await refreshSession())) throw error;
    return request<T>(path, init);
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      // Ciasteczko sesji wysyłamy tylko do punktów logowania; reszta API dostaje token w nagłówku.
      credentials: path.startsWith(AUTH_PATH) ? 'include' : 'omit',
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'NETWORK');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(res.status, body?.code ?? 'INTERNAL_ERROR', body?.details);
  return body as T;
}

/**
 * Komunikat dla operatora: tłumaczenie kodu błędu (ze szczegółami, np. liczbą prób) albo kod
 * w ogólnym komunikacie.
 */
export function errorMessage(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR';
  const details = error instanceof ApiRequestError && isRecord(error.details) ? error.details : {};
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string' || typeof value === 'number') values[key] = value;
  }
  if (typeof values.retryAfterSeconds === 'number') values.retryAfterMinutes = Math.ceil(values.retryAfterSeconds / 60);
  return t.has(`error.${code}`) ? t.dynamic(`error.${code}`, values) : t('error.unknown', { code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
