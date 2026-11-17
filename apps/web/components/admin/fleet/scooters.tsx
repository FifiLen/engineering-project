'use client';

/** Zasób `scooters` w panelu: lista (makieta Flota) i formularz na wspólnym wzorcu (ADR 0031). */
import {
  OPERATOR_STATUSES,
  scooterModelsResource,
  scootersResource,
  type ListResponse,
  type ScooterDetails,
  type ScooterListItem,
  type ScooterModelListItem,
} from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatKm, formatRelative, t } from '../../../lib/i18n';
import type { FilterSpec } from '../filter-drawer';
import { ScooterIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceForm, type FormFieldSpec } from '../resource-form';
import { ResourceList, type Column } from '../resource-list';
import { Battery, RentalLink, scooterNumber, StatusPill } from './fleet-format';

const BASE = '/admin/flota';

function location(s: ScooterListItem): string {
  if (s.fleetStatus === 'IN_USE') return t('resource.scooters.inTransit');
  if (!s.parkingZoneCode) return t('resource.scooters.outsideZone');
  return t('resource.scooters.zoneLabel', { code: s.parkingZoneCode, name: s.parkingZoneName ?? '' });
}

const columns: Column<ScooterListItem>[] = [
  { field: 'number', width: '80px', render: (s) => scooterNumber(s.number) },
  { field: 'variant', width: '80px', render: (s) => valueLabel(scootersResource, 'variant', s.variant) },
  { field: 'fleetStatus', width: '130px', render: (s) => <StatusPill status={s.fleetStatus} /> },
  {
    field: 'batteryPct',
    width: '120px',
    render: (s) => <Battery pct={s.batteryPct} low={s.fleetStatus === 'LOW_BATTERY'} />,
  },
  { field: 'parkingZoneName', width: '1.4fr', render: location },
  { field: 'lastSeenAt', width: '120px', render: (s) => formatRelative(s.lastSeenAt) },
  { field: 'rentals30d', width: '120px', render: (s) => <span className="num">{s.rentals30d}</span> },
  { field: 'odometerM', width: '100px', render: (s) => <span className="num">{formatKm(s.odometerM)}</span> },
];

const filters: FilterSpec[] = [
  { field: 'fleetStatus', kind: 'checklist' },
  { field: 'variant', kind: 'chips' },
  { field: 'parkingZoneCode', kind: 'checklist', options: [] },
  { field: 'batteryPct', kind: 'range' },
  { field: 'lastSeenAt', kind: 'dateRange' },
  { field: 'online', kind: 'boolean' },
];

/**
 * Stan całej floty bez filtrów: liczba hulajnóg do podtytułu i strefy parkowania do filtra (tylko strefy,
 * w których stoją hulajnogi, z liczników listy).
 */
function useFleetOverview(): { specs: FilterSpec[]; total: number | null } {
  const [overview, setOverview] = useState<{ zones: string[]; total: number | null }>({ zones: [], total: null });
  useEffect(() => {
    api<ListResponse<ScooterListItem>>('/admin/scooters?pageSize=1&facets=parkingZoneCode')
      .then((r) =>
        setOverview({
          zones: Object.keys(r.facets.parkingZoneCode ?? {})
            .filter((z) => z !== 'null')
            .sort(),
          total: r.total,
        }),
      )
      .catch(() => setOverview({ zones: [], total: null }));
  }, []);
  const specs = filters.map((f) =>
    f.field === 'parkingZoneCode' ? { ...f, options: overview.zones.map((z) => ({ value: z, label: z })) } : f,
  );
  return { specs, total: overview.total };
}

export function ScooterList() {
  const { specs, total } = useFleetOverview();
  return (
    <ResourceList<ScooterListItem>
      resource={scootersResource}
      basePath={BASE}
      columns={columns}
      quick={{
        field: 'fleetStatus',
        values: ['AVAILABLE', 'IN_USE', 'LOW_BATTERY', 'MAINTENANCE', 'OFFLINE'],
        pluralKey: 'fleetStatusPlural',
      }}
      filters={specs}
      rowLabel={(s) => scooterNumber(s.number)}
      summary={(data) => t('resource.scooters.summary', { count: total ?? data.total })}
      emptyIcon={<ScooterIcon size={22} />}
    />
  );
}

function useModelOptions() {
  const [models, setModels] = useState<ScooterModelListItem[]>([]);
  useEffect(() => {
    api<ListResponse<ScooterModelListItem>>('/admin/scooter-models?pageSize=100&sort=name')
      .then((r) => setModels(r.items))
      .catch(() => setModels([]));
  }, []);
  return models;
}

const statusOption = (s: string) => ({ value: s, label: valueLabel(scootersResource, 'status', s) });

export function ScooterForm({ id }: { id?: string }) {
  const models = useModelOptions();
  const fields: FormFieldSpec[] = [
    { name: 'number', kind: 'integer', createOnly: true, hint: true },
    { name: 'serialNumber', kind: 'text', hint: true },
    {
      name: 'modelId',
      kind: 'select',
      // Przy edycji widać też model wycofany z oferty (bieżący model hulajnogi); nowe przypisanie tylko do modelu w ofercie.
      options: models.map((m) => ({
        value: m.id,
        label: m.active
          ? m.name
          : t('resource.scooter-models.archivedOption', {
              name: m.name,
              state: valueLabel(scooterModelsResource, 'active', false),
            }),
      })),
      createOptions: models.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name })),
    },
    { name: 'variant', kind: 'chips' },
    {
      name: 'status',
      kind: 'chips',
      options: OPERATOR_STATUSES.map(statusOption),
      createOptions: ['AVAILABLE', 'MAINTENANCE'].map(statusOption),
      hint: true,
    },
    { name: 'firmware', kind: 'text', optional: true },
  ];
  return (
    <ResourceForm<ScooterDetails>
      resource={scootersResource}
      basePath={BASE}
      id={id}
      fields={fields}
      defaults={{ number: '', serialNumber: '', modelId: '', variant: 'GRAFIT', status: 'MAINTENANCE', firmware: '' }}
      title={(s) =>
        s
          ? t('resource.scooters.editTitle', { number: String(s.number).padStart(4, '0') })
          : t('resource.scooters.newTitle')
      }
      recordLabel={(s) => scooterNumber(s.number)}
      aside={(s) => (
        <div className="card side-card">
          <h2>{scooterNumber(s.number)}</h2>
          <StatusPill status={s.fleetStatus} />
          <dl style={{ margin: 0 }}>
            <div className="kv">
              <dt>{t('map.battery')}</dt>
              <dd>
                <Battery pct={s.batteryPct} low={s.fleetStatus === 'LOW_BATTERY'} />
              </dd>
            </div>
            <div className="kv">
              <dt>{t('map.lastSignal')}</dt>
              <dd>{formatRelative(s.lastSeenAt)}</dd>
            </div>
            <div className="kv">
              <dt>{t('map.odometer')}</dt>
              <dd className="num">{formatKm(s.odometerM)}</dd>
            </div>
            <div className="kv">
              <dt>{t('map.currentRental')}</dt>
              <dd className="num">
                <RentalLink id={s.rentalId} number={s.rentalNumber} />
              </dd>
            </div>
          </dl>
        </div>
      )}
    />
  );
}
