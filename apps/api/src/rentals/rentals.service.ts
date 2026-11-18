import {
  COMMAND_ACK_TIMEOUT_MS,
  commandResultFromAck,
  decideOfflineEnd,
  decideTowing,
  distanceAfterEnd,
  ensureCanAddParkingPhoto,
  isMovedAfterEnd,
  newBatteryThresholds,
  OFFLINE_BILLING_CAP_MS,
  priceRental,
  qualifiesForTowing,
  rentalCounters,
  decideCancelReservation,
  decideEnd,
  decidePause,
  decideRemoteEnd,
  decideReservation,
  decideResume,
  decideStart,
  desiredZoneControl,
  distanceM,
  DomainError,
  ensureCanDeleteAccount,
  ensureCanRing,
  ensureCustomerCanRent,
  estimateRangeKm,
  evaluatePosition,
  isZoneCommand,
  NEARBY_LIMIT,
  needsBatteryCriticalTicket,
  NEARBY_RADIUS_M,
  notFound,
  rentalCommandOutcome,
  RentalStateMachine,
  reservationExpiresAt,
  unavailableReason,
  zoneControlCommands,
  type CommandType,
  type EndMode,
  type GeoPoint,
  type RentalAction,
  type RentalState,
  type RentalTariff,
  type ZoneTransition,
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
  RentalRequest,
  RentalView,
  RouteView,
} from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';
import { FilesService } from '../files/files.service.js';
import { CommandsService, type AckResult } from '../fleet/commands.service.js';
import { RoutePlanner } from '../geo/route-planner.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OperationsService, systemScope, type OperationsEffects } from '../operations/operations.service.js';
import { PaymentEffects, PaymentsService } from '../payments/payments.service.js';
import { FleetGateway } from '../realtime/fleet.gateway.js';
import { buildRentalView, tariffView } from './rental-view.js';

/**
 * Skutki transakcji wykonywane dopiero po jej zatwierdzeniu: komendy do MQTT, zdarzenia Socket.IO przejazdu,
 * portfela i zgłoszeń automatycznych (moduł Operacje).
 */
class Effects extends PaymentEffects implements OperationsEffects {
  readonly commands: RentalCommandRecord[] = [];
  readonly tickets = new Set<string>();
  readonly tasks = new Set<string>();
  readonly systemCommands: OperationsEffects['systemCommands'] = [];
}

/** Odczyt telemetrii po zapisie partii: bateria w trakcie jazdy i ruch po zakończeniu offline (ADR 0056). */
export interface RentalReading {
  scooterId: string;
  recordedAt: Date;
  batteryPct: number;
  buffered: boolean;
}

/** Zakończenie przejazdu: tryb i opłata za odholowanie zapisywane w `rentals` (ADR 0056, ADR 0060). */
interface CompleteOptions {
  endMode?: EndMode;
  towingFee?: number | null;
}

