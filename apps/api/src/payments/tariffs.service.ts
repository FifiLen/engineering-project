import { DomainError, ensureNoScheduledTariff, notFound, tariffChanges, validateTariffInput } from '@hulajnogi/core';
import { type Database, DrizzleTariffRepository, tariffValues } from '@hulajnogi/db';
import type { ListQuery, NewTariff, TariffDetailsView, TariffVersionItem } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { ContentPublisher } from '../content/content-publisher.service.js';
import { DB } from '../database/database.module.js';

/**
 * Wersje cennika (ADR 0053): obowiązująca dla klienta, nowa wersja i usunięcie zaplanowanej w panelu. Cennik jest na
 * stronie, więc zmiana odświeża tag `tariff` (ADR 0065); wersja na przyszłą datę pojawi się po czasie zapasowym.
 */
@Injectable()
export class TariffsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audited: AuditedTransaction,
    private readonly publisher: ContentPublisher,
  ) {}

  async current(): Promise<TariffDetailsView> {
    const tariff = await new DrizzleTariffRepository(this.db).current();
    if (!tariff) throw new DomainError('TARIFF_MISSING');
    return tariff;
  }

  list(query: ListQuery) {
    return new DrizzleTariffRepository(this.db).list(query);
  }

  async item(id: string): Promise<TariffVersionItem> {
    const item = await new DrizzleTariffRepository(this.db).item(id);
    if (!item) throw notFound('tariff', id);
    return item;
  }

  /** Nowa wersja „od teraz” albo od daty; dopóki jest zaplanowana, nie powstaje kolejna (ADR 0053). */
  async create(staffId: string, body: NewTariff): Promise<TariffVersionItem> {
    const id = await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleTariffRepository(tx);
      await repo.lockForNewVersion();
      ensureNoScheduledTariff(await repo.scheduled());
      const { validFrom: requested, ...values } = body;
      // Zegar bazy, nie API: „od teraz” obowiązuje od razu według widoku `v_tariff_versions`.
      const { validFrom } = validateTariffInput(
        { ...values, validFrom: requested ? new Date(requested) : null },
        await repo.now(),
      );
      const current = await repo.current();
      const created = await repo.insert({ ...values, validFrom }, staffId);
      const tariff = (await repo.details(created))!;
      await audit({
        action: 'tariff.created',
        entityType: 'tariff',
        entityId: created,
        data: {
          version: tariff.version,
          validFrom: tariff.validFrom,
          values: tariffValues(tariff),
          changes: tariffChanges(current ? tariffValues(current) : null, tariffValues(tariff)),
        },
      });
      await this.publisher.revalidateSite(tx, ['tariff']);
      return created;
    });
    return this.item(id);
  }

  /** Usunięcie zaplanowanej wersji przed jej datą (`sp_delete_scheduled_tariff`). */
  async remove(staffId: string, id: string): Promise<void> {
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleTariffRepository(tx);
      const tariff = await repo.details(id);
      if (!tariff) throw notFound('tariff', id);
      await repo.remove(id);
      await audit({
        action: 'tariff.deleted',
        entityType: 'tariff',
        entityId: id,
        data: { version: tariff.version, validFrom: tariff.validFrom },
      });
      await this.publisher.revalidateSite(tx, ['tariff']);
    });
  }
}
