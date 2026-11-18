import type { AuditEntry, AuditLogRepository, SystemAuditEntry } from '@hulajnogi/core';
import {
  auditLogResource,
  type AuditLogDetails,
  type AuditLogListItem,
  type ListQuery,
  type ListResponse,
} from '@hulajnogi/shared';
import { and, desc, eq } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { auditLog, vAuditLog } from '../schema/schema.js';

type AuditField = keyof typeof auditLogResource.fields;

const listSource: ListSource<AuditField> = {
  from: vAuditLog,
  id: vAuditLog.id,
  columns: {
    id: vAuditLog.id,
    createdAt: vAuditLog.createdAt,
    staffId: vAuditLog.staffId,
    staffName: vAuditLog.staffName,
    staffEmail: vAuditLog.staffEmail,
    action: vAuditLog.action,
    entityType: vAuditLog.entityType,
    entityId: vAuditLog.entityId,
    actor: vAuditLog.actor,
  },
};

/** Dziennik audytu (tylko do dopisywania; ADR 0028). Wpis powstaje w transakcji zapisu, którego dotyczy. */
export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: DbExecutor) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values(entry);
  }

  /** Wpis systemu bez operatora (`actor = SYSTEM`, ADR 0055); wpis z `systemAuditEntry` w core. */
  async appendSystem(entry: SystemAuditEntry): Promise<void> {
    await this.db.insert(auditLog).values({ ...entry, staffId: null, actor: 'SYSTEM' });
  }

  list(query: ListQuery): Promise<ListResponse<AuditLogListItem>> {
    return runListQuery<AuditField, AuditLogListItem>(this.db, auditLogResource, listSource, query);
  }

  async details(id: number): Promise<AuditLogDetails | null> {
    const [row] = await this.db
      .select({ ...listSource.columns, data: vAuditLog.data })
      .from(vAuditLog)
      .where(eq(vAuditLog.id, id));
    return (row as unknown as AuditLogDetails | undefined) ?? null;
  }

  /** Ostatnie wpisy jednej akcji, od najnowszego (np. „Ostatnie polecenia” symulatora, ADR 0059). */
  async forAction(action: string, limit = 10): Promise<AuditLogDetails[]> {
    const rows = await this.db
      .select({ ...listSource.columns, data: vAuditLog.data })
      .from(vAuditLog)
      .where(eq(vAuditLog.action, action))
      .orderBy(desc(vAuditLog.createdAt), desc(vAuditLog.id))
      .limit(limit);
    return rows as unknown as AuditLogDetails[];
  }

  /** Historia zmian rekordu do karty w formularzu, od najnowszej. */
  async forEntity(entityType: string, entityId: string, limit = 20): Promise<AuditLogDetails[]> {
    const rows = await this.db
      .select({ ...listSource.columns, data: vAuditLog.data })
      .from(vAuditLog)
      .where(and(eq(vAuditLog.entityType, entityType), eq(vAuditLog.entityId, entityId)))
      .orderBy(desc(vAuditLog.createdAt), desc(vAuditLog.id))
      .limit(limit);
    return rows as unknown as AuditLogDetails[];
  }
}
