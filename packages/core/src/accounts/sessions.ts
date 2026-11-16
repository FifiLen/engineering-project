import { DomainError } from '../errors.js';

/**
 * Sesje klientów i operatorów (ADR 0019): krótki token dostępowy JWT i token odświeżający zapisany
 * w bazie jako skrót. Każde odświeżenie wydaje nowy token odświeżający (rotacja), a poprzedni wiersz
 * wskazuje następcę. Ten sam token użyty drugi raz oznacza, że ktoś go przechwycił: unieważniamy
 * wtedy całą rodzinę sesji, czyli wszystkie tokeny wydane od jednego logowania.
 */
export const SESSION_POLICY = {
  accessTokenSeconds: 15 * 60,
  customerRefreshDays: 30,
  /** Sesja panelu trwa jedną zmianę, chyba że operator zaznaczy „Zapamiętaj to urządzenie”. */
  staffRefreshHours: 12,
  staffRememberedRefreshDays: 7,
  /**
   * Dwa równoległe odświeżenia (np. dwa żądania aplikacji po wygaśnięciu tokenu) używają tego samego
   * tokenu. W tym oknie po rotacji drugie odświeżenie jest odrzucane bez unieważniania rodziny.
   */
  reuseGraceSeconds: 10,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SessionOwner = 'CUSTOMER' | 'STAFF';

export function refreshExpiresAt(owner: SessionOwner, now: Date, remember = false): Date {
  const ms =
    owner === 'CUSTOMER'
      ? SESSION_POLICY.customerRefreshDays * DAY_MS
      : remember
        ? SESSION_POLICY.staffRememberedRefreshDays * DAY_MS
        : SESSION_POLICY.staffRefreshHours * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

export function accessExpiresAt(now: Date): Date {
  return new Date(now.getTime() + SESSION_POLICY.accessTokenSeconds * 1000);
}

export interface RefreshSessionState {
  expiresAt: Date;
  revokedAt: Date | null;
  /** Następca po rotacji; `null`, gdy token jest najnowszy w rodzinie albo został unieważniony bez rotacji. */
  replacedBy: string | null;
}

export type RefreshDecision =
  | { action: 'ROTATE' }
  | { action: 'REJECT'; revokeFamily: boolean; error: DomainError };

/** Co zrobić z tokenem odświeżającym, który przyszedł od klienta. */
export function assessRefresh(session: RefreshSessionState, now: Date): RefreshDecision {
  if (session.replacedBy && session.revokedAt) {
    const sinceRotationMs = now.getTime() - session.revokedAt.getTime();
    if (sinceRotationMs <= SESSION_POLICY.reuseGraceSeconds * 1000) {
      return { action: 'REJECT', revokeFamily: false, error: unauthenticated('SESSION_ROTATED') };
    }
    return { action: 'REJECT', revokeFamily: true, error: unauthenticated('SESSION_REUSED') };
  }
  if (session.revokedAt) return { action: 'REJECT', revokeFamily: false, error: unauthenticated('SESSION_REVOKED') };
  if (session.expiresAt.getTime() <= now.getTime()) {
    return { action: 'REJECT', revokeFamily: false, error: unauthenticated('SESSION_EXPIRED') };
  }
  return { action: 'ROTATE' };
}

/**
 * Brak ważnego uwierzytelnienia. Powód jest w `details` (do dziennika i testów); klient reaguje
 * tak samo na każdy: odświeża token albo wraca do logowania.
 */
export function unauthenticated(reason: string): DomainError {
  return new DomainError('UNAUTHENTICATED', { reason });
}
