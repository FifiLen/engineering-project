'use client';

/**
 * Flota → Komendy (ADR 0076, makieta flota-komendy): komendy MQTT wszystkich hulajnóg z typem, źródłem (operator,
 * przejazd, strefa, system), czasem potwierdzenia i stanem; lista tylko do odczytu z `scooters.read` (wysyłka zostaje
 * na karcie hulajnogi z `scooters.command`). Te same kolumny pokazuje zakładka „Komendy” na karcie hulajnogi.
 */
import {
  COMMAND_STATUSES,
  scooterCommandsResource,
  type ScooterCommandListItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { t } from '../../../lib/i18n';
import { FleetTabs, useFleetSubtitle } from '../areas';
import type { FilterSpec } from '../filter-drawer';
import { ListIcon } from '../icons';
import { InlineList } from '../inline-list';
import { valueLabel } from '../labels';
import { afterText, ListNote, When } from '../list-format';
import { ResourceList, type Column } from '../resource-list';
import { rentalNumber, scooterNumber } from './fleet-format';

const STATUS_PILL: Record<string, string> = {
  SENT: 'pill accent',
  ACKED: 'pill accent',
  REJECTED: 'pill warn',
  TIMEOUT: 'pill danger',
};

const label = (field: string, value: string) => valueLabel(scooterCommandsResource, field, value);

/** Źródło z drugą linią: strefa z kodem, operator albo przejazd klienta. */
function Source({ c }: { c: ScooterCommandListItem }) {
  const detail =
    c.source === 'ZONE'
      ? [c.zoneCode, c.zoneName].filter(Boolean).join(' ')
      : c.source === 'STAFF'
        ? c.staffName
        : c.source === 'RENTAL'
          ? t('fleetLists.commands.byRental')
          : t('fleetLists.commands.bySystem');
  return (
    <span className="stack">
      <span>{label('source', c.source)}</span>
      {detail && <small>{detail}</small>}
    </span>
  );
}

function Status({ c }: { c: ScooterCommandListItem }) {
  if (c.status === 'SENT')
    return <span className="live">{t('fleetLists.commands.sent')}</span>;
  return (
    <span className="stack">
      <span className={STATUS_PILL[c.status]}>{label('status', c.status)}</span>
      {c.ackReason && <small className="code">{c.ackReason}</small>}
    </span>
  );
}

const typeCell = (c: ScooterCommandListItem) => <span className="strong">{label('type', c.type)}</span>;
const sentCell = (c: ScooterCommandListItem) => <When at={c.sentAt} seconds />;
const ackCell = (c: ScooterCommandListItem) =>
  c.ackedAt ? (
    <When at={c.ackedAt} seconds sub={c.responseMs !== null ? afterText(c.responseMs) : undefined} />
  ) : (
    <span className="muted">{t('common.none')}</span>
  );
const rentalCell = (c: ScooterCommandListItem) =>
  c.rentalId && c.rentalNumber !== null ? (
    <Link href={`/admin/przejazdy/${c.rentalId}`} className="link num">
      {rentalNumber(c.rentalNumber)}
    </Link>
  ) : (
    <span className="muted">{t('common.none')}</span>
  );

const columns: Column<ScooterCommandListItem>[] = [
  { field: 'scooterNumber', width: '84px', render: (c) => <span className="link num">{scooterNumber(c.scooterNumber)}</span> },
  { field: 'type', width: 'minmax(0,1.1fr)', render: typeCell },
  { field: 'source', width: 'minmax(0,1.4fr)', render: (c) => <Source c={c} /> },
  { field: 'sentAt', width: '110px', render: sentCell },
  { field: 'ackedAt', width: '130px', render: ackCell },
  { field: 'expiresAt', width: '100px', render: (c) => <When at={c.expiresAt} seconds /> },
  { field: 'status', width: '150px', render: (c) => <Status c={c} /> },
  { field: 'rentalNumber', width: '96px', render: rentalCell },
];

const filters: FilterSpec[] = [
  { field: 'status', kind: 'checklist' },
  { field: 'type', kind: 'checklist' },
  { field: 'source', kind: 'checklist' },
  { field: 'sentAt', kind: 'dateRange' },
  { field: 'responseMs', kind: 'range' },
];

const EXPORT = [
  'scooterNumber',
  'type',
  'source',
  'zoneCode',
  'staffName',
  'sentAt',
  'ackedAt',
  'expiresAt',
  'responseMs',
  'status',
  'ackReason',
  'rentalNumber',
] as const;

export function CommandList() {
  const subtitle = useFleetSubtitle();
  return (
    <ResourceList<ScooterCommandListItem>
      resource={scooterCommandsResource}
      basePath="/admin/flota/komendy"
      title={t('resource.scooters.title')}
      columns={columns}
      itemHref={(c) => `/admin/flota/${c.scooterId}?tab=komendy`}
      quick={{ field: 'status', values: COMMAND_STATUSES, pluralKey: 'fleetLists.commands.quick' }}
      filters={filters}
      rowLabel={(c) => `${scooterNumber(c.scooterNumber)} ${label('type', c.type)}`}
      summary={(data) => subtitle ?? t('resource.scooter-commands.summary', { count: data.total })}
      emptyIcon={<ListIcon size={22} />}
      createLabel={null}
      selectable={false}
      tabs={<FleetTabs />}
      exportColumns={EXPORT}
      footer={<ListNote>{t('fleetLists.commands.note')}</ListNote>}
    />
  );
}

/** Karta hulajnogi → Komendy: te same kolumny bez hulajnogi, stały filtr `scooterId`. */
export function ScooterCommandsTab({ scooterId, revision }: { scooterId: string; revision?: number }) {
  return (
    <InlineList<ScooterCommandListItem>
      resource={scooterCommandsResource}
      columns={columns.slice(1)}
      fixed={[{ field: 'scooterId', op: 'eq', values: [scooterId] }]}
      filters={filters}
      title={t('fleetLists.commands.cardTitle')}
      rowKey={(c) => c.id}
      emptyText={t('fleetLists.commands.cardEmpty')}
      revision={revision}
      exportColumns={EXPORT}
    />
  );
}
