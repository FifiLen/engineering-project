import type { FleetStatus } from '@hulajnogi/shared';
import { t } from '../../../lib/i18n';

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
