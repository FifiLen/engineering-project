/**
 * Nowe listy kont i dostępu (iteracja 8, ADR 0076 „Miejsca w panelu”): Użytkownicy → Zgody, Sesje, Kody SMS; karta
 * klienta → Zapisane miejsca; Operatorzy i role → Sesje, Zaproszenia, Uprawnienia. Widoki z migracji 0013 (bez
 * skrótów tokenów i kodów). Sesje mają jeden wiersz na rodzinę tokenów (`id` to `family_id`), a unieważnienie
 * obejmuje całą rodzinę; token dostępu działa jeszcze do 15 min (ADR 0035).
 */
import { z } from 'zod';
import { CONSENT_TYPES, USER_STATUSES, type ConsentType, type UserStatus } from './access.js';
import type { ResourceDefinition } from './list.js';

export const CONSENT_SOURCES = ['REGISTRATION', 'APP', 'PANEL'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
/** Stan zgody jak na karcie klienta (`v_consent_list.state`). */
export const CONSENT_STATES = ['CURRENT', 'OUTDATED', 'SUPERSEDED', 'CONFIRMED', 'REVOKED'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];
export const SESSION_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;
export type SessionPlatform = (typeof SESSION_PLATFORMS)[number];
export const SESSION_STATES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;
export type SessionState = (typeof SESSION_STATES)[number];
export const INVITATION_STATES = ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED', 'REPLACED'] as const;
export type InvitationState = (typeof INVITATION_STATES)[number];
export const OTP_PURPOSES = ['LOGIN', 'REGISTER'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];
export const OTP_STATES = ['ACTIVE', 'CONSUMED', 'BLOCKED', 'EXPIRED'] as const;
export type OtpState = (typeof OTP_STATES)[number];
export const PLACE_LABELS = ['HOME', 'WORK', 'CUSTOM'] as const;
export type PlaceLabel = (typeof PLACE_LABELS)[number];

// --- Zgody ----------------------------------------------------------------------------------------------

export const consentsResource = {
  name: 'consents',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true, personal: true },
    userPhone: { type: 'text', filters: ['contains'], personal: true },
    userStatus: { type: 'enum', values: USER_STATUSES, filters: ['eq'], facet: true },
    type: { type: 'enum', values: CONSENT_TYPES, filters: ['eq'], facet: true, sortable: true },
    documentVersion: { type: 'text', filters: ['eq'] },
    versionNo: { type: 'integer', filters: ['eq'], sortable: true },
    documentTitle: { type: 'text', sortable: true },
    source: { type: 'enum', values: CONSENT_SOURCES, filters: ['eq'], facet: true },
    acceptedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    revokedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    revokedByStaff: { type: 'uuid', filters: ['eq'] },
    revokedByName: { type: 'text' },
    currentVersionNo: { type: 'integer' },
    isLatest: { type: 'boolean', filters: ['eq'], facet: true },
    state: { type: 'enum', values: CONSENT_STATES, filters: ['eq'], facet: true, sortable: true },
    stateAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['userName', 'userPhone', 'documentTitle'],
  defaultSort: ['-stateAt'],
  // Tabela procesu: operator wycofuje tylko zgodę marketingową (`POST /admin/consents/{id}/revoke`).
  deleteMode: 'none',
  permissions: { read: 'users.read', write: 'users.manage' },
} as const satisfies ResourceDefinition;

/** Wycofanie zgody marketingowej przez operatora z powodem (`consent.revoked` w dzienniku audytu). */
export const consentRevokeSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type ConsentRevoke = z.infer<typeof consentRevokeSchema>;

export interface ConsentListItem {
  id: string;
  userId: string;
  /** `null` bez `users.read` nie występuje: lista wymaga `users.read`. */
  userName: string | null;
  userPhone: string | null;
  userStatus: UserStatus;
  type: ConsentType;
  documentVersion: string;
  versionNo: number | null;
  documentTitle: string | null;
  /** `null` w zgodach sprzed migracji 0013 („brak danych”). */
  source: ConsentSource | null;
  acceptedAt: string;
  revokedAt: string | null;
  revokedByStaff: string | null;
  revokedByName: string | null;
  currentVersionNo: number | null;
  isLatest: boolean;
  state: ConsentState;
  stateAt: string;
}

