import { notFound, RentalStateMachine, rentalFigures } from '@hulajnogi/core';
import { type Database, type DbExecutor, DrizzlePaymentRepository, DrizzleRentalRepository } from '@hulajnogi/db';
import type { ListQuery, RentalAdminDetails, RentalRefund, RemoteEnd } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';
import { FilesService } from '../files/files.service.js';
import { OperationsEffects, OperationsService } from '../operations/operations.service.js';
import { TicketsService } from '../operations/tickets.service.js';
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
    private readonly files: FilesService,
    private readonly tickets: TicketsService,
    private readonly operations: OperationsService,
  ) {}

  list(query: ListQuery, db: DbExecutor = this.db) {
    return new DrizzleRentalRepository(db).list(query);
  }

  async details(id: string): Promise<RentalAdminDetails> {
    const repo = new DrizzleRentalRepository(this.db);
    const [item, rental] = await Promise.all([repo.listItem(id), repo.find(id)]);
    if (!item || !rental) throw notFound('rental', id);
    const now = await repo.now();
    const payments = new DrizzlePaymentRepository(this.db);
    const open = RentalStateMachine.isOpen(rental.state) && rental.state !== 'RESERVED';
    const [tariff, events, timeline, route, stats, settlement, refunds, refundBase, parkingPhoto, towing] =
      await Promise.all([
        repo.tariff(rental.tariffId),
        repo.timelineEvents(id),
        repo.timeline(id),
        repo.route(id),
        repo.stats(rental.userId),
        payments.settlement(id),
        payments.refundItems({ rentalId: id }),
        payments.rentalRefundBase(id),
        this.files.viewById(rental.parkingPhotoId),
        // Okno zdalnego zakończenia (ADR 0060): opłata z wersji cennika przejazdu i ostatnia pozycja hulajnogi.
        open
          ? Promise.all([repo.outOfZoneFee(rental.tariffId), this.rentals.outsideParking(this.db, rental)]).then(
              ([outOfZoneFee, outsideParking]) => ({
                outOfZoneFee,
                outsideParking,
                positionAt: rental.scooterPositionAt?.toISOString() ?? null,
              }),
            )
          : null,
      ]);
    // Zakończony przejazd: liczniki i kwota z wiersza przejazdu (`rentalFigures`), otwarty: z osi czasu.
    const { counters, price } = rentalFigures(tariff, events, now, rental);
    return {
      ...item,
      reservedAt: rental.reservedAt?.toISOString() ?? null,
      reservationExpiresAt: rental.reservationExpiresAt?.toISOString() ?? null,
      billedUntil: counters.billedUntil?.toISOString() ?? null,
      rideSeconds: counters.rideSeconds,
      pauseSeconds: counters.pauseSeconds,
      distanceM: rental.state === 'ENDED' || rental.state === 'UNPAID' ? rental.distanceM : await repo.liveDistance(id),
      price,
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
      endMode: rental.endMode,
      towingFee: rental.towingFee,
      towing,
      parkingPhoto,
      billingStoppedAt: counters.billingStoppedAt?.toISOString() ?? null,
      asOf: now.toISOString(),
    };
  }

  /**
   * Zwrot za przejazd (ADR 0054) z odświeżonymi szczegółami w odpowiedzi. Zwrot z reklamacji (`ticketId`, pytanie 6)
   * zapisuje `refunds.ticket_id` w transakcji zwrotu, a wpis `rental.refunded` trafia na oś zgłoszenia.
   */
  async refund(staffId: string, id: string, body: RentalRefund): Promise<RentalAdminDetails> {
    const effects = new OperationsEffects();
    const ticketId = body.ticketId;
    await this.payments.refundRental(
      staffId,
      id,
      body,
      ticketId ? (tx, refundId) => this.tickets.linkRefund(tx, ticketId, id, refundId, effects) : undefined,
    );
    await this.operations.afterCommit(effects);
    return this.details(id);
  }

  async remoteEnd(staffId: string, id: string, body: RemoteEnd): Promise<RentalAdminDetails> {
    await this.rentals.remoteEnd(staffId, id, body);
    return this.details(id);
  }
}
