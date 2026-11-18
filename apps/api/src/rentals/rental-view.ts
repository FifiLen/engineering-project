import { batteryAlert, desiredZoneControl, isOfflineEndMode, rentalFigures, type RentalTariff } from '@hulajnogi/core';
import type { DrizzleRentalRepository, RentalRecord } from '@hulajnogi/db';
import type { FileView, RentalNotice, RentalView, TariffView } from '@hulajnogi/shared';

export const tariffView = (t: RentalTariff): TariffView => ({
  version: t.version,
  unlockFee: t.unlockFee,
  minuteRate: t.minuteRate,
  pauseMinuteRate: t.pauseMinuteRate,
  freeReservationMinutes: t.freeReservationMinutes,
});

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Podpisany widok zdjęcia parkowania (moduł Pliki); bez niego widok nie podaje zdjęcia. */
export interface RentalViewFiles {
  viewById(id: string | null): Promise<FileView | null>;
}

/**
 * Widok przejazdu dla klienta: liczniki i kwota liczone przez core z osi czasu na chwilę `now`
 * (ADR 0042, ADR 0056) z opłatą za odholowanie (ADR 0060), a po zakończeniu zapisane w przejeździe, dystans z telemetrii przejazdu albo zapisany
 * przy zakończeniu. Adres zdjęcia parkowania jest podpisany na 10 min (ADR 0057).
 */
export async function buildRentalView(
  repo: DrizzleRentalRepository,
  rental: RentalRecord,
  options: { tariff?: RentalTariff; now?: Date; files?: RentalViewFiles } = {},
): Promise<RentalView> {
  const at = options.now ?? (await repo.now());
  const [rate, events, notice, thresholds] = await Promise.all([
    options.tariff ?? repo.tariff(rental.tariffId),
    repo.timelineEvents(rental.id),
    repo.lastNotice(rental.id),
    repo.batteryThresholds(rental.id),
  ]);
  // Zakończony przejazd: liczniki i kwota z wiersza przejazdu, otwarty: z osi czasu na chwilę `at`.
  const { counters, price } = rentalFigures(rate, events, at, rental);
  const ended = rental.state === 'ENDED' || rental.state === 'UNPAID';
  const riding = !ended && rental.startedAt !== null;
  const [distanceM, speedKmh, route, zones, settlement, parkingPhoto] = await Promise.all([
    riding ? repo.liveDistance(rental.id) : rental.distanceM,
    riding ? repo.lastSpeed(rental.id) : null,
    rental.startedAt ? repo.route(rental.id) : [],
    riding ? repo.currentZones(rental.id) : null,
    repo.settlement(rental.id),
    options.files?.viewById(rental.parkingPhotoId) ?? null,
  ]);
  // Przed pierwszym odczytem stref nie ma czego wymagać od hulajnogi (brak stanu to nie „poza obszarem”).
  const zoneControl = zones
    ? desiredZoneControl(zones, { batteryCritical: thresholds.includes('CRITICAL') })
    : { stopped: false, speedLimitKmh: null };
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
    price,
    pendingCommand:
      rental.pendingCommand === 'LOCK' || rental.pendingCommand === 'UNLOCK' ? rental.pendingCommand : null,
    notice: (notice?.type as RentalNotice | undefined) ?? null,
    endZone: rental.endZone,
    zones: (zones ?? []).map(({ code, name, type, speedLimitKmh }) => ({ code, name, type, speedLimitKmh })),
    zoneControl,
    settlement,
    endMode: rental.endMode,
    parkingPhotoRequired: isOfflineEndMode(rental.endMode) && rental.parkingPhotoId === null,
    parkingPhoto,
    scooterOnline: rental.scooterOnline,
    positionAt: iso(rental.scooterPositionAt),
    billingStopped: counters.billingStoppedAt !== null,
    billingStoppedAt: iso(counters.billingStoppedAt),
    batteryAlert: batteryAlert(thresholds),
    asOf: at.toISOString(),
  };
}
