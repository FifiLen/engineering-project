import { DomainError } from '@hulajnogi/core';

/** Ograniczenia unikalności, które zgłaszamy jako błąd pola formularza (`ALREADY_EXISTS`). */
const UNIQUE_FIELDS: Record<string, string> = {
  scooters_number_key: 'number',
  scooters_serial_number_key: 'serialNumber',
  scooter_models_code_key: 'code',
};

/**
 * Unikalność pilnuje baza (arc42 §8.3), a nie wcześniejsze sprawdzenie w kodzie, które nie wyklucza
 * wyścigu dwóch operatorów. Naruszenie zamieniamy na błąd domeny z nazwą pola.
 */
export function rethrowUniqueViolation(error: unknown): never {
  const cause =
    (error as { cause?: { code?: string; constraint?: string } }).cause ??
    (error as { code?: string; constraint?: string });
  if (cause?.code === '23505' && cause.constraint && UNIQUE_FIELDS[cause.constraint]) {
    throw new DomainError('ALREADY_EXISTS', { field: UNIQUE_FIELDS[cause.constraint] });
  }
  throw error;
}
