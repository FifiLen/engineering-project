import {
  companyAddress,
  contentAuditData,
  DomainError,
  ensureCompanyProfileValid,
  ensureNoContentIssues,
  ensureVersion,
  type CompanyProfile,
  type ContentIssue,
} from '@hulajnogi/core';
import {
  type CompanyProfileFields,
  type CompanyProfileRecord,
  type Database,
  type DbExecutor,
  DrizzleContentRepository,
  toContentHistoryEntry,
} from '@hulajnogi/db';
import type {
  CompanyProfileUpdate,
  CompanyProfileView,
  CompanyPublicView,
  ContentHistoryEntry,
  ReceiptParty,
} from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { ContentPublisher } from './content-publisher.service.js';

/**
 * Port modułu Treści dla Płatności (ADR 0062, ADR 0003): dane sprzedawcy w chwili wystawienia paragonu. Moduł
 * Płatności nie czyta `company_profile`, tylko woła ten port w swojej transakcji.
 */
export interface CompanyProfileProvider {
  seller(executor: DbExecutor): Promise<ReceiptParty>;
}

export const COMPANY_PROFILE = Symbol('COMPANY_PROFILE');

/** Wartość w bazie `NULL` dla pustego tekstu (adres i NIP są w bazie całe albo puste). */
const nullable = (value: string | null | undefined): string | null => (value?.trim() ? value.trim() : null);

/** Dane firmy w kształcie reguł core: brak adresu albo NIP to pusty napis (ADR 0062). */
export function companyProfile(record: CompanyProfileRecord): CompanyProfile {
  return {
    name: record.name,
    street: record.street ?? '',
    postalCode: record.postalCode ?? '',
    city: record.city ?? '',
    taxId: record.taxId ?? '',
    supportEmail: record.supportEmail,
    supportPhone: record.supportPhone,
    supportHours: record.supportHours ?? '',
    regon: record.regon,
    krs: record.krs,
    registryCourt: record.registryCourt,
    shareCapitalGrosze: record.shareCapitalGrosze,
  };
}

const view = (record: CompanyProfileRecord): CompanyProfileView => ({
  ...companyProfile(record),
  version: record.version,
  updatedAt: record.updatedAt.toISOString(),
  updatedByName: record.updatedByName,
});

/** Stan wpisu historii jak w bazie i w danych startowych: pola formularza, puste jako `null`. */
const snapshot = (profile: CompanyProfile): Record<string, unknown> => ({
  ...profile,
  street: nullable(profile.street),
  postalCode: nullable(profile.postalCode),
  city: nullable(profile.city),
  taxId: nullable(profile.taxId),
  supportHours: nullable(profile.supportHours),
});

/** Adres jest cały albo pusty (`company_profile_address` w bazie): brakujące pola jako problemy formularza. */
function addressIssues(next: CompanyProfile): ContentIssue[] {
  const fields = ['street', 'postalCode', 'city'] as const;
  const filled = fields.filter((field) => next[field].trim());
  if (!filled.length || filled.length === fields.length) return [];
  return fields
    .filter((field) => !next[field].trim())
    .map((field) => ({ item: null, field, code: 'CONTENT_FIELD_REQUIRED' }));
}

/**
 * Dane firmy (ADR 0062, pytanie 13): jeden wiersz `company_profile` zamiast `SELLER_*`. Podgląd z `content.read`,
 * zapis z `company.write` (tylko Administrator) z blokadą optymistyczną, sumami kontrolnymi NIP i REGON z core
 * i pełnym stanem przed i po w dzienniku audytu (historia z „Przywróć”).
 */
@Injectable()
export class CompanyService implements CompanyProfileProvider {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly publisher: ContentPublisher,
  ) {}

  async get(executor: DbExecutor = this.db): Promise<CompanyProfileView> {
    return view(await new DrizzleContentRepository(executor).company());
  }

  /** Stopka strony, Pomoc w aplikacji i wydruki: bez wersji i autora zmian. */
  async publicView(executor: DbExecutor = this.db): Promise<CompanyPublicView> {
    return companyProfile(await new DrizzleContentRepository(executor).company());
  }

  /**
   * Sprzedawca na paragonie (ADR 0052): nazwa, adres i NIP z chwili wystawienia; paragon kopiuje je do
   * `receipts.seller`. Brak adresu albo NIP (wartości deweloperskie po migracji) zostaje `null`.
   */
  async seller(executor: DbExecutor = this.db): Promise<ReceiptParty> {
    const profile = companyProfile(await new DrizzleContentRepository(executor).company());
    return {
      name: profile.name,
      address: profile.street ? companyAddress(profile) : null,
      taxId: profile.taxId || null,
    };
  }

  async history(): Promise<ContentHistoryEntry[]> {
    const rows = await new DrizzleContentRepository(this.db).history('company_profile', null);
    return rows.map((row) => toContentHistoryEntry(row));
  }

  /** `PATCH /admin/company`: zapis częściowy; niezmienione dane nie tworzą wersji ani wpisu. */
  async update(staffId: string, body: CompanyProfileUpdate): Promise<CompanyProfileView> {
    const changed = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleContentRepository(tx);
      const current = await repo.company({ lock: true });
      ensureVersion(body.version, current.version);
      if (body.restoredFrom !== null && !(await repo.auditEntryExists(body.restoredFrom, 'company_profile'))) {
        throw new DomainError('VALIDATION_FAILED', { fields: ['restoredFrom'] });
      }
      const previous = companyProfile(current);
      const { restoredFrom } = body;
      const next: CompanyProfile = { ...previous };
      for (const field of Object.keys(previous) as Array<keyof CompanyProfile>) {
        const value = body[field];
        if (value !== undefined) (next as unknown as Record<string, unknown>)[field] = value;
      }
      next.registryCourt = nullable(next.registryCourt);
      ensureNoContentIssues(addressIssues(next));
      ensureCompanyProfileValid(next, previous);
      if (JSON.stringify(snapshot(next)) === JSON.stringify(snapshot(previous))) return false;
      const fields: CompanyProfileFields = {
        name: next.name,
        street: nullable(next.street),
        postalCode: nullable(next.postalCode),
        city: nullable(next.city),
        taxId: nullable(next.taxId),
        supportEmail: next.supportEmail,
        supportPhone: next.supportPhone,
        supportHours: nullable(next.supportHours),
        regon: next.regon,
        krs: next.krs,
        registryCourt: next.registryCourt,
        shareCapitalGrosze: next.shareCapitalGrosze,
      };
      if (!(await repo.updateCompany(current.version, fields, staffId))) {
        throw new DomainError('CONFLICT', { expectedVersion: current.version });
      }
      await audit({
        action: restoredFrom === null ? 'company_profile.updated' : 'company_profile.restored',
        entityType: 'company_profile',
        entityId: null,
        data: contentAuditData(
          snapshot(previous),
          snapshot(next),
          { from: current.version, to: current.version + 1 },
          restoredFrom,
        ),
      });
      await this.publisher.changed(tx, ['WEB', 'MOBILE']);
      return true;
    });
    if (changed) await this.publisher.notify(['WEB', 'MOBILE', 'ADMIN']);
    return this.get();
  }
}
