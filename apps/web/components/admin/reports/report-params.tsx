'use client';

/**
 * Pasek parametrów raportu (ADR 0071, makiety raport-przychody, raport-strefy-godziny, raport-stany): gotowe zakresy,
 * własny okres w okienku z dwiema datami, granulacja, porównanie z poprzednim okresem i filtry strefy, modelu
 * i hulajnogi według katalogu raportu. Stan jest w adresie URL (`preset`, `from`, `to`, `granularity`, `compare`,
 * `zoneId`, `modelId`, `scooterId`), więc działa „wstecz”, odświeżenie i udostępnienie odnośnika; reguły (366 dni,
 * granulacja dobierana do długości) sprawdza API, a panel pokazuje ich wynik.
 */
import {
  REPORT_GRANULARITIES,
  REPORT_MAX_DAYS,
  REPORT_PRESETS,
  type ListResponse,
  type ReportCatalogItem,
  type ReportGranularity,
  type ReportPreset,
  type ResolvedReportParamsView,
  type ScooterListItem,
  type ScooterModelListItem,
  type ZoneListItem,
} from '@hulajnogi/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { CalendarIcon } from '../icons';
import { formatRangeShort, isWholeMonth, localDate } from './reports-common';

export type ReportFilterKey = 'zoneId' | 'modelId' | 'scooterId';
export type ReportQuery = Partial<
  Record<'preset' | 'from' | 'to' | 'granularity' | 'compare' | ReportFilterKey, string>
>;

const QUERY_KEYS = ['preset', 'from', 'to', 'granularity', 'compare', 'zoneId', 'modelId', 'scooterId'] as const;

/** Parametry z adresu zawężone do tych, które raport przyjmuje (inne dałyby `REPORT_PARAM_NOT_SUPPORTED`). */
export function readReportQuery(search: URLSearchParams, item: ReportCatalogItem | null): ReportQuery {
  const query: ReportQuery = {};
  for (const key of QUERY_KEYS) {
    const value = search.get(key);
    if (!value) continue;
    if (key === 'granularity' && item && !item.params.granularity) continue;
    if (key === 'compare' && item && !item.params.compare) continue;
    if ((key === 'zoneId' || key === 'modelId' || key === 'scooterId') && item && !item.params.filters.includes(key))
      continue;
    query[key] = value;
  }
  return query;
}

/** Parametry bez podanych kluczy. */
export const omitQuery = (query: ReportQuery, keys: ReadonlyArray<keyof ReportQuery>): ReportQuery =>
  Object.fromEntries(Object.entries(query).filter(([key]) => !keys.includes(key as keyof ReportQuery)));

/** Zakres wybrany w adresie (gotowy albo własny); domyślnie bieżący miesiąc jak w core. */
export const queryPreset = (query: ReportQuery): ReportPreset =>
  (query.preset as ReportPreset | undefined) ?? (query.from || query.to ? 'custom' : 'this_month');

