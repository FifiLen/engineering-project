import type { FleetStatus } from '@hulajnogi/shared';
import Link from 'next/link';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';

const STATUS_PILL: Record<FleetStatus, string> = {
  AVAILABLE: 'pill',
  RESERVED: 'pill accent',
  IN_USE: 'pill accent',
  LOW_BATTERY: 'pill warn',
  MAINTENANCE: 'pill danger',
  OFFLINE: 'pill muted',
  RETIRED: 'pill muted',
};

/** Kolory statusów na mapie: jedyny kolor akcji to kobalt (jazda), ostrzeżenia i błędy z palety. */
export const STATUS_COLOR: Record<FleetStatus, string> = {
  AVAILABLE: '#16181D',
  RESERVED: '#2B3FF5',
  IN_USE: '#2B3FF5',
  LOW_BATTERY: '#8F5500',
  MAINTENANCE: '#C62F2F',
  OFFLINE: '#B9B9B2',
  RETIRED: '#B9B9B2',
};

export function StatusPill({ status }: { status: FleetStatus }) {
  return <span className={STATUS_PILL[status]}>{t.dynamic(`fleetStatus.${status}`)}</span>;
}

/** Pasek baterii; kolor ostrzeżenia, gdy status floty to niska bateria (próg z cennika liczy API). */
export function Battery({ pct, low, bar = true }: { pct: number | null; low: boolean; bar?: boolean }) {
  if (pct === null) return <span className="muted">{t('common.none')}</span>;
  return (
    <span className={low ? 'battery warn' : 'battery'}>
      {bar && (
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="num">{t('common.percent', { value: pct })}</span>
    </span>
  );
}

export const scooterNumber = (n: number) => t('common.scooterNumber', { number: String(n).padStart(4, '0') });

export const rentalNumber = (n: number) => t('common.rentalNumber', { number: n });

/**
 * Bieżący przejazd hulajnogi. Szczegóły hulajnogi znają tylko numer przejazdu, więc odnośnik prowadzi do listy
 * przejazdów z filtrem numeru (jeden wiersz z panelem bocznym).
 */
export function RentalLink({ id, number }: { id: string | null; number: number | null }) {
  const { can } = useSession();
  if (number === null) return <>{t('common.none')}</>;
  if (!can('rentals.read')) return <>{rentalNumber(number)}</>;
  return (
    <Link className="link" href={id ? `/admin/przejazdy/${id}` : `/admin/przejazdy?number=${number}`}>
      {rentalNumber(number)}
    </Link>
  );
}
