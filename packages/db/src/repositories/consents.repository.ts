import type { ConsentRepository, ConsentStatus, ConsentType, CurrentDocument } from '@hulajnogi/core';
import type { ConsentView } from '@hulajnogi/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { consents, contentPageVersions, vCurrentDocuments, vUserConsents } from '../schema/schema.js';

/** Moduł Konta: zgody klientów na wersje dokumentów (ADR 0027). */
export class DrizzleConsentRepository implements ConsentRepository {
  constructor(private readonly db: DbExecutor) {}

  async statuses(userId: string): Promise<ConsentStatus[]> {
    const rows = await this.db
      .select({ type: vUserConsents.type, isCurrent: vUserConsents.isCurrent })
      .from(vUserConsents)
      .where(eq(vUserConsents.userId, userId));
    return rows.map((r) => ({ type: r.type!, isCurrent: r.isCurrent === true }));
  }

  /** Zgody do karty klienta w panelu: ostatnia zgoda każdego rodzaju, także wycofana. */
  async views(userId: string): Promise<ConsentView[]> {
    const rows = await this.db
      .select({
        type: vUserConsents.type,
        documentVersion: vUserConsents.documentVersion,
        versionNo: vUserConsents.versionNo,
        currentVersionNo: vUserConsents.currentVersionNo,
        acceptedAt: vUserConsents.acceptedAt,
        revokedAt: vUserConsents.revokedAt,
        isCurrent: vUserConsents.isCurrent,
      })
      .from(vUserConsents)
      .where(eq(vUserConsents.userId, userId))
      .orderBy(vUserConsents.type);
    return rows.map((r) => ({
      type: r.type!,
      documentVersion: r.documentVersion!,
      versionNo: r.versionNo,
      currentVersionNo: r.currentVersionNo,
      acceptedAt: r.acceptedAt!.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
      isCurrent: r.isCurrent === true,
    }));
  }

  async pendingDocuments(userId: string): Promise<CurrentDocument[]> {
    const result = await this.db.execute<{
      consent_type: ConsentType;
      slug: string;
      version_id: string;
      version_no: number;
      title: string;
      change_summary: string | null;
    }>(sql`SELECT * FROM fn_user_pending_documents(${userId})`);
    return result.rows.map((r) => ({
      consentType: r.consent_type,
      slug: r.slug,
      versionId: r.version_id,
      versionNo: r.version_no,
      title: r.title,
      changeSummary: r.change_summary,
    }));
  }

  async currentDocument(type: ConsentType): Promise<CurrentDocument | null> {
    const [row] = await this.db
      .select({
        consentType: vCurrentDocuments.consentType,
        slug: vCurrentDocuments.slug,
        versionId: vCurrentDocuments.versionId,
        versionNo: vCurrentDocuments.versionNo,
        title: vCurrentDocuments.title,
        changeSummary: contentPageVersions.changeSummary,
      })
      .from(vCurrentDocuments)
      .innerJoin(contentPageVersions, eq(contentPageVersions.id, vCurrentDocuments.versionId))
      .where(eq(vCurrentDocuments.consentType, type));
    return row ? ({ ...row, consentType: row.consentType! } as CurrentDocument) : null;
  }

  async accept(
    userId: string,
    type: ConsentType,
    document: Pick<CurrentDocument, 'versionId' | 'versionNo'> | null,
  ): Promise<void> {
    // Zgoda bez dokumentu (wiek, marketing) ma wersję „1”; powtórzenie trafia na indeks unikalny.
    await this.db
      .insert(consents)
      .values({
        userId,
        type,
        documentVersion: document ? String(document.versionNo) : '1',
        pageVersionId: document?.versionId ?? null,
      })
      .onConflictDoNothing();
  }

  async revoke(userId: string, type: ConsentType, now: Date): Promise<number> {
    const rows = await this.db
      .update(consents)
      .set({ revokedAt: now })
      .where(and(eq(consents.userId, userId), eq(consents.type, type), isNull(consents.revokedAt)))
      .returning({ id: consents.id });
    return rows.length;
  }
}