/** Data `RRRR-MM-DD` przesunięta o dni. */
export function addDays(date: string, days: number): string {
  const d = localDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dzisiejsza doba polska. */
export const todayWarsaw = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Ostatni dzień miesiąca daty. */
function monthEnd(date: string): string {
  const d = localDate(date);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

/**
 * Podpowiedź przy zbyt długim okresie (plansza raport-stany): ostatnie 366 dni kończące się datą `to` i podział na
 * dwie części, pierwsza do końca miesiąca przed przekroczeniem limitu.
 */
export function rangeSuggestion(from: string, to: string) {
  const shortened = { from: addDays(to, -(REPORT_MAX_DAYS - 1)), to };
  let firstEnd = addDays(from, REPORT_MAX_DAYS - 1);
  if (monthEnd(firstEnd) !== firstEnd) {
    const previousMonthEnd = addDays(`${firstEnd.slice(0, 7)}-01`, -1);
    if (previousMonthEnd >= from) firstEnd = previousMonthEnd;
  }
  const parts =
    firstEnd < to
      ? [
          { from, to: firstEnd },
          { from: addDays(firstEnd, 1), to },
        ]
      : null;
  return { shortened, parts };
}

interface ParamsBarProps {
  item: ReportCatalogItem;
  query: ReportQuery;
  /** Parametry po walidacji z ostatniego podglądu (zakres gotowego okresu, granulacja dobrana automatycznie). */
  resolved: ResolvedReportParamsView | null;
  /** Zakres w adresie jest za długi (czerwone pole dat). */
  rangeError: boolean;
  onChange: (next: ReportQuery) => void;
  /** Otwarcie okienka dat z zewnątrz („Zmień daty” w stanie „Zakres za długi”). */
  datesOpenSignal: number;
  onFilterNames: (names: Partial<Record<ReportFilterKey, string>>) => void;
}

export function ParamsBar({
  item,
  query,
  resolved,
  rangeError,
  onChange,
  datesOpenSignal,
  onFilterNames,
}: ParamsBarProps) {
  const preset = queryPreset(query);
  const [datesOpen, setDatesOpen] = useState(false);
  useEffect(() => {
    if (datesOpenSignal > 0) setDatesOpen(true);
  }, [datesOpenSignal]);

  const from = query.from ?? resolved?.from;
  const to = query.to ?? resolved?.to;
  const rangeText = from && to ? formatRangeShort(from, to) : t.dynamic(`reports.presets.${preset}`);
  const granularity = (query.granularity as ReportGranularity | undefined) ?? resolved?.granularity ?? null;
  const compare = query.compare !== '0' && query.compare !== 'false';

  // Zmiana okresu wraca do granulacji dobranej automatycznie (dzień do 62 dni, tydzień do 182, dalej miesiąc).
  const setRange = (next: ReportQuery) => {
    onChange({ ...omitQuery(query, ['preset', 'from', 'to', 'granularity']), ...next });
  };

  const compareLabel = (() => {
    const f = from;
    const tt = to;
    // Porównanie miesięczne (core wyrównuje do dnia miesiąca): „Porównaj z październikiem”.
    if (resolved?.comparison?.alignment === 'month' && query.compare !== '0')
      return t('reports.params.compareMonth', { month: Number(resolved.comparison.from.slice(5, 7)) });
    if (f && tt && isWholeMonth(f, tt)) {
      const previous = localDate(f);
      previous.setUTCMonth(previous.getUTCMonth() - 1);
      return t('reports.params.compareMonth', { month: previous.getUTCMonth() + 1 });
    }
    return t('reports.params.comparePrevious');
  })();

  return (
    <div className="card rp-params" role="group" aria-label={t('reports.params.label')}>
      <div className="rp-params-row">
        {REPORT_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="rp-chip"
            aria-pressed={preset === p}
            onClick={() => (p === 'custom' ? setDatesOpen(true) : setRange({ preset: p }))}
          >
            {t.dynamic(`reports.presets.${p}`)}
          </button>
        ))}
        <span className="rp-date-anchor">
          <button
            type="button"
            className={rangeError ? 'rp-date error' : 'rp-date'}
            aria-haspopup="dialog"
            aria-expanded={datesOpen}
            aria-label={t('reports.params.dates', { range: rangeText })}
            onClick={() => setDatesOpen((v) => !v)}
          >
            <CalendarIcon size={15} />
            <span className="num">{rangeText}</span>
          </button>
          {datesOpen && (
            <DatesPopover
              initialFrom={from ?? todayWarsaw()}
              initialTo={to ?? todayWarsaw()}
              onApply={(f, tt) => {
                setDatesOpen(false);
                setRange({ from: f, to: tt });
              }}
              onClose={() => setDatesOpen(false)}
            />
          )}
        </span>

        {item.params.granularity && (
          <>
            <span className="rp-vsep" aria-hidden="true" />
            <div className="rp-seg" role="radiogroup" aria-label={t('reports.params.granularity')}>
              {REPORT_GRANULARITIES.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={granularity === g}
                  onClick={() => onChange({ ...query, granularity: g })}
                >
                  {t.dynamic(`reports.granularity.${g}`)}
                </button>
              ))}
            </div>
          </>
        )}

        {item.params.compare && (
          <>
            <span className="rp-vsep" aria-hidden="true" />
            <label className="rp-switch">
              <input
                type="checkbox"
                role="switch"
                checked={compare}
                onChange={(e) => {
                  const rest = omitQuery(query, ['compare']);
                  onChange(e.target.checked ? rest : { ...rest, compare: '0' });
                }}
              />
              <span className="rp-switch-track" aria-hidden="true" />
              {compareLabel}
            </label>
          </>
        )}

        {item.params.filters.length > 0 && <span className="rp-vsep" aria-hidden="true" />}
        <ReportFilters item={item} query={query} onChange={onChange} onNames={onFilterNames} />
      </div>
    </div>
  );
}

