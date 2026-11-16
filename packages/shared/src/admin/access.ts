/**
 * Zasoby panelu modułów Konta i Dostęp: operatorzy, role, klienci, dziennik audytu (ADR 0028, ADR 0031).
 * Wartości wyliczeń są kopią z packages/core; zgodność pilnuje test API.
 */
import { z } from 'zod';
import type { ResourceDefinition } from './list.js';

export const STAFF_STATUSES = ['ACTIVE', 'INVITED', 'DEACTIVATED'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];
export const USER_STATUSES = ['ACTIVE', 'BLOCKED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const BLOCK_REASONS = ['TERMS_VIOLATION', 'UNPAID_BALANCE', 'SUSPECTED_ABUSE'] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];
export const CONSENT_TYPES = ['TERMS', 'PRIVACY', 'AGE', 'MARKETING'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

const version = z.number().int().min(1);
const personName = z.string().trim().min(2).max(80);
const workEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

// ---------------------------------------------------------------------------------------------
// Operatorzy
// ---------------------------------------------------------------------------------------------

/** Zaproszenie operatora: konto bez hasła, link z tokenem ważny 72 h. */
export const staffInviteSchema = z.object({
  email: workEmail,
  name: personName,
  roleIds: z.array(z.uuid()).min(1).max(20),
});
export type StaffInvite = z.infer<typeof staffInviteSchema>;

export const staffUpdateSchema = z.object({
  version,
  name: personName.optional(),
  email: workEmail.optional(),
  roleIds: z.array(z.uuid()).min(1).max(20).optional(),
});
export type StaffUpdate = z.infer<typeof staffUpdateSchema>;

export const staffResource = {
  name: 'staff',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    name: { type: 'text', filters: ['contains'], sortable: true },
    email: { type: 'text', filters: ['contains'], sortable: true },
    status: { type: 'enum', values: STAFF_STATUSES, filters: ['eq'], sortable: true, facet: true },
    totpEnabled: { type: 'boolean', filters: ['eq'], facet: true },
    roles: { type: 'text', array: true },
    roleIds: { type: 'uuid', array: true, filters: ['eq'] },
    lastLoginAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    lockedUntil: { type: 'datetime' },
    activeSessions: { type: 'integer', sortable: true },
    invitationExpiresAt: { type: 'datetime' },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer' },
  },
  search: ['name', 'email'],
  defaultSort: ['-lastLoginAt', 'name'],
  // „Usunięcie” operatora to dezaktywacja: wpisy w dzienniku audytu wskazują autora.
  deleteMode: 'archive',
  permissions: { read: 'staff.read', write: 'staff.manage', delete: 'staff.manage' },
  createSchema: staffInviteSchema,
  updateSchema: staffUpdateSchema,
} as const satisfies ResourceDefinition;

export interface StaffListItem {
  id: string;
  name: string;
  email: string;
  status: StaffStatus;
  totpEnabled: boolean;
  roles: string[];
  roleIds: string[];
  lastLoginAt: string | null;
  lockedUntil: string | null;
  activeSessions: number;
  invitationExpiresAt: string | null;
  createdAt: string;
  version: number;
}

export interface SessionView {
  id: string;
  device: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface StaffDetails extends StaffListItem {
  sessions: SessionView[];
}

/** Wylogowanie wszędzie, reset TOTP, ponowne zaproszenie: operacje na koncie z wersją rekordu. */
export const staffActionSchema = z.object({ version });
export type StaffAction = z.infer<typeof staffActionSchema>;

/** Odpowiedź na zaproszenie: link pokazujemy tylko raz (w środowisku deweloperskim zamiast e-maila). */
export interface StaffInvitationResult {
  staff: StaffDetails;
  invitationUrl: string | null;
}

// ---------------------------------------------------------------------------------------------
// Role i uprawnienia
// ---------------------------------------------------------------------------------------------

const permissionCode = z.string().regex(/^[a-z_]+\.[a-z_]+$/);

export const roleCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable().default(null),
  permissions: z.array(permissionCode).max(100).default([]),
});
export type RoleCreate = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z.object({
  version,
  name: roleCreateSchema.shape.name.optional(),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(permissionCode).max(100).optional(),
});
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;

export const rolesResource = {
  name: 'roles',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    name: { type: 'text', filters: ['contains'], sortable: true },
    description: { type: 'text', filters: ['contains'] },
    isSystem: { type: 'boolean', filters: ['eq'], facet: true },
    permissionsCount: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    staffCount: { type: 'integer', filters: ['eq', 'gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer' },
  },
  search: ['name', 'description'],
  defaultSort: ['-updatedAt'],
  deleteMode: 'delete',
  permissions: { read: 'staff.read', write: 'roles.manage', delete: 'roles.manage' },
  createSchema: roleCreateSchema,
  updateSchema: roleUpdateSchema,
} as const satisfies ResourceDefinition;

export interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionsCount: number;
  staffCount: number;
  updatedAt: string;
  version: number;
}

