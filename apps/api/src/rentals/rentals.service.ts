import {
  COMMAND_ACK_TIMEOUT_MS,
  commandResultFromAck,
  decideCancelReservation,
  decideEnd,
  decidePause,
  decideRemoteEnd,
  decideReservation,
  decideResume,
  decideStart,
  DomainError,
  ensureCanDeleteAccount,
  ensureCanRing,
  ensureCustomerCanRent,
  estimateRangeKm,
  evaluatePosition,
  NEARBY_LIMIT,
  NEARBY_RADIUS_M,
  notFound,
  rentalCommandOutcome,
  RentalStateMachine,
  reservationExpiresAt,
  unavailableReason,
  type CommandType,
  type RentalAction,
  type RentalState,
  type RentalTariff,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleConsentRepository,
  DrizzleCustomerRepository,
  DrizzleRentalRepository,
  DrizzleZoneRepository,
  rethrowDatabaseRule,
  type RentalCommandRecord,
  type RentalRecord,
} from '@hulajnogi/db';
import type {
  CustomerScooterView,
  NearbyResponse,
  NotificationPreferences,
  ProfileSummary,
  RemoteEnd,
  RentalHistoryItem,
  RentalListItem,
  RentalView,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { CommandsService, type AckResult } from '../fleet/commands.service.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { buildRentalView, tariffView } from './rental-view.js';

/** Skutki transakcji wykonywane dopiero po jej zatwierdzeniu: komendy do MQTT i zdarzenia Socket.IO. */
class Effects {
  readonly commands: RentalCommandRecord[] = [];
  readonly rentals = new Set<string>();
}

/**
 * Moduł Wypożyczenia (ADR 0036). Każda operacja to jedna transakcja: blokada hulajnogi, potem przejazdu,
 * decyzja reguł z packages/core, zapis przejścia ze zdarzeniem, komendą i zadaniem pg-boss. Po zatwierdzeniu
 * komendy idą do MQTT, a klient i panel dostają zdarzenia.
 */
@Injectable()
export class RentalsService implements OnModuleInit {
  private readonly logger = new Logger(RentalsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobs: JobsService,
    private readonly commands: CommandsService,
    private readonly gateway: FleetGateway,
    private readonly audited: AuditedTransaction,
  ) {}

  onModuleInit(): void {
    this.commands.attachRentalHandler((commandId, ack) => this.onCommandResult(commandId, ack));
    this.jobs.handle(JOBS.reservationExpire, async ({ rentalId }) => {
      await this.expireReservation(rentalId as string);
    });
    this.jobs.handle(JOBS.expireSweep, async () => {
      for (const id of await new DrizzleRentalRepository(this.db).dueReservations(new Date()))
        await this.expireReservation(id);
    });
  }

  // --- Mapa i hulajnoga --------------------------------------------------------------------

  async nearby(lat: number, lon: number): Promise<NearbyResponse> {
    const repo = new DrizzleRentalRepository(this.db);
    const tariff = await this.requireTariff(repo);
    const rows = await repo.nearby(lat, lon, NEARBY_RADIUS_M, NEARBY_LIMIT, tariff.minBatteryPct);
    return {
      scooters: rows.map((r) => ({
        id: r.id,
        number: r.number,
        variant: r.variant,
        lat: r.lat,
        lon: r.lon,
        batteryPct: r.batteryPct,
        rangeKm: estimateRangeKm(r.batteryPct, r.modelRangeKm),
        distanceM: r.distanceM,
      })),
      tariff: tariffView(tariff),
      radiusM: NEARBY_RADIUS_M,
    };
  }

  async scooterByNumber(userId: string, number: number): Promise<CustomerScooterView> {
    const repo = new DrizzleRentalRepository(this.db);
    const scooter = await repo.scooterByNumber(number);
    if (!scooter) throw new DomainError('NOT_FOUND', { entity: 'scooter', number });
    const own = await repo.openForUser(userId);
    const tariff = own?.scooterId === scooter.id ? await repo.tariff(own.tariffId) : await this.requireTariff(repo);
    const reservedByMe = own?.scooterId === scooter.id && own.state === 'RESERVED';
    const reason = reservedByMe ? null : unavailableReason(scooter, tariff);
    return {
      id: scooter.id,
      number: scooter.number,
      variant: scooter.variant,
      batteryPct: scooter.batteryPct,
      rangeKm: estimateRangeKm(scooter.batteryPct, scooter.modelRangeKm),
      lat: scooter.lat,
      lon: scooter.lon,
      available: reason === null,
      unavailableReason: reason,
      reservedByMe,
      tariff: tariffView(tariff),
    };
  }

  /** Dzwonek z aplikacji (decyzja D5): komenda bez przejazdu, z limitem potwierdzenia jak każda inna. */
  async ring(userId: string, scooterId: string): Promise<void> {
    await this.transaction(async (repo, tx, effects) => {
      const scooter = await repo.lockScooter(scooterId);
      if (!scooter) throw notFound('scooter', scooterId);
      ensureCanRing(scooter, await repo.openForUser(userId));
      await this.sendCommand(repo, tx, effects, scooter.id, null, 'RING');
    });
  }

  // --- Przejazd klienta ----------------------------------------------------------------------

  async reserve(userId: string, scooterId: string): Promise<{ rental: RentalView; created: boolean }> {
    await this.ensureCustomerCanRent(userId);
    const id = await this.transaction(async (repo, tx, effects) => {
      const scooter = await repo.lockScooter(scooterId);
      if (!scooter) throw notFound('scooter', scooterId);
      const tariff = await this.requireTariff(repo);
      const now = await repo.now();
      const decision = decideReservation({
        userId,
        scooter,
        tariff,
        userRental: await repo.lockOpenForUser(userId),
        scooterRental: await repo.lockOpenForScooter(scooterId),
        now,
      });
      if (decision.kind === 'EXISTING') return { id: decision.rentalId, created: false };
      const expiresAt = reservationExpiresAt(now, tariff);
      const rentalId = await repo.insert({
        userId,
        scooterId,
        tariffId: tariff.id,
        state: decision.to,
        reservedAt: now,
        reservationExpiresAt: expiresAt,
      });
      await repo.addEvent(rentalId, 'STATE_CHANGED', { from: null, to: decision.to });
      await repo.setScooterStatus(scooterId, 'RESERVED');
      await this.jobs.sendInTransaction(tx, JOBS.reservationExpire, { rentalId }, expiresAt);
      effects.rentals.add(rentalId);
      return { id: rentalId, created: true };
    });
    return { rental: await this.viewFor(userId, id.id), created: id.created };
  }

  async cancelReservation(userId: string): Promise<RentalView> {
    const rentalId = await this.lockedUserRental(userId, async (repo, rental, _tx, effects) => {
      const to = decideCancelReservation(rental, userId);
      await this.transition(repo, rental, 'CANCEL_RESERVATION', to, effects, { reason: 'cancelled_by_user' });
      await repo.setScooterStatus(rental.scooterId, 'AVAILABLE');
      return rental.id;
    });
    return this.viewFor(userId, rentalId);
  }

  async start(userId: string, scooterId: string): Promise<{ rental: RentalView; created: boolean }> {
    await this.ensureCustomerCanRent(userId);
    const result = await this.transaction(async (repo, tx, effects) => {
      const scooter = await repo.lockScooter(scooterId);
      if (!scooter) throw notFound('scooter', scooterId);
      const userRental = await repo.lockOpenForUser(userId);
      const tariff =
        userRental?.scooterId === scooterId ? await repo.tariff(userRental.tariffId) : await this.requireTariff(repo);
      const decision = decideStart({
        userId,
        scooter,
        tariff,
        userRental,
        scooterRental: await repo.lockOpenForScooter(scooterId),
        now: await repo.now(),
      });
      if (decision.kind === 'EXISTING') return { id: decision.rentalId, created: false };
      const rentalId =
        decision.rentalId ??
        (await repo.insert({
          userId,
          scooterId,
          tariffId: tariff.id,
          state: decision.to,
          reservedAt: null,
          reservationExpiresAt: null,
        }));
      if (decision.rentalId) await repo.setState(rentalId, decision.to);
      await repo.addEvent(rentalId, 'STATE_CHANGED', { from: decision.from, to: decision.to });
      await repo.setScooterStatus(scooterId, 'IN_USE');
      await this.sendCommand(repo, tx, effects, scooterId, rentalId, 'UNLOCK');
      effects.rentals.add(rentalId);
      return { id: rentalId, created: true };
    });
    return { rental: await this.viewFor(userId, result.id), created: result.created };
  }

  async pause(userId: string): Promise<RentalView> {
    return this.rideCommand(userId, (rental) => decidePause(rental, userId).command);
  }

  async resume(userId: string): Promise<RentalView> {
    return this.rideCommand(userId, (rental) => decideResume(rental, userId).command);
  }

  /** Zakończenie przez klienta: strefa parkowania z ostatniej pozycji hulajnogi, potem blokada (ADR 0036). */
  async end(userId: string): Promise<RentalView> {
    const rentalId = await this.lockedUserRental(userId, async (repo, rental, tx, effects) => {
      const zones =
        rental.scooterLat === null
          ? []
          : await new DrizzleZoneRepository(tx).findAt({ lat: rental.scooterLat, lon: rental.scooterLon! });
      const canPark = evaluatePosition(zones).canPark;
      const nearestParking =
        canPark || rental.scooterLat === null ? null : await repo.nearestParking(rental.scooterLat, rental.scooterLon!);
      const decision = decideEnd(rental, userId, { canPark, nearestParking });
      // Strefa parkowania na osi czasu („żądanie zakończenia w strefie P-04”).
      const zoneId = await repo.parkingZoneAt(rental.scooterLat!, rental.scooterLon!);
      await repo.addEvent(rental.id, 'END_REQUESTED', { data: { resumeState: decision.resumeState }, zoneId });
      await this.transition(repo, rental, 'REQUEST_END', decision.to, effects);
      await this.sendCommand(repo, tx, effects, rental.scooterId, rental.id, decision.command);
      return rental.id;
    });
    return this.viewFor(userId, rentalId);
  }

  async current(userId: string): Promise<RentalView | null> {
    const rental = await new DrizzleRentalRepository(this.db).openForUser(userId);
    return rental ? buildRentalView(new DrizzleRentalRepository(this.db), rental) : null;
  }

  async viewFor(userId: string, rentalId: string): Promise<RentalView> {
    const repo = new DrizzleRentalRepository(this.db);
    const rental = await repo.find(rentalId);
    if (!rental || rental.userId !== userId) throw notFound('rental', rentalId);
    return buildRentalView(repo, rental);
  }

  history(userId: string, limit: number): Promise<RentalHistoryItem[]> {
    return new DrizzleRentalRepository(this.db).history(userId, limit);
  }

  // --- Profil i konto ----------------------------------------------------------------------

  async profile(userId: string): Promise<ProfileSummary> {
    const repo = new DrizzleRentalRepository(this.db);
    const [stats, balance, notifications] = await Promise.all([
      repo.stats(userId),
      repo.balance(userId),
      repo.notificationPreferences(userId),
    ]);
    return { stats, balance, notifications };
  }

  async setNotifications(userId: string, prefs: NotificationPreferences): Promise<NotificationPreferences> {
    const repo = new DrizzleRentalRepository(this.db);
    await repo.setNotificationPreferences(userId, prefs);
    return repo.notificationPreferences(userId);
  }

  /** Usunięcie konta (pytanie 7): bez otwartego przejazdu i z saldem 0; dane osobowe znika `sp_anonymize_user`. */
  async deleteAccount(userId: string): Promise<void> {
    await this.transaction(async (repo) => {
      ensureCanDeleteAccount({
        hasOpenRental: (await repo.lockOpenForUser(userId)) !== null,
        balance: await repo.balance(userId),
      });
      await repo.anonymizeUser(userId);
    });
  }

  // --- Zdarzenia z hulajnogi i zadania w tle ---------------------------------------------------

  /**
   * Wynik komendy przejazdu: potwierdzenie z MQTT albo brak potwierdzenia w limicie (`ack = null`).
   * Zwraca `false` dla komendy bez przejazdu, którą obsługuje moduł Flota.
   */
  async onCommandResult(commandId: string, ack: AckResult | null): Promise<boolean> {
    const command = await new DrizzleRentalRepository(this.db).command(commandId);
    if (!command?.rentalId) return false;
    await this.transaction(async (repo, tx, effects) => {
      await repo.lockScooter(command.scooterId);
      const rental = (await repo.lock(command.rentalId!))!;
      const result = ack ? commandResultFromAck(command.type, ack.ok, ack.reason) : 'FAILED';
      const status = ack ? (result === 'CONFIRMED' ? 'ACKED' : 'REJECTED') : 'TIMEOUT';
      const late = !(await repo.completeCommand(command.id, status, ack?.at ?? null, ack?.reason ?? null));
      const outcome = rentalCommandOutcome({
        state: rental.state,
        command: command.type,
        result,
        late,
        resumeState: rental.state === 'ENDING' ? await repo.endResumeState(rental.id) : undefined,
      });
      if (outcome.event)
        await repo.addEvent(rental.id, outcome.event, {
          data: { commandId: command.id, ...(ack?.reason ? { reason: ack.reason } : {}) },
        });
      if (outcome.action)
        await this.applyCommandAction(repo, rental, outcome.action, effects, ack?.reason ?? (ack ? null : 'timeout'));
      if (outcome.compensateLock) await this.sendCommand(repo, tx, effects, rental.scooterId, rental.id, 'LOCK');
      if (outcome.action || outcome.event) effects.rentals.add(rental.id);
    });
    await this.commands.notifyPanel(commandId);
    return true;
  }

  /** Łączność hulajnogi w trakcie przejazdu: zdarzenie na osi czasu bez zmiany naliczania (reguła w iteracji 6). */
  async onConnectionChange(scooterId: string, online: boolean): Promise<void> {
    const repo = new DrizzleRentalRepository(this.db);
    const rental = await repo.openForScooter(scooterId);
    if (!rental || rental.state === 'RESERVED') return;
    const last = (await repo.timelineEvents(rental.id))
      .filter((e) => e.type === 'CONNECTION_LOST' || e.type === 'CONNECTION_RESTORED')
      .at(-1);
    const type = online ? 'CONNECTION_RESTORED' : 'CONNECTION_LOST';
    if ((last?.type ?? 'CONNECTION_RESTORED') === type) return;
    await repo.addEvent(rental.id, type);
    await this.notify(rental.id);
  }

  /** Wygaśnięcie rezerwacji (zadanie pg-boss); rezerwacja już odblokowana albo anulowana nic nie zmienia. */
  async expireReservation(rentalId: string): Promise<void> {
    const found = await new DrizzleRentalRepository(this.db).find(rentalId);
    if (!found || found.state !== 'RESERVED') return;
    await this.transaction(async (repo, _tx, effects) => {
      await repo.lockScooter(found.scooterId);
      const rental = await repo.lock(rentalId);
      const now = await repo.now();
      if (rental?.state !== 'RESERVED' || (rental.reservationExpiresAt && rental.reservationExpiresAt > now)) return;
      await this.transition(
        repo,
        rental,
        'EXPIRE_RESERVATION',
        RentalStateMachine.transition('RESERVED', 'EXPIRE_RESERVATION'),
        effects,
        {
          reason: 'reservation_timeout',
        },
      );
      await repo.setScooterStatus(rental.scooterId, 'AVAILABLE');
    });
  }

  // --- Panel ---------------------------------------------------------------------------------

  /** Zdalne zakończenie (D7): bez sprawdzania strefy, z powodem w dzienniku audytu i na osi czasu. */
  async remoteEnd(staffId: string, rentalId: string, body: RemoteEnd): Promise<void> {
    const found = await new DrizzleRentalRepository(this.db).find(rentalId);
    if (!found) throw notFound('rental', rentalId);
    const effects = new Effects();
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleRentalRepository(tx);
      await repo.lockScooter(found.scooterId);
      const rental = await repo.lock(rentalId);
      const decision = decideRemoteEnd(rental, body.reason, body.note);
      await repo.addEvent(rentalId, 'ENDED_REMOTELY', { data: { reason: body.reason, staffId } });
      await this.complete(repo, rental!, 'END_REMOTELY', decision.to, effects);
      if (decision.command) await this.sendCommand(repo, tx, effects, rental!.scooterId, rentalId, decision.command);
      await audit({
        action: 'rental.ended_remotely',
        entityType: 'rental',
        entityId: rentalId,
        data: { reason: body.reason, ...(body.note ? { note: body.note } : {}), fromState: rental!.state },
      });
    });
    await this.afterCommit(effects);
  }

  // --- Wspólne --------------------------------------------------------------------------------

  private async rideCommand(userId: string, decide: (rental: RentalRecord) => CommandType): Promise<RentalView> {
    const rentalId = await this.lockedUserRental(userId, async (repo, rental, tx, effects) => {
      await this.sendCommand(repo, tx, effects, rental.scooterId, rental.id, decide(rental));
      return rental.id;
    });
    return this.viewFor(userId, rentalId);
  }

  /** Otwarty przejazd klienta zablokowany w kolejności hulajnoga, przejazd. */
  private async lockedUserRental<T>(
    userId: string,
    work: (repo: DrizzleRentalRepository, rental: RentalRecord, tx: DbExecutor, effects: Effects) => Promise<T>,
  ): Promise<T> {
    const found = await new DrizzleRentalRepository(this.db).openForUser(userId);
    if (!found) throw new DomainError('NOT_FOUND', { entity: 'rental' });
    return this.transaction(async (repo, tx, effects) => {
      await repo.lockScooter(found.scooterId);
      const rental = await repo.lock(found.id);
      if (!rental || !RentalStateMachine.isOpen(rental.state)) throw new DomainError('NOT_FOUND', { entity: 'rental' });
      return work(repo, rental, tx, effects);
    });
  }

  private async applyCommandAction(
    repo: DrizzleRentalRepository,
    rental: RentalRecord,
    action: RentalAction,
    effects: Effects,
    reason: string | null,
  ): Promise<void> {
    const to = RentalStateMachine.transition(rental.state, action);
    if (action === 'COMPLETE_END') return this.complete(repo, rental, action, to, effects);
    const now = action === 'CONFIRM_UNLOCK' ? await repo.now() : undefined;
    await this.transition(
      repo,
      rental,
      action,
      to,
      effects,
      reason && action === 'UNLOCK_TIMEOUT' ? { reason } : undefined,
      now,
    );
    if (to === 'UNLOCK_FAILED') await repo.setScooterStatus(rental.scooterId, 'AVAILABLE');
  }

  private async transition(
    repo: DrizzleRentalRepository,
    rental: RentalRecord,
    action: RentalAction,
    to: RentalState,
    effects: Effects,
    data?: Record<string, unknown>,
    startedAt?: Date,
  ): Promise<void> {
    await repo.setState(rental.id, to, startedAt ? { startedAt } : {});
    await repo.addEvent(rental.id, 'STATE_CHANGED', { from: rental.state, to, data: { action, ...data } });
    effects.rentals.add(rental.id);
  }

  /** `ENDED`: liczniki z osi czasu i kwota z core (ADR 0042), dystans i trasa z telemetrii, hulajnoga wolna. */
  private async complete(
    repo: DrizzleRentalRepository,
    rental: RentalRecord,
    action: RentalAction,
    to: RentalState,
    effects: Effects,
  ): Promise<void> {
    const now = await repo.now();
    const tariff = await repo.tariff(rental.tariffId);
    const view = await buildRentalView(repo, rental, tariff, now);
    const endZoneId =
      rental.scooterLat === null ? null : await repo.parkingZoneAt(rental.scooterLat, rental.scooterLon!);
    await repo.addEvent(rental.id, 'STATE_CHANGED', { from: rental.state, to, data: { action } });
    await repo.finish(rental.id, {
      endedAt: now,
      rideSeconds: view.rideSeconds,
      pauseSeconds: view.pauseSeconds,
      totalAmount: view.price.total,
      endZoneId,
    });
    await repo.setScooterStatus(rental.scooterId, 'AVAILABLE');
    effects.rentals.add(rental.id);
  }

  /** Komenda z terminem ważności (ADR 0038) i zadaniem limitu potwierdzenia w tej samej transakcji (ADR 0037). */
  private async sendCommand(
    repo: DrizzleRentalRepository,
    tx: DbExecutor,
    effects: Effects,
    scooterId: string,
    rentalId: string | null,
    type: CommandType,
  ): Promise<void> {
    const command = await repo.createCommand({ scooterId, rentalId, type, ttlMs: COMMAND_ACK_TIMEOUT_MS });
    await this.jobs.sendInTransaction(tx, JOBS.commandAckTimeout, { commandId: command.id }, command.expiresAt!);
    effects.commands.push(command);
  }

  private async transaction<T>(
    work: (repo: DrizzleRentalRepository, tx: DbExecutor, effects: Effects) => Promise<T>,
  ): Promise<T> {
    const effects = new Effects();
    let result: T;
    try {
      result = await this.db.transaction((tx) => work(new DrizzleRentalRepository(tx), tx, effects));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      rethrowDatabaseRule(error);
    }
    await this.afterCommit(effects);
    return result;
  }

  private async afterCommit(effects: Effects): Promise<void> {
    for (const command of effects.commands) {
      try {
        await this.commands.dispatch(command);
      } catch (error) {
        // Komenda jest zapisana; bez publikacji skończy się brakiem potwierdzenia jak zgubiona w sieci.
        this.logger.warn(`Nie wysłano komendy ${command.id}: ${(error as Error).message}`);
      }
    }
    for (const id of effects.rentals) await this.notify(id);
  }

  /** Klient dostaje pełny widok przejazdu, panel wiersz listy (ADR 0036). */
  async notify(rentalId: string): Promise<void> {
    const repo = new DrizzleRentalRepository(this.db);
    const [rental, item] = await Promise.all([repo.find(rentalId), repo.listItem(rentalId)]);
    if (rental) this.gateway.rentalUpdated(rental.userId, await buildRentalView(repo, rental));
    if (item) this.gateway.rentalChanged(item as RentalListItem);
  }

  private async ensureCustomerCanRent(userId: string): Promise<void> {
    const customer = await new DrizzleCustomerRepository(this.db).findById(userId);
    if (!customer) throw new DomainError('UNAUTHENTICATED');
    ensureCustomerCanRent(customer, await new DrizzleConsentRepository(this.db).statuses(userId));
  }

  private async requireTariff(repo: DrizzleRentalRepository): Promise<RentalTariff> {
    const tariff = await repo.currentTariff(new Date());
    if (!tariff) throw new DomainError('TARIFF_MISSING');
    return tariff;
  }
}
