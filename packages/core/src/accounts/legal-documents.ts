import { DomainError } from '../errors.js';

/**
 * Dokumenty z wersjami (regulamin, polityka prywatności, zasady jazdy; ADR 0027). Opublikowanej wersji
 * nie zmieniamy, bo wskazują ją zgody klientów: poprawka to nowa wersja robocza.
 */
export const DOCUMENT_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

export interface DocumentVersionState {
  status: DocumentVersionStatus;
  title: string;
  bodyMd: string;
  changeSummary: string | null;
}

export function ensureDraftEditable(version: Pick<DocumentVersionState, 'status'>): void {
  if (version.status !== 'DRAFT') throw new DomainError('DOCUMENT_VERSION_LOCKED', { status: version.status });
}

/** Dokument ma najwyżej jedną wersję roboczą: następna powstaje z obowiązującej po publikacji. */
export function ensureCanStartDraft(hasDraft: boolean): void {
  if (hasDraft) throw new DomainError('DRAFT_EXISTS');
}

/**
 * Publikacja. Dokument ze zgodą (z wyjątkiem pierwszej wersji) wymaga „najważniejszych zmian”, bo
 * klient zobaczy je przy ponownej akceptacji.
 */
export function ensurePublishable(version: DocumentVersionState, requiresConsent: boolean, isFirstVersion: boolean): void {
  ensureDraftEditable(version);
  const missing: string[] = [];
  if (version.title.trim().length === 0) missing.push('title');
  if (version.bodyMd.trim().length === 0) missing.push('bodyMd');
  if (requiresConsent && !isFirstVersion && !version.changeSummary?.trim()) missing.push('changeSummary');
  if (missing.length > 0) throw new DomainError('VALIDATION_FAILED', { fields: missing });
}

/** Numer nowej wersji: kolejny po najwyższym (także archiwalnym). */
export function nextVersionNo(highest: number | null): number {
  return (highest ?? 0) + 1;
}
