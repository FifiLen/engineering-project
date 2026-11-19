import {
  DomainError,
  ensureCanStartDraft,
  ensureDraftEditable,
  ensureNoContentIssues,
  ensurePublishable,
  ensureVersion,
  markdownIssues,
  nextVersionNo,
  notFound,
} from '@hulajnogi/core';
import { type Database, DrizzleLegalDocumentRepository } from '@hulajnogi/db';
import type {
  DocumentDraftUpdate,
  DocumentVersionDetails,
  LegalDocumentDetails,
  LegalDocumentSummary,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { ContentPublisher } from '../content/content-publisher.service.js';
import { CONTENT_RULES } from '../content/content-rules.js';
import { DB } from '../database/database.module.js';

/** Limit treści dokumentu prawnego (jak `documentDraftUpdateSchema`); błędy Markdown w profilu `document` (ADR 0063). */
const DOCUMENT_BODY_MAX = 100_000;

/**
 * Dokumenty prawne z wersjami (ADR 0027): wersja robocza, edycja, publikacja. Opublikowanej wersji nie
 * zmieniamy, bo wskazują ją zgody klientów; publikacja działa od razu i wymaga ponownej akceptacji.
 */
@Injectable()
export class LegalDocumentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transaction: AuditedTransaction,
    private readonly publisher: ContentPublisher,
  ) {}

  list(): Promise<LegalDocumentSummary[]> {
    return new DrizzleLegalDocumentRepository(this.db).list();
  }

  async details(id: string): Promise<LegalDocumentDetails> {
    const repo = new DrizzleLegalDocumentRepository(this.db);
    const summary = (await repo.list()).find((d) => d.id === id);
    if (!summary) throw notFound('legalDocument', id);
    const versions = await repo.versions(id);
    return {
      ...summary,
      versions: versions.map((v) => ({
        ...v,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        supersededAt: v.supersededAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async version(versionId: string): Promise<DocumentVersionDetails> {
    const version = await new DrizzleLegalDocumentRepository(this.db).findVersion(versionId);
    if (!version) throw notFound('documentVersion', versionId);
    const { pageId, ...rest } = version;
    return { ...rest, documentId: pageId };
  }

  /** Nowa wersja robocza powstaje z obowiązującej (treść do poprawienia, a nie od zera). */
  async startDraft(actorId: string, documentId: string): Promise<DocumentVersionDetails> {
    const id = await this.transaction.run(actorId, async ({ tx, audit }) => {
      const repo = new DrizzleLegalDocumentRepository(tx);
      const doc = await repo.findById(documentId);
      if (!doc) throw notFound('legalDocument', documentId);
      ensureCanStartDraft(doc.draft !== null);
      const versionNo = nextVersionNo(doc.highestVersionNo);
      const source = doc.published ?? { title: doc.slug, bodyMd: '' };
      const draft = await repo.createDraft(documentId, versionNo, source, actorId);
      await audit({
        action: 'legal_document.draft_created',
        entityType: 'legal_document',
        entityId: documentId,
        data: { versionNo },
      });
      return draft.id;
    });
    return this.version(id);
  }

  /**
   * Zapis wersji roboczej z blokadą optymistyczną (`version`, dług z iteracji 2) i walidacją Markdown w profilu
   * `document` (`422 CONTENT_VALIDATION_FAILED` z wierszem i kolumną, ADR 0063).
   */
  async updateDraft(
    actorId: string,
    versionId: string,
    { version: expectedVersion, ...changes }: DocumentDraftUpdate,
  ): Promise<DocumentVersionDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const repo = new DrizzleLegalDocumentRepository(tx);
      const version = await repo.findVersion(versionId, { lock: true });
      if (!version) throw notFound('documentVersion', versionId);
      ensureDraftEditable(version);
      ensureVersion(expectedVersion, version.version);
      if (changes.bodyMd !== undefined) {
        ensureNoContentIssues(
          markdownIssues(
            changes.bodyMd,
            { max: DOCUMENT_BODY_MAX, required: false, profile: 'document' },
            { item: null, field: 'bodyMd' },
            CONTENT_RULES,
          ),
        );
      }
      if (!(await repo.updateDraft(versionId, expectedVersion, changes))) {
        throw new DomainError('CONFLICT', { expectedVersion, currentVersion: version.version });
      }
      // Treść dokumentu jest długa: w dzienniku tylko nazwy zmienionych pól.
      await audit({
        action: 'legal_document.draft_updated',
        entityType: 'legal_document',
        entityId: version.pageId,
        data: {
          versionNo: version.versionNo,
          fields: Object.keys(changes).filter((k) => changes[k as keyof typeof changes] !== undefined),
        },
      });
    });
    return this.version(versionId);
  }

  async publish(actorId: string, versionId: string): Promise<LegalDocumentDetails> {
    const documentId = await this.transaction.run(actorId, async ({ tx, audit }) => {
      const repo = new DrizzleLegalDocumentRepository(tx);
      const version = await repo.findVersion(versionId);
      if (!version) throw notFound('documentVersion', versionId);
      const doc = (await repo.findById(version.pageId))!;
      ensurePublishable(version, doc.consentType !== null, doc.published === null);
      await repo.publish(versionId, new Date());
      await audit({
        action: 'legal_document.published',
        entityType: 'legal_document',
        entityId: doc.id,
        data: { versionNo: version.versionNo, previousVersionNo: doc.published?.versionNo ?? null },
      });
      // Dokument na stronie (`/regulamin`, wersje archiwalne) i w aplikacji (ADR 0065).
      await this.publisher.changed(tx, ['WEB', 'MOBILE']);
      return doc.id;
    });
    await this.publisher.notify(['WEB', 'MOBILE']);
    return this.details(documentId);
  }

  async deleteDraft(actorId: string, versionId: string): Promise<void> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const repo = new DrizzleLegalDocumentRepository(tx);
      const version = await repo.findVersion(versionId);
      if (!version) throw notFound('documentVersion', versionId);
      ensureDraftEditable(version);
      await repo.deleteDraft(versionId);
      await audit({
        action: 'legal_document.draft_deleted',
        entityType: 'legal_document',
        entityId: version.pageId,
        data: { versionNo: version.versionNo },
      });
    });
  }
}
