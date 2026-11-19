/**
 * Zasoby panelu powiadomień (iteracja 6, ADR 0031, ADR 0058): szablony z wersjami, wysłane powiadomienia i tokeny
 * push. Kody szablonów wyznacza rejestr (`NOTIFICATION_TEMPLATES`), więc panel nie dodaje ani nie usuwa szablonów;
 * zapis treści tworzy nową wersję. Powiadomienia i tokeny powstają w API, panel tylko je przegląda.
 */
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TEMPLATE_CODES,
  notificationTemplateUpdateSchema,
  PUSH_PLATFORMS,
  type NotificationChannel,
  type NotificationStatus,
  type NotificationTemplateCode,
  type NotificationTemplateVersionView,
  type NotificationTemplateView,
  type PushPlatform,
} from '../notifications.js';
import type { ResourceDefinition } from './list.js';

// --- Szablony -------------------------------------------------------------------------------------

/** Szablony z `v_notification_templates`: podgląd `content.read`, zapis nowej wersji `content.write`. */
export const notificationTemplatesResource = {
  name: 'notification-templates',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    code: { type: 'enum', values: NOTIFICATION_TEMPLATE_CODES, filters: ['eq'], sortable: true },
    channel: { type: 'enum', values: NOTIFICATION_CHANNELS, filters: ['eq'], facet: true, sortable: true },
    title: { type: 'text', filters: ['contains'], sortable: true },
    body: { type: 'text', filters: ['contains'] },
    description: { type: 'text' },
    version: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedByName: { type: 'text', sortable: true },
    versions: { type: 'integer', sortable: true },
    lastSentAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    sent30d: { type: 'integer', sortable: true },
  },
  search: ['title', 'body', 'description'],
  defaultSort: ['code'],
  // Kody są stałe (rejestr w packages/shared); szablonu nie dodaje się ani nie usuwa.
  deleteMode: 'none',
  permissions: { read: 'content.read', write: 'content.write' },
  updateSchema: notificationTemplateUpdateSchema,
} as const satisfies ResourceDefinition;

export interface NotificationTemplateListItem {
  id: string;
  code: NotificationTemplateCode;
  channel: NotificationChannel;
  title: string | null;
  body: string;
  description: string | null;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
  versions: number;
  lastSentAt: string | null;
  sent30d: number;
}

/** Szczegóły w edytorze: bieżąca treść z parametrami z rejestru i historia wersji od najnowszej. */
export interface NotificationTemplateDetails extends NotificationTemplateView {
  versions: NotificationTemplateVersionView[];
}

// --- Wysłane powiadomienia ------------------------------------------------------------------------

/**
 * Powiadomienia z `v_notification_list` (zakładka „Wysłane”): podgląd z `content.read`, a imię i telefon klienta
 * tylko z `users.read` (bez niego API podaje `null`, nie szuka po nich i odrzuca filtr albo sortowanie po nich).
 */
export const notificationsResource = {
  name: 'notifications',
  fields: {
    id: { type: 'integer', filters: ['eq'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    sentAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    status: { type: 'enum', values: NOTIFICATION_STATUSES, filters: ['eq'], facet: true, sortable: true },
    channel: { type: 'enum', values: NOTIFICATION_CHANNELS, filters: ['eq'], facet: true },
    templateCode: { type: 'enum', values: NOTIFICATION_TEMPLATE_CODES, filters: ['eq'], facet: true, sortable: true },
    templateVersion: { type: 'integer', filters: ['eq'] },
    title: { type: 'text' },
    body: { type: 'text' },
    error: { type: 'text', filters: ['contains'] },
    dedupeKey: { type: 'text', filters: ['eq'] },
    providerRef: { type: 'text', filters: ['eq'] },
    readAt: { type: 'datetime', filters: ['gte', 'lte'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true, personal: true },
    userPhone: { type: 'text', filters: ['contains'], personal: true },
    rentalId: { type: 'uuid', filters: ['eq'] },
    rentalNumber: { type: 'integer', filters: ['eq'] },
    ticketId: { type: 'uuid', filters: ['eq'] },
    ticketNumber: { type: 'integer', filters: ['eq'] },
  },
  search: ['title', 'body', 'userName', 'userPhone', 'rentalNumber', 'ticketNumber'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'content.read' },
} as const satisfies ResourceDefinition;

/** Pola powiadomienia z danymi klienta: tylko z `users.read`. */
export const NOTIFICATION_PERSONAL_FIELDS = ['userName', 'userPhone'] as const;

export interface NotificationListItem {
  id: number;
  createdAt: string;
  sentAt: string | null;
  status: NotificationStatus;
  channel: NotificationChannel;
  templateCode: NotificationTemplateCode;
  templateVersion: number | null;
  title: string | null;
  body: string | null;
  /** Błąd bramki (`FAILED`), powód pominięcia (`SKIPPED`: `PREFERENCE_DISABLED`, `NO_PUSH_TOKEN`) albo potwierdzenia. */
  error: string | null;
  dedupeKey: string | null;
  providerRef: string | null;
  readAt: string | null;
  userId: string;
  /** `null` bez `users.read`. */
  userName: string | null;
  userPhone: string | null;
  rentalId: string | null;
  rentalNumber: number | null;
  ticketId: string | null;
  ticketNumber: number | null;
}

// --- Tokeny push ----------------------------------------------------------------------------------

/** Tokeny Expo z `v_push_tokens` ze stanem sesji klienta; dane konta, więc `users.read`. */
export const pushTokensResource = {
  name: 'push-tokens',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true, personal: true },
    userPhone: { type: 'text', filters: ['contains'], personal: true },
    platform: { type: 'enum', values: PUSH_PLATFORMS, filters: ['eq'], facet: true },
    expoToken: { type: 'text', filters: ['eq'] },
    sessionId: { type: 'uuid', filters: ['eq'] },
    sessionActive: { type: 'boolean', filters: ['eq'], facet: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    lastSeenAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['userName', 'userPhone', 'expoToken'],
  defaultSort: ['-lastSeenAt'],
  // Token usuwa wylogowanie, przejęcie przez inne konto albo `DeviceNotRegistered` (ADR 0058), nie operator.
  deleteMode: 'none',
  permissions: { read: 'users.read' },
} as const satisfies ResourceDefinition;

export interface PushTokenListItem {
  id: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  platform: PushPlatform;
  expoToken: string;
  sessionId: string | null;
  sessionActive: boolean;
  createdAt: string;
  lastSeenAt: string;
}
