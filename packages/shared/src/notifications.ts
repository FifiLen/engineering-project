/**
 * Powiadomienia z szablonów (iteracja 6, ADR 0058). Rejestr wyznacza kody, kanał, parametry z typami i ekran
 * aplikacji otwierany po dotknięciu powiadomienia; panel edytuje tylko treść. Kody są kopią z packages/core
 * (`NOTIFICATION_TEMPLATE_CODES`), a walidację i renderowanie robi core; zgodność pilnuje test API.
 */
import { z } from 'zod';
import { TICKET_STATUSES } from './tickets.js';

export const NOTIFICATION_CHANNELS = ['PUSH', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const PUSH_PLATFORMS = ['IOS', 'ANDROID'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** `text` i `number` (kwoty i daty API formatuje przed renderowaniem), `select` z listą wartości. */
export const TEMPLATE_PARAM_TYPES = ['text', 'number', 'select'] as const;
export type TemplateParamType = (typeof TEMPLATE_PARAM_TYPES)[number];

export interface TemplateParam {
  name: string;
  type: TemplateParamType;
  options?: readonly string[];
  /** Szablon musi użyć parametru (`TEMPLATE_MISSING_PARAM`): bez niego wiadomość traci sens. */
  required?: boolean;
}

export interface NotificationTemplateDefinition {
  channel: NotificationChannel;
  params: readonly TemplateParam[];
  /**
   * Ekran aplikacji (Expo Router) w `data.path` powiadomienia; `[id]` zastępuje identyfikator zdarzenia
   * (`notificationPath`). `null` dla SMS.
   */
  path: string | null;
  /** Preferencja klienta, od której zależy wysyłka; `null`: zawsze. */
  preference: 'reservationEnd' | 'receipts' | null;
}

const text = (name: string): TemplateParam => ({ name, type: 'text' });
/** Parametr wymagany: kod logowania, numer zgłoszenia, kwota zaległości. */
const required = (param: TemplateParam): TemplateParam => ({ ...param, required: true });
const number = (name: string): TemplateParam => ({ name, type: 'number' });
const select = (name: string, options: readonly string[]): TemplateParam => ({ name, type: 'select', options });
const BOOLEAN = ['true', 'false'] as const;

/** Rejestr szablonów; dane startowe zakładają polskie szablony wszystkich kodów. */
export const NOTIFICATION_TEMPLATES = {
  reservation_ending: {
    channel: 'PUSH',
    params: [text('scooterNumber'), number('minutesLeft')],
    path: '/przejazd',
    preference: 'reservationEnd',
  },
  ride_ended: {
    channel: 'PUSH',
    // `towingFee` i `hasTowingFee`: opłata za odholowanie osobno (ADR 0060).
    params: [
      text('rideNumber'),
      number('minutes'),
      text('amount'),
      select('hasReceipt', BOOLEAN),
      text('towingFee'),
      select('hasTowingFee', BOOLEAN),
    ],
    path: '/podsumowanie/[id]',
    preference: 'receipts',
  },
  payment_failed: {
    channel: 'PUSH',
    params: [text('rideNumber'), required(text('amount'))],
    path: '/zaleglosc/[id]',
    preference: null,
  },
  battery_low: {
    channel: 'PUSH',
    params: [text('scooterNumber'), number('batteryPct')],
    path: '/przejazd',
    preference: null,
  },
  ticket_received: {
    channel: 'PUSH',
    params: [required(text('ticketNumber')), text('scooterNumber')],
    path: '/zgloszenie/[id]',
    preference: null,
  },
  ticket_status_changed: {
    channel: 'PUSH',
    // Status jako wybór, żeby etykiety statusów były w szablonie, nie w API (ADR 0027).
    params: [required(text('ticketNumber')), select('status', TICKET_STATUSES), text('reply')],
    path: '/zgloszenie/[id]',
    preference: null,
  },
  login_code: {
    channel: 'SMS',
    // Bez kodu SMS zablokowałby logowanie klientów.
    params: [required(text('code'))],
    path: null,
    preference: null,
  },
  data_export_ready: {
    channel: 'PUSH',
    // Eksport danych klienta (ADR 0069): data ważności pliku sformatowana przez API; zawsze wysyłane.
    params: [text('expiresAt')],
    path: '/profil/moje-dane',
    preference: null,
  },
} as const satisfies Record<string, NotificationTemplateDefinition>;

export type NotificationTemplateCode = keyof typeof NOTIFICATION_TEMPLATES;
export const NOTIFICATION_TEMPLATE_CODES = Object.keys(NOTIFICATION_TEMPLATES) as NotificationTemplateCode[];

export const isNotificationTemplateCode = (code: string): code is NotificationTemplateCode =>
  Object.hasOwn(NOTIFICATION_TEMPLATES, code);

/** Ekran otwierany z powiadomienia, np. `/podsumowanie/{rentalId}`; `null` dla SMS. */
export function notificationPath(code: NotificationTemplateCode, id?: string): string | null {
  const path: string | null = NOTIFICATION_TEMPLATES[code].path;
  if (!path) return null;
  return id === undefined ? path : path.replace('[id]', encodeURIComponent(id));
}

/** Limity znaków źródła szablonu (kopia `TEMPLATE_LIMITS` z core dla licznika w edytorze). */
export const TEMPLATE_LIMITS = { title: 50, body: 240, smsBody: 160 } as const;

// --- Tokeny push ----------------------------------------------------------------------------------

/** `POST /me/push-tokens`: upsert po tokenie Expo; token z innego konta przechodzi do nowego. */
export const pushTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/),
  platform: z.enum(PUSH_PLATFORMS),
});
export type PushTokenRequest = z.infer<typeof pushTokenSchema>;

