import { auditEntry, systemAuditEntry, type AuditEntry } from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzleAuditLogRepository, rethrowDatabaseRule } from '@hulajnogi/db';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';

/** Wpis dziennika bez autora: autora podaje `AuditedTransaction` z operatora wykonującego zapis. */
export type AuditRecord = Omit<AuditEntry, 'staffId'>;

export interface AuditScope {
  tx: DbExecutor;
  /** Dopisuje wpis w tej samej transakcji co zmiana (ADR 0028): nie ma zmiany bez wpisu. */
  audit(record: AuditRecord): Promise<void>;
  /**
   * Wpis systemu (`actor = SYSTEM`, ADR 0055) w tej samej transakcji: skutek reguły, nie decyzja operatora
   * (np. automatyczne `MAINTENANCE`, powrót do floty po ostatnim zadaniu).
   */
  system(record: AuditRecord): Promise<void>;
}

/** Wpis systemu w transakcji bez operatora (zadanie w tle, zgłoszenie klienta, zakończenie przejazdu). */
export function systemAudit(tx: DbExecutor, record: AuditRecord): Promise<void> {
  return new DrizzleAuditLogRepository(tx).appendSystem(systemAuditEntry(record));
}

/**
 * Zapis operatora w panelu: transakcja z dziennikiem audytu. Reguły pilnowane przez bazę (np. strażnik
 * ostatniego zarządzającego rolami, odroczony do zatwierdzenia) wracają jako błędy domeny.
 */
@Injectable()
export class AuditedTransaction {
  constructor(@Inject(DB) private readonly db: Database) {}

  async run<T>(staffId: string, work: (scope: AuditScope) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction((tx) => {
        const log = new DrizzleAuditLogRepository(tx);
        return work({
          tx,
          audit: (record) => log.append(auditEntry({ ...record, staffId })),
          system: (record) => log.appendSystem(systemAuditEntry(record)),
        });
      });
    } catch (error) {
      rethrowDatabaseRule(error);
    }
  }
}
