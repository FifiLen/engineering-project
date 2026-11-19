import { type Database, type DrizzleReportsRepository, rethrowDatabaseRule, withReportSnapshot } from '@hulajnogi/db';

/**
 * Migawka danych raportu (`withReportSnapshot`: `REPEATABLE READ READ ONLY`, `statement_timeout`) z błędami reguł
 * bazy jako błędami domeny (np. `REPORT_INVALID_GRANULARITY` z `fn_report_buckets`); limit czasu to `REPORT_TIMEOUT`.
 * Podgląd podaje limit jednego zapytania, zadanie także łączny limit migawki (`REPORT_LIMITS.jobSnapshotTotalMs`).
 */
export async function reportSnapshot<T>(
  db: Database,
  limits: number | { timeoutMs: number; totalTimeoutMs: number },
  fn: (repo: DrizzleReportsRepository, dataAsOf: Date) => Promise<T>,
): Promise<T> {
  try {
    return await withReportSnapshot(db, typeof limits === 'number' ? { timeoutMs: limits } : limits, fn);
  } catch (error) {
    rethrowDatabaseRule(error);
  }
}
