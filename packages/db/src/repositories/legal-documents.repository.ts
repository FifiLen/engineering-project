import type {
  ConsentType,
  DocumentVersionRecord,
  DocumentVersionState,
  LegalDocumentRecord,
  LegalDocumentRepository,
} from '@hulajnogi/core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { contentPages, contentPageVersions } from '../schema/schema.js';

export interface LegalDocumentListItem {
  id: string;
  slug: string;
  name: string;
  consentType: ConsentType | null;
  publishedVersionNo: number | null;
  hasDraft: boolean;
}

export interface DocumentVersionListItem {
  id: string;
  versionNo: number;
  title: string;
  status: DocumentVersionState['status'];
  publishedAt: Date | null;
  /** Data, od której obowiązuje następna wersja (koniec obowiązywania tej). */
  supersededAt: Date | null;
  acceptances: number;
  createdAt: Date;
}

const versionColumns = {
  id: contentPageVersions.id,
  pageId: contentPageVersions.pageId,
  versionNo: contentPageVersions.versionNo,
  status: contentPageVersions.status,
  title: contentPageVersions.title,
  bodyMd: contentPageVersions.bodyMd,
  changeSummary: contentPageVersions.changeSummary,
};

/**
 * Dokumenty z wersjami do zgód (regulamin, polityka prywatności, zasady jazdy; ADR 0027). Kilka
 * dokumentów po kilka wersji: listy bez wspólnego mechanizmu, pełny moduł treści w iteracji 7.
 */
export class DrizzleLegalDocumentRepository implements LegalDocumentRepository {
  constructor(private readonly db: DbExecutor) {}

  async list(): Promise<LegalDocumentListItem[]> {
    return this.db
      .select({
        id: contentPages.id,
        slug: contentPages.slug,
        name: contentPages.name,
        consentType: contentPages.consentType,
        // Odwołania do zapytania zewnętrznego z nazwą tabeli: Drizzle wstawia kolumnę bez niej.
        publishedVersionNo: sql<number | null>`(SELECT v.version_no FROM content_page_versions v
          WHERE v.page_id = content_pages.id AND v.status = 'PUBLISHED')`,
        hasDraft: sql<boolean>`EXISTS (SELECT 1 FROM content_page_versions v
          WHERE v.page_id = content_pages.id AND v.status = 'DRAFT')`,
      })
      .from(contentPages)
      .orderBy(asc(contentPages.name));
  }

  async versions(pageId: string): Promise<DocumentVersionListItem[]> {
    const rows = await this.db
      .select({
        id: contentPageVersions.id,
        versionNo: contentPageVersions.versionNo,
        title: contentPageVersions.title,
        status: contentPageVersions.status,
        publishedAt: contentPageVersions.publishedAt,
        supersededAt: sql<Date | null>`(SELECT min(n.published_at) FROM content_page_versions n
          WHERE n.page_id = content_page_versions.page_id AND n.version_no > content_page_versions.version_no
            AND n.published_at IS NOT NULL)`,
        acceptances: sql<number>`(SELECT count(*)::int FROM consents c
          WHERE c.page_version_id = content_page_versions.id AND c.revoked_at IS NULL)`,
        createdAt: contentPageVersions.createdAt,
      })
      .from(contentPageVersions)
      .where(eq(contentPageVersions.pageId, pageId))
      .orderBy(desc(contentPageVersions.versionNo));
    return rows.map((r) => ({
      ...r,
      supersededAt: r.supersededAt ? new Date(r.supersededAt) : null,
      acceptances: Number(r.acceptances),
    }));
  }

  /** Obowiązująca wersja dokumentu dla klientów (`GET /legal/{slug}`). */
  async published(slug: string): Promise<(DocumentVersionRecord & { publishedAt: Date }) | null> {
    const [row] = await this.db
      .select({ ...versionColumns, publishedAt: contentPageVersions.publishedAt })
      .from(contentPageVersions)
      .innerJoin(contentPages, eq(contentPages.id, contentPageVersions.pageId))
      .where(and(eq(contentPages.slug, slug), eq(contentPageVersions.status, 'PUBLISHED')));
    return row ? { ...row, publishedAt: row.publishedAt! } : null;
  }

  async findById(pageId: string): Promise<LegalDocumentRecord | null> {
    const [page] = await this.db
      .select({ id: contentPages.id, slug: contentPages.slug, consentType: contentPages.consentType })
      .from(contentPages)
      .where(eq(contentPages.id, pageId));
    if (!page) return null;
    const versions = await this.db
      .select(versionColumns)
      .from(contentPageVersions)
      .where(eq(contentPageVersions.pageId, pageId))
      .orderBy(desc(contentPageVersions.versionNo));
    return {
      ...page,
      draft: versions.find((v) => v.status === 'DRAFT') ?? null,
      published: versions.find((v) => v.status === 'PUBLISHED') ?? null,
      highestVersionNo: versions[0]?.versionNo ?? null,
    };
  }

  async findVersion(versionId: string): Promise<DocumentVersionRecord | null> {
    const [row] = await this.db.select(versionColumns).from(contentPageVersions).where(eq(contentPageVersions.id, versionId));
    return row ?? null;
  }

  async createDraft(
    pageId: string,
    versionNo: number,
    from: Pick<DocumentVersionState, 'title' | 'bodyMd'>,
    createdBy: string,
  ): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(contentPageVersions)
      .values({ pageId, versionNo, title: from.title, bodyMd: from.bodyMd, createdBy })
      .returning({ id: contentPageVersions.id });
    return row!;
  }

  async updateDraft(
    versionId: string,
    changes: Partial<Pick<DocumentVersionState, 'title' | 'bodyMd' | 'changeSummary'>>,
  ): Promise<void> {
    const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length === 0) return;
    await this.db
      .update(contentPageVersions)
      .set(set)
      .where(and(eq(contentPageVersions.id, versionId), eq(contentPageVersions.status, 'DRAFT')));
  }

  async publish(versionId: string, now: Date): Promise<void> {
    const [version] = await this.db
      .select({ pageId: contentPageVersions.pageId })
      .from(contentPageVersions)
      .where(eq(contentPageVersions.id, versionId));
    if (!version) return;
    await this.db
      .update(contentPageVersions)
      .set({ status: 'ARCHIVED' })
      .where(and(eq(contentPageVersions.pageId, version.pageId), eq(contentPageVersions.status, 'PUBLISHED')));
    await this.db
      .update(contentPageVersions)
      .set({ status: 'PUBLISHED', publishedAt: now })
      .where(and(eq(contentPageVersions.id, versionId), eq(contentPageVersions.status, 'DRAFT')));
    await this.db
      .update(contentPages)
      .set({ updatedAt: now, version: sql`${contentPages.version} + 1` })
      .where(eq(contentPages.id, version.pageId));
  }

  async deleteDraft(versionId: string): Promise<void> {
    await this.db
      .delete(contentPageVersions)
      .where(and(eq(contentPageVersions.id, versionId), eq(contentPageVersions.status, 'DRAFT')));
  }
}
