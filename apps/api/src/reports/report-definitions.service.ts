import { diffForAudit, DomainError, ensureVersion } from '@hulajnogi/core';
import { type Database, DrizzleReportDefinitionsRepository } from '@hulajnogi/db';
import type {
  ListQuery,
  ListResponse,
  ReportDefinitionDetails,
  ReportDefinitionListItem,
  ReportDefinitionsReorder,
  ReportDefinitionUpdate,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { definitionDetails } from './report-views.js';

/**
 * Raporty → Definicje (`reports.manage`, ADR 0071): nazwa, opis, aktywność i kolejność definicji z blokadą
 * optymistyczną i wpisem w dzienniku audytu w tej samej transakcji (zmienione pola przed i po). Parametry, formaty
 * i uprawnienie pochodzą z katalogu w core (seed), więc są tylko do odczytu.
 */
@Injectable()
export class ReportDefinitionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
  ) {}

  list(query: ListQuery): Promise<ListResponse<ReportDefinitionListItem>> {
    return new DrizzleReportDefinitionsRepository(this.db).list(query);
  }

  async details(code: string): Promise<ReportDefinitionDetails> {
    const def = await new DrizzleReportDefinitionsRepository(this.db).get(code);
    if (!def) throw new DomainError('REPORT_NOT_FOUND', { code });
    return definitionDetails(def);
  }

  /** `PATCH /admin/report-definitions/{code}`: konflikt wersji to `409 CONFLICT` z aktualną wersją. */
  async update(staffId: string, code: string, body: ReportDefinitionUpdate): Promise<ReportDefinitionDetails> {
    const { version, ...changes } = body;
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleReportDefinitionsRepository(tx);
      const before = await repo.get(code, { lock: true });
      if (!before) throw new DomainError('REPORT_NOT_FOUND', { code });
      ensureVersion(version, before.version);
      if (!(await repo.update(code, version, changes, staffId)))
        throw new DomainError('CONFLICT', { expectedVersion: version, currentVersion: before.version });
      await audit({
        action: 'report_definition.updated',
        entityType: 'report_definition',
        entityId: null,
        data: { code, changes: diffForAudit(before, changes), version: [version, version + 1] },
      });
    });
    return this.details(code);
  }

  /**
   * `POST /admin/report-definitions/reorder`: kolejność przeciąganiem jednym poleceniem. Podane definicje dostają
   * w nowym porządku te same miejsca (`sort_order`), które zajmowały; każda z wersją rekordu (konflikt to `409`).
   */
  async reorder(staffId: string, body: ReportDefinitionsReorder): Promise<ReportDefinitionDetails[]> {
    const codes = body.items.map((i) => i.code);
    if (new Set(codes).size !== codes.length) throw new DomainError('VALIDATION_FAILED', { field: 'items' });
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleReportDefinitionsRepository(tx);
      const current = [];
      for (const item of [...body.items].sort((a, b) => a.code.localeCompare(b.code))) {
        const def = await repo.get(item.code, { lock: true });
        if (!def) throw new DomainError('REPORT_NOT_FOUND', { code: item.code });
        ensureVersion(item.version, def.version);
        current.push(def);
      }
      const slots = current.map((d) => d.sortOrder).sort((a, b) => a - b);
      const before = Object.fromEntries(current.map((d) => [d.code, d.sortOrder]));
      const after: Record<string, number> = {};
      for (const [index, item] of body.items.entries()) {
        const sortOrder = slots[index]!;
        after[item.code] = sortOrder;
        if (before[item.code] === sortOrder) continue;
        if (!(await repo.update(item.code, item.version, { sortOrder }, staffId)))
          throw new DomainError('CONFLICT', { code: item.code, expectedVersion: item.version });
      }
      await audit({
        action: 'report_definitions.reordered',
        entityType: 'report_definition',
        entityId: null,
        data: { before, after },
      });
    });
    const all = await new DrizzleReportDefinitionsRepository(this.db).all();
    return all.map(definitionDetails);
  }
}
