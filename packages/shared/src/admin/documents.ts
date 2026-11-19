/**
 * Zasoby panelu wydruków i eksportu danych (iteracja 7, ADR 0031, ADR 0067–0069): szablony wydruków z aktywną
 * wersją, wygenerowane dokumenty i zlecenia eksportu danych klientów. Wszystkie są tylko do odczytu: szablon
 * zakłada i zmienia osobny punkt (`POST /admin/document-templates`, wersje, aktywacja), wydruk powstaje
 * z „Drukuj”, a eksport zleca klient w aplikacji.
 */
import { DATA_EXPORT_STATES } from '../data-export.js';
import {
  DOCUMENT_FORMATS,
  DOCUMENT_TYPES,
  GENERATED_DOCUMENT_STATES,
  JOB_STATUSES,
  TEMPLATE_DOCUMENT_TYPES,
  type DocumentFormat,
  type DocumentType,
  type GeneratedDocumentState,
  type JobStatus,
  type TemplateDocumentType,
} from '../documents.js';
import type { ResourceDefinition } from './list.js';

// --- Szablony -------------------------------------------------------------------------------------

/** Szablony z `v_document_templates`: lista według rodzaju z aktywną wersją i domyślnym szablonem. */
export const documentTemplatesResource = {
  name: 'document-templates',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    documentType: { type: 'enum', values: TEMPLATE_DOCUMENT_TYPES, filters: ['eq'], facet: true, sortable: true },
    name: { type: 'text', filters: ['contains'], sortable: true },
    description: { type: 'text' },
    isDefault: { type: 'boolean', filters: ['eq'], sortable: true },
    active: { type: 'boolean', filters: ['eq'] },
    activeVersionId: { type: 'uuid' },
    activeVersionNo: { type: 'integer', sortable: true },
    activeSince: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    versions: { type: 'integer', sortable: true },
    pendingVersions: { type: 'integer', filters: ['gte'], sortable: true },
    lastGeneratedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedByName: { type: 'text', sortable: true },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    updatedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    version: { type: 'integer' },
  },
  search: ['name', 'description'],
  defaultSort: ['documentType', '-isDefault', 'name'],
  deleteMode: 'none',
  permissions: { read: 'templates.read', write: 'templates.write' },
} as const satisfies ResourceDefinition;

export interface DocumentTemplateListItem {
  id: string;
  documentType: TemplateDocumentType;
  name: string;
  description: string | null;
  isDefault: boolean;
  active: boolean;
  activeVersionId: string | null;
  activeVersionNo: number | null;
  activeSince: string | null;
  versions: number;
  pendingVersions: number;
  lastGeneratedAt: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// --- Wygenerowane dokumenty -----------------------------------------------------------------------

/**
 * Wydruki z `v_generated_documents` (zakładka Wygenerowane, `documents.generate`): API zawęża listę do rodzajów,
 * do których operator ma uprawnienie odczytu, a imię klienta zlecającego podaje tylko z `users.read`.
 * Filtr `requesterKind=STAFF` to domyślny widok panelu „wszystkie oprócz paragonów klientów”.
 */
export const generatedDocumentsResource = {
  name: 'generated-documents',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    documentType: { type: 'enum', values: DOCUMENT_TYPES, filters: ['eq'], facet: true, sortable: true },
    entityRef: { type: 'text', filters: ['eq'] },
    entityLabel: { type: 'text', filters: ['contains'], sortable: true },
    format: { type: 'enum', values: DOCUMENT_FORMATS, filters: ['eq'], facet: true, sortable: true },
    status: { type: 'enum', values: JOB_STATUSES, filters: ['eq'] },
    state: { type: 'enum', values: GENERATED_DOCUMENT_STATES, filters: ['eq'], facet: true, sortable: true },
    templateId: { type: 'uuid', filters: ['eq'] },
    templateName: { type: 'text', sortable: true },
    templateVersionId: { type: 'uuid', filters: ['eq'] },
    templateVersionNo: { type: 'integer', sortable: true },
    builtIn: { type: 'boolean', filters: ['eq'] },
    requesterKind: { type: 'enum', values: ['STAFF', 'CUSTOMER'], filters: ['eq'], facet: true },
    requestedByStaff: { type: 'uuid', filters: ['eq'] },
    staffName: { type: 'text', sortable: true },
    requestedByUser: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true },
    errorCode: { type: 'text', filters: ['eq'], sortable: true },
    retryOf: { type: 'uuid', filters: ['eq'] },
    createdAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    startedAt: { type: 'datetime', filters: ['gte', 'lte'] },
    finishedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    filesDeletedAt: { type: 'datetime', filters: ['gte', 'lte'] },
    durationMs: { type: 'integer', sortable: true },
    // Plik z danymi klienta bez maskowania: bez `users.read` panel nie pokazuje „Pobierz”, a API zwraca 404.
    customerDataVisible: { type: 'boolean', filters: ['eq'] },
  },
  // Identyfikator wydruku ze stopki (8 znaków) szuka API osobno (`id::text LIKE`), bo `id` to uuid.
  search: ['entityLabel', 'templateName', 'staffName', 'userName'],
  defaultSort: ['-createdAt'],
  deleteMode: 'none',
  permissions: { read: 'documents.generate' },
} as const satisfies ResourceDefinition;

