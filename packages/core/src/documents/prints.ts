import type { Permission } from '../access/permissions.js';
import { DomainError } from '../errors.js';
import {
  DOCUMENT_READ_PERMISSIONS,
  documentFieldCatalog,
  isTemplateDocumentType,
  type DocumentFormat,
  type DocumentType,
} from './catalog.js';

/**
 * Wydruki w procesach (ADR 0066, ADR 0068): kto drukuje i pobiera, wybór szablonu, ponowne użycie paragonu PDF
 * klienta, stan wydruku z retencją plików 30 dni i klucze plików w magazynie.
 */
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Pliki DOCX i PDF wydruków usuwa `documents.retention` po 30 dniach; wiersz zostaje na zawsze (pytanie 3). */
export const GENERATED_DOCUMENT_RETENTION_MS = 30 * 24 * 60 * 60_000;

export interface PermissionSet {
  has(permission: Permission): boolean;
}

/** Uprawnienie odczytu rodzaju (np. `service.read` dla protokołu, `payments.read` dla paragonu). */
export const documentReadPermission = (type: DocumentType): Permission => DOCUMENT_READ_PERMISSIONS[type];

/** „Drukuj” (`POST /admin/documents`): `documents.generate` i uprawnienie odczytu rodzaju, inaczej `FORBIDDEN`. */
export function ensureCanPrint(permissions: PermissionSet, type: DocumentType): void {
  for (const permission of ['documents.generate', documentReadPermission(type)] as const) {
    if (!permissions.has(permission)) throw new DomainError('FORBIDDEN', { permission });
  }
}

/** Rodzaje, które operator widzi na liście Wygenerowane (Serwisant nie widzi paragonów). */
export const visibleDocumentTypes = (permissions: PermissionSet, types: readonly DocumentType[]): DocumentType[] =>
  permissions.has('documents.generate') ? types.filter((type) => permissions.has(documentReadPermission(type))) : [];

/** Dane klienta w wydruku tylko z `users.read`; inaczej „Klient” (ADR 0068, jak listy zgłoszeń w ADR 0055). */
export const canSeeCustomerData = (permissions: PermissionSet): boolean => permissions.has('users.read');

/** Rodzaj z polami klienta w katalogu (imię i telefon klienta albo zgłaszającego); naklejka i karta ich nie mają. */
export function documentHasCustomerFields(type: DocumentType): boolean {
  if (!isTemplateDocumentType(type)) return false;
  const catalog = documentFieldCatalog(type);
  return (
    catalog.fields.some((field) => field.customer) ||
    catalog.loops.some((loop) => loop.fields.some((field) => field.customer))
  );
}

/**
 * Czy plik wydruku zawiera dane klienta (`generated_documents.customer_data_visible`, zapisywane przy wypełnieniu
 * szablonu): rodzaj z polami klienta wypełniony bez maskowania, czyli przez operatora z `users.read` albo przez
 * klienta (własny paragon). Maskowanie jest wypalone w pliku, więc o pobraniu decyduje ta flaga, a nie uprawnienia
 * pobierającego w chwili zlecenia.
 */
export const documentShowsCustomerData = (type: DocumentType, canReadCustomers: boolean): boolean =>
  canReadCustomers && documentHasCustomerFields(type);

/** Naklejka z kodem QR ma tylko PDF (HTML przez Chromium); rodzaje z szablonem mają DOCX i PDF. */
export function ensureDocumentFormat(type: DocumentType, format: DocumentFormat): void {
  if (type === 'SCOOTER_LABEL' && format !== 'PDF')
    throw new DomainError('DOCUMENT_FORMAT_NOT_ALLOWED', { type, format });
}

export interface PrintableTemplate {
  id: string;
  isDefault: boolean;
  /** Aktywna wersja szablonu; `null`: szablon bez aktywnej wersji nie drukuje. */
  activeVersionId: string | null;
}

