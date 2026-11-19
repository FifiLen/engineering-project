'use client';

/**
 * Strefy → Obecność w strefach i Komendy stref (ADR 0076): techniczne tabele śledzenia stref w przejeździe
 * (`scooter_zone_presence`, `scooter_zone_control`, ADR 0043 i 0044) jako listy tylko do odczytu z `zones.read`.
 */
import {
  ZONE_TYPES,
  zoneControlResource,
  zonePresenceResource,
  type CommandStatus,
  type ZoneControlListItem,
  type ZonePresenceListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { t } from '../../../lib/i18n';
import { ZoneTabs } from '../areas';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { ParkingIcon } from '../icons';
import { valueLabel } from '../labels';
import { durationText, ListNote, When } from '../list-format';
import { ResourceList, type Column } from '../resource-list';

const scooterCell = (r: { scooterId: string; scooterNumber: number }) => (
  <Link href={`/admin/flota/${r.scooterId}`} className="link num">
    {scooterNumber(r.scooterNumber)}
  </Link>
);
const rentalCell = (r: { rentalId: string; rentalNumber: number }) => (
  <Link href={`/admin/przejazdy/${r.rentalId}`} className="link num">
    {rentalNumber(r.rentalNumber)}
  </Link>
);

// --- Obecność w strefach -----------------------------------------------------------------------------------

const presenceColumns: Column<ZonePresenceListItem>[] = [
  { field: 'scooterNumber', width: '100px', render: scooterCell },
  {
    field: 'zoneCode',
    width: 'minmax(0,1.6fr)',
    render: (r) => (
      <span className="stack">
        <span>
          <span className="num strong">{r.zoneCode}</span> {r.zoneName}
        </span>
        <small>{valueLabel(zonePresenceResource, 'zoneType', r.zoneType)}</small>
      </span>
    ),
  },
  { field: 'rentalNumber', width: '110px', render: rentalCell },
  { field: 'enteredAt', width: '140px', render: (r) => <When at={r.enteredAt} seconds /> },
  { field: 'secondsInZone', width: '130px', render: (r) => <span className="num">{durationText(r.secondsInZone)}</span> },
  {
    field: 'outsideCount',
    width: '130px',
    render: (r) => <span className={r.outsideCount > 0 ? 'num warn-text' : 'num'}>{r.outsideCount}</span>,
  },
];

const presenceFilters: FilterSpec[] = [
  { field: 'zoneType', kind: 'checklist' },
  { field: 'enteredAt', kind: 'dateRange' },
  { field: 'secondsInZone', kind: 'range' },
  { field: 'outsideCount', kind: 'range' },
];

export function ZonePresenceList() {
  return (
    <ResourceList<ZonePresenceListItem & { id: string }>
      resource={zonePresenceResource}
      basePath="/admin/strefy/obecnosc"
      title={t('resource.zones.title')}
      columns={presenceColumns}
      rowKey={(r) => `${r.scooterId}:${r.zoneId}`}
      itemHref={(r) => `/admin/flota/${r.scooterId}`}
      quick={{ field: 'zoneType', values: ZONE_TYPES.filter((z) => z !== 'SERVICE_AREA') }}
      filters={presenceFilters}
      rowLabel={(r) => `${scooterNumber(r.scooterNumber)} ${r.zoneCode}`}
      summary={(data) => t('resource.zone-presence.summary', { count: data.total })}
      emptyIcon={<ParkingIcon size={22} />}
      createLabel={null}
      selectable={false}
      tabs={<ZoneTabs />}
      exportColumns={[
        'scooterNumber',
        'zoneCode',
        'zoneName',
        'zoneType',
        'rentalNumber',
        'enteredAt',
        'secondsInZone',
        'outsideCount',
      ]}
      footer={<ListNote>{t('zoneLists.presenceNote')}</ListNote>}
    />
  );
}

// --- Komendy stref -----------------------------------------------------------------------------------------

function Sync({ synced, status }: { synced: boolean; status: CommandStatus | null }) {
  if (synced) return <small>{t('zoneLists.synced')}</small>;
  return (
    <small className="warn-text">
      {status ? valueLabel(zoneControlResource, 'limitCommandStatus', status) : t('zoneLists.notSynced')}
    </small>
  );
}

const controlColumns: Column<ZoneControlListItem>[] = [
  { field: 'scooterNumber', width: '100px', render: scooterCell },
  { field: 'rentalNumber', width: '110px', render: rentalCell },
  {
    field: 'speedLimitKmh',
    width: 'minmax(0,1fr)',
    render: (r) => (
      <span className="stack">
        <span className="num">
          {r.speedLimitKmh !== null ? t('common.kmh', { value: r.speedLimitKmh }) : t('zoneLists.noLimit')}
        </span>
        <Sync synced={r.limitSynced} status={r.limitCommandStatus} />
      </span>
    ),
  },
  {
    field: 'stopped',
    width: 'minmax(0,1fr)',
    render: (r) => (
      <span className="stack">
        <span>{r.stopped ? t('zoneLists.stopped') : t('zoneLists.notStopped')}</span>
        <Sync synced={r.stopSynced} status={r.stopCommandStatus} />
      </span>
    ),
  },
  { field: 'startedAt', width: '140px', render: (r) => <When at={r.startedAt} seconds /> },
  { field: 'updatedAt', width: '140px', render: (r) => <When at={r.updatedAt} seconds /> },
];

const controlFilters: FilterSpec[] = [
  { field: 'limitSynced', kind: 'boolean' },
  { field: 'stopped', kind: 'boolean' },
  { field: 'stopSynced', kind: 'boolean' },
  { field: 'limitCommandStatus', kind: 'checklist' },
  { field: 'updatedAt', kind: 'dateRange' },
];

export function ZoneControlList() {
  return (
    <ResourceList<ZoneControlListItem & { id: string }>
      resource={zoneControlResource}
      basePath="/admin/strefy/sterowanie"
      title={t('resource.zones.title')}
      columns={controlColumns}
      rowKey={(r) => r.scooterId}
      itemHref={(r) => `/admin/przejazdy/${r.rentalId}`}
      quick={{ field: 'stopped', values: ['true'], pluralKey: 'zoneLists.quick.stopped' }}
      filters={controlFilters}
      rowLabel={(r) => scooterNumber(r.scooterNumber)}
      summary={(data) => t('resource.zone-control.summary', { count: data.total })}
      emptyIcon={<ParkingIcon size={22} />}
      createLabel={null}
      selectable={false}
      tabs={<ZoneTabs />}
      exportColumns={[
        'scooterNumber',
        'rentalNumber',
        'speedLimitKmh',
        'limitSynced',
        'limitCommandStatus',
        'stopped',
        'stopSynced',
        'stopCommandStatus',
        'startedAt',
        'updatedAt',
      ]}
      footer={<ListNote>{t('zoneLists.controlNote')}</ListNote>}
    />
  );
}