/** Pola wydruku z danymi klienta: tylko z `users.read`. */
export const GENERATED_DOCUMENT_PERSONAL_FIELDS = ['userName'] as const;

export interface GeneratedDocumentListItem {
  id: string;
  documentType: DocumentType;
  entityRef: string;
  entityLabel: string;
  format: DocumentFormat;
  status: JobStatus;
  state: GeneratedDocumentState;
  templateId: string | null;
  templateName: string | null;
  templateVersionId: string | null;
  templateVersionNo: number | null;
  builtIn: boolean;
  requesterKind: 'STAFF' | 'CUSTOMER';
  requestedByStaff: string | null;
  staffName: string | null;
  requestedByUser: string | null;
  /** `null` bez `users.read`. */
  userName: string | null;
  errorCode: string | null;
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  filesDeletedAt: string | null;
  durationMs: number | null;
  /** Plik zawiera dane klienta: pobranie i szczegóły tylko z `users.read` (ADR 0068). */
  customerDataVisible: boolean;
}

// --- Eksporty danych klientów ---------------------------------------------------------------------

/** Stan zlecenia eksportu w panelu: jak w aplikacji, a do tego `DELETED` po usunięciu pliku. */
export const DATA_EXPORT_LIST_STATES = [...DATA_EXPORT_STATES, 'DELETED'] as const;

/**
 * Zlecenia „Pobierz moje dane” z `v_data_exports` (ADR 0069): tylko do odczytu z `users.read`, z klientem,
 * stanem, datami i rozmiarem, bez pobierania pliku.
 */
export const dataExportsResource = {
  name: 'data-exports',
  fields: {
    id: { type: 'uuid', filters: ['eq'] },
    userId: { type: 'uuid', filters: ['eq'] },
    userName: { type: 'text', sortable: true },
    userPhone: { type: 'text', filters: ['contains'] },
    status: { type: 'enum', values: JOB_STATUSES, filters: ['eq'] },
    state: { type: 'enum', values: DATA_EXPORT_LIST_STATES, filters: ['eq'], facet: true, sortable: true },
    sizeBytes: { type: 'integer', sortable: true },
    requestedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    startedAt: { type: 'datetime', filters: ['gte', 'lte'] },
    finishedAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    expiresAt: { type: 'datetime', filters: ['gte', 'lte'], sortable: true },
    deletedAt: { type: 'datetime', filters: ['gte', 'lte'] },
    errorCode: { type: 'text', filters: ['eq'] },
  },
  search: ['userName', 'userPhone'],
  defaultSort: ['-requestedAt'],
  deleteMode: 'none',
  permissions: { read: 'users.read' },
} as const satisfies ResourceDefinition;

export interface DataExportListItem {
  id: string;
  userId: string;
  userName: string | null;
  userPhone: string | null;
  status: JobStatus;
  state: (typeof DATA_EXPORT_LIST_STATES)[number];
  sizeBytes: number | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  deletedAt: string | null;
  errorCode: string | null;
}
