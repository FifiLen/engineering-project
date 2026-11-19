'use client';

/**
 * Przejazdy → Zdarzenia (ADR 0076): `rental_events` jako lista wzorca widoku tabeli (dotąd tylko oś czasu przejazdu),
 * z filtrami typu, stanu, strefy i czasu; tylko do odczytu z `rentals.read`. Bez `users.read` API pokazuje „Klient”.
 */
import { rentalEventsResource, type RentalEventListItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { t } from '../../../lib/i18n';
import { RentalTabs } from '../areas';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { RouteIcon } from '../icons';
import { valueLabel } from '../labels';
import { ListNote, When } from '../list-format';
import { ResourceList, type Column } from '../resource-list';

const label = (field: string, value: string) => valueLabel(rentalEventsResource, field, value);

/** Szczegół zdarzenia: przejście stanów albo strefa. */
function Detail({ e }: { e: RentalEventListItem }) {
  if (e.fromState || e.toState)
    return (
      <small>
        {t('rentalEvents.transition', {
          from: e.fromState ? label('fromState', e.fromState) : t('common.none'),
          to: e.toState ? label('toState', e.toState) : t('common.none'),
        })}
      </small>
    );
  if (e.zoneCode) return <small>{[e.zoneCode, e.zoneName].filter(Boolean).join(' ')}</small>;
  return null;
}

const columns: Column<RentalEventListItem>[] = [
  { field: 'createdAt', width: '130px', render: (e) => <When at={e.createdAt} seconds /> },
  {
    field: 'type',
    width: 'minmax(0,1.6fr)',
    render: (e) => (
      <span className="stack">
        <span>{label('type', e.type)}</span>
        <Detail e={e} />
      </span>
    ),
  },
  {
    field: 'rentalNumber',
    width: '110px',
    render: (e) => (
      <Link href={`/admin/przejazdy/${e.rentalId}`} className="link num">
        {rentalNumber(e.rentalNumber)}
      </Link>
    ),
  },
  {
    field: 'scooterNumber',
    width: '100px',
    render: (e) => (
      <Link href={`/admin/flota/${e.scooterId}`} className="link num">
        {scooterNumber(e.scooterNumber)}
      </Link>
    ),
  },
  { field: 'userName', width: 'minmax(0,1fr)', render: (e) => e.userName ?? t('rentalEvents.customer') },
  {
    field: 'zoneCode',
    width: '110px',
    render: (e) => (e.zoneCode ? <span className="num">{e.zoneCode}</span> : <span className="muted">{t('common.none')}</span>),
  },
  { field: 'rentalState', width: '130px', render: (e) => <span className="pill">{label('rentalState', e.rentalState)}</span> },
];

const filters: FilterSpec[] = [
  { field: 'type', kind: 'checklist' },
  { field: 'rentalState', kind: 'checklist' },
  { field: 'zoneType', kind: 'checklist' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function RentalEventList() {
  return (
    <ResourceList<RentalEventListItem>
      resource={rentalEventsResource}
      basePath="/admin/przejazdy/zdarzenia"
      title={t('resource.rentals.title')}
      columns={columns}
      itemHref={(e) => `/admin/przejazdy/${e.rentalId}`}
      quick={{
        field: 'type',
        values: ['STATE_CHANGED', 'ZONE_ENTERED', 'ZONE_EXITED', 'CONNECTION_LOST', 'BATTERY_LOW'],
      }}
      filters={filters}
      rowLabel={(e) => `${rentalNumber(e.rentalNumber)} ${label('type', e.type)}`}
      summary={(data) => t('resource.rental-events.summary', { count: data.total })}
      emptyIcon={<RouteIcon size={22} />}
      createLabel={null}
      selectable={false}
      tabs={<RentalTabs />}
      exportColumns={[
        'createdAt',
        'type',
        'fromState',
        'toState',
        'rentalNumber',
        'rentalState',
        'scooterNumber',
        'userName',
        'zoneCode',
        'zoneName',
        'zoneType',
      ]}
      footer={<ListNote>{t('rentalEvents.note')}</ListNote>}
    />
  );
}
