import type { DataExportSources } from '@hulajnogi/core';
import { Injectable } from '@nestjs/common';

/** Moduły, które oddają dane klienta do eksportu (ADR 0069). */
export const DATA_EXPORT_MODULES = ['accounts', 'rentals', 'payments', 'operations', 'notifications'] as const;
export type DataExportModuleName = (typeof DATA_EXPORT_MODULES)[number];

/**
 * Rejestr portów eksportu danych (ADR 0069, ADR 0003): każdy moduł rejestruje w `onModuleInit` swój port
 * `exportForUser(userId)`, więc moduł Eksport nie czyta cudzych tabel. Brak portu modułu zatrzymuje eksport
 * (sekcji zabraknie i plik nie przejdzie schematu), zamiast oddać niepełny plik.
 */
/** Port `DataExportContributor` z core z dowolnym podzbiorem sekcji. */
export interface DataExportPort {
  exportForUser(userId: string): Promise<Partial<DataExportSources>>;
}

@Injectable()
export class DataExportRegistry {
  private readonly contributors = new Map<DataExportModuleName, DataExportPort>();

  register(module: DataExportModuleName, contributor: DataExportPort): void {
    this.contributors.set(module, contributor);
  }

  /** Dane klienta ze wszystkich portów; brakujący port to błąd. */
  async collect(userId: string): Promise<DataExportSources> {
    const missing = DATA_EXPORT_MODULES.filter((module) => !this.contributors.has(module));
    if (missing.length) throw new Error(`Brak portu eksportu modułów: ${missing.join(', ')}`);
    const parts = await Promise.all([...this.contributors.values()].map((c) => c.exportForUser(userId)));
    return Object.assign({}, ...parts) as DataExportSources;
  }
}
