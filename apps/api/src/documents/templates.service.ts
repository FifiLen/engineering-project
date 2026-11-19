import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  documentFieldCatalog,
  documentFormatters,
  documentParamSpecs,
  documentSampleData,
  DOCUMENT_CATALOG,
  DOCUMENT_READ_PERMISSIONS,
  DOCUMENT_TEXTS_PL,
  DOCUMENT_TYPES,
  diffForAudit,
  DomainError,
  ensureCanPrint,
  ensureVersion,
  ensureTemplateVersionDeletable,
  formatDocumentDateTime,
  isPrintable,
  isTemplateDocumentType,
  nextTemplateVersionNo,
  notFound,
  TEMPLATE_MAX_BYTES,
  templateVersionKey,
  type DocumentFieldSpec,
  type TemplateDocumentType,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleDocumentRepository,
  type DocumentTemplateRecord,
  starterTemplatesDir,
  type TemplateVersionRecord,
} from '@hulajnogi/db';
import {
  formatPln,
  type DocumentFieldCatalogView,
  type DocumentFieldView,
  type DocumentFileLink,
  type DocumentTemplateCreate,
  type DocumentTemplateUpdate,
  type DocumentTemplateListItem,
  type DocumentTemplateVersionView,
  type DocumentTemplateView,
  type DocumentTypeView,
  type ListQuery,
  type ListResponse,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { CompanyService } from '../content/company.service.js';
import { DB } from '../database/database.module.js';
import { FILE_STORAGE, type FileStorage } from '../files/file-storage.js';
import { FilesService } from '../files/files.service.js';
import { fileLink, readObject, storeFile } from './document-files.js';
import { inspectTemplate } from './docx-engine.js';
import { DOCUMENT_RENDERER, type DocumentEngine } from './renderers.js';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface TemplateUpload {
  data: Buffer;
  truncated: boolean;
  filename: string | null;
  note: string | null;
}

export interface DocumentTemplateDetails extends DocumentTemplateView {
  active: boolean;
  /** Wersja rekordu do edycji nazwy i opisu (blokada optymistyczna, ADR 0076). */
  version: number;
  versions: DocumentTemplateVersionView[];
}

const templateView = (t: DocumentTemplateRecord): DocumentTemplateView => ({
  id: t.id,
  documentType: t.documentType,
  name: t.name,
  description: t.description,
  isDefault: t.isDefault,
  activeVersionNo: t.activeVersionNo,
  versionCount: t.versions,
  lastGeneratedAt: t.lastGeneratedAt?.toISOString() ?? null,
});

const versionView = (v: TemplateVersionRecord): DocumentTemplateVersionView => ({
  id: v.id,
  templateId: v.templateId,
  versionNo: v.versionNo,
  state: v.state,
  note: v.note,
  fileName: v.fileName,
  sizeBytes: v.sizeBytes,
  uncompressedBytes: v.uncompressedBytes,
  fields: v.fields,
  warnings: v.warnings,
  createdAt: v.uploadedAt.toISOString(),
  createdByName: v.uploadedByName,
  activatedAt: v.activatedAt?.toISOString() ?? null,
  activatedByName: v.activatedByName,
});

const fieldView = (field: DocumentFieldSpec): DocumentFieldView => ({
  path: field.path,
  label: field.label,
  type: field.type,
  example: field.example,
  customer: field.customer ?? false,
  common: field.common ?? false,
});

/** Nazwa pliku wersji do pobrania: nazwa szablonu w ASCII i numer wersji. */
const versionFileName = (v: TemplateVersionRecord) =>
  `${v.templateName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}-v${v.versionNo}.docx`;

/**
 * Szablony wydruków (ADR 0067): lista z aktywną wersją, wgranie wersji z kontrolą archiwum i znaczników, podgląd
 * PDF na danych przykładowych zapamiętany przy wersji, aktywacja i przywrócenie procedurą bazy, szablon domyślny,
 * lista pól z katalogu w core (także jako DOCX z szablonu systemowego). `templates.read` daje podgląd i pobranie,
 * `templates.write` (Administrator) zmiany; każda zmiana ma wpis w dzienniku audytu.
 */
@Injectable()
export class TemplatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(DOCUMENT_RENDERER) private readonly renderer: DocumentEngine,
    private readonly files: FilesService,
    private readonly audited: AuditedTransaction,
    private readonly permissions: StaffPermissionsService,
    private readonly company: CompanyService,
  ) {}

  list(query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<DocumentTemplateListItem>> {
    return new DrizzleDocumentRepository(db).listTemplates(query);
  }

  async details(id: string): Promise<DocumentTemplateDetails> {
    const repo = new DrizzleDocumentRepository(this.db);
    const template = await repo.template(id);
    if (!template) throw notFound('document_template', id);
    return {
      ...templateView(template),
      active: template.active,
      version: template.version,
      versions: (await repo.versions(id)).map(versionView),
    };
  }

  /** `POST /admin/document-templates`: nowy szablon rodzaju z katalogu (bez wersji, więc jeszcze bez „Drukuj”). */
  async create(staffId: string, body: DocumentTemplateCreate): Promise<DocumentTemplateDetails> {
    const id = await this.audited.run(staffId, async ({ tx, audit }) => {
      const templateId = await new DrizzleDocumentRepository(tx).insertTemplate({ ...body, staffId });
      await audit({
        action: 'document_template.created',
        entityType: 'document_template',
        entityId: templateId,
        data: { after: body },
      });
      return templateId;
    });
    return this.details(id);
  }

  /**
   * Wgranie wersji (ADR 0067, kroki 1–8): rozmiar i archiwum, kompilacja, znaczniki względem katalogu rodzaju
   * z miejscem błędu, próbne wypełnienie danymi przykładowymi. Błąd to `422 TEMPLATE_INVALID` z `details.issues[]`
   * i plik nie trafia do magazynu; sukces to wersja „Do aktywacji” z ostrzeżeniami o nieużytych polach.
   */
  async uploadVersion(
    staffId: string,
    templateId: string,
    upload: TemplateUpload,
  ): Promise<DocumentTemplateVersionView> {
    const repo = new DrizzleDocumentRepository(this.db);
    const template = await repo.template(templateId);
    if (!template) throw notFound('document_template', templateId);
    if (upload.truncated || upload.data.length > TEMPLATE_MAX_BYTES) {
      throw new DomainError('TEMPLATE_TOO_LARGE', { maxBytes: TEMPLATE_MAX_BYTES });
    }
    const inspection = inspectTemplate(upload.data, documentFieldCatalog(template.documentType));
    if (inspection.issues.length) throw new DomainError('TEMPLATE_INVALID', { issues: inspection.issues });
    try {
      this.renderer.fillDocx(upload.data, this.sample(template.documentType, template.name, 0));
    } catch (error) {
      const reason = error instanceof DomainError ? (error.details?.reason ?? error.code) : (error as Error).message;
      throw new DomainError('TEMPLATE_INVALID', {
        issues: [
          {
            code: 'TEMPLATE_RENDER_FAILED',
            tag: null,
            place: null,
            suggestion: null,
            available: [],
            loop: null,
            reason,
          },
        ],
      });
    }
    const versionId = randomUUID();
    const file = await storeFile(this.storage, this.db, {
      purpose: 'DOCUMENT_TEMPLATE',
      key: () => templateVersionKey(versionId, new Date()),
      bytes: upload.data,
      contentType: DOCX_TYPE,
      originalName: upload.filename ?? `${template.name}.docx`,
      staffId,
    });
    try {
      await this.audited.run(staffId, async ({ tx, audit }) => {
        const txRepo = new DrizzleDocumentRepository(tx);
        await txRepo.template(templateId, { lock: true });
        const versionNo = nextTemplateVersionNo(await txRepo.highestVersionNo(templateId));
        await txRepo.insertVersion({
          id: versionId,
          templateId,
          versionNo,
          fileId: file.id,
          fields: inspection.usedFields,
          warnings: inspection.warnings,
          note: upload.note,
          uploadedBy: staffId,
          sizeBytes: inspection.sizeBytes,
          uncompressedBytes: inspection.uncompressedBytes,
        });
        await txRepo.touchTemplate(templateId, staffId);
        await audit({
          action: 'document_template.version_uploaded',
          entityType: 'document_template',
          entityId: templateId,
          data: { versionId, versionNo, fields: inspection.usedFields.length, warnings: inspection.warnings.length },
        });
      });
    } catch (error) {
      await this.files.deleteObject(file);
      throw error;
    }
    return versionView((await repo.version(versionId))!);
  }

  private async versionOf(templateId: string, versionId: string): Promise<TemplateVersionRecord> {
    const version = await new DrizzleDocumentRepository(this.db).version(versionId);
    if (!version || version.templateId !== templateId) throw notFound('document_template_version', versionId);
    return version;
  }

  /** Aktywacja i „Przywróć” starszej wersji bez kopiowania pliku (`sp_document_template_activate`). */
  async activate(staffId: string, templateId: string, versionId: string): Promise<DocumentTemplateDetails> {
    const version = await this.versionOf(templateId, versionId);
    if (!version.isActive) {
      await this.audited.run(staffId, async ({ tx, audit }) => {
        await new DrizzleDocumentRepository(tx).activate(versionId, staffId);
        await audit({
          action: version.activatedAt ? 'document_template.version_restored' : 'document_template.version_activated',
          entityType: 'document_template',
          entityId: templateId,
          data: { versionId, versionNo: version.versionNo },
        });
      });
    }
    return this.details(templateId);
  }

  /**
   * Nazwa i opis szablonu (ADR 0076, dług z iteracji 7) z blokadą optymistyczną i wpisem `document_template.updated`
   * ze zmianami; zajęta nazwa w rodzaju to `TEMPLATE_NAME_TAKEN`. Bez zmian nie ma wpisu ani nowej wersji rekordu.
   */
  async update(staffId: string, templateId: string, body: DocumentTemplateUpdate): Promise<DocumentTemplateDetails> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleDocumentRepository(tx);
      const template = await repo.template(templateId, { lock: true });
      if (!template) throw notFound('document_template', templateId);
      ensureVersion(body.version, template.version);
      const changes = diffForAudit(template, { name: body.name, description: body.description });
      if (Object.keys(changes).length === 0) return;
      const fields = {
        ...(changes.name ? { name: body.name } : {}),
        ...(changes.description ? { description: body.description ?? null } : {}),
      };
      if (!(await repo.updateTemplate(templateId, body.version, fields, staffId))) {
        ensureVersion(body.version, (await repo.template(templateId))!.version);
      }
      await audit({
        action: 'document_template.updated',
        entityType: 'document_template',
        entityId: templateId,
        data: { documentType: template.documentType, changes },
      });
    });
    return this.details(templateId);
  }

  /**
   * Dezaktywacja (`sp_document_template_deactivate`, ADR 0076): domyślny szablon z aktywną wersją to `409
   * TEMPLATE_IS_DEFAULT`; nieaktywny znika z „Drukuj”, wersje i wydruki zostają. Ponowna dezaktywacja bez wpisu.
   */
  async deactivate(staffId: string, templateId: string): Promise<DocumentTemplateDetails> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleDocumentRepository(tx);
      const template = await repo.template(templateId);
      if (!template) throw notFound('document_template', templateId);
      if (!(await repo.deactivateTemplate(templateId, staffId))) return;
      await audit({
        action: 'document_template.deactivated',
        entityType: 'document_template',
        entityId: templateId,
        data: {
          documentType: template.documentType,
          changes: { active: [true, false], ...(template.isDefault ? { isDefault: [true, false] } : {}) },
        },
      });
    });
    return this.details(templateId);
  }

  /** „Aktywuj ponownie” (`sp_document_template_reactivate`): szablon wraca bez roli domyślnego. */
  async reactivate(staffId: string, templateId: string): Promise<DocumentTemplateDetails> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleDocumentRepository(tx);
      if (!(await repo.reactivateTemplate(templateId, staffId))) return;
      const template = await repo.template(templateId);
      await audit({
        action: 'document_template.reactivated',
        entityType: 'document_template',
        entityId: templateId,
        data: { documentType: template?.documentType ?? null, changes: { active: [false, true] } },
      });
    });
    return this.details(templateId);
  }

  /** Szablon domyślny rodzaju (`sp_document_template_set_default`; wymaga aktywnej wersji). */
  async setDefault(staffId: string, templateId: string): Promise<DocumentTemplateDetails> {
    const template = await new DrizzleDocumentRepository(this.db).template(templateId);
    if (!template) throw notFound('document_template', templateId);
    if (!template.isDefault) {
      await this.audited.run(staffId, async ({ tx, audit }) => {
        await new DrizzleDocumentRepository(tx).setDefault(templateId);
        await audit({
          action: 'document_template.default_set',
          entityType: 'document_template',
          entityId: templateId,
          data: { documentType: template.documentType },
        });
      });
    }
    return this.details(templateId);
  }

  /** Usunięcie wersji nigdy nieaktywowanej („Do aktywacji”); pozostałe wskazują wydruki. */
  async deleteVersion(staffId: string, templateId: string, versionId: string): Promise<void> {
    const version = await this.versionOf(templateId, versionId);
    ensureTemplateVersionDeletable(version);
    const released = await this.audited.run(staffId, async ({ tx, audit }) => {
      await new DrizzleDocumentRepository(tx).deleteVersion(versionId);
      await audit({
        action: 'document_template.version_deleted',
        entityType: 'document_template',
        entityId: templateId,
        data: { versionId, versionNo: version.versionNo },
      });
      const claimed = [await this.files.claimReleased(tx, version.fileId)];
      if (version.previewFileId) claimed.push(await this.files.claimReleased(tx, version.previewFileId));
      return claimed;
    });
    for (const file of released) if (file) await this.files.deleteObject(file);
  }

  /** Adres z podpisem do „Pobierz aktywną” i pobrania dowolnej wersji. */
  async versionFile(templateId: string, versionId: string): Promise<DocumentFileLink> {
    const version = await this.versionOf(templateId, versionId);
    const file = await new DrizzleDocumentRepository(this.db).fileKey(version.fileId);
    const link = fileLink(this.files, file ? { id: version.fileId, ...file } : null, versionFileName(version));
    if (!link) throw new DomainError('FILE_DELETED', { fileId: version.fileId });
    return link;
  }

  /**
   * Podgląd PDF wersji na danych przykładowych (synchronicznie, limit silnika 30 s); wynik zapamiętany
   * w `preview_file_id`, więc kolejne otwarcia nie wołają silnika.
   */
  async preview(templateId: string, versionId: string): Promise<{ bytes: Buffer; fileName: string }> {
    const version = await this.versionOf(templateId, versionId);
    const repo = new DrizzleDocumentRepository(this.db);
    const fileName = versionFileName(version).replace(/\.docx$/, '-podglad.pdf');
    if (version.previewFileId) {
      const stored = await repo.fileKey(version.previewFileId);
      const bytes = stored?.status === 'READY' ? await readObject(this.storage, stored.storageKey) : null;
      if (bytes) return { bytes, fileName };
    }
    const template = await readObject(this.storage, version.storageKey);
    if (!template) throw new DomainError('FILE_DELETED', { fileId: version.fileId });
    const docx = this.renderer.fillDocx(
      template,
      this.sample(version.documentType, version.templateName, version.versionNo, await this.companyProfile()),
    );
    const pdf = Buffer.from(await this.renderer.docxToPdf(docx, { trace: `preview-${version.id}`, fileName }));
    const file = await storeFile(this.storage, this.db, {
      purpose: 'DOCUMENT_TEMPLATE',
      key: (id) => `document-template/preview/${id}.pdf`,
      bytes: pdf,
      contentType: 'application/pdf',
      originalName: fileName,
    });
    if (!(await repo.setPreviewFile(version.id, file.id))) await this.files.deleteObject(file);
    return { bytes: pdf, fileName };
  }

  /** Pola i pętle rodzaju dla autora szablonu (jedyne źródło: katalog w core). */
  fieldCatalog(type: string): DocumentFieldCatalogView {
    if (!isTemplateDocumentType(type)) throw new DomainError('DOCUMENT_TYPE_NOT_PRINTABLE', { type });
    const catalog = documentFieldCatalog(type);
    return {
      documentType: type,
      fields: catalog.fields.map(fieldView),
      loops: catalog.loops.map((loop) => ({ path: loop.path, label: loop.label, fields: loop.fields.map(fieldView) })),
    };
  }

  /** „Lista pól (DOCX)”: systemowy szablon `lista-pol.docx` z pętlą po polach katalogu, bez nowej biblioteki. */
  async fieldListDocx(type: string): Promise<{ bytes: Uint8Array; fileName: string }> {
    const catalog = this.fieldCatalog(type);
    const kind = (field: DocumentFieldView) => (field.type === 'boolean' ? 'warunek (tak/nie)' : 'tekst');
    const fields = [
      ...catalog.fields.map((f) => ({ tag: `{${f.path}}`, label: f.label, kind: kind(f), example: f.example })),
      ...catalog.loops.flatMap((loop) => [
        { tag: `{#${loop.path}}…{/${loop.path}}`, label: loop.label, kind: 'pętla', example: '' },
        ...loop.fields.map((f) => ({
          tag: `{${f.path}}`,
          label: `${loop.label}: ${f.label}`,
          kind: kind(f),
          example: f.example,
        })),
      ]),
    ];
    const template = readFileSync(join(starterTemplatesDir, 'lista-pol.docx'));
    const now = new Date();
    const company = await this.companyProfile();
    const bytes = this.renderer.fillDocx(template, {
      company: { name: company.name },
      documentType: { label: DOCUMENT_TYPE_NAMES[catalog.documentType], code: catalog.documentType },
      document: { generatedAt: formatDocumentDateTime(now), footer: `Lista pól · ${catalog.documentType}` },
      fields,
    });
    return { bytes, fileName: `lista-pol-${DOCUMENT_CATALOG[catalog.documentType].slug}.docx` };
  }

  /**
   * `GET /admin/document-types`: rodzaje z szablonami i parametrami. „Drukuj” (`printable`) wymaga szablonu
   * z aktywną wersją (naklejka zawsze) i uprawnień `documents.generate` z odczytem rodzaju; z `templates.read`
   * widać wszystkie rodzaje (zakładka Szablony), bez niego tylko te do druku.
   */
  async documentTypes(staffId: string): Promise<DocumentTypeView[]> {
    const { permissions } = await this.permissions.get(staffId);
    const templates = await new DrizzleDocumentRepository(this.db).templates();
    const result: DocumentTypeView[] = [];
    for (const type of DOCUMENT_TYPES) {
      const own = templates.filter((t) => t.documentType === type && t.active);
      let canPrint = true;
      try {
        ensureCanPrint(permissions, type);
      } catch {
        canPrint = false;
      }
      if (!canPrint && !permissions.has('templates.read')) continue;
      const printable = canPrint && isPrintable(type, own);
      result.push({
        documentType: type,
        readPermission: DOCUMENT_READ_PERMISSIONS[type],
        builtIn: type === 'SCOOTER_LABEL',
        printable,
        params: documentParamSpecs(type).map((p) => ({
          name: p.name,
          type: p.type,
          options: p.options ? [...p.options] : null,
          default: p.default,
        })),
        templates: own
          .filter((t) => t.activeVersionId !== null || permissions.has('templates.read'))
          .map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault, activeVersionNo: t.activeVersionNo })),
      });
    }
    return result;
  }

  private async companyProfile() {
    return this.company.publicView();
  }

  /** Dane przykładowe z katalogu; stopka podglądu „nie jest dokumentem”. */
  private sample(
    type: TemplateDocumentType,
    name: string,
    versionNo: number,
    company?: Awaited<ReturnType<CompanyService['publicView']>>,
  ) {
    return documentSampleData(type, {
      documentId: randomUUID(),
      template: { name, versionNo },
      format: documentFormatters(formatPln),
      texts: DOCUMENT_TEXTS_PL,
      preview: true,
      ...(company ? { company } : {}),
    });
  }
}

/** Nazwy rodzajów na liście pól (DOCX); panel ma własne etykiety w pliku tłumaczeń. */
const DOCUMENT_TYPE_NAMES: Record<TemplateDocumentType, string> = {
  RECEIPT: 'Paragon i korekta',
  RENTAL_CONFIRMATION: 'Potwierdzenie przejazdu',
  SERVICE_PROTOCOL: 'Protokół zadania serwisowego',
  SCOOTER_CARD: 'Karta hulajnogi',
  INCIDENT_REPORT: 'Raport zgłoszenia',
  WALLET_ADJUSTMENT: 'Potwierdzenie korekty salda',
};