/**
 * Szablon wydruku: wskazany (musi mieć aktywną wersję, `TEMPLATE_NOT_ACTIVE`) albo domyślny rodzaju. Rodzaj bez
 * szablonu z aktywną wersją nie pokazuje „Drukuj” (`DOCUMENT_TYPE_NOT_PRINTABLE`).
 */
export function selectTemplate(
  templates: readonly PrintableTemplate[],
  templateId: string | null = null,
): { templateId: string; versionId: string } {
  const template = templateId ? templates.find((t) => t.id === templateId) : templates.find((t) => t.isDefault);
  if (templateId && !template) throw new DomainError('NOT_FOUND', { entity: 'document_template', id: templateId });
  if (!template) throw new DomainError('DOCUMENT_TYPE_NOT_PRINTABLE');
  if (!template.activeVersionId) throw new DomainError('TEMPLATE_NOT_ACTIVE', { templateId: template.id });
  return { templateId: template.id, versionId: template.activeVersionId };
}

/** „Drukuj” widoczne: naklejka zawsze, rodzaj z szablonem, gdy któryś szablon ma aktywną wersję. */
export const isPrintable = (type: DocumentType, templates: readonly PrintableTemplate[]): boolean =>
  type === 'SCOOTER_LABEL' || templates.some((template) => template.activeVersionId !== null);

export const GENERATED_DOCUMENT_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DELETED'] as const;
export type GeneratedDocumentState = (typeof GENERATED_DOCUMENT_STATES)[number];

/** Stan na liście Wygenerowane: `DELETED` po usunięciu plików przez retencję (`files_deleted_at`). */
export const generatedDocumentState = (doc: {
  status: JobStatus;
  filesDeletedAt: Date | null;
}): GeneratedDocumentState => (doc.filesDeletedAt ? 'DELETED' : doc.status);

/** Pliki do usunięcia przez `documents.retention`: zakończony wydruk starszy niż 30 dni z nieusuniętymi plikami. */
export const documentFilesExpired = (
  doc: { finishedAt: Date | null; filesDeletedAt: Date | null },
  now: Date,
): boolean =>
  doc.finishedAt !== null &&
  doc.filesDeletedAt === null &&
  now.getTime() - doc.finishedAt.getTime() > GENERATED_DOCUMENT_RETENTION_MS;

export interface ExistingReceiptDocument {
  id: string;
  templateVersionId: string | null;
  format: DocumentFormat;
  status: JobStatus;
  filesDeletedAt: Date | null;
  /** Wydruk zlecony przez klienta (`requested_by_user`); wydruki operatora mają w stopce operatora. */
  requestedByCustomer: boolean;
}

/**
 * Paragon PDF klienta (`POST /me/receipts/{id}/pdf`, pytanie 2): gotowy albo trwający wydruk klienta z aktywną
 * wersją domyślnego szablonu, w formacie PDF, nie `FAILED` i z plikami wraca bez nowego zadania (`200`);
 * inaczej nowy wiersz i zadanie (`202`). Wyścig dwóch kliknięć rozstrzyga indeks częściowy w bazie.
 */
export function reusableReceiptDocument(
  existing: readonly ExistingReceiptDocument[],
  activeVersionId: string,
): ExistingReceiptDocument | null {
  return (
    existing.find(
      (doc) =>
        doc.requestedByCustomer &&
        doc.templateVersionId === activeVersionId &&
        doc.format === 'PDF' &&
        doc.status !== 'FAILED' &&
        doc.filesDeletedAt === null,
    ) ?? null
  );
}

/** „Spróbuj ponownie” (`POST /admin/documents/{id}/retry`) tylko dla nieudanego wydruku; tworzy nowy wiersz z `retry_of`. */
export function ensureDocumentRetryable(doc: { status: JobStatus }): void {
  if (doc.status !== 'FAILED') throw new DomainError('DOCUMENT_NOT_RETRYABLE', { status: doc.status });
}

// --- Zadania w tle wydruków i eksportu --------------------------------------------------------------

/** Wiersz zadania w tle (`generated_documents`, `data_exports`) do decyzji o przejęciu i sprzątaniu. */
export interface BackgroundJobRow {
  status: JobStatus;
  startedAt: Date | null;
  /** Czas zlecenia (`created_at` wydruku, `requested_at` eksportu). */
  createdAt: Date;
}

