'use client';

/** Zasób `scooter-models` w panelu: słownik modeli hulajnóg na wspólnym wzorcu (ADR 0031). */
import { scooterModelsResource, type ScooterModelDetails, type ScooterModelListItem } from '@hulajnogi/shared';
import { formatDate, formatDateTime, t } from '../../../lib/i18n';
import type { FilterSpec } from '../filter-drawer';
import { ScooterIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceForm, type FormFieldSpec } from '../resource-form';
import { ResourceList, type Column } from '../resource-list';

const BASE = '/admin/modele';
const none = () => <span className="muted">{t('common.none')}</span>;
const num = (value: number | null, key: 'common.km' | 'common.kmh' | 'common.wh' | 'common.kg') =>
  value === null ? none() : <span className="num">{t(key, { value })}</span>;

const columns: Column<ScooterModelListItem>[] = [
  { field: 'code', width: '100px' },
  { field: 'name', width: '1.4fr' },
  { field: 'manufacturer', width: '1fr', render: (m) => m.manufacturer ?? none() },
  { field: 'rangeKm', width: '90px', render: (m) => num(m.rangeKm, 'common.km') },
  { field: 'maxSpeedKmh', width: '110px', render: (m) => num(m.maxSpeedKmh, 'common.kmh') },
  { field: 'batteryWh', width: '90px', render: (m) => num(m.batteryWh, 'common.wh') },
  { field: 'weightKg', width: '80px', render: (m) => num(m.weightKg, 'common.kg') },
  {
    field: 'scootersTotal',
    width: '90px',
    render: (m) => (
      <span className="num">
        {t('resource.scooter-models.scooters', { active: m.scootersActive, total: m.scootersTotal })}
      </span>
    ),
  },
  {
    field: 'active',
    width: '100px',
    render: (m) => (
      <span className={m.active ? 'pill' : 'pill muted'}>{valueLabel(scooterModelsResource, 'active', m.active)}</span>
    ),
  },
  { field: 'updatedAt', width: '80px', render: (m) => formatDate(m.updatedAt) },
];

const filters: FilterSpec[] = [
  {
    field: 'active',
    kind: 'checklist',
    options: ['true', 'false'].map((v) => ({ value: v, label: valueLabel(scooterModelsResource, 'active', v) })),
  },
  { field: 'rangeKm', kind: 'range' },
  { field: 'maxSpeedKmh', kind: 'range' },
  { field: 'weightKg', kind: 'range' },
  { field: 'scootersActive', kind: 'range' },
  { field: 'updatedAt', kind: 'dateRange' },
];

export function ScooterModelList() {
  return (
    <ResourceList<ScooterModelListItem>
      resource={scooterModelsResource}
      basePath={BASE}
      columns={columns}
      filters={filters}
      rowLabel={(m) => m.code}
      summary={(data) => t('resource.scooter-models.summary', { count: data.total })}
      emptyIcon={<ScooterIcon size={22} />}
    />
  );
}

const fields: FormFieldSpec[] = [
  { name: 'code', kind: 'text', hint: true },
  { name: 'name', kind: 'text' },
  { name: 'manufacturer', kind: 'text', optional: true },
  { name: 'rangeKm', kind: 'integer', optional: true, hint: true },
  { name: 'maxSpeedKmh', kind: 'integer', optional: true },
  { name: 'batteryWh', kind: 'integer', optional: true },
  { name: 'weightKg', kind: 'decimal', optional: true, hint: true },
  { name: 'active', kind: 'toggle', hint: true },
  { name: 'description', kind: 'textarea', optional: true },
];

export function ScooterModelForm({ id }: { id?: string }) {
  return (
    <ResourceForm<ScooterModelDetails>
      resource={scooterModelsResource}
      basePath={BASE}
      id={id}
      fields={fields}
      defaults={{
        code: '',
        name: '',
        manufacturer: '',
        rangeKm: '',
        maxSpeedKmh: '',
        batteryWh: '',
        weightKg: '',
        active: true,
        description: '',
      }}
      title={(m) =>
        m ? t('resource.scooter-models.editTitle', { code: m.code }) : t('resource.scooter-models.newTitle')
      }
      recordLabel={(m) => m.code}
      aside={(m) => (
        <div className="card side-card">
          <h2>{t('resource.scooter-models.fields.scootersTotal')}</h2>
          <p className="num">
            {t('resource.scooter-models.scooters', { active: m.scootersActive, total: m.scootersTotal })}
          </p>
          <p>{t('form.createdAt', { date: formatDateTime(m.createdAt) })}</p>
        </div>
      )}
    />
  );
}
