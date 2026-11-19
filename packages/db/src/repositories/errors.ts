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
  zones_code_key: 'code',
  spare_parts_sku_key: 'sku',
  // Treści i wydruki (migracja 0011).
  faq_categories_name_key: 'name',
  media_assets_key_key: 'key',
  news_slug_key: 'slug',
  document_templates_document_type_name_key: 'name',
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
const DATABASE_RULES = [
  'LAST_ROLE_MANAGER',
  'USER_HAS_OPEN_RENTAL',
  'WALLET_BALANCE_NOT_ZERO',
  // Strefy (migracja 0006, ADR 0047): szczegół błędu to kod strefy, z którą jest konflikt.
  'ZONE_OUTSIDE_SERVICE_AREA',
  'ZONE_OVERLAP',
  'ZONE_TYPE_IMMUTABLE',
  'ZONE_IN_USE',
  'SERVICE_AREA_REQUIRED',
  // Płatności (migracja 0007, ADR 0049–0054).
  'TARIFF_IMMUTABLE',
  'TARIFF_ALREADY_SCHEDULED',
  'TARIFF_NOT_SCHEDULED',
  'TARIFF_IN_USE',
  'REFUND_EXCEEDS_PAYMENT',
  'RECEIPT_CORRECTION_EXCEEDS',
  'LEDGER_APPEND_ONLY',
  'LEDGER_BALANCE_MISMATCH',
  // Operacje i serwis (migracja 0008, ADR 0055): szczegół przejścia to `FROM->TO`, stanu części liczba sztuk.
  'INVALID_TICKET_TRANSITION',
  'INVALID_TASK_TRANSITION',
  'TASK_RESULT_NOTE_REQUIRED',
  'TASK_CANCEL_REASON_REQUIRED',
  'TASK_NOT_IN_PROGRESS',
  'PART_QUANTITY_INVALID',
  'PART_INACTIVE',
  'PART_OUT_OF_STOCK',
  'PART_RETURN_EXCEEDS',
  'PART_ADJUST_NO_CHANGE',
  'PART_MOVEMENTS_APPEND_ONLY',
  // Treści, media, szablony wydruków i eksport danych (migracja 0011, ADR 0062–0069): szczegół grafiki systemowej
  // to jej klucz, zablokowanego adresu aktualności slug, a limitu eksportu czas następnego zlecenia (ISO 8601).
  'CONTENT_DELETE_PUBLISHED',
  'NEWS_SLUG_LOCKED',
  'COMPANY_PROFILE_REQUIRED',
  'MEDIA_SYSTEM',
  'MEDIA_KEY_IMMUTABLE',
  'MEDIA_FILE_INVALID',
  'TEMPLATE_FILE_INVALID',
  'TEMPLATE_VERSION_IMMUTABLE',
  'TEMPLATE_VERSION_NOT_PENDING',
  'TEMPLATE_INACTIVE',
  'TEMPLATE_NO_ACTIVE_VERSION',
  'DATA_EXPORT_LIMIT',
] as const;

/** Szczegół błędu z bazy (`DETAIL`) w odpowiedzi API: kod strefy albo kwota do zwrotu. */
const RULE_DETAILS: Partial<Record<(typeof DATABASE_RULES)[number], (detail: string) => Record<string, unknown>>> = {
  ZONE_OUTSIDE_SERVICE_AREA: (zoneCode) => ({ zoneCode }),
  ZONE_OVERLAP: (zoneCode) => ({ zoneCode }),
  ZONE_IN_USE: (zoneCode) => ({ zoneCode }),
  SERVICE_AREA_REQUIRED: (zoneCode) => ({ zoneCode }),
  REFUND_EXCEEDS_PAYMENT: (remaining) => ({ remaining: Number(remaining) }),
  INVALID_TICKET_TRANSITION: (transition) => transitionDetails(transition),
  INVALID_TASK_TRANSITION: (transition) => transitionDetails(transition),
  PART_OUT_OF_STOCK: (available) => ({ available: Number(available) }),
  PART_RETURN_EXCEEDS: (quantity) => ({ quantity: Number(quantity) }),
  NEWS_SLUG_LOCKED: (slug) => ({ slug }),
  MEDIA_SYSTEM: (key) => ({ key }),
  MEDIA_KEY_IMMUTABLE: (key) => ({ key }),
  DATA_EXPORT_LIMIT: (nextAllowedAt) => ({ nextAllowedAt }),
};