// --- Sesje klientów ---------------------------------------------------------------------------------------

export const sessionsResource = {
  name: 'sessions',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    shortId: { type: 'text', filters: ['eq'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true, personal: true },
    userPhone: { type: 'text', filters: ['contains'], personal: true },
    userStatus: { type: 'enum', values: USER_STATUSES, filters: ['eq'], facet: true },
    // Nazwa urządzenia nadana przez klienta (np. „iPhone Anny”) może zawierać imię.
    deviceName: { type: 'text', filters: ['contains'], sortable: true, personal: true },
    platform: { type: 'enum', values: SESSION_PLATFORMS, filters: ['eq'], facet: true, sortable: true },
    appVersion: { type: 'text', filters: ['eq'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    lastUsedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    expiresAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    revokedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    rotations: { type: 'integer', filters: ['gte'], sortable: true },
    state: { type: 'enum', values: SESSION_STATES, filters: ['eq'], facet: true, sortable: true },
  },
  search: ['userName', 'userPhone', 'deviceName', 'shortId'],
  defaultSort: ['-lastUsedAt'],
  // Unieważnienie rodziny tokenów: `POST /admin/sessions/{id}/revoke` (`users.manage`, `session.revoked`).
  deleteMode: 'none',
  permissions: { read: 'users.read', write: 'users.manage' },
} as const satisfies ResourceDefinition;

export interface SessionListItem {
  id: string;
  shortId: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  userStatus: UserStatus;
  deviceName: string | null;
  platform: SessionPlatform | null;
  appVersion: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  rotations: number;
  state: SessionState;
}

// --- Sesje operatorów ---------------------------------------------------------------------------------------

export const staffSessionsResource = {
  name: 'staff-sessions',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    shortId: { type: 'text', filters: ['eq'] },
    staffId: { type: 'uuid', filters: ['eq'] },
    staffName: { type: 'text', sortable: true, personal: true },
    staffEmail: { type: 'text', filters: ['contains'], personal: true },
    // Przeglądarkę i system z `user_agent` rozbiera API.
    userAgent: { type: 'text', filters: ['contains'] },
    remembered: { type: 'boolean', filters: ['eq'], facet: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    lastUsedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    expiresAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    revokedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    rotations: { type: 'integer', filters: ['gte'], sortable: true },
    state: { type: 'enum', values: SESSION_STATES, filters: ['eq'], facet: true, sortable: true },
  },
  search: ['staffName', 'staffEmail', 'shortId'],
  defaultSort: ['-lastUsedAt'],
  deleteMode: 'none',
  permissions: { read: 'staff.read', write: 'staff.manage' },
} as const satisfies ResourceDefinition;

export interface StaffSessionListItem {
  id: string;
  shortId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  userAgent: string | null;
  remembered: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  rotations: number;
  state: SessionState;
}

// --- Zaproszenia operatorów --------------------------------------------------------------------------------

export const staffInvitationsResource = {
  name: 'staff-invitations',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    staffId: { type: 'uuid', filters: ['eq'] },
    staffName: { type: 'text', sortable: true, personal: true },
    staffEmail: { type: 'text', filters: ['contains'], sortable: true, personal: true },
    staffActive: { type: 'boolean', filters: ['eq'] },
    staffRoles: { type: 'text', array: true, filters: ['eq'] },
    invitedBy: { type: 'uuid', filters: ['eq'] },
    invitedByName: { type: 'text', sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    expiresAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    acceptedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    revokedAt: { type: 'datetime', filters: ['gte', 'lte'] },
    replacedBy: { type: 'uuid', filters: ['eq'] },
    isResend: { type: 'boolean', filters: ['eq'], facet: true },
    state: { type: 'enum', values: INVITATION_STATES, filters: ['eq'], facet: true, sortable: true },
  },
  search: ['staffName', 'staffEmail', 'invitedByName'],
  defaultSort: ['-createdAt'],
  // Ponowne wysłanie i unieważnienie: polecenia z `staff.manage` (`staff.invitation_revoked`).
  deleteMode: 'none',
  permissions: { read: 'staff.read', write: 'staff.manage' },
} as const satisfies ResourceDefinition;

export interface StaffInvitationListItem {
  id: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  staffActive: boolean;
  staffRoles: string[];
  /** `null`: zaproszenie z polecenia `pnpm db:staff:create`. */
  invitedBy: string | null;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  replacedBy: string | null;
  isResend: boolean;
  state: InvitationState;
}

// --- Kody SMS --------------------------------------------------------------------------------------------

export const otpCodesResource = {
  name: 'otp-codes',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    // Numer zamaskowany w bazie do trzech ostatnich cyfr; pełny numer nie wychodzi z widoku.
    phoneMasked: { type: 'text' },
    phoneLast3: { type: 'text', filters: ['eq'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true, personal: true },
    purpose: { type: 'enum', values: OTP_PURPOSES, filters: ['eq'], facet: true, sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    expiresAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    attempts: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    consumedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    state: { type: 'enum', values: OTP_STATES, filters: ['eq'], facet: true, sortable: true },
    purgeable: { type: 'boolean', filters: ['eq'], facet: true },
  },
  search: ['phoneLast3', 'userName'],
  defaultSort: ['-createdAt'],
  // „Usuń wygasłe” (`POST /admin/otp-codes/purge`, `sp_purge_expired_otp`): `users.manage`, wpis `otp.purged`.
  deleteMode: 'none',
  permissions: { read: 'users.read', write: 'users.manage', delete: 'users.manage' },
} as const satisfies ResourceDefinition;

export interface OtpCodeListItem {
  id: string;
  phoneMasked: string;
  phoneLast3: string;
  userId: string | null;
  userName: string | null;
  purpose: OtpPurpose;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  consumedAt: string | null;
  state: OtpState;
  purgeable: boolean;
}

// --- Uprawnienia -----------------------------------------------------------------------------------------

/** Opis uprawnienia (dymek macierzy roli i zakładka Uprawnienia): do 160 znaków, z wersją rekordu. */
export const permissionUpdateSchema = z.object({
  version: z.number().int().min(1),
  description: z.string().trim().min(1).max(160),
});
export type PermissionUpdate = z.infer<typeof permissionUpdateSchema>;

export const permissionsResource = {
  name: 'permissions',
  fields: {
    code: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    module: { type: 'text', filters: ['eq'], facet: true, sortable: true },
    description: { type: 'text', filters: ['contains'] },
    rolesCount: { type: 'integer', filters: ['eq', 'gte', 'lte'], sortable: true },
    roleNames: { type: 'text', array: true, filters: ['eq'] },
    inAdministrator: { type: 'boolean', filters: ['eq'], facet: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedBy: { type: 'uuid', filters: ['eq'] },
    updatedByName: { type: 'text', sortable: true },
    version: { type: 'integer' },
  },
  search: ['code', 'description', 'module'],
  defaultSort: ['module', 'code'],
  // Kody pochodzą z katalogu w packages/core; panel zmienia tylko opis (`permission.updated`).
  deleteMode: 'none',
  permissions: { read: 'roles.manage', write: 'roles.manage' },
  updateSchema: permissionUpdateSchema,
} as const satisfies ResourceDefinition;

export interface PermissionListItem {
  code: string;
  module: string;
  description: string;
  rolesCount: number;
  roleNames: string[];
  inAdministrator: boolean;
  updatedAt: string;
  /** `null`: opis z migracji (synchronizacja katalogu go nie nadpisuje po zmianie w panelu). */
  updatedBy: string | null;
  updatedByName: string | null;
  version: number;
}

// --- Zapisane miejsca klienta --------------------------------------------------------------------------------

export const savedPlacesResource = {
  name: 'saved-places',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true, personal: true },
    label: { type: 'enum', values: PLACE_LABELS, filters: ['eq'], facet: true, sortable: true },
    name: { type: 'text', filters: ['contains'], sortable: true, personal: true },
    lon: { type: 'decimal', personal: true },
    lat: { type: 'decimal', personal: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
  },
  search: ['name'],
  defaultSort: ['-createdAt'],
  // Na karcie klienta (filtr `userId`); usunięcie z `users.manage`, dodawanie i edycja w aplikacji.
  deleteMode: 'delete',
  permissions: { read: 'users.read', write: 'users.manage', delete: 'users.manage' },
} as const satisfies ResourceDefinition;

export interface SavedPlaceListItem {
  id: string;
  userId: string;
  userName: string | null;
  label: PlaceLabel;
  name: string;
  lon: number;
  lat: number;
  createdAt: string;
}
