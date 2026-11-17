/** Wygląd stref w edytorze (makiety 23-panel-strefy): kolory typów, ikony i opis pozycji listy. */
import type { ZoneListItem, ZoneType } from '@hulajnogi/shared';
import type { ReactNode } from 'react';
import { t } from '../../../lib/i18n';
import { MapIcon, NoRideIcon, ParkingIcon, SlowZoneIcon } from '../icons';
import { formatHa } from './zone-geometry';

/** Kolory z palety: parkowanie kobaltem, wolna jazda kolorem ostrzeżenia, zakaz kolorem błędu, obszar grafitem. */
export const ZONE_COLOR: Record<ZoneType, `#${string}`> = {
  PARKING: '#2B3FF5',
  SLOW: '#8F5500',
  NO_RIDE: '#C62F2F',
  SERVICE_AREA: '#16181D',
};

/** Kolejność typów w filtrach i w przełączniku typu. */
export const ZONE_TYPE_ORDER: readonly ZoneType[] = ['PARKING', 'SLOW', 'NO_RIDE', 'SERVICE_AREA'];

export const zoneTypeLabel = (type: ZoneType) => t.dynamic(`resource.zones.values.type.${type}`);

export function ZoneTypeIcon({ type, size = 15 }: { type: ZoneType; size?: number }) {
  const style = { color: ZONE_COLOR[type] };
  switch (type) {
    case 'PARKING':
      return <ParkingIcon size={size} style={style} />;
    case 'SLOW':
      return <SlowZoneIcon size={size} style={style} />;
    case 'NO_RIDE':
      return <NoRideIcon size={size} style={style} />;
    case 'SERVICE_AREA':
      return <MapIcon size={size} strokeWidth={2} style={style} />;
  }
}

/** Parkowanie pełne, gdy hulajnóg jest co najmniej tyle, ile wynosi pojemność (pojemność tylko informuje). */
export const isFull = (z: Pick<ZoneListItem, 'capacity' | 'scootersInside'>) =>
  z.capacity !== null && z.scootersInside >= z.capacity;

/** Drugi wiersz pozycji listy zależny od typu (ustalenia z plansz). */
export function zoneDescription(z: ZoneListItem): ReactNode {
  const type = zoneTypeLabel(z.type);
  switch (z.type) {
    case 'PARKING':
      if (z.capacity === null) return `${type} · ${t('zones.list.scooters', { count: z.scootersInside })}`;
      return (
        <>
          {type}
          {' · '}
          <span className={isFull(z) ? 'zl-full' : undefined}>
            {t(isFull(z) ? 'zones.list.capacityFull' : 'zones.list.capacity', {
              count: z.scootersInside,
              capacity: z.capacity,
            })}
          </span>
        </>
      );
    case 'SLOW':
      return `${type} · ${t('common.kmh', { value: z.speedLimitKmh ?? 0 })}`;
    case 'NO_RIDE':
      return t('zones.list.noRide');
    case 'SERVICE_AREA':
      return `${type} · ${t('zones.list.hectares', { value: formatHa(z.areaM2) })}`;
  }
}

/** Etykieta strefy na mapie: kod i nazwa, a dla wolnej jazdy także limit. */
export function zoneMapLabel(p: { code: string; name: string; type: string; speedLimitKmh?: number | null }): string {
  const base = `${p.code} ${p.name}`;
  return p.type === 'SLOW' && p.speedLimitKmh ? `${base} · ${t('common.kmh', { value: p.speedLimitKmh })}` : base;
}
