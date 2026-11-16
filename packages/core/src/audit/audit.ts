/**
 * Dziennik audytu (ADR 0028): każdy zapis operatora w panelu zapisuje autora, akcję, obiekt i zmienione
 * pola. Wpis powstaje w tej samej transakcji co zmiana, więc nie ma zmiany bez wpisu.
 */

/** Akcja w postaci `obiekt.czynność`, np. `scooter.updated`, `role.permissions_changed`. */
export const AUDIT_ACTION_PATTERN = /^[a-z_]+\.[a-z_]+$/;

export interface AuditEntry {
  staffId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
}

/** Zmiana pola: wartość przed i po. */
export type FieldChange = [before: unknown, after: unknown];

/**
 * Pola, których wartości nigdy nie trafiają do dziennika. Zmianę takiego pola zapisujemy jako fakt
 * (`[REDACTED]` po obu stronach), np. „zmieniono hasło”.
 */
const SECRET_FIELD = /(password|secret|token|hash)/i;
export const REDACTED = '[REDACTED]';

/**
 * Pola zmienione między stanem przed i po zapisie. Porównuje tylko pola obecne w `after` (zapis
 * częściowy), pomija `version` i `updatedAt`, a daty porównuje po wartości.
 */
export function diffForAudit(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const [field, next] of Object.entries(after)) {
    if (field === 'version' || field === 'updatedAt' || next === undefined) continue;
    const prev = before[field];
    if (sameValue(prev, next)) continue;
    changes[field] = SECRET_FIELD.test(field) ? [REDACTED, REDACTED] : [normalize(prev), normalize(next)];
  }
  return changes;
}

/** Dane wpisu bez sekretów: dane wejściowe akcji (np. notatka blokady) przechodzą przez ten sam filtr. */
export function redactSecrets(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, SECRET_FIELD.test(k) ? REDACTED : normalize(v)]),
  );
}

export function auditEntry(entry: AuditEntry): AuditEntry {
  if (!AUDIT_ACTION_PATTERN.test(entry.action)) throw new Error(`Niepoprawna akcja audytu: ${entry.action}`);
  return { ...entry, data: redactSecrets(entry.data) };
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  }
  return value ?? null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