/** `OPEN->DONE` z wyzwalacza przejść; nowy rekord nie ma stanu wyjściowego (`->DONE`). */
function transitionDetails(transition: string): Record<string, unknown> {
  const [from, to] = transition.split('->');
  return { from: from || null, to };
}

/** Brak rekordu zgłoszony przez procedurę bazy. */
const NOT_FOUND_RULES: Record<string, string> = {
  TARIFF_NOT_FOUND: 'tariff',
  RENTAL_NOT_FOUND: 'rental',
  PAYMENT_NOT_FOUND: 'payment',
  RECEIPT_NOT_FOUND: 'receipt',
  WALLET_NOT_FOUND: 'wallet',
  PART_NOT_FOUND: 'spare_part',
  TASK_NOT_FOUND: 'service_task',
  TASK_PART_NOT_FOUND: 'service_task_part',
  USER_NOT_FOUND: 'user',
  TEMPLATE_NOT_FOUND: 'document_template',
  TEMPLATE_VERSION_NOT_FOUND: 'document_template_version',
};

/**
 * Indeksy częściowe przejazdu (ADR 0036): wyścig, którego nie wyłapała blokada wiersza, kończy się
 * tym samym błędem co sprawdzenie w core.
 */
const RENTAL_CONSTRAINTS: Record<string, string> = {
  rentals_one_open_per_user: 'RENTAL_ALREADY_OPEN',
  rentals_one_open_per_scooter: 'SCOOTER_UNAVAILABLE',
  scooter_commands_one_pending_per_rental: 'RENTAL_COMMAND_PENDING',
  zones_one_active_service_area: 'SERVICE_AREA_REQUIRED',
  payments_one_pending_per_rental: 'PAYMENT_IN_PROGRESS',
  wallet_ledger_one_charge_per_rental: 'RENTAL_ALREADY_CHARGED',
  receipts_one_sale_per_rental: 'RECEIPT_ALREADY_ISSUED',
  // Operacje (migracja 0008): drugie otwarte zgłoszenie automatyczne albo zadanie tego samego rodzaju, druga
  // opłata za odholowanie i drugie powiadomienie o tym samym zdarzeniu.
  tickets_one_open_auto_per_scooter: 'AUTO_TICKET_ALREADY_OPEN',
  service_tasks_one_open_per_type: 'TASK_ALREADY_OPEN',
  wallet_ledger_one_fee_per_rental: 'RENTAL_ALREADY_CHARGED',
  notifications_dedupe_key_key: 'NOTIFICATION_DUPLICATE',
  ticket_photos_one_per_position: 'TICKET_TOO_MANY_PHOTOS',
  // Poprawki po przeglądzie (migracja 0009): plik przypięty w dwóch miejscach naraz (wyścig przypięcia) i to samo
  // zdjęcie dwa razy w zgłoszeniu.
  rentals_parking_photo_unique: 'FILE_ALREADY_ATTACHED',
  ticket_photos_file_unique: 'FILE_ALREADY_ATTACHED',
  ticket_photos_pkey: 'FILE_ALREADY_ATTACHED',
  // Treści i wydruki (migracja 0011): druga pozycja sekcji przy zatwierdzeniu (ograniczenie odroczone), drugie
  // zlecenie eksportu w toku i druga aktywna wersja szablonu (wyścig, którego nie wyłapała blokada szablonu).
  content_blocks_key_position: 'CONTENT_POSITION_TAKEN',
  data_exports_one_open: 'DATA_EXPORT_IN_PROGRESS',
  document_template_versions_one_active: 'TEMPLATE_ALREADY_ACTIVE',
  document_templates_one_default: 'TEMPLATE_ALREADY_DEFAULT',
};

/** Klucze obce, które chronią rekord w użyciu (migracja 0011): grafika w bloku, aktualności albo modelu, kategoria z pytaniami. */
const FOREIGN_KEYS: Record<string, string> = {
  content_blocks_media_id_fkey: 'MEDIA_IN_USE',
  news_media_id_fkey: 'MEDIA_IN_USE',
  scooter_models_photo_media_id_fkey: 'MEDIA_IN_USE',
  faq_items_category_id_fkey: 'FAQ_CATEGORY_NOT_EMPTY',
};