/** Okienko własnego okresu: dwie daty (najwyżej dziś); długość sprawdza API (`REPORT_RANGE_TOO_LONG`). */
function DatesPopover({
  initialFrom,
  initialTo,
  onApply,
  onClose,
}: {
  initialFrom: string;
  initialTo: string;
  onApply: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const today = todayWarsaw();
  const invalid = !from || !to || to < from;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) onApply(from, to);
  };
  return (
    <form ref={ref} className="rp-popover" role="dialog" aria-label={t('reports.params.customTitle')} onSubmit={submit}>
      <span className="label">{t('reports.params.customTitle')}</span>
      <div className="rp-dates">
        <label className="field">
          <span className="small">{t('reports.params.from')}</span>
          <input className="input" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="small">{t('reports.params.to')}</span>
          <input className="input" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <span className="small">{t('reports.params.customHint', { days: REPORT_MAX_DAYS })}</span>
      {from && to && to < from && <span className="err">{t('reports.params.customInvalid')}</span>}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={invalid}>
          {t('reports.params.apply')}
        </button>
      </div>
    </form>
  );
}

interface Option {
  id: string;
  label: string;
}

/** Wszystkie strony listy (filtry raportu: strefy, modele, hulajnogi; najwyżej 500 pozycji). */
async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await api<ListResponse<T>>(`${path}${path.includes('?') ? '&' : '?'}pageSize=100&page=${page}`);
    items.push(...res.items);
    if (items.length >= res.total) break;
  }
  return items;
}

/** Filtry raportu jako pola wyboru „Strefa: wszystkie”; listy według uprawnień operatora (bez nich filtra nie ma). */
function ReportFilters({
  item,
  query,
  onChange,
  onNames,
}: {
  item: ReportCatalogItem;
  query: ReportQuery;
  onChange: (next: ReportQuery) => void;
  onNames: (names: Partial<Record<ReportFilterKey, string>>) => void;
}) {
  const { can } = useSession();
  const [options, setOptions] = useState<Partial<Record<ReportFilterKey, Option[]>>>({});
  const wanted = item.params.filters.join(',');

  useEffect(() => {
    let current = true;
    const filters = wanted ? (wanted.split(',') as ReportFilterKey[]) : [];
    const loaders = filters.map(async (filter): Promise<[ReportFilterKey, Option[]] | null> => {
      try {
        if (filter === 'zoneId' && can('zones.read')) {
          const zones = await allPages<ZoneListItem>('/admin/zones?sort=code');
          return [filter, zones.map((z) => ({ id: z.id, label: `${z.code} ${z.name}` }))];
        }
        if (filter === 'modelId' && can('scooters.read')) {
          const models = await allPages<ScooterModelListItem>('/admin/scooter-models?sort=name');
          return [filter, models.map((m) => ({ id: m.id, label: m.name }))];
        }
        if (filter === 'scooterId' && can('scooters.read')) {
          const scooters = await allPages<ScooterListItem>('/admin/scooters?sort=number');
          return [
            filter,
            scooters.map((s) => ({
              id: s.id,
              label: t('reports.params.scooterOption', {
                number: String(s.number).padStart(4, '0'),
                model: s.modelName,
              }),
            })),
          ];
        }
      } catch {
        return null;
      }
      return null;
    });
    void Promise.all(loaders).then((results) => {
      if (!current) return;
      setOptions(Object.fromEntries(results.filter((r) => r !== null)));
    });
    return () => {
      current = false;
    };
  }, [wanted, can]);

  // Nazwy wybranych filtrów do opisu parametrów w oknie eksportu.
  const names = JSON.stringify(
    Object.fromEntries(
      (['zoneId', 'modelId', 'scooterId'] as const).flatMap((f) => {
        const label = options[f]?.find((o) => o.id === query[f])?.label;
        return label ? [[f, label]] : [];
      }),
    ),
  );
  useEffect(() => onNames(JSON.parse(names) as Partial<Record<ReportFilterKey, string>>), [names, onNames]);

  return (
    <>
      {item.params.filters.map((filter) => {
        const list = options[filter];
        if (!list) return null;
        return (
          <label key={filter} className="rp-select">
            <span className="muted">{t.dynamic(`reports.params.filters.${filter}`)}</span>
            <select
              value={query[filter] ?? ''}
              onChange={(e) => {
                const rest = omitQuery(query, [filter]);
                onChange(e.target.value ? { ...rest, [filter]: e.target.value } : rest);
              }}
            >
              <option value="">{t.dynamic(`reports.params.filtersAll.${filter}`)}</option>
              {list.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </>
  );
}