/** `DELETE /me/push-tokens` przy wylogowaniu albo wyłączeniu powiadomień w systemie. */
export const pushTokenDeleteSchema = pushTokenSchema.pick({ token: true });
export type PushTokenDelete = z.infer<typeof pushTokenDeleteSchema>;

// --- Szablony w panelu ----------------------------------------------------------------------------

/** Zapis treści tworzy nową wersję (`notification_template_versions`); kod i kanał są stałe. */
export const notificationTemplateUpdateSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().max(200).nullable(),
  body: z.string().min(1).max(1000),
});
export type NotificationTemplateUpdate = z.infer<typeof notificationTemplateUpdateSchema>;

/** Przywrócenie wersji tworzy nową wersję z treścią starej. */
export const notificationTemplateRestoreSchema = z.object({
  version: z.number().int().min(1),
  fromVersion: z.number().int().min(1),
});
export type NotificationTemplateRestore = z.infer<typeof notificationTemplateRestoreSchema>;

/** Podgląd w edytorze na przykładowych wartościach (nie zapisują się). */
export const notificationTemplatePreviewSchema = z.object({
  title: z.string().max(200).nullable(),
  body: z.string().max(1000),
  values: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])).default({}),
});
export type NotificationTemplatePreview = z.infer<typeof notificationTemplatePreviewSchema>;

/** Problem szablonu z walidacji w core; `line` i `column` od 1 („Wiersz 5, znak 42”). */
export interface TemplateIssueView {
  code: string;
  field: 'title' | 'body';
  line?: number;
  column?: number;
  kind?: string;
  param?: string;
  option?: string;
  max?: number;
  length?: number;
}

export interface NotificationTemplatePreviewResult {
  issues: TemplateIssueView[];
  /** Treść po renderowaniu; `null`, gdy szablon ma błędy albo brakuje wartości. */
  rendered: { title: string | null; body: string } | null;
}

export interface NotificationTemplateView {
  id: string;
  code: NotificationTemplateCode;
  channel: NotificationChannel;
  title: string | null;
  body: string;
  version: number;
  description: string | null;
  params: readonly TemplateParam[];
  path: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface NotificationTemplateVersionView {
  version: number;
  title: string | null;
  body: string;
  staffName: string | null;
  createdAt: string;
  current: boolean;
}

// --- Powiadomienia klienta ------------------------------------------------------------------------

/** Powiadomienie po wysyłce: baner w wersji web (`notification.created`) i lista w aplikacji. */
export interface NotificationView {
  id: number;
  templateCode: NotificationTemplateCode;
  title: string | null;
  body: string;
  path: string | null;
  createdAt: string;
  readAt: string | null;
}
