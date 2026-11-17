/**
 * Pola wersji cennika (ADR 0053, D6: bez limitu strefy): sekcje, jednostki, formatowanie i walidacja
 * wartości wpisanych w formularzu (te same zakresy co reguła w core; ostatecznie decyduje API).
 */
import { formatPln, type NewTariff, type TariffVersionItem } from '@hulajnogi/shared';
import { t } from '../../../lib/i18n';
import { parseZloty, zlotyInput } from '../payments/payment-format';

export type TariffField = Exclude<keyof NewTariff, 'validFrom'>;
type Kind = 'money' | 'minutes' | 'percent' | 'years' | 'vat';

interface FieldSpec {
  field: TariffField;
  kind: Kind;
  min?: number;
  max?: number;
}

/** Kwoty w groszach: najwyżej 10 000 zł, jak w schemacie nowej wersji. */
const MONEY_MAX = 1_000_000;

export const TARIFF_SECTIONS: Array<{ key: 'fees' | 'reservation' | 'safety'; fields: FieldSpec[] }> = [
  {
    key: 'fees',
    fields: [
      { field: 'unlockFee', kind: 'money' },
      { field: 'minuteRate', kind: 'money' },
      { field: 'pauseMinuteRate', kind: 'money' },
      { field: 'outOfZoneFee', kind: 'money' },
    ],
  },
  {
    key: 'reservation',
    fields: [
      { field: 'freeReservationMinutes', kind: 'minutes', min: 0, max: 60 },
      { field: 'minWalletBalance', kind: 'money' },
    ],
  },
  {
    key: 'safety',
    fields: [
      { field: 'minBatteryPct', kind: 'percent', min: 0, max: 100 },
      { field: 'minUserAge', kind: 'years', min: 13, max: 99 },
    ],
  },
];

/** VAT jest w formularzu i porównaniu, a w szczegółach w stopce karty (makieta cennik-wersje). */
export const VAT_FIELD: FieldSpec = { field: 'vatRate', kind: 'vat', min: 0, max: 99.99 };
export const ALL_FIELDS: FieldSpec[] = [...TARIFF_SECTIONS.flatMap((s) => s.fields), VAT_FIELD];

export const fieldLabel = (field: TariffField) => t.dynamic(`resource.tariffs.fields.${field}`);

/** Wartość w jednostce pola: „3,00 zł”, „10 min”, „15 %”, „18 lat”, „23%”. */
export function formatValue(spec: FieldSpec, value: number): string {
  switch (spec.kind) {
    case 'money':
      return formatPln(value);
    case 'minutes':
      return t('tariffs.units.minutes', { value });
    case 'percent':
      return t('tariffs.units.percent', { value });
    case 'years':
      return t('tariffs.units.years', { value });
    case 'vat':
      return t('tariffs.units.vat', { value });
  }
}

export const unitSuffix = (spec: FieldSpec) => t.dynamic(`tariffs.suffix.${spec.kind}`);

/** Wartość wersji jako tekst pola formularza. */
export function toInput(spec: FieldSpec, value: number): string {
  if (spec.kind === 'money') return zlotyInput(value);
  if (spec.kind === 'vat') return String(value).replace('.', ',');
  return String(value);
}

/** Tekst pola jako wartość do API albo komunikat błędu przy polu. */
export function parseInput(spec: FieldSpec, raw: string): { value: number } | { error: string } {
  const text = raw.trim();
  if (spec.kind === 'money') {
    const grosze = parseZloty(text);
    if (grosze === null || grosze > MONEY_MAX) return { error: t('tariffs.errors.money') };
    return { value: grosze };
  }
  const range = () =>
    t('tariffs.errors.range', {
      min: String(spec.min).replace('.', ','),
      max: String(spec.max).replace('.', ','),
      unit: unitSuffix(spec),
    });
  if (spec.kind === 'vat') {
    if (!/^\d{1,2}([.,]\d{1,2})?$/.test(text)) return { error: range() };
    return { value: Number(text.replace(',', '.')) };
  }
  if (!/^\d+$/.test(text)) return { error: range() };
  const value = Number(text);
  if (value < (spec.min ?? 0) || value > (spec.max ?? Number.MAX_SAFE_INTEGER)) return { error: range() };
  return { value };
}

export const valueOf = (tariff: TariffVersionItem, field: TariffField) => tariff[field];
