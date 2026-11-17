import { notFound, priceRental, rentalCounters } from '@hulajnogi/core';
import { type Database, DrizzlePaymentRepository, DrizzleRentalRepository } from '@hulajnogi/db';
import type { ListQuery, RentalAdminDetails, RentalRefund, RemoteEnd } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { AdminPaymentsService } from '../payments/admin-payments.service.js';
import { tariffView } from './rental-view.js';
import { RentalsService } from './rentals.service.js';

/** Przejazdy w panelu: lista według wzorca (ADR 0031), szczegóły z osią czasu i zdalne zakończenie. */
@Injectable()
export class AdminRentalsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rentals: RentalsService,
    private readonly payments: AdminPaymentsService,
  ) {}

  list(query: ListQuery) {
    return new DrizzleRentalRepository(this.db).list(query);
  }

  async details(id: string): Promise<RentalAdminDetails> {
    const repo = new DrizzleRentalRepository(this.db);
    const [item, rental] = await Promise.all([repo.listItem(id), repo.find(id)]);
    if (!item || !rental) throw notFound('rental', id);
    const now = await repo.now();
    const payments = new DrizzlePaymentRepository(this.db);
    const [tariff, events, timeline, route, stats, settlement, refunds, refundBase] = await Promise.all([
      repo.tariff(rental.tariffId),
      repo.timelineEvents(id),
      repo.timeline(id),
      repo.route(id),
      repo.stats(rental.userId),
      payments.settlement(id),
      payments.refundItems({ rentalId: id }),
      payments.rentalRefundBase(id),
    ]);
    const counters = rentalCounters(events, now);
    return {
      ...item,
      reservedAt: rental.reservedAt?.toISOString() ?? null,
      reservationExpiresAt: rental.reservationExpiresAt?.toISOString() ?? null,
      billedUntil: counters.billedUntil?.toISOString() ?? null,
      rideSeconds: counters.rideSeconds,
      pauseSeconds: counters.pauseSeconds,
      distanceM: rental.state === 'ENDED' || rental.state === 'UNPAID' ? rental.distanceM : await repo.liveDistance(id),
      price: priceRental(tariff, counters),
      tariff: tariffView(tariff),
      endZoneName: rental.endZone?.name ?? null,
      scooterOnline: rental.scooterOnline,
      scooterBatteryPct: rental.scooterBatteryPct,
      scooterLat: rental.scooterLat,
      scooterLon: rental.scooterLon,
      userRidesCount: stats.ridesCount,
      route,
      timeline,
      settlement,
      refunds,
      refundable:
        settlement.state === 'WALLET_PAID' || settlement.state === 'CARD_PAID'
          ? Math.max(0, refundBase.paid - refundBase.refunded)
          : 0,
      asOf: now.toISOString(),
    };
  }

  /** Zwrot za przejazd (ADR 0054) z odświeżonymi szczegółami w odpowiedzi. */
  async refund(staffId: string, id: string, body: RentalRefund): Promise<RentalAdminDetails> {
    await this.payments.refundRental(staffId, id, body);
    return this.details(id);
  }

  async remoteEnd(staffId: string, id: string, body: RemoteEnd): Promise<RentalAdminDetails> {
    await this.rentals.remoteEnd(staffId, id, body);
    return this.details(id);
  }
}