/**
 * Limit czasu zadania `document.generate` w pg-boss (`expireInSeconds` kolejki, 120 s): dłużej trwające zadanie
 * pg-boss uznaje za porzucone (np. restart API) i ponawia, a ponowienie przejmuje wiersz `RUNNING`.
 */
export const DOCUMENT_JOB_EXPIRE_MS = 120_000;
/**
 * Wydruk w toku albo w kolejce dłużej niż 15 min nie ma już zadania (restart API po wyczerpaniu ponowień, zgubione
 * zadanie): zadanie porządkowe `documents.sweep` kończy go jako `FAILED` z `RENDER_TIMEOUT` („Spróbuj ponownie”).
 */
export const DOCUMENT_JOB_ABANDONED_MS = 15 * 60_000;

/**
 * Czy zadanie może pracować na wierszu: `QUEUED` zawsze, `RUNNING` tylko po limicie czasu zadania (ponowienie
 * po restarcie API przejmuje porzucony wiersz). Powtórka zadania po końcu (`SUCCEEDED`, `FAILED`) niczego nie dubluje.
 */
export function isJobClaimable(row: Pick<BackgroundJobRow, 'status' | 'startedAt'>, now: Date, expireMs: number) {
  if (row.status === 'QUEUED') return true;
  return row.status === 'RUNNING' && (!row.startedAt || now.getTime() - row.startedAt.getTime() >= expireMs);
}

/** Wiersz porzucony: `RUNNING` od `startedAt` albo `QUEUED` od zlecenia dłużej niż `abandonedMs`. */
export function isJobAbandoned(row: BackgroundJobRow, now: Date, abandonedMs: number): boolean {
  const since = row.status === 'RUNNING' ? (row.startedAt ?? row.createdAt) : row.createdAt;
  return (row.status === 'RUNNING' || row.status === 'QUEUED') && now.getTime() - since.getTime() > abandonedMs;
}

/** Zadanie `document.generate`: wiersz `QUEUED` albo porzucony `RUNNING` (po `DOCUMENT_JOB_EXPIRE_MS`). */
export const shouldRunDocumentJob = (row: Pick<BackgroundJobRow, 'status' | 'startedAt'>, now: Date): boolean =>
  isJobClaimable(row, now, DOCUMENT_JOB_EXPIRE_MS);

/**
 * Pobranie pliku wydruku, szczegóły i ponowienie: klient tylko swój; operator, który zlecił, albo z `documents.generate`
 * i uprawnieniem odczytu rodzaju. Wydruk z danymi klienta w pliku (`customerDataVisible`) wymaga od operatora także
 * `users.read`, również od zlecającego (Serwisant nie pobierze protokołu wydrukowanego przez Dyspozytora). Cudzy albo
 * niedostępny wydruk daje `NOT_FOUND`, żeby nie zdradzać, że istnieje.
 */
export function ensureCanDownloadDocument(
  doc: {
    id: string;
    documentType: DocumentType;
    requestedByStaff: string | null;
    requestedByUser: string | null;
    customerDataVisible: boolean;
  },
  principal: { kind: 'customer'; userId: string } | { kind: 'staff'; staffId: string; permissions: PermissionSet },
): void {
  const allowed =
    principal.kind === 'customer'
      ? doc.requestedByUser === principal.userId
      : (!doc.customerDataVisible || canSeeCustomerData(principal.permissions)) &&
        (doc.requestedByStaff === principal.staffId ||
          (principal.permissions.has('documents.generate') &&
            principal.permissions.has(documentReadPermission(doc.documentType))));
  if (!allowed) throw new DomainError('NOT_FOUND', { entity: 'generated_document', id: doc.id });
}

const storageKey = (prefix: string, id: string, extension: string, at: Date) =>
  `${prefix}/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, '0')}/${id}.${extension}`;