/** Ograniczenia CHECK geometrii i pól strefy (`ST_IsValid` z 0001, limit tylko w wolnej jeździe z 0006). */
const CHECK_CONSTRAINTS: Record<string, string> = {
  zones_geom_check: 'ZONE_INVALID_GEOMETRY',
  zones_check: 'VALIDATION_FAILED',
  zones_check1: 'VALIDATION_FAILED',
  zones_speed_limit_only_slow: 'VALIDATION_FAILED',
  refunds_check2: 'VALIDATION_FAILED',
  tariffs_free_reservation_range: 'TARIFF_INVALID',
  tariffs_min_user_age_range: 'TARIFF_INVALID',
  tariffs_vat_rate_check: 'TARIFF_INVALID',
  tickets_urgent_from_categories: 'VALIDATION_FAILED',
  tickets_auto_kind_source: 'VALIDATION_FAILED',
  tickets_auto_kind_category: 'VALIDATION_FAILED',
  tickets_system_categories: 'TICKET_CATEGORY_NOT_ALLOWED',
  tickets_billing_has_rental: 'TICKET_RENTAL_REQUIRED',
  ticket_photos_position_range: 'TICKET_TOO_MANY_PHOTOS',
  service_tasks_relocation_target: 'VALIDATION_FAILED',
  spare_part_movements_other_note: 'VALIDATION_FAILED',
  notification_templates_title_length: 'TEMPLATE_TOO_LONG',
  notification_templates_body_length: 'TEMPLATE_TOO_LONG',
  // Przyczyna stanu niezgodna ze stanem hulajnogi (ADR 0055); wyzwalacz z 0009 dopasowuje ją przy zmianie stanu.
  scooters_status_reason_matches: 'VALIDATION_FAILED',
  // Treści (migracja 0011): adres przycisku spoza dozwolonych schematów, ikona spoza listy, klucz sekcji innego
  // klienta, pytanie niewidoczne nigdzie, zajawka i tekst alternatywny poza limitem, dane firmy w złym formacie.
  content_blocks_cta_url: 'CONTENT_LINK_SCHEME',
  content_blocks_icon: 'CONTENT_ICON_UNKNOWN',
  content_blocks_icon_item: 'VALIDATION_FAILED',
  content_blocks_key_client: 'VALIDATION_FAILED',
  content_blocks_check: 'VALIDATION_FAILED',
  content_blocks_has_content: 'VALIDATION_FAILED',
  faq_items_visible_somewhere: 'FAQ_NOT_VISIBLE',
  news_lead_length: 'VALIDATION_FAILED',
  media_assets_alt_text_length: 'VALIDATION_FAILED',
  media_assets_system_key: 'VALIDATION_FAILED',
  company_profile_address: 'VALIDATION_FAILED',
  company_profile_postal_code_check: 'VALIDATION_FAILED',
  company_profile_tax_id_check: 'VALIDATION_FAILED',
  company_profile_regon_check: 'VALIDATION_FAILED',
  company_profile_krs_check: 'VALIDATION_FAILED',
  company_profile_support_hours_check: 'VALIDATION_FAILED',
};

export function rethrowDatabaseRule(error: unknown): never {
  // Błąd domeny z reguły w core przechodzi bez zmian (szczegóły zostają).
  if (error instanceof DomainError) throw error;
  const cause =
    (error as { cause?: { message?: string; code?: string; constraint?: string; detail?: string } }).cause ??
    (error as { message?: string; code?: string; constraint?: string; detail?: string });
  const rule = DATABASE_RULES.find((r) => cause?.message === r);
  if (rule) throw new DomainError(rule, cause?.detail ? RULE_DETAILS[rule]?.(cause.detail) : undefined);
  const entity = cause?.message ? NOT_FOUND_RULES[cause.message] : undefined;
  if (entity) throw new DomainError('NOT_FOUND', { entity });
  if (cause?.code === '23514' && cause.constraint && CHECK_CONSTRAINTS[cause.constraint]) {
    throw new DomainError(CHECK_CONSTRAINTS[cause.constraint]!);
  }
  if (cause?.code === '23505' && cause.constraint && RENTAL_CONSTRAINTS[cause.constraint]) {
    throw new DomainError(RENTAL_CONSTRAINTS[cause.constraint]!);
  }
  if (cause?.code === '23503' && cause.constraint && FOREIGN_KEYS[cause.constraint]) {
    throw new DomainError(FOREIGN_KEYS[cause.constraint]!);
  }
  rethrowUniqueViolation(error);
}
