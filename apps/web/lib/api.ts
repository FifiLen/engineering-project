/**
 * Klient API panelu. Panel zna tylko API (ADR 0004); błędy mają format `{ code, message, details }`
 * (arc42 §8.8), a tekst dla operatora pochodzi z pliku tłumaczeń pod kluczem `error.<code>`.
 */
import { t } from './i18n';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...rest.headers },
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

/** Komunikat dla operatora: tłumaczenie kodu błędu albo kod w ogólnym komunikacie. */
export function errorMessage(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR';
  return t.has(`error.${code}`) ? t.dynamic(`error.${code}`) : t('error.unknown', { code });
}
