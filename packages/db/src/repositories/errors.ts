import { DomainError } from '@hulajnogi/core';

/** Ograniczenia unikalności, które zgłaszamy jako błąd pola formularza (`ALREADY_EXISTS`). */
const UNIQUE_FIELDS: Record<string, string> = {
  scooters_number_key: 'number',
  scooters_serial_number_key: 'serialNumber',
  scooter_models_code_key: 'code',
  users_phone_key: 'phone',
  users_email_key: 'email',
  staff_email_key: 'email',
  roles_name_key: 'name',
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

/**
 * Reguły pilnowane przez bazę, które zgłaszamy jako błąd domeny. Strażnik ostatniego zarządzającego
 * rolami (migracja 0004) jest odroczony: w transakcji błąd przychodzi przy zatwierdzeniu, więc serwis
 * w API przepuszcza przez tę funkcję także błąd całej transakcji.
 */
const DATABASE_RULES = ['LAST_ROLE_MANAGER', 'USER_HAS_OPEN_RENTAL', 'WALLET_BALANCE_NOT_ZERO'] as const;

/**
 * Indeksy częściowe przejazdu (ADR 0036): wyścig, którego nie wyłapała blokada wiersza, kończy się
 * tym samym błędem co sprawdzenie w core.
 */
const RENTAL_CONSTRAINTS: Record<string, string> = {
  rentals_one_open_per_user: 'RENTAL_ALREADY_OPEN',
  rentals_one_open_per_scooter: 'SCOOTER_UNAVAILABLE',
  scooter_commands_one_pending_per_rental: 'RENTAL_COMMAND_PENDING',
};

export function rethrowDatabaseRule(error: unknown): never {
  const cause =
    (error as { cause?: { message?: string; code?: string; constraint?: string } }).cause ??
    (error as { message?: string; code?: string; constraint?: string });
  const rule = DATABASE_RULES.find((r) => cause?.message === r);
  if (rule) throw new DomainError(rule);
  if (cause?.code === '23505' && cause.constraint && RENTAL_CONSTRAINTS[cause.constraint]) {
    throw new DomainError(RENTAL_CONSTRAINTS[cause.constraint]!);
  }
  rethrowUniqueViolation(error);
}
