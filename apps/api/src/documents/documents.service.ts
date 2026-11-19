import { randomUUID } from 'node:crypto';
import {
  buildDocumentData,
  documentEntityLabel,
  documentFileName,
  documentFilesExpired,
  documentFormatters,
  documentShowsCustomerData,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_JOB_ABANDONED_MS,
  DOCUMENT_TEXTS_PL,
  DOCUMENT_TYPES,
  DomainError,
  ensureCanDownloadDocument,
  ensureCanPrint,
  ensureDocumentFormat,
  ensureDocumentRetryable,
  generatedDocumentKey,
  generatedDocumentState,
  GENERATED_DOCUMENT_RETENTION_MS,
  isRetryableRenderError,
  isTemplateDocumentType,
  notFound,
  resolveDocumentParams,
  scooterLabelData,
  selectTemplate,
  shouldRunDocumentJob,
  visibleDocumentTypes,
  type DocumentFormat,
  type DocumentParams,
  type DocumentType,
  type PermissionSet,
  type ScooterLabelLayout,
  type TemplateDocumentType,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleDocumentRepository,
  DrizzleFileRepository,
  type GeneratedDocumentRecord,
} from '@hulajnogi/db';
import {
  formatPln,
  GENERATED_DOCUMENT_PERSONAL_FIELDS,
  generatedDocumentsResource,
  type CustomerDocumentView,
  type DocumentGenerate,
  type DocumentReady,
  type GeneratedDocumentListItem,
  type GeneratedDocumentView,
  type ListQuery,
  type ListResponse,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { CONFIG, type AppConfig } from '../config.js';
import { CompanyService } from '../content/company.service.js';
import { ContentTextsService } from '../content/content-texts.service.js';
import { DB } from '../database/database.module.js';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage.js';
import { FilesService } from '../files/files.service.js';
import { PlaceSearch } from '../geo/place-search.js';
import { JOBS, JobsService, type JobAttempt } from '../jobs/jobs.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { fileLink, readObject, storeFile } from './document-files.js';
import { loadDocumentSource, type SourceContext } from './document-sources.js';
import { DOCUMENT_RENDERER, type DocumentEngine } from './renderers.js';
import { scooterLabelHtml } from './scooter-label.js';

const EXTENSIONS: Record<DocumentFormat, string> = { DOCX: 'docx', PDF: 'pdf' };
/** Identyfikator wydruku ze stopki (8 znaków szesnastkowych) w wyszukiwaniu listy Wygenerowane. */
const SHORT_ID = /^[0-9a-f]{8}$/i;
/** Partia retencji i sprzątania; zadanie dobowe przechodzi kolejne partie do wyczerpania kandydatów. */
const BATCH = 200;

/**
 * Wydruki w procesach (ADR 0066, ADR 0068): „Drukuj” z karty obiektu w panelu, paragon PDF klienta z ponownym
 * użyciem, zadanie `document.generate` (DOCX zawsze, PDF przez silnik, przy błędzie PDF zostaje DOCX), zdarzenie
 * `document.ready`, lista Wygenerowane zawężona do rodzajów z uprawnieniem odczytu i retencja plików 30 dni.
 */
@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentEngine,
    private readonly files: FilesService,
    private readonly audited: AuditedTransaction,
    private readonly permissions: StaffPermissionsService,
    private readonly jobs: JobsService,
    private readonly gateway: FleetGateway,
    private readonly company: CompanyService,
    private readonly texts: ContentTextsService,
    private readonly places: PlaceSearch,
  ) {}

  onModuleInit(): void {
    this.jobs.handle(JOBS.documentGenerate, async (data, attempt) => this.generate(String(data.documentId), attempt));
    this.jobs.handle(JOBS.documentsRetention, async () => {
      await this.retention();
    });
    this.jobs.handle(JOBS.documentsSweep, async () => {
      await this.sweep();
    });
  }

  // --- Zlecenia --------------------------------------------------------------------------------------

  /** Kontekst źródła bez odwrotnego wyszukiwania (numer obiektu przy zleceniu nie potrzebuje adresu). */
  private get labelContext(): SourceContext {
    return { reverse: () => Promise.resolve(null), siteUrl: this.config.PUBLIC_SITE_URL };
  }

  /** Numer obiektu z chwili zlecenia (`entity_label`); brak obiektu to `404`. */
  private async entityLabel(repo: DrizzleDocumentRepository, type: DocumentType, entityId: string): Promise<string> {
    const sourceType: TemplateDocumentType = type === 'SCOOTER_LABEL' ? 'SCOOTER_CARD' : type;
    const source = await loadDocumentSource(repo, sourceType, entityId, this.labelContext);
    if (!source) throw notFound(NOT_FOUND_ENTITY[sourceType], entityId);
    return documentEntityLabel(sourceType, source);
  }

  /** Wersja szablonu do wydruku: wskazany szablon albo domyślny rodzaju (`selectTemplate`). */
  private async templateVersion(
    repo: DrizzleDocumentRepository,
    type: TemplateDocumentType,
    templateId: string | null,
  ) {
    const templates = (await repo.templates(type)).filter((t) => t.active);
    return selectTemplate(
      templates.map((t) => ({ id: t.id, isDefault: t.isDefault, activeVersionId: t.activeVersionId })),
      templateId,
    );
  }

  /**
   * `POST /admin/documents`: `documents.generate` i uprawnienie odczytu rodzaju (`ensureCanPrint`), parametry
   * z katalogu, wiersz `QUEUED` i zadanie w jednej transakcji z wpisem `generated_document.requested`.
   */
  async print(staffId: string, body: DocumentGenerate, retryOf: string | null = null): Promise<GeneratedDocumentView> {
    const { permissions } = await this.permissions.get(staffId);
    ensureCanPrint(permissions, body.documentType);
    ensureDocumentFormat(body.documentType, body.format);
    const params = resolveDocumentParams(body.documentType, body.params as DocumentParams);
    const repo = new DrizzleDocumentRepository(this.db);
    const entityLabel = await this.entityLabel(repo, body.documentType, body.entityId);
    const version =
      body.documentType === 'SCOOTER_LABEL'
        ? null
        : await this.templateVersion(repo, body.documentType, body.templateId);
    const id = randomUUID();
    await this.audited.run(staffId, async ({ tx, audit }) => {
      await new DrizzleDocumentRepository(tx).insertGenerated({
        id,
        documentType: body.documentType,
        templateVersionId: version?.versionId ?? null,
        entityRef: body.entityId,
        entityLabel,
        params,
        format: body.format,
        requestedByStaff: staffId,
        requestedByUser: null,
        retryOf,
      });
      await audit({
        action: 'generated_document.requested',
        entityType: 'generated_document',
        entityId: id,
        data: {
          documentType: body.documentType,
          entityRef: body.entityId,
          entityLabel,
          format: body.format,
          templateVersionId: version?.versionId ?? null,
          params,
          retryOf,
        },
      });
      await this.schedule(tx, id);
    });
    return this.staffView(id, permissions);
  }

  private schedule(tx: DbExecutor, id: string): Promise<void> {
    return this.jobs.sendInTransaction(tx, JOBS.documentGenerate, { documentId: id }, new Date(), { singletonKey: id });
  }

  /**
   * „Spróbuj ponownie” (wydruk nieudany) i „Wygeneruj ponownie” (pliki usunięte po 30 dniach): nowy wiersz
   * z `retry_of`, z bieżących danych i aktywnej wersji szablonu, z tymi samymi parametrami. Wydruk z danymi klienta
   * ponawia tylko operator z `users.read` (`ensureCanDownloadDocument`).
   */
  async retry(staffId: string, id: string): Promise<GeneratedDocumentView> {
    const doc = await new DrizzleDocumentRepository(this.db).generated(id);
    if (!doc) throw notFound('generated_document', id);
    const { permissions } = await this.permissions.get(staffId);
    ensureCanDownloadDocument(doc, { kind: 'staff', staffId, permissions });
    if (!doc.filesDeletedAt) ensureDocumentRetryable(doc);
    return this.print(
      staffId,
      {
        documentType: doc.documentType,
        entityId: doc.entityRef,
        templateId: doc.templateId,
        format: doc.format,
        params: doc.params,
      },
      id,
    );
  }

  async staffDocument(staffId: string, id: string): Promise<GeneratedDocumentView> {
    const { permissions } = await this.permissions.get(staffId);
    return this.staffView(id, permissions, staffId);
  }

  private async staffView(id: string, permissions: PermissionSet, staffId?: string): Promise<GeneratedDocumentView> {
    const doc = await new DrizzleDocumentRepository(this.db).generated(id);
    if (!doc) throw notFound('generated_document', id);
    if (staffId) ensureCanDownloadDocument(doc, { kind: 'staff', staffId, permissions });
    return this.view(doc);
  }

  /**
   * Lista Wygenerowane (`documents.generate`): tylko rodzaje z uprawnieniem odczytu (Serwisant nie widzi
   * paragonów), imię klienta zlecającego tylko z `users.read`; `q` z 8 znaków szesnastkowych szuka identyfikatora
   * ze stopki wydruku. Wiersz z `customerDataVisible` bez `users.read` zostaje na liście (że wydruk powstał), ale
   * szczegóły i pliki dają 404, więc panel nie pokazuje przy nim „Pobierz”.
   */
  async list(staffId: string, query: ListQuery): Promise<ListResponse<GeneratedDocumentListItem>> {
    const { permissions } = await this.permissions.get(staffId);
    permissions.require('documents.generate');
    const types = visibleDocumentTypes(permissions, DOCUMENT_TYPES);
    const repo = new DrizzleDocumentRepository(this.db);
    const idPrefix = query.q && SHORT_ID.test(query.q.trim()) ? query.q.trim().toLowerCase() : undefined;
    const effective = idPrefix ? { ...query, q: undefined } : query;
    if (permissions.has('users.read')) return repo.listGenerated(effective, types, { idPrefix });
    const personal = (field: string) => (GENERATED_DOCUMENT_PERSONAL_FIELDS as readonly string[]).includes(field);
    if (query.filters.some((f) => personal(f.field)) || query.sort.some((s) => personal(s.field))) {
      throw new DomainError('FORBIDDEN', { permission: 'users.read' });
    }
    const result = await repo.listGenerated(effective, types, {
      idPrefix,
      def: { ...generatedDocumentsResource, search: generatedDocumentsResource.search.filter((f) => !personal(f)) },
    });
    return { ...result, items: result.items.map((item) => ({ ...item, userName: null })) };
  }

  private fileName(doc: GeneratedDocumentRecord, format: DocumentFormat): string {
    return `${documentFileName(doc.documentType, doc.entityLabel)}.${EXTENSIONS[format]}`;
  }

  private files$(doc: GeneratedDocumentRecord, now = new Date()) {
    return {
      docx: doc.filesDeletedAt ? null : fileLink(this.files, doc.docx, this.fileName(doc, 'DOCX'), now),
      pdf: doc.filesDeletedAt ? null : fileLink(this.files, doc.pdf, this.fileName(doc, 'PDF'), now),
    };
  }

  private view(doc: GeneratedDocumentRecord): GeneratedDocumentView {
    return {
      id: doc.id,
      documentType: doc.documentType,
      entityRef: doc.entityRef,
      entityLabel: doc.entityLabel,
      format: doc.format,
      status: doc.status,
      state: generatedDocumentState(doc),
      template:
        doc.templateVersionId && doc.templateId
          ? {
              id: doc.templateId,
              name: doc.templateName ?? '',
              versionId: doc.templateVersionId,
              versionNo: doc.templateVersionNo ?? 0,
            }
          : null,
      requestedBy: doc.requestedByStaff
        ? { kind: 'staff', staffId: doc.requestedByStaff, name: doc.staffName ?? '' }
        : { kind: 'customer' },
      params: doc.params,
      errorCode: doc.errorCode,
      files: this.files$(doc),
      retryOf: doc.retryOf,
      createdAt: doc.createdAt.toISOString(),
      startedAt: doc.startedAt?.toISOString() ?? null,
      finishedAt: doc.finishedAt?.toISOString() ?? null,
      filesDeletedAt: doc.filesDeletedAt?.toISOString() ?? null,
      customerDataVisible: doc.customerDataVisible,
    };
  }

  // --- Paragon PDF klienta -------------------------------------------------------------------------

  private customerView(doc: GeneratedDocumentRecord): CustomerDocumentView {
    return {
      id: doc.id,
      documentType: 'RECEIPT',
      status: doc.status,
      errorCode: doc.errorCode,
      file: this.files$(doc).pdf,
      createdAt: doc.createdAt.toISOString(),
      finishedAt: doc.finishedAt?.toISOString() ?? null,
    };
  }

  /**
   * `POST /me/receipts/{id}/pdf` (pytanie 2): wydruk klienta tego paragonu z aktywną wersją domyślnego szablonu,
   * w formacie PDF, nie `FAILED` i z plikami wraca bez nowego zadania (`200`); inaczej wiersz i zadanie (`202`).
   * Wyścig dwóch kliknięć rozstrzyga `INSERT … ON CONFLICT DO NOTHING` na indeksie częściowym.
   */
  async customerReceiptPdf(
    userId: string,
    receiptId: string,
  ): Promise<{ created: boolean; view: CustomerDocumentView }> {
    const repo = new DrizzleDocumentRepository(this.db);
    const owner = await repo.receiptOwner(receiptId);
    if (!owner || owner.userId !== userId) throw notFound('receipt', receiptId);
    const { versionId } = await this.templateVersion(repo, 'RECEIPT', null);
    const existing = await repo.reusableCustomerReceipt(receiptId, versionId);
    if (existing) return { created: false, view: this.customerView(existing) };
    const id = randomUUID();
    const created = await this.db.transaction(async (tx) => {
      const inserted = await new DrizzleDocumentRepository(tx).insertCustomerReceipt({
        id,
        documentType: 'RECEIPT',
        templateVersionId: versionId,
        entityRef: receiptId,
        entityLabel: owner.number,
        params: {},
        format: 'PDF',
        requestedByStaff: null,
        requestedByUser: userId,
      });
      if (inserted) await this.schedule(tx, id);
      return inserted;
    });
    const doc = created ? await repo.generated(id) : await repo.reusableCustomerReceipt(receiptId, versionId);
    return { created, view: this.customerView(doc!) };
  }

  /** `GET /me/documents/{id}`: stan i adres z podpisem; cudzy wydruk to `404`. */
  async customerDocument(userId: string, id: string): Promise<CustomerDocumentView> {
    const doc = await new DrizzleDocumentRepository(this.db).generated(id);
    if (!doc) throw notFound('generated_document', id);
    ensureCanDownloadDocument(doc, { kind: 'customer', userId });
    return this.customerView(doc);
  }

  // --- Zadanie `document.generate` ------------------------------------------------------------------

  /**
   * Zadanie wydruku (ADR 0066): blokada wiersza i `RUNNING` (powtórka zadania po końcu niczego nie dubluje), dane
   * z `v_doc_*` przez katalog w core, DOCX do magazynu, PDF przez silnik. Niedostępny silnik wraca do kolejki,
   * dopóki są ponowienia; inny błąd to `FAILED` z kodem, a zapisany DOCX zostaje do pobrania. Ponowienie pg-boss
   * po restarcie API przejmuje wiersz `RUNNING` starszy niż limit czasu zadania (`shouldRunDocumentJob`).
   */
  async generate(documentId: string, attempt: JobAttempt = { retryCount: 0, retryLimit: 0 }): Promise<void> {
    const started = await this.db.transaction(async (tx) => {
      const repo = new DrizzleDocumentRepository(tx);
      const doc = await repo.lockGenerated(documentId);
      if (!doc || !shouldRunDocumentJob(doc, new Date())) return null;
      await repo.markRunning(documentId);
      return doc;
    });
    if (!started) return;
    try {
      await this.render(started);
      await new DrizzleDocumentRepository(this.db).succeed(documentId);
    } catch (error) {
      const code = error instanceof DomainError ? error.code : 'RENDER_FAILED';
      if (isRetryableRenderError(code) && attempt.retryCount < attempt.retryLimit) {
        await new DrizzleDocumentRepository(this.db).requeue(documentId);
        throw error;
      }
      if (!(error instanceof DomainError)) this.logger.error(`Wydruk ${documentId}: ${(error as Error).stack}`);
      const detail = error instanceof DomainError ? JSON.stringify(error.details ?? {}) : (error as Error).message;
      await new DrizzleDocumentRepository(this.db).fail(documentId, code, detail);
    }
    await this.emitReady(documentId);
  }

  private async render(doc: GeneratedDocumentRecord): Promise<void> {
    const repo = new DrizzleDocumentRepository(this.db);
    const now = new Date();
    const fileName = documentFileName(doc.documentType, doc.entityLabel);
    const store = async (format: DocumentFormat, bytes: Uint8Array) => {
      const file = await storeFile(this.storage, this.db, {
        purpose: 'GENERATED_DOCUMENT',
        key: (fileId) => generatedDocumentKey(fileId, format, now),
        bytes,
        contentType: DOCUMENT_CONTENT_TYPES[format],
        originalName: `${fileName}.${EXTENSIONS[format]}`,
        staffId: doc.requestedByStaff,
        userId: doc.requestedByUser,
      });
      await repo.attachFile(doc.id, format, file.id);
    };

    if (doc.documentType === 'SCOOTER_LABEL') {
      const scooter = await repo.source('SCOOTER_CARD', doc.entityRef);
      if (!scooter) throw new DomainError('DOCUMENT_SOURCE_NOT_FOUND');
      const label = scooterLabelData({
        number: Number(scooter.number),
        siteUrl: this.config.PUBLIC_SITE_URL,
        layout: (doc.params.layout ?? 'single') as ScooterLabelLayout,
        text: await this.texts.adminSection('admin.scooter-label'),
      });
      const pdf = await this.renderer.htmlToPdf(await scooterLabelHtml(label), { trace: doc.id, fileName });
      await store('PDF', pdf);
      return;
    }

    if (!isTemplateDocumentType(doc.documentType) || !doc.templateVersionId) {
      throw new DomainError('DOCUMENT_TYPE_NOT_PRINTABLE');
    }
    let docx: Uint8Array | null =
      doc.docx?.status === 'READY' ? await readObject(this.storage, doc.docx.storageKey) : null;
    if (!docx) {
      const version = await repo.version(doc.templateVersionId);
      const template = version ? await readObject(this.storage, version.storageKey) : null;
      if (!version || !template) throw new DomainError('TEMPLATE_RENDER_FAILED', { reason: 'template_file_missing' });
      const source = await loadDocumentSource(repo, doc.documentType, doc.entityRef, {
        reverse: (point) => this.places.reverse(point),
        siteUrl: this.config.PUBLIC_SITE_URL,
      });
      if (!source) throw new DomainError('DOCUMENT_SOURCE_NOT_FOUND');
      const canReadCustomers = doc.requestedByUser
        ? true
        : (await this.permissions.get(doc.requestedByStaff!)).permissions.has('users.read');
      const data = buildDocumentData(doc.documentType, source, {
        documentId: doc.id,
        generatedAt: now,
        template: { name: version.templateName, versionNo: version.versionNo },
        staff: doc.requestedByStaff ? { name: doc.staffName ?? '' } : null,
        company: await this.company.publicView(),
        params: doc.params,
        format: documentFormatters(formatPln),
        texts: DOCUMENT_TEXTS_PL,
        canReadCustomers,
      });
      docx = this.renderer.fillDocx(template, data);
      // Maskowanie jest wypalone w pliku: o pobraniu przez innego operatora decyduje ta flaga (ADR 0068).
      await repo.setCustomerDataVisible(doc.id, documentShowsCustomerData(doc.documentType, canReadCustomers));
      await store('DOCX', docx);
    }
    if (doc.format === 'PDF') {
      await store('PDF', await this.renderer.docxToPdf(docx, { trace: doc.id, fileName }));
    }
  }

  /**
   * `document.ready` po stanie końcowym: do zlecającego operatora albo klienta, z adresami z podpisem. Operator, który
   * stracił `users.read` przed końcem wydruku z danymi klienta, dostaje zdarzenie bez adresów.
   */
  private async emitReady(documentId: string): Promise<void> {
    const doc = await new DrizzleDocumentRepository(this.db).generated(documentId);
    if (!doc || (doc.status !== 'SUCCEEDED' && doc.status !== 'FAILED')) return;
    const hidden =
      doc.customerDataVisible &&
      doc.requestedByStaff !== null &&
      !(await this.permissions.get(doc.requestedByStaff)).permissions.has('users.read');
    const links = hidden ? { docx: null, pdf: null } : this.files$(doc);
    const event: DocumentReady = {
      id: doc.id,
      documentType: doc.documentType,
      status: doc.status,
      format: doc.format,
      ...(doc.errorCode ? { errorCode: doc.errorCode } : {}),
      files: { ...(links.docx ? { docx: links.docx } : {}), ...(links.pdf ? { pdf: links.pdf } : {}) },
    };
    this.gateway.documentReady({ staffId: doc.requestedByStaff, userId: doc.requestedByUser }, event);
  }

  // --- Retencja ------------------------------------------------------------------------------------

  /**
   * Zadanie dobowe `documents.retention`: DOCX i PDF wydruków starszych niż 30 dni znikają z magazynu
   * (`files.status = DELETED`), a wiersz wydruku dostaje `files_deleted_at` i zostaje na zawsze. Kolejne partie
   * po 200 do wyczerpania kandydatów; partia bez żadnego usunięcia (np. magazyn niedostępny) kończy przebieg.
   */
  async retention(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - GENERATED_DOCUMENT_RETENTION_MS);
    let deleted = 0;
    for (;;) {
      const candidates = await new DrizzleDocumentRepository(this.db).expiredFiles(before, BATCH);
      const removed = await this.retentionBatch(candidates, now);
      deleted += removed;
      if (candidates.length < BATCH || removed === 0) break;
    }
    if (deleted) this.logger.log(`Retencja wydruków: ${deleted}`);
    return deleted;
  }

  private async retentionBatch(candidates: GeneratedDocumentRecord[], now: Date): Promise<number> {
    let deleted = 0;
    for (const doc of candidates) {
      if (!documentFilesExpired(doc, now)) continue;
      try {
        const keys = await this.db.transaction(async (tx) => {
          if (!(await new DrizzleDocumentRepository(tx).markFilesDeleted(doc.id))) return [];
          const files = new DrizzleFileRepository(tx);
          const released: string[] = [];
          for (const file of [doc.docx, doc.pdf]) {
            if (file && (await files.markDeleted(file.id))) released.push(file.storageKey);
          }
          return released;
        });
        for (const key of keys) await this.storage.delete(key).catch(() => undefined);
        deleted += 1;
      } catch (error) {
        this.logger.warn(`Nie usunięto plików wydruku ${doc.id}: ${(error as Error).message}`);
      }
    }
    return deleted;
  }

  /**
   * Zadanie porządkowe `documents.sweep` (co 5 min): wydruk w kolejce albo w toku dłużej niż 15 min nie ma już
   * zadania (restart API po wyczerpaniu ponowień, zgubione zadanie), więc kończy się jako `FAILED` z `RENDER_TIMEOUT`
   * i `document.ready`; operator ma „Spróbuj ponownie”, a paragon klienta powstaje od nowa przy kolejnym żądaniu.
   */
  async sweep(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - DOCUMENT_JOB_ABANDONED_MS);
    let failed = 0;
    for (;;) {
      const ids = await new DrizzleDocumentRepository(this.db).failAbandoned(before, 'RENDER_TIMEOUT', BATCH);
      for (const id of ids) await this.emitReady(id);
      failed += ids.length;
      if (ids.length < BATCH) break;
    }
    if (failed) this.logger.warn(`Porzucone wydruki zakończone jako nieudane: ${failed}`);
    return failed;
  }
}

const NOT_FOUND_ENTITY: Record<TemplateDocumentType, string> = {
  RECEIPT: 'receipt',
  RENTAL_CONFIRMATION: 'rental',
  SERVICE_PROTOCOL: 'service_task',
  SCOOTER_CARD: 'scooter',
  INCIDENT_REPORT: 'ticket',
  WALLET_ADJUSTMENT: 'wallet_entry',
};
