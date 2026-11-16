import { DomainError } from './errors.js';

/**
 * Blokada optymistyczna (ADR 0031): zapis podaje wersję, którą operator widział. Gdy rekord zmienił się
 * w międzyczasie, zapis kończy się błędem `CONFLICT` z aktualną wersją, a panel pokazuje porównanie.
 */
export function ensureVersion(expected: number, current: number): void {
  if (expected !== current) throw new DomainError('CONFLICT', { expectedVersion: expected, currentVersion: current });
}

/** Brak rekordu, którego dotyczy polecenie. */
export function notFound(entity: string, id: string): DomainError {
  return new DomainError('NOT_FOUND', { entity, id });
}
