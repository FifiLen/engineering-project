import { type Database, type DrizzleReportsRepository, rethrowDatabaseRule, withReportSnapshot } from '@hulajnogi/db';

/**
 * Migawka danych raportu (`withReportSnapshot`: `REPEATABLE READ READ ONLY`, `statement_timeout`) z błędami reguł
 * bazy jako błędami domeny (np. `REPORT_INVALID_GRANULARITY` z `fn_report_buckets`); limit czasu to `REPORT_TIMEOUT`.
 */
export async function reportSnapshot<T>(
  db: Database,
  timeoutMs: number,
  fn: (repo: DrizzleReportsRepository, dataAsOf: Date) => Promise<T>,
): Promise<T> {
  try {
    return await withReportSnapshot(db, { timeoutMs }, fn);
  } catch (error) {
    rethrowDatabaseRule(error);
  }
}