/** Klucz pliku wydruku `generated-document/{rrrr}/{mm}/{uuid}.{docx|pdf}` (czas UTC). */
export const generatedDocumentKey = (id: string, format: DocumentFormat, at: Date): string =>
  storageKey('generated-document', id, format.toLowerCase(), at);

/** Klucz wersji szablonu `document-template/{rrrr}/{mm}/{uuid}.docx`. */
export const templateVersionKey = (id: string, at: Date): string => storageKey('document-template', id, 'docx', at);

/** Klucz pliku eksportu danych `data-export/{rrrr}/{mm}/{uuid}.json` (ADR 0069). */
export const dataExportKey = (id: string, at: Date): string => storageKey('data-export', id, 'json', at);

export const DOCUMENT_CONTENT_TYPES: Record<DocumentFormat, string> = {
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PDF: 'application/pdf',
};

// --- Wersje szablonów -----------------------------------------------------------------------------

export const TEMPLATE_VERSION_STATES = ['PENDING', 'ACTIVE', 'ARCHIVED'] as const;
export type TemplateVersionState = (typeof TEMPLATE_VERSION_STATES)[number];

/** Stan wersji jak w `v_document_template_versions`: aktywna, była aktywna (archiwalna) albo do aktywacji. */
export const templateVersionState = (version: { isActive: boolean; activatedAt: Date | null }): TemplateVersionState =>
  version.isActive ? 'ACTIVE' : version.activatedAt ? 'ARCHIVED' : 'PENDING';

/** Usunąć można tylko wersję nigdy nieaktywowaną; pozostałe wskazują wydruki (`TEMPLATE_VERSION_IN_USE`). */
export function ensureTemplateVersionDeletable(version: { isActive: boolean; activatedAt: Date | null }): void {
  const state = templateVersionState(version);
  if (state !== 'PENDING') throw new DomainError('TEMPLATE_VERSION_IN_USE', { state });
}

/** Szablon domyślny rodzaju musi mieć aktywną wersję (`sp_document_template_set_default`). */
export function ensureCanSetDefault(template: { activeVersionId: string | null }): void {
  if (!template.activeVersionId) throw new DomainError('TEMPLATE_NOT_ACTIVE');
}

/** Numer kolejnej wersji szablonu: kolejny po najwyższym. */
export const nextTemplateVersionNo = (highest: number | null): number => (highest ?? 0) + 1;

// --- Naklejka z kodem QR (D5) ---------------------------------------------------------------------

export const SCOOTER_LABEL_LAYOUTS = {
  /** Jedna naklejka 60 × 80 mm. */
  single: { perPage: 1, pageWidthMm: 60, pageHeightMm: 80, columns: 1, rows: 1 },
  /** Arkusz A4 z siatką 2 × 3. */
  a4x6: { perPage: 6, pageWidthMm: 210, pageHeightMm: 297, columns: 2, rows: 3 },
} as const;
export type ScooterLabelLayout = keyof typeof SCOOTER_LABEL_LAYOUTS;

export interface ScooterLabelData {
  layout: ScooterLabelLayout;
  /** Numer na naklejce, np. `0007`. */
  number: string;
  /** Zawartość kodu QR: `${PUBLIC_SITE_URL}/h/0007` (ADR 0041). */
  url: string;
  /** Tekst z sekcji `admin.scooter-label` (treść z panelu, nie z kodu). */
  title: string;
  body: string;
  copies: number;
}

/** Dane układu naklejki (HTML w API, PDF przez Chromium); arkusz A4 powtarza naklejkę sześć razy. */
export function scooterLabelData(input: {
  number: number;
  siteUrl: string;
  layout: ScooterLabelLayout;
  text: { title: string | null; body: string | null };
}): ScooterLabelData {
  const number = String(input.number).padStart(4, '0');
  return {
    layout: input.layout,
    number,
    url: `${input.siteUrl.replace(/\/$/, '')}/h/${number}`,
    title: input.text.title ?? '',
    body: input.text.body ?? '',
    copies: SCOOTER_LABEL_LAYOUTS[input.layout].perPage,
  };
}
