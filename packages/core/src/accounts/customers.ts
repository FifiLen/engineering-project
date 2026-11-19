import { DomainError } from '../errors.js';

/** Konto klienta: rejestracja, zgody i blokada (ADR 0019, ADR 0028). */

export const USER_STATUSES = ['ACTIVE', 'BLOCKED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Powód blokady widoczny dla klienta; notatka operatora trafia tylko do dziennika audytu. */
export const BLOCK_REASONS = ['TERMS_VIOLATION', 'UNPAID_BALANCE', 'SUSPECTED_ABUSE'] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const CONSENT_TYPES = ['TERMS', 'PRIVACY', 'AGE', 'MARKETING'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Bez tych zgód konto nie jest gotowe do jazdy; zgoda marketingowa jest dobrowolna. */
export const REQUIRED_CONSENTS = ['TERMS', 'PRIVACY', 'AGE'] as const satisfies readonly ConsentType[];
/** Zgody dotyczące dokumentu z wersjami: przy nowej wersji klient akceptuje ją ponownie. */
export const DOCUMENT_CONSENTS = ['TERMS', 'PRIVACY'] as const satisfies readonly ConsentType[];

export function isDocumentConsent(type: ConsentType): boolean {
  return (DOCUMENT_CONSENTS as readonly ConsentType[]).includes(type);
}

export interface CustomerState {
  status: UserStatus;
  name: string | null;
}

/** Aktualne zgody klienta: rodzaj i to, czy dotyczy obowiązującej wersji dokumentu (`v_user_consents`). */
export interface ConsentStatus {
  type: ConsentType;
  isCurrent: boolean;
}

export function missingRequiredConsents(consents: readonly ConsentStatus[]): ConsentType[] {
  const current = new Set(consents.filter((c) => c.isCurrent).map((c) => c.type));
  return REQUIRED_CONSENTS.filter((t) => !current.has(t));
}

/**
 * Dokąd aplikacja kieruje klienta po zalogowaniu albo uruchomieniu: dane (imię, wiek, zgody
 * z rejestracji), akceptacja nowej wersji dokumentu, ekran blokady albo mapa.
 */
export type CustomerNextStep = 'PROFILE' | 'CONSENTS' | 'BLOCKED' | 'READY';

export function customerNextStep(customer: CustomerState, consents: readonly ConsentStatus[]): CustomerNextStep {
  if (customer.status === 'BLOCKED') return 'BLOCKED';
  const missing = missingRequiredConsents(consents);
  // Nowy klient nie ma imienia ani zgody na wiek: kończy rejestrację na ekranie danych.
  if (!customer.name || missing.includes('AGE')) return 'PROFILE';
  if (missing.length > 0) return 'CONSENTS';
  return 'READY';
}

/**
 * Czy klient może rozpocząć wypożyczenie (sprawdzane od iteracji 3 przy rezerwacji). Bez akceptacji
 * obowiązującej wersji dokumentu klient widzi mapę, ale nie zarezerwuje hulajnogi.
 */
export function ensureCustomerCanRent(customer: CustomerState, consents: readonly ConsentStatus[]): void {
  if (customer.status === 'DELETED') throw new DomainError('USER_DELETED');
  if (customer.status === 'BLOCKED') throw new DomainError('ACCOUNT_BLOCKED');
  const missing = missingRequiredConsents(consents);
  if (!customer.name || missing.length > 0) throw new DomainError('CONSENT_REQUIRED', { missing });
}

/**
 * Zakończenie rejestracji: imię, potwierdzenie wieku i akceptacja obowiązujących dokumentów.
 * Wiek pochodzi z obowiązującej wersji cennika (`tariffs.min_user_age`), więc tekst zgody go podaje.
 */
export interface RegistrationInput {
  name: string;
  ageConfirmed: boolean;
  acceptedDocuments: readonly ConsentType[];
}

export function ensureRegistrationComplete(input: RegistrationInput): void {
  if (input.name.trim().length === 0) throw new DomainError('VALIDATION_FAILED', { field: 'name' });
  if (!input.ageConfirmed) throw new DomainError('AGE_NOT_CONFIRMED');
  const missing = DOCUMENT_CONSENTS.filter((t) => !input.acceptedDocuments.includes(t));
  if (missing.length > 0) throw new DomainError('CONSENT_REQUIRED', { missing });
}

export function ensureCanBlock(status: UserStatus): void {
  if (status === 'DELETED') throw new DomainError('USER_DELETED');
  if (status === 'BLOCKED') throw new DomainError('ALREADY_BLOCKED');
}

export function ensureCanUnblock(status: UserStatus): void {
  if (status !== 'BLOCKED') throw new DomainError('NOT_BLOCKED');
}

/**
 * Zgoda na dokument dotyczy obowiązującej wersji: klient z ekranu sprzed publikacji nowej wersji
 * dostaje `DOCUMENT_VERSION_OUTDATED` i aplikacja pokazuje mu aktualną treść.
 */
export function ensureAcceptingCurrentVersion(acceptedVersionId: string, currentVersionId: string | null): void {
  if (currentVersionId === null) throw new DomainError('DOCUMENT_NOT_PUBLISHED');
  if (acceptedVersionId !== currentVersionId) {
    throw new DomainError('DOCUMENT_VERSION_OUTDATED', { currentVersionId });
  }
}

/** Zgodę wycofać można tylko dobrowolną; wymaganych nie wycofuje się bez usunięcia konta. */
export function ensureConsentRevocable(type: ConsentType): void {
  if ((REQUIRED_CONSENTS as readonly ConsentType[]).includes(type)) throw new DomainError('CONSENT_REQUIRED_FOR_ACCOUNT');
}

/**
 * Operator wycofuje tylko zgodę marketingową (ADR 0076): regulamin, polityka prywatności i wiek są warunkami konta,
 * więc ich wycofanie z panelu to `CONSENT_NOT_REVOCABLE`. Zgoda już wycofana niczego nie zmienia (bez wpisu).
 */
export function staffConsentRevocation(type: ConsentType, revokedAt: Date | null): 'REVOKE' | 'UNCHANGED' {
  if (type !== 'MARKETING') throw new DomainError('CONSENT_NOT_REVOCABLE', { type });
  return revokedAt ? 'UNCHANGED' : 'REVOKE';
}
