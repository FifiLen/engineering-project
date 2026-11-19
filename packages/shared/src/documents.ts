/**
 * Wydruki z szablonów DOCX (iteracja 7, ADR 0066–0068): szablony z wersjami, walidacja wgranej wersji, zlecenie
 * wydruku i wygenerowane dokumenty. Katalog rodzajów i pól jest w packages/core, a panel dostaje go z API
 * (`GET /admin/document-types`), więc tutaj są tylko typy widoków. Wyliczenia są kopią z core; zgodność pilnuje
 * test API.
 */
import { z } from 'zod';

/** Rodzaje dokumentów (`document_type`); `SCOOTER_LABEL` to naklejka z kodem QR bez szablonu DOCX (ADR 0068). */
export const DOCUMENT_TYPES = [
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'SCOOTER_CARD',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
  'RECEIPT',
  'SCOOTER_LABEL',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Rodzaje z szablonem DOCX (wszystkie poza naklejką). */
export const TEMPLATE_DOCUMENT_TYPES = [
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'SCOOTER_CARD',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
  'RECEIPT',
] as const satisfies readonly DocumentType[];
export type TemplateDocumentType = (typeof TEMPLATE_DOCUMENT_TYPES)[number];

export const DOCUMENT_FORMATS = ['DOCX', 'PDF'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** Stan zadania (`job_status`); widok listy dokłada `DELETED` po usunięciu plików (retencja 30 dni). */
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const GENERATED_DOCUMENT_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DELETED'] as const;
export type GeneratedDocumentState = (typeof GENERATED_DOCUMENT_STATES)[number];

/** Stan wersji szablonu z widoku `v_document_template_versions`: „Do aktywacji”, „Aktywna”, „Archiwalna”. */
export const TEMPLATE_VERSION_STATES = ['PENDING', 'ACTIVE', 'ARCHIVED'] as const;
export type TemplateVersionState = (typeof TEMPLATE_VERSION_STATES)[number];

/** Kody błędów wydruku (`generated_documents.error_code`) z ADR 0066. */
export const DOCUMENT_ERROR_CODES = [
  'RENDER_TIMEOUT',
  'RENDERER_UNAVAILABLE',
  'RENDER_FAILED',
  'TEMPLATE_RENDER_FAILED',
  'DOCUMENT_SOURCE_NOT_FOUND',
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

/** Układ naklejki z kodem QR: jedna 60 × 80 mm albo arkusz A4 z sześcioma. */
export const SCOOTER_LABEL_LAYOUTS = ['single', 'a4x6'] as const;
export type ScooterLabelLayout = (typeof SCOOTER_LABEL_LAYOUTS)[number];

/** Zakres historii karty hulajnogi (parametr `historyDays`). */
export const SCOOTER_CARD_HISTORY_DAYS = [30, 90, 365] as const;

/** Limit wgranego szablonu (przed rozpakowaniem). */
export const TEMPLATE_MAX_BYTES = 5 * 1024 * 1024;

/** Panel czeka na `document.ready`, a w zapasie pyta co 2 s i po 30 s pokazuje błąd (zadanie działa dalej). */
export const DOCUMENT_POLL_INTERVAL_MS = 2000;
export const DOCUMENT_WAIT_TIMEOUT_MS = 30_000;

// --- Szablony ---------------------------------------------------------------------------------------

/** `POST /admin/document-templates`: nowy szablon rodzaju (bez wersji, więc jeszcze bez „Drukuj”). */
export const documentTemplateCreateSchema = z.object({
  documentType: z.enum(TEMPLATE_DOCUMENT_TYPES),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().default(null),
});
export type DocumentTemplateCreate = z.infer<typeof documentTemplateCreateSchema>;

/**
 * Nazwa i opis szablonu (ADR 0076): `PATCH /admin/document-templates/{id}` z wersją rekordu; rodzaj jest niezmienny.
 * Zajęta nazwa w rodzaju to `409 TEMPLATE_NAME_TAKEN` z `details.field = name`.
 */
export const documentTemplateUpdateSchema = z
  .object({
    version: z.number().int().min(1),
    name: documentTemplateCreateSchema.shape.name.optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, { message: 'Brak zmian', path: ['name'] });
export type DocumentTemplateUpdate = z.infer<typeof documentTemplateUpdateSchema>;

/** Pola formularza `multipart/form-data` wgrania wersji obok pola `file`. */
export const templateVersionUploadFieldsSchema = z.object({
  note: z.string().trim().max(300).nullable().default(null),
});
export type TemplateVersionUploadFields = z.infer<typeof templateVersionUploadFieldsSchema>;

/**
 * Miejsce błędu w DOCX w języku autora szablonu (ADR 0067): część, tabela z tekstem pierwszej komórki, wiersz
 * i kolumna albo akapit z początkiem tekstu. Bez numeru strony: podział na strony powstaje dopiero przy renderowaniu.
 */
export interface TemplatePlace {
  part: 'document' | 'header' | 'footer' | 'footnotes' | 'endnotes' | 'other';
  /** Numer nagłówka albo stopki (`word/header2.xml` → 2); `null` dla treści. */
  partNumber: number | null;
  table: number | null;
  tableCaption: string | null;
  row: number | null;
  column: number | null;
  paragraph: number | null;
  excerpt: string | null;
}

/** Problem wgranej wersji (`422 TEMPLATE_INVALID`, `details.issues[]`). */
export interface TemplateIssueDetails {
  code: string;
  /** Znacznik w zapisie autora, np. `{task.partCost}`, `{#parts}`. */
  tag: string | null;
  place: TemplatePlace | null;
  /** Podpowiedź najbliższego pola (odległość edycyjna do 2). */
  suggestion: string | null;
  /** Pola dostępne w zakresie znacznika (także wewnątrz pętli). */
  available: string[];
  /** Pętla, w której stoi znacznik. */
  loop: string | null;
}

/** Ostrzeżenie wersji (zapisane w `warnings`): nieużyte pole katalogu. */
export interface TemplateWarningDetails {
  code: 'TEMPLATE_UNUSED_FIELD';
  field: string;
  loop: string | null;
}

export interface DocumentTemplateView {
  id: string;
  documentType: TemplateDocumentType;
  name: string;
  description: string | null;
  isDefault: boolean;
  activeVersionNo: number | null;
  versionCount: number;
  lastGeneratedAt: string | null;
}

export interface DocumentTemplateVersionView {
  id: string;
  templateId: string;
  versionNo: number;
  state: TemplateVersionState;
  note: string | null;
  fileName: string | null;
  sizeBytes: number;
  uncompressedBytes: number;
  /** Ścieżki znaczników użytych w wersji (`fields text[]`). */
  fields: string[];
  warnings: TemplateWarningDetails[];
  createdAt: string;
  createdByName: string | null;
  activatedAt: string | null;
  activatedByName: string | null;
}

// --- Katalog rodzajów (z API, źródłem jest core) -------------------------------------------------

export const DOCUMENT_FIELD_TYPES = ['text', 'boolean', 'list'] as const;
export type DocumentFieldType = (typeof DOCUMENT_FIELD_TYPES)[number];

/** Pole katalogu dla autora szablonu („Lista pól (DOCX)”, okno błędów). */
export interface DocumentFieldView {
  path: string;
  label: string;
  type: DocumentFieldType;
  example: string;
  /** Dane klienta: operator bez `users.read` dostaje „Klient” (ADR 0068). */
  customer: boolean;
  /** Pole wspólne wszystkich rodzajów (`company.*`, `document.*`, `template.*`, `staff.*`). */
  common: boolean;
}

export interface DocumentLoopView {
  path: string;
  label: string;
  fields: DocumentFieldView[];
}

export const DOCUMENT_PARAM_TYPES = ['boolean', 'select'] as const;
export type DocumentParamType = (typeof DOCUMENT_PARAM_TYPES)[number];

export interface DocumentParamView {
  name: string;
  type: DocumentParamType;
  options: Array<string | number> | null;
  default: string | number | boolean;
}

/** `GET /admin/document-types`: rodzaje widoczne dla operatora z szablonami do „Drukuj”. */
export interface DocumentTypeView {
  documentType: DocumentType;
  readPermission: string;
  /** Naklejka: układ wbudowany, bez szablonu. */
  builtIn: boolean;
  /** „Drukuj” jest widoczne: rodzaj wbudowany albo z szablonem z aktywną wersją. */
  printable: boolean;
  params: DocumentParamView[];
  templates: Array<{ id: string; name: string; isDefault: boolean; activeVersionNo: number | null }>;
}

/** `GET /admin/document-types/{type}/fields`. */
export interface DocumentFieldCatalogView {
  documentType: TemplateDocumentType;
  fields: DocumentFieldView[];
  loops: DocumentLoopView[];
}

// --- Drukowanie -----------------------------------------------------------------------------------

const paramValue = z.union([z.string().max(100), z.number().int(), z.boolean()]);

/**
 * `POST /admin/documents` (`documents.generate` i uprawnienie odczytu rodzaju): wydruk jednego obiektu. Bez
 * `templateId` drukuje szablon domyślny rodzaju; parametry spoza katalogu i złe wartości odrzuca core
 * (`DOCUMENT_PARAM_INVALID`). Naklejka ma tylko format PDF.
 */
export const documentGenerateSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  /** Identyfikator obiektu: uuid, a wpis księgi portfela (`WALLET_ADJUSTMENT`) ma identyfikator liczbowy. */
  entityId: z.union([z.uuid(), z.string().regex(/^[1-9]\d{0,17}$/)]),
  templateId: z.uuid().nullable().default(null),
  format: z.enum(DOCUMENT_FORMATS).default('PDF'),
  params: z.record(z.string().max(40), paramValue).default({}),
});
export type DocumentGenerate = z.infer<typeof documentGenerateSchema>;

/** Plik wydruku: adres z podpisem HMAC na 10 min (ADR 0057). */
export interface DocumentFileLink {
  url: string;
  urlExpiresAt: string;
  fileName: string;
  sizeBytes: number;
}

export type DocumentRequester = { kind: 'staff'; staffId: string; name: string } | { kind: 'customer' };

export interface GeneratedDocumentView {
  id: string;
  documentType: DocumentType;
  entityRef: string;
  /** Numer obiektu z chwili zlecenia (`PAR/2026/…`, `R-…`, `S-…`, `Z-…`, `#0007`). */
  entityLabel: string;
  format: DocumentFormat;
  status: JobStatus;
  state: GeneratedDocumentState;
  /** `null` dla naklejki („Układ wbudowany, bez szablonu”). */
  template: { id: string; name: string; versionId: string; versionNo: number } | null;
  requestedBy: DocumentRequester;
  params: Record<string, string | number | boolean>;
  errorCode: string | null;
  files: { docx: DocumentFileLink | null; pdf: DocumentFileLink | null };
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  filesDeletedAt: string | null;
  /** Plik zawiera dane klienta bez maskowania: pobranie, szczegóły i ponowienie tylko z `users.read` (ADR 0068). */
  customerDataVisible: boolean;
}

/** `POST /me/receipts/{id}/pdf` (`200` z gotowym plikiem albo `202` w toku) i `GET /me/documents/{id}`. */
export interface CustomerDocumentView {
  id: string;
  documentType: 'RECEIPT';
  status: JobStatus;
  errorCode: string | null;
  file: DocumentFileLink | null;
  createdAt: string;
  finishedAt: string | null;
}
