import { desiredZoneControl, priceRental, rentalCounters, type RentalTariff } from '@hulajnogi/core';
import type { DrizzleRentalRepository, RentalRecord } from '@hulajnogi/db';
import type { RentalNotice, RentalView, TariffView } from '@hulajnogi/shared';

export const tariffView = (t: RentalTariff): TariffView => ({
  version: t.version,
  unlockFee: t.unlockFee,
  minuteRate: t.minuteRate,
  pauseMinuteRate: t.pauseMinuteRate,
  freeReservationMinutes: t.freeReservationMinutes,
});

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Widok przejazdu dla klienta: liczniki i kwota liczone przez core z osi czasu na chwilę `now`
 * (ADR 0042), dystans z telemetrii przejazdu albo zapisany przy zakończeniu.
 */
export async function buildRentalView(
  repo: DrizzleRentalRepository,
  rental: RentalRecord,
  tariff?: RentalTariff,
  now?: Date,
): Promise<RentalView> {
  const at = now ?? (await repo.now());
  const [rate, events, notice] = await Promise.all([
    tariff ?? repo.tariff(rental.tariffId),
    repo.timelineEvents(rental.id),
    repo.lastNotice(rental.id),
  ]);
  const counters = rentalCounters(events, at);
  const ended = rental.state === 'ENDED' || rental.state === 'UNPAID';
  const riding = !ended && rental.startedAt !== null;
  const [distanceM, speedKmh, route, zones] = await Promise.all([
    riding ? repo.liveDistance(rental.id) : rental.distanceM,
    riding ? repo.lastSpeed(rental.id) : null,
    rental.startedAt ? repo.route(rental.id) : [],
    riding ? repo.currentZones(rental.id) : null,
  ]);
  // Przed pierwszym odczytem stref nie ma czego wymagać od hulajnogi (brak stanu to nie „poza obszarem”).
  const zoneControl = zones ? desiredZoneControl(zones) : { stopped: false, speedLimitKmh: null };
  return {
    id: rental.id,
    number: rental.number,
    state: rental.state,
    scooter: {
      id: rental.scooterId,
      number: rental.scooterNumber,
      variant: rental.scooterVariant,
      batteryPct: rental.scooterBatteryPct,
      lat: rental.scooterLat,
      lon: rental.scooterLon,
    },
    tariff: tariffView(rate),
    reservedAt: iso(rental.reservedAt),
    reservationExpiresAt: iso(rental.reservationExpiresAt),
    startedAt: iso(counters.startedAt ?? rental.startedAt),
    endedAt: iso(rental.endedAt),
    billedUntil: iso(counters.billedUntil),
    rideSeconds: counters.rideSeconds,
    pauseSeconds: counters.pauseSeconds,
    distanceM,
    speedKmh,
    route,
    price: priceRental(rate, counters),
    pendingCommand:
      rental.pendingCommand === 'LOCK' || rental.pendingCommand === 'UNLOCK' ? rental.pendingCommand : null,
    notice: (notice?.type as RentalNotice | undefined) ?? null,
    endZone: rental.endZone,
    zones: (zones ?? []).map(({ code, name, type, speedLimitKmh }) => ({ code, name, type, speedLimitKmh })),
    zoneControl,
    settlement: 'PENDING',
    asOf: at.toISOString(),
  };
}
