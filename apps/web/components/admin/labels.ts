import type { ListFilter, ResourceDefinition } from '@hulajnogi/shared';
import { t } from '../../lib/i18n';

/** Etykieta pola zasobu: `resource.<zasób>.fields.<pole>` (ADR 0031). */
export const fieldLabel = (resource: ResourceDefinition, field: string) =>
  t.dynamic(`resource.${resource.name}.fields.${field}`);

/** Etykieta wartości: najpierw słownik zasobu, potem wspólny (np. `fleetStatus.AVAILABLE`), na końcu sama wartość. */
export function valueLabel(resource: ResourceDefinition, field: string, value: string | number | boolean): string {
  for (const key of [`resource.${resource.name}.values.${field}.${value}`, `${field}.${value}`]) {
    if (t.has(key)) return t.dynamic(key);
  }
  return String(value);
}

export function filterLabel(resource: ResourceDefinition, filter: ListFilter): string {
  const values = filter.values.map((v) => valueLabel(resource, filter.field, v)).join(', ');
  const prefix = filter.op === 'gte' ? `${t('list.from')} ` : filter.op === 'lte' ? `${t('list.to')} ` : '';
  return `${prefix}${values}`;
}