/** Margines zegara między zaplanowaniem zadania a czasem bazy (pg-boss uruchamia zadanie po `startAfter`). */
const JOB_CLOCK_SKEW_MS = 5000;
/** Powiadomienie `reservation_ending` przed końcem bezpłatnej rezerwacji (ADR 0058). */
export const RESERVATION_ENDING_BEFORE_MS = 2 * 60_000;

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
    private readonly routes: RoutePlanner,
    private readonly payments: PaymentsService,
    private readonly files: FilesService,
    private readonly operations: OperationsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.commands.attachRentalHandler((commandId, ack) => this.onCommandResult(commandId, ack));
    // Płatność rozstrzyga zaległość (ADR 0049): przejście wykonuje maszyna stanów w transakcji płatności.
    this.payments.attachRentalHandler({
      transition: (tx, rentalId, action, data) => this.paymentTransition(tx, rentalId, action, data),
      notify: (rentalId) => this.notify(rentalId),
    });
    this.jobs.handle(JOBS.reservationExpire, async ({ rentalId }) => {
      await this.expireReservation(rentalId as string);
    });
    this.jobs.handle(JOBS.reservationEnding, async ({ rentalId }) => {
      await this.reservationEnding(rentalId as string);
    });
    this.jobs.handle(JOBS.expireSweep, async () => {
      for (const id of await new DrizzleRentalRepository(this.db).dueReservations(new Date()))
        await this.expireReservation(id);
    });
    this.jobs.handle(JOBS.offlineEndTimeout, async ({ rentalId }) => {
      await this.offlineEndTimeout(rentalId as string);
    });
    this.jobs.handle(JOBS.offlineBillingStop, async ({ rentalId }) => {
      await this.stopOfflineBilling(rentalId as string);
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

  /**
   * Trasa piesza do hulajnogi (ADR 0048): tylko do wolnej hulajnogi w promieniu wyszukiwania albo do własnej
   * rezerwacji; bez OSRM linia prosta.
   */
  async walkRoute(userId: string, scooterId: string, from: GeoPoint): Promise<RouteView> {
    const repo = new DrizzleRentalRepository(this.db);
    const scooter = await repo.scooter(scooterId);
    if (!scooter || scooter.lat === null || scooter.lon === null) throw notFound('scooter', scooterId);
    const own = await repo.openForUser(userId);
    const target = { lat: scooter.lat, lon: scooter.lon };
    const mine = own?.scooterId === scooterId && own.state === 'RESERVED';
    const visible =
      unavailableReason(scooter, await this.requireTariff(repo)) === null && distanceM(from, target) <= NEARBY_RADIUS_M;
    if (!mine && !visible) throw notFound('scooter', scooterId);
    return this.routes.route('foot', from, target);
  }

  // --- Przejazd klienta ----------------------------------------------------------------------

  async reserve(
    userId: string,
    scooterId: string,
    payment: Pick<RentalRequest, 'paymentSource' | 'paymentMethodId'> = {},
  ): Promise<{ rental: RentalView; created: boolean }> {
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
      // Minimalne saldo i zaległość także przy rezerwacji (pytanie 2); źródło zapamiętuje przejazd.
      const pay = await this.payments.ensureCanPay(tx, userId, {
        source: payment.paymentSource ?? 'WALLET',
        paymentMethodId: payment.paymentMethodId,
        tariffId: tariff.id,
      });
      const expiresAt = reservationExpiresAt(now, tariff);
      const rentalId = await repo.insert({
        userId,
        scooterId,
        tariffId: tariff.id,
        state: decision.to,
        reservedAt: now,
        reservationExpiresAt: expiresAt,
        paymentSource: pay.source,
        paymentMethodId: pay.paymentMethodId,
      });
      await repo.addEvent(rentalId, 'STATE_CHANGED', { from: null, to: decision.to });
      await repo.setScooterStatus(scooterId, 'RESERVED');
      await this.jobs.sendInTransaction(tx, JOBS.reservationExpire, { rentalId }, expiresAt);
      // Przypomnienie 2 min przed końcem (ADR 0058); przy krótszej rezerwacji go nie ma.
      const remindAt = new Date(expiresAt.getTime() - RESERVATION_ENDING_BEFORE_MS);
      if (remindAt > now) await this.jobs.sendInTransaction(tx, JOBS.reservationEnding, { rentalId }, remindAt);
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

  async start(
    userId: string,
    scooterId: string,
    payment: Pick<RentalRequest, 'paymentSource' | 'paymentMethodId'> = {},
  ): Promise<{ rental: RentalView; created: boolean }> {
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
      // Start z rezerwacji zachowuje jej źródło płatności, chyba że klient wybrał inne (ADR 0049).
      const reserved = decision.rentalId ? userRental : null;
      const pay = await this.payments.ensureCanPay(tx, userId, {
        source: payment.paymentSource ?? reserved?.paymentSource ?? 'WALLET',
        paymentMethodId:
          payment.paymentMethodId ?? (payment.paymentSource ? null : (reserved?.paymentMethodId ?? null)),
        tariffId: tariff.id,
      });
      const rentalId =
        decision.rentalId ??
        (await repo.insert({
          userId,
          scooterId,
          tariffId: tariff.id,
          state: decision.to,
          reservedAt: null,
          reservationExpiresAt: null,
          paymentSource: pay.source,
          paymentMethodId: pay.paymentMethodId,
        }));
      if (decision.rentalId) {
        await repo.setState(rentalId, decision.to);
        await repo.setPaymentSource(rentalId, pay.source, pay.paymentMethodId);
      }
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

  /**
   * Zakończenie przez klienta: strefa parkowania z ostatniej pozycji hulajnogi, potem blokada (ADR 0036). Przy
   * hulajnodze offline (ADR 0056) pozycja ma najwyżej 120 s, naliczanie kończy się przy żądaniu, a `lock` czeka
   * na powrót łączności 10 min; bez potwierdzenia zadanie `rental.offline-end-timeout` kończy przejazd.
   */
  async end(userId: string): Promise<RentalView> {
    const rentalId = await this.lockedUserRental(userId, async (repo, rental, tx, effects) => {
      const position: GeoPoint | null =
        rental.scooterLat === null ? null : { lat: rental.scooterLat, lon: rental.scooterLon! };
      const zones = position ? await new DrizzleZoneRepository(tx).findAt(position) : [];
      const canPark = evaluatePosition(zones).canPark;
      const nearestParking = canPark || !position ? null : await repo.nearestParking(position.lat, position.lon);
      // Strefa parkowania na osi czasu („żądanie zakończenia w strefie P-04”).
      const zoneId = position ? await repo.parkingZoneAt(position.lat, position.lon) : null;
      if (rental.scooterOnline) {
        const decision = decideEnd(rental, userId, { canPark, nearestParking });
        await repo.addEvent(rental.id, 'END_REQUESTED', { data: { resumeState: decision.resumeState }, zoneId });
        await this.transition(repo, rental, 'REQUEST_END', decision.to, effects, undefined, {
          endMode: decision.endMode,
        });
        await this.sendCommand(repo, tx, effects, rental.scooterId, rental.id, decision.command);
        return rental.id;
      }
      const decision = decideOfflineEnd(rental, userId, {
        positionAt: rental.scooterPositionAt,
        now: await repo.now(),
        inParking: zones.some((z) => z.type === 'PARKING'),
        inNoRide: zones.some((z) => z.type === 'NO_RIDE'),
        nearestParking,
      });
      // Pozycja z chwili żądania jest punktem odniesienia dla `MOVED_AFTER_END` po dosłaniu bufora.
      await repo.addEvent(rental.id, 'END_REQUESTED', {
        data: {
          resumeState: decision.resumeState,
          mode: 'OFFLINE',
          position,
          positionAt: rental.scooterPositionAt?.toISOString() ?? null,
        },
        zoneId,
      });
      await this.transition(repo, rental, 'REQUEST_END', decision.to, effects, undefined, {
        endMode: decision.endMode,
      });
      const lock = await this.sendCommand(repo, tx, effects, rental.scooterId, rental.id, decision.command, undefined, {
        ttlMs: decision.commandTtlMs,
      });
      await this.jobs.sendInTransaction(
        tx,
        JOBS.offlineEndTimeout,
        { rentalId: rental.id, commandId: lock.id },
        lock.expiresAt!,
      );
      return rental.id;
    });
    return this.viewFor(userId, rentalId);
  }

  /**
   * Zdjęcie parkowania po zakończeniu (ADR 0057): własny plik z celem `PARKING_PHOTO`, wysłany wcześniej przez
   * `POST /files`. Wymagane po zakończeniu bez łączności, poza tym opcjonalne.
   */
  async addParkingPhoto(userId: string, rentalId: string, fileId: string): Promise<RentalView> {
    await this.transaction(async (repo, tx, effects) => {
      const rental = await repo.lock(rentalId);
      if (!rental || rental.userId !== userId) throw notFound('rental', rentalId);
      ensureCanAddParkingPhoto(rental);
      await this.files.ensureAttachable(tx, fileId, { userId }, 'PARKING_PHOTO');
      await repo.setParkingPhoto(rentalId, fileId);
      effects.rentals.add(rentalId);
    });
    return this.viewFor(userId, rentalId);
  }

  async current(userId: string): Promise<RentalView | null> {
    const rental = await new DrizzleRentalRepository(this.db).openForUser(userId);
    return rental ? buildRentalView(new DrizzleRentalRepository(this.db), rental, { files: this.files }) : null;
  }

  async viewFor(userId: string, rentalId: string): Promise<RentalView> {
    const repo = new DrizzleRentalRepository(this.db);
    const rental = await repo.find(rentalId);
    if (!rental || rental.userId !== userId) throw notFound('rental', rentalId);
    return buildRentalView(repo, rental, { files: this.files });
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

  /**
   * Usunięcie konta (pytanie 7 w iteracji 3, pytanie 9 w iteracji 5): bez otwartego przejazdu, bez zaległości,
   * bez płatności i zwrotów w toku i z saldem 0; dane osobowe znika `sp_anonymize_user`.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.transaction(async (repo) => {
      ensureCanDeleteAccount({
        hasOpenRental: (await repo.lockOpenForUser(userId)) !== null,
        balance: await repo.balance(userId),
        unpaidRentals: await repo.unpaidCount(userId),
        pendingPayments: await repo.pendingMoney(userId),
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
    if (isZoneCommand(command.type)) {
      await this.onZoneCommandResult(command, ack);
      return true;
    }
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
        endMode: rental.endMode,
      });
      if (outcome.event)
        await repo.addEvent(rental.id, outcome.event, {
          data: { commandId: command.id, ...(ack?.reason ? { reason: ack.reason } : {}) },
        });
      if (outcome.action)
        await this.applyCommandAction(
          repo,
          tx,
          rental,
          outcome.action,
          effects,
          ack?.reason ?? (ack ? null : 'timeout'),
        );
      if (outcome.compensateLock) await this.sendCommand(repo, tx, effects, rental.scooterId, rental.id, 'LOCK');
      if (outcome.action || outcome.event) effects.rentals.add(rental.id);
    });
    await this.commands.notifyPanel(commandId);
    return true;
  }

  /**
   * Łączność hulajnogi w trakcie przejazdu: zdarzenie na osi czasu. Naliczanie liczy core z osi czasu (odcinek
   * bez łączności najwyżej 30 min, ADR 0056); po 30 min zadanie `rental.offline-billing-stop` zapisuje
   * `BILLING_STOPPED`, a przejazd trafia na pulpit „Wymaga uwagi”.
   */
  async onConnectionChange(scooterId: string, online: boolean): Promise<void> {
    const found = await new DrizzleRentalRepository(this.db).openForScooter(scooterId);
    if (!found || found.state === 'RESERVED') return;
    await this.transaction(async (repo, tx, effects) => {
      await repo.lockScooter(scooterId);
      const rental = await repo.lock(found.id);
      if (!rental || !RentalStateMachine.isOpen(rental.state)) return;
      const type = online ? 'CONNECTION_RESTORED' : 'CONNECTION_LOST';
      if (((await repo.lastConnectionEvent(rental.id))?.type ?? 'CONNECTION_RESTORED') === type) return;
      await repo.addEvent(rental.id, type);
      effects.rentals.add(rental.id);
      if (online) return;
      const lostAt = await repo.now();
      await this.jobs.sendInTransaction(
        tx,
        JOBS.offlineBillingStop,
        { rentalId: rental.id },
        new Date(lostAt.getTime() + OFFLINE_BILLING_CAP_MS),
      );
    });
  }

  /**
   * Zadanie `rental.offline-billing-stop` (ADR 0056): 30 min bez łączności bez żądania klienta zapisuje
   * `BILLING_STOPPED` raz na odcinek bez łączności. Powrót łączności, żądanie zakończenia albo koniec przejazdu
   * przed upływem limitu nic nie zapisują.
   */
  async stopOfflineBilling(rentalId: string): Promise<void> {
    const found = await new DrizzleRentalRepository(this.db).find(rentalId);
    if (!found) return;
    await this.transaction(async (repo, _tx, effects) => {
      await repo.lockScooter(found.scooterId);
      const rental = await repo.lock(rentalId);
      if (rental?.state !== 'ACTIVE' && rental?.state !== 'PAUSED') return;
      const lost = await repo.lastConnectionEvent(rentalId);
      if (lost?.type !== 'CONNECTION_LOST') return;
      const stoppedAt = new Date(lost.at.getTime() + OFFLINE_BILLING_CAP_MS);
      if ((await repo.now()).getTime() + JOB_CLOCK_SKEW_MS < stoppedAt.getTime()) return;
      if (await repo.hasEventSince(rentalId, 'BILLING_STOPPED', lost.at)) return;
      await repo.addEvent(rentalId, 'BILLING_STOPPED', {
        data: { connectionLostAt: lost.at.toISOString(), stoppedAt: stoppedAt.toISOString() },
      });
      effects.rentals.add(rentalId);
    });
  }

  /**
   * Zadanie `rental.offline-end-timeout` (ADR 0056): blokada po żądaniu offline bez potwierdzenia w 10 min kończy
   * przejazd jako `END_UNCONFIRMED` z naliczaniem do żądania. Wynik komendy przychodzi zwykle wcześniej (limit
   * potwierdzenia ma ten sam termin), więc zadanie działa tylko, gdy przejazd wciąż czeka.
   */
  async offlineEndTimeout(rentalId: string): Promise<void> {
    const repo = new DrizzleRentalRepository(this.db);
    const rental = await repo.find(rentalId);
    if (rental?.state !== 'ENDING' || rental.endMode !== 'CUSTOMER_OFFLINE') return;
    const lock = await repo.pendingLock(rentalId);
    if (lock) {
      await this.commands.timeout(lock);
      return;
    }
    // Blokada ma już wynik, a przejazd nadal czeka (np. wynik zapisany bez przejścia): kończymy bez potwierdzenia.
    await this.transaction(async (repo, tx, effects) => {
      await repo.lockScooter(rental.scooterId);
      const locked = await repo.lock(rentalId);
      if (locked?.state !== 'ENDING' || locked.endMode !== 'CUSTOMER_OFFLINE') return;
      await repo.addEvent(rentalId, 'LOCK_FAILED', { data: { reason: 'timeout' } });
      await this.complete(repo, tx, locked, 'END_UNCONFIRMED', 'ENDED', effects, { endMode: 'UNCONFIRMED' });
    });
  }

  // --- Telemetria w trakcie i po przejeździe (ADR 0056) ----------------------------------------------

  /**
   * Odczyty z partii telemetrii: progi baterii z odczytu bieżącego w trakcie jazdy i ruch hulajnogi po zakończeniu
   * bez łączności (punkty dosłane z bufora). Wywołuje moduł Telemetria po zapisie partii.
   */
  async onTelemetry(readings: readonly RentalReading[]): Promise<void> {
    if (!readings.length) return;
    const repo = new DrizzleRentalRepository(this.db);
    const scooterIds = [...new Set(readings.map((r) => r.scooterId))];
    const riding = await repo.ridingByScooter(scooterIds);
    for (const [scooterId, rentalId] of riding) {
      const current = readings.filter((r) => r.scooterId === scooterId && !r.buffered).at(-1);
      if (current) await this.checkBattery(rentalId, scooterId, current.batteryPct);
    }
    for (const { rentalId, scooterId } of await repo.offlineEndedByScooter(scooterIds)) {
      await this.checkMovedAfterEnd(rentalId, scooterId);
    }
  }

  /**
   * Progi baterii (ADR 0056): `LOW` z wersji cennika przejazdu i `CRITICAL` 5%, każdy jedno zdarzenie
   * `BATTERY_LOW` na przejazd. `CRITICAL` dokłada limit 10 km/h do uzgadniania komend stref.
   */
  private async checkBattery(rentalId: string, scooterId: string, batteryPct: number): Promise<void> {
    const read = new DrizzleRentalRepository(this.db);
    const found = await read.find(rentalId);
    if (found?.state !== 'ACTIVE' && found?.state !== 'PAUSED') return;
    const tariff = await read.tariff(found.tariffId);
    const fresh = newBatteryThresholds({
      batteryPct,
      minBatteryPct: tariff.minBatteryPct,
      reached: await read.batteryThresholds(rentalId),
    });
    if (!fresh.length) return;
    await this.transaction(async (repo, tx, effects) => {
      await repo.lockScooter(scooterId);
      const rental = await repo.lock(rentalId);
      if (rental?.state !== 'ACTIVE' && rental?.state !== 'PAUSED') return;
      const reached = await repo.batteryThresholds(rentalId);
      const thresholds = newBatteryThresholds({ batteryPct, minBatteryPct: tariff.minBatteryPct, reached });
      for (const threshold of thresholds) {
        await repo.addEvent(rentalId, 'BATTERY_LOW', { data: { threshold, batteryPct } });
      }
      if (!thresholds.length) return;
      effects.rentals.add(rentalId);
      // Push „Niska bateria” przy progu z cennika (pytanie 2); aplikacja na pierwszym planie go ukrywa.
      if (thresholds.includes('LOW')) {
        await this.notifications.batteryLow(tx, {
          rentalId,
          userId: rental.userId,
          scooterNumber: rental.scooterNumber,
          batteryPct,
        });
      }
      if (thresholds.includes('CRITICAL') && rental.state === 'ACTIVE') {
        await this.reconcileZoneControl(repo, tx, effects, rental);
      }
    });
  }

  /** `MOVED_AFTER_END` (ADR 0056): ponad 200 m po żądaniu zakończenia offline; kwota się nie zmienia. */
  private async checkMovedAfterEnd(rentalId: string, scooterId: string): Promise<void> {
    const read = new DrizzleRentalRepository(this.db);
    const request = await read.offlineEndRequest(rentalId);
    if (!request) return;
    const distance = distanceAfterEnd({
      endRequestedAt: request.at,
      origin: request.position,
      readings: await read.readingsAfter(rentalId, scooterId, request.at),
    });
    if (!isMovedAfterEnd(distance)) return;
    await this.transaction(async (repo, _tx, effects) => {
      await repo.lock(rentalId);
      if (await repo.hasEventSince(rentalId, 'MOVED_AFTER_END', request.at)) return;
      await repo.addEvent(rentalId, 'MOVED_AFTER_END', { data: { distanceM: distance } });
      effects.rentals.add(rentalId);
    });
  }

  /** Stan blokady hulajnóg dla reguły `shouldLockIdleScooter` w module Telemetria (ADR 0056). */
  lockStates(scooterIds: string[]) {
    return new DrizzleRentalRepository(this.db).lockStates(scooterIds);
  }

  // --- Strefy w trakcie jazdy (ADR 0043, ADR 0044) -------------------------------------------------

  /** Przejazdy, w których śledzimy strefy: hulajnoga po odblokowaniu, przed zakończeniem. */
  ridingByScooter(scooterIds: string[]): Promise<Map<string, string>> {
    return new DrizzleRentalRepository(this.db).ridingByScooter(scooterIds);
  }

  /**
   * Przejścia stref z modułu Strefy: zdarzenia na osi czasu z czasem odczytu i uzgodnienie komend
   * z bieżącymi strefami (tylko w `ACTIVE` i tylko po odczycie bieżącym, nie z bufora).
   */
  async onZoneChanges(input: {
    rentalId: string;
    scooterId: string;
    transitions: readonly ZoneTransition[];
    applyControl: boolean;
  }): Promise<void> {
    await this.transaction(async (repo, tx, effects) => {
      await repo.lockScooter(input.scooterId);
      const rental = await repo.lock(input.rentalId);
      if (!rental || !RentalStateMachine.isOpen(rental.state)) return;
      for (const t of input.transitions) {
        await repo.addEvent(rental.id, t.kind === 'ENTERED' ? 'ZONE_ENTERED' : 'ZONE_EXITED', {
          zoneId: t.zone.id,
          data: { code: t.zone.code, zoneType: t.zone.type, recordedAt: t.at.toISOString() },
        });
      }
      if (input.transitions.length) effects.rentals.add(rental.id);
      if (input.applyControl && rental.state === 'ACTIVE') await this.reconcileZoneControl(repo, tx, effects, rental);
    });
  }

  /** Komenda strefy (limit, zatrzymanie): wynik zmienia tylko stan zastosowany; błąd wymusza ponowienie. */
  private async onZoneCommandResult(command: RentalCommandRecord, ack: AckResult | null): Promise<void> {
    await this.transaction(async (repo, tx, effects) => {
      const confirmed = ack !== null && commandResultFromAck(command.type, ack.ok, ack.reason) === 'CONFIRMED';
      const status = ack ? (confirmed ? 'ACKED' : 'REJECTED') : 'TIMEOUT';
      if (!(await repo.completeCommand(command.id, status, ack?.at ?? null, ack?.reason ?? null))) return;
      if (status !== 'ACKED') await new DrizzleZoneRepository(tx).markControlFailed(command.id);
      effects.rentals.add(command.rentalId!);
    });
    await this.commands.notifyPanel(command.id);
  }

  /** Uzgodnienie stanu docelowego hulajnogi z jej bieżącymi strefami (ADR 0044). */
  private async reconcileZoneControl(
    repo: DrizzleRentalRepository,
    tx: DbExecutor,
    effects: Effects,
    rental: RentalRecord,
  ): Promise<void> {
    const zones = new DrizzleZoneRepository(tx);
    const applied = await zones.control(rental.scooterId);
    if (!applied || applied.rentalId !== rental.id) return;
    const batteryCritical = (await repo.batteryThresholds(rental.id)).includes('CRITICAL');
    const desired = desiredZoneControl(
      (await zones.presence(rental.scooterId)).map((p) => p.zone),
      { batteryCritical },
    );
    for (const command of zoneControlCommands(applied, desired)) {
      const kmh = command.type === 'SPEED_LIMIT' ? command.speedLimitKmh : null;
      const sent = await this.sendCommand(
        repo,
        tx,
        effects,
        rental.scooterId,
        rental.id,
        command.type,
        kmh ? { kmh } : undefined,
      );
      await zones.applyControl(
        rental.scooterId,
        command.type === 'SPEED_LIMIT'
          ? { speedLimitKmh: kmh, limitCommandId: sent.id }
          : { stopped: command.type === 'STOP_GRADUALLY', stopCommandId: sent.id },
      );
    }
  }

  /**
   * Zadanie `rental.reservation-ending` (ADR 0058): powiadomienie `reservation_ending`, tylko gdy rezerwacja nadal
   * trwa; preferencję `notify_reservation_end` sprawdza wysyłka.
   */
  async reservationEnding(rentalId: string): Promise<void> {
    await this.transaction(async (repo, tx) => {
      const rental = await repo.lock(rentalId);
      if (rental?.state !== 'RESERVED' || !rental.reservationExpiresAt) return;
      const leftMs = rental.reservationExpiresAt.getTime() - (await repo.now()).getTime();
      if (leftMs <= 0) return;
      await this.notifications.reservationEnding(tx, {
        rentalId,
        userId: rental.userId,
        scooterNumber: rental.scooterNumber,
        minutesLeft: Math.max(1, Math.ceil(leftMs / 60_000)),
      });
    });
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

  /**
   * Zdalne zakończenie (D7): bez sprawdzania strefy, z powodem w dzienniku audytu i na osi czasu. Poza strefą
   * parkowania operator decyduje o opłacie za odholowanie z wersji cennika przejazdu (ADR 0060); dziennik zapisuje
   * opłatę albo jej pominięcie.
   */
  async remoteEnd(staffId: string, rentalId: string, body: RemoteEnd): Promise<void> {
    const found = await new DrizzleRentalRepository(this.db).find(rentalId);
    if (!found) throw notFound('rental', rentalId);
    const effects = new Effects();
    await this.audited.run(staffId, async ({ tx, audit }) => {
      const repo = new DrizzleRentalRepository(tx);
      await repo.lockScooter(found.scooterId);
      const rental = await repo.lock(rentalId);
      // Hulajnoga offline dostaje blokadę ważną 10 min (z sesji trwałej brokera po powrocie łączności), jak przy
      // zakończeniu klienta offline (ADR 0056); po jej wygaśnięciu działa reguła blokady hulajnogi bez przejazdu.
      const decision = decideRemoteEnd(rental, body.reason, body.note, { online: rental?.scooterOnline ?? true });
      const towing = decideTowing({
        outsideParking: await this.outsideParking(tx, rental!),
        collect: body.collectTowingFee,
        outOfZoneFee: await repo.outOfZoneFee(rental!.tariffId),
      });
      await repo.addEvent(rentalId, 'ENDED_REMOTELY', {
        data: { reason: body.reason, staffId, ...(towing.towingFee ? { towingFee: towing.towingFee } : {}) },
      });
      // Poza strefą parkowania zawsze zgłoszenie `OUT_OF_ZONE` z zadaniem `RELOCATION` do najbliższej strefy, także
      // bez opłaty (ADR 0055, ADR 0060); przed zakończeniem, żeby hulajnoga przeszła od razu do `MAINTENANCE`.
      if (towing.relocation) {
        await this.operations.openAutoTicket(
          systemScope(tx),
          {
            scooterId: rental!.scooterId,
            kind: 'OUT_OF_ZONE',
            rentalId,
            position: rental!.scooterLat === null ? null : { lat: rental!.scooterLat, lon: rental!.scooterLon! },
            data: { towingFee: towing.towingFee },
          },
          effects,
        );
      }
      await this.complete(repo, tx, rental!, 'END_REMOTELY', decision.to, effects, {
        endMode: decision.endMode,
        towingFee: towing.towingFee,
      });
      if (decision.command) {
        await this.sendCommand(repo, tx, effects, rental!.scooterId, rentalId, decision.command, undefined, {
          ttlMs: decision.commandTtlMs,
        });
      }
      await audit({
        action: 'rental.ended_remotely',
        entityType: 'rental',
        entityId: rentalId,
        data: {
          reason: body.reason,
          ...(body.note ? { note: body.note } : {}),
          fromState: rental!.state,
          outsideParking: towing.relocation,
          ...(towing.relocation ? { towingFee: towing.towingFee } : {}),
        },
      });
    });
    await this.afterCommit(effects);
  }

  /** Ostatnia znana pozycja hulajnogi poza strefą parkowania albo brak pozycji (`qualifiesForTowing`, ADR 0060). */
  async outsideParking(executor: DbExecutor, rental: RentalRecord): Promise<boolean> {
    if (rental.scooterLat === null) return qualifiesForTowing(null);
    const zones = await new DrizzleZoneRepository(executor).findAt({ lat: rental.scooterLat, lon: rental.scooterLon! });
    return qualifiesForTowing({ canPark: evaluatePosition(zones).canPark });
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
    tx: DbExecutor,
    rental: RentalRecord,
    action: RentalAction,
    effects: Effects,
    reason: string | null,
  ): Promise<void> {
    const to = RentalStateMachine.transition(rental.state, action);
    if (action === 'COMPLETE_END') return this.complete(repo, tx, rental, action, to, effects);
    // Blokada po żądaniu offline nie przyszła w 10 min (ADR 0056): koniec z naliczaniem do żądania.
    if (action === 'END_UNCONFIRMED')
      return this.complete(repo, tx, rental, action, to, effects, { endMode: 'UNCONFIRMED' });
    const now = action === 'CONFIRM_UNLOCK' ? await repo.now() : undefined;
    await this.transition(
      repo,
      rental,
      action,
      to,
      effects,
      reason && action === 'UNLOCK_TIMEOUT' ? { reason } : undefined,
      now ? { startedAt: now } : {},
    );
    if (to === 'UNLOCK_FAILED') {
      await repo.setScooterStatus(rental.scooterId, 'AVAILABLE');
      await new DrizzleZoneRepository(tx).stopTracking(rental.id);
    }
    // `lock` kasuje limit i zatrzymanie w hulajnodze; po odblokowaniu strefy obowiązują od razu (ADR 0044).
    if (to === 'PAUSED') await new DrizzleZoneRepository(tx).resetControl(rental.scooterId);
    if (to === 'ACTIVE') await this.reconcileZoneControl(repo, tx, effects, { ...rental, state: to });
  }

  private async transition(
    repo: DrizzleRentalRepository,
    rental: RentalRecord,
    action: RentalAction,
    to: RentalState,
    effects: Effects,
    data?: Record<string, unknown>,
    extra: { startedAt?: Date; endMode?: EndMode } = {},
  ): Promise<void> {
    await repo.setState(rental.id, to, extra);
    await repo.addEvent(rental.id, 'STATE_CHANGED', { from: rental.state, to, data: { action, ...data } });
    effects.rentals.add(rental.id);
  }

  /**
   * `ENDED`: liczniki z osi czasu i kwota z core (ADR 0042, ADR 0056) z opłatą za odholowanie (ADR 0060), dystans
   * i trasa z telemetrii, hulajnoga wolna.
   */
  private async complete(
    repo: DrizzleRentalRepository,
    tx: DbExecutor,
    rental: RentalRecord,
    action: RentalAction,
    to: RentalState,
    effects: Effects,
    options: CompleteOptions = {},
  ): Promise<void> {
    const now = await repo.now();
    const tariff = await repo.tariff(rental.tariffId);
    const events = await repo.timelineEvents(rental.id);
    const counters = rentalCounters(events, now, { endMode: options.endMode ?? rental.endMode });
    const price = priceRental(tariff, counters, { towingFee: options.towingFee });
    const endZoneId =
      rental.scooterLat === null ? null : await repo.parkingZoneAt(rental.scooterLat, rental.scooterLon!);
    await repo.addEvent(rental.id, 'STATE_CHANGED', { from: rental.state, to, data: { action } });
    await this.autoTickets(tx, rental, options, effects);
    await repo.finish(rental.id, {
      endedAt: now,
      rideSeconds: counters.rideSeconds,
      pauseSeconds: counters.pauseSeconds,
      totalAmount: price.total,
      endZoneId,
      endMode: options.endMode,
      towingFee: options.towingFee ?? null,
    });
    await repo.setScooterStatus(rental.scooterId, 'AVAILABLE');
    await new DrizzleZoneRepository(tx).stopTracking(rental.id);
    // Rozliczenie w tej samej transakcji (ADR 0049): portfel od razu, karta zadaniem po zatwierdzeniu.
    const charge = await this.payments.settleRide(tx, rental.id, effects);
    // `ride_ended` (ADR 0058) po rozliczeniu: portfel i przejazd bez opłaty od razu, karta po paragonie z płatności.
    if (charge !== 'CARD') {
      await this.notifications.rideEnded(
        tx,
        {
          id: rental.id,
          userId: rental.userId,
          number: rental.number,
          rideSeconds: counters.rideSeconds,
          pauseSeconds: counters.pauseSeconds,
          totalAmount: price.total,
          towingFee: options.towingFee ?? null,
        },
        charge === 'WALLET',
      );
    }
    effects.rentals.add(rental.id);
  }

  /**
   * Zgłoszenia automatyczne przy zakończeniu (ADR 0055) przed zwolnieniem hulajnogi, więc otwarte zadanie od razu
   * wybiera `MAINTENANCE` (wyzwalacz `scooters_status`): `OFFLINE` po zakończeniu bez potwierdzenia blokady
   * (ADR 0056) i `BATTERY_CRITICAL` z zadaniem `BATTERY_SWAP` przy baterii poniżej 10%.
   */
  private async autoTickets(
    tx: DbExecutor,
    rental: RentalRecord,
    options: CompleteOptions,
    effects: Effects,
  ): Promise<void> {
    const scope = systemScope(tx);
    if (options.endMode === 'UNCONFIRMED') {
      await this.operations.openAutoTicket(
        scope,
        { scooterId: rental.scooterId, kind: 'OFFLINE', rentalId: rental.id, data: { endMode: 'UNCONFIRMED' } },
        effects,
      );
    }
    if (needsBatteryCriticalTicket(rental.scooterBatteryPct)) {
      await this.operations.openAutoTicket(
        scope,
        {
          scooterId: rental.scooterId,
          kind: 'BATTERY_CRITICAL',
          rentalId: rental.id,
          data: { batteryPct: rental.scooterBatteryPct },
        },
        effects,
      );
    }
  }

  /** Przejście wywołane wynikiem płatności (`DECLINE_PAYMENT`, `SETTLE_DEBT`) w transakcji modułu Płatności. */
  private async paymentTransition(
    tx: DbExecutor,
    rentalId: string,
    action: 'DECLINE_PAYMENT' | 'SETTLE_DEBT',
    data: Record<string, unknown>,
  ): Promise<void> {
    const repo = new DrizzleRentalRepository(tx);
    const rental = await repo.lock(rentalId);
    if (!rental) throw notFound('rental', rentalId);
    const to = RentalStateMachine.transition(rental.state, action);
    await repo.setState(rentalId, to);
    await repo.addEvent(rentalId, 'STATE_CHANGED', { from: rental.state, to, data: { action, ...data } });
  }

  /** Komenda z terminem ważności (ADR 0038) i zadaniem limitu potwierdzenia w tej samej transakcji (ADR 0037). */
  private async sendCommand(
    repo: DrizzleRentalRepository,
    tx: DbExecutor,
    effects: Effects,
    scooterId: string,
    rentalId: string | null,
    type: CommandType,
    params?: { kmh?: number },
    options: { ttlMs?: number } = {},
  ): Promise<RentalCommandRecord> {
    // Blokada przy zakończeniu bez łączności czeka 10 min (ADR 0056); pozostałe komendy 10 s (ADR 0038).
    const ttlMs = options.ttlMs ?? COMMAND_ACK_TIMEOUT_MS;
    const command = await repo.createCommand({ scooterId, rentalId, type, ttlMs, params });
    await this.jobs.sendInTransaction(tx, JOBS.commandAckTimeout, { commandId: command.id }, command.expiresAt!);
    effects.commands.push(command);
    return command;
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
    for (const userId of effects.wallets) await this.payments.notifyWallet(userId);
    await this.operations.afterCommit(effects);
  }

  /** Klient dostaje pełny widok przejazdu, panel wiersz listy (ADR 0036). */
  async notify(rentalId: string): Promise<void> {
    const repo = new DrizzleRentalRepository(this.db);
    const [rental, item] = await Promise.all([repo.find(rentalId), repo.listItem(rentalId)]);
    if (rental) this.gateway.rentalUpdated(rental.userId, await buildRentalView(repo, rental, { files: this.files }));
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
