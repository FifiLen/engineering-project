import type { NotificationChannel } from './templates.js';

/**
 * Powiadomienia z szablonów (ADR 0058). Kody są kopią rejestru z packages/shared (`NOTIFICATION_TEMPLATES`);
 * zgodność pilnuje test API, jak przy innych wyliczeniach.
 */
export const NOTIFICATION_TEMPLATE_CODES = [
  'reservation_ending',
  'ride_ended',
  'payment_failed',
  'battery_low',
  'ticket_received',
  'ticket_status_changed',
  'login_code',
] as const;
export type NotificationTemplateCode = (typeof NOTIFICATION_TEMPLATE_CODES)[number];

/** Stan wysyłki (`notifications.status`). */
export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Preferencje klienta (`notify_reservation_end`, `notify_receipts`) w nazwach z `NotificationPreferences`. */
export interface NotificationPreferences {
  reservationEnd: boolean;
  receipts: boolean;
}

/** Kody zależne od preferencji; pozostałe (bateria, płatność, zgłoszenia, kod SMS) idą zawsze. */
export const NOTIFICATION_PREFERENCE: Partial<Record<NotificationTemplateCode, keyof NotificationPreferences>> = {
  reservation_ending: 'reservationEnd',
  ride_ended: 'receipts',
};

export type NotificationSkipReason = 'PREFERENCE_DISABLED' | 'NO_PUSH_TOKEN';

export type NotificationDelivery = { send: true } | { send: false; reason: NotificationSkipReason };

/**
 * Decyzja zadania `notification.send`: wyłączona preferencja albo brak tokenu push daje `SKIPPED` z powodem.
 * SMS (kod logowania) nie zależy od preferencji ani tokenów.
 */
export function notificationDelivery(input: {
  code: NotificationTemplateCode;
  channel: NotificationChannel;
  preferences: NotificationPreferences;
  pushTokens: number;
}): NotificationDelivery {
  if (input.channel === 'SMS') return { send: true };
  const preference = NOTIFICATION_PREFERENCE[input.code];
  if (preference && !input.preferences[preference]) return { send: false, reason: 'PREFERENCE_DISABLED' };
  if (input.pushTokens <= 0) return { send: false, reason: 'NO_PUSH_TOKEN' };
  return { send: true };
}

/**
 * Klucz idempotencji (`notifications.dedupe_key`, unikalny): kod i identyfikatory zdarzenia, np. `ride_ended:{rentalId}`,
 * `battery_low:{rentalId}:CRITICAL`, `ticket_status_changed:{ticketId}:{version}`.
 */
export const notificationDedupeKey = (
  code: NotificationTemplateCode,
  ...parts: ReadonlyArray<string | number>
): string => [code, ...parts].join(':');