export interface RoleDetails extends RoleListItem {
  permissions: string[];
  staff: Array<{ id: string; name: string; status: StaffStatus }>;
}

/** Katalog uprawnień do macierzy w edycji roli, pogrupowany według modułów. */
export interface PermissionView {
  code: string;
  module: string;
  description: string;
}

// ---------------------------------------------------------------------------------------------
// Klienci
// ---------------------------------------------------------------------------------------------

export const userUpdateSchema = z.object({
  version,
  name: personName.optional(),
  email: workEmail.nullable().optional(),
});
export type UserUpdate = z.infer<typeof userUpdateSchema>;

/** Blokada: powód widzi klient, notatka trafia tylko do dziennika audytu. */
export const userBlockSchema = z.object({
  version,
  reason: z.enum(BLOCK_REASONS),
  note: z.string().trim().max(500).nullable().default(null),
});
export type UserBlock = z.infer<typeof userBlockSchema>;

export const usersResource = {
  name: 'users',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    name: { type: 'text', filters: ['contains'], sortable: true },
    phone: { type: 'text', filters: ['contains'], sortable: true },
    email: { type: 'text', filters: ['contains'], sortable: true },
    status: { type: 'enum', values: USER_STATUSES, filters: ['eq'], facet: true },
    blockedReason: { type: 'enum', values: BLOCK_REASONS, filters: ['eq'], facet: true },
    blockedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    rides: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    lastRideAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    totalSpent: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    walletBalance: { type: 'integer', filters: ['gte', 'lte'], sortable: true },
    ticketsReported: { type: 'integer', sortable: true },
    activeSessions: { type: 'integer', sortable: true },
    lastSeenAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer' },
  },
  search: ['name', 'phone', 'email'],
  defaultSort: ['-createdAt'],
  // Usunięcie konta to anonimizacja (sp_anonymize_user) z aplikacji, nie z listy w panelu.
  deleteMode: 'none',
  permissions: { read: 'users.read', write: 'users.manage' },
  updateSchema: userUpdateSchema,
} as const satisfies ResourceDefinition;

export interface UserListItem {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: UserStatus;
  blockedReason: BlockReason | null;
  blockedAt: string | null;
  rides: number;
  lastRideAt: string | null;
  totalSpent: number;
  walletBalance: number;
  ticketsReported: number;
  activeSessions: number;
  lastSeenAt: string | null;
  createdAt: string;
  version: number;
}

export interface ConsentView {
  type: ConsentType;
  documentVersion: string;
  versionNo: number | null;
  currentVersionNo: number | null;
  acceptedAt: string;
  revokedAt: string | null;
  isCurrent: boolean;
}

export interface UserDetails extends UserListItem {
  consents: ConsentView[];
  sessions: SessionView[];
}

// ---------------------------------------------------------------------------------------------
// Dziennik audytu
// ---------------------------------------------------------------------------------------------

export const auditLogResource = {
  name: 'audit-log',
  fields: {
    id: { type: 'integer', filters: ['eq'], sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    staffId: { type: 'uuid', filters: ['eq'], facet: true },
    staffName: { type: 'text', sortable: true },
    staffEmail: { type: 'text' },
    action: { type: 'text', filters: ['eq', 'contains'], sortable: true },
    entityType: { type: 'text', filters: ['eq'], sortable: true, facet: true },
    entityId: { type: 'uuid', filters: ['eq'] },
  },
  search: ['action', 'staffName', 'entityType'],
  defaultSort: ['-createdAt', '-id'],
  // Tabela tylko do dopisywania (pytanie 4 do prowadzącego).
  deleteMode: 'none',
  permissions: { read: 'audit.read' },
} as const satisfies ResourceDefinition;

export interface AuditLogListItem {
  id: number;
  createdAt: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
}

export interface AuditLogDetails extends AuditLogListItem {
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Dokumenty prawne (ADR 0027): kilka dokumentów po kilka wersji, bez wspólnego mechanizmu list
// ---------------------------------------------------------------------------------------------

export const DOCUMENT_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type DocumentVersionStatus = (typeof DOCUMENT_VERSION_STATUSES)[number];

export interface LegalDocumentSummary {
  id: string;
  slug: string;
  name: string;
  consentType: ConsentType | null;
  publishedVersionNo: number | null;
  hasDraft: boolean;
}

export interface DocumentVersionSummary {
  id: string;
  versionNo: number;
  title: string;
  status: DocumentVersionStatus;
  publishedAt: string | null;
  supersededAt: string | null;
  acceptances: number;
  createdAt: string;
}

export interface LegalDocumentDetails extends LegalDocumentSummary {
  versions: DocumentVersionSummary[];
}

export interface DocumentVersionDetails {
  id: string;
  documentId: string;
  versionNo: number;
  status: DocumentVersionStatus;
  title: string;
  bodyMd: string;
  changeSummary: string | null;
}

export const documentDraftUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  bodyMd: z.string().max(100_000).optional(),
  changeSummary: z.string().trim().max(300).nullable().optional(),
});
export type DocumentDraftUpdate = z.infer<typeof documentDraftUpdateSchema>;

