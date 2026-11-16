'use client';

/** Panel filtrów wysuwany z prawej strony (makieta wzorzec-filtry). */
import {
  toSearchParams,
  type FilterValue,
  type ListFilter,
  type ListQuery,
  type ListResponse,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { CloseIcon } from './icons';
import { fieldLabel, valueLabel } from './labels';

export interface FilterSpec {
  field: string;
  /** Lista wartości z licznikami, wybór wielu jako przyciski, zakres liczb lub dat, tak/nie, lista z opcjami. */
  kind: 'checklist' | 'chips' | 'range' | 'dateRange' | 'boolean' | 'select';
  /** Wartości do wyboru; domyślnie z definicji pola (`enum`). */
  options?: ReadonlyArray<{ value: string; label: string }>;
}

interface FilterDrawerProps {
  resource: ResourceDefinition;
  specs: FilterSpec[];
  query: ListQuery;
  facets: ListResponse<unknown>['facets'];
  onApply: (filters: ListFilter[]) => void;
  onClose: () => void;
}

type Draft = Record<string, { eq?: FilterValue[]; gte?: string; lte?: string }>;

function toDraft(filters: ListFilter[]): Draft {
  const draft: Draft = {};
  for (const f of filters) {
    const entry = (draft[f.field] ??= {});
    if (f.op === 'eq') entry.eq = f.values;
    if (f.op === 'gte' || f.op === 'lte')
      entry[f.op] = String(f.values[0]).slice(0, f.field.endsWith('At') ? 10 : undefined);
  }
  return draft;
}

function toFilters(resource: ResourceDefinition, specs: FilterSpec[], draft: Draft): ListFilter[] {
  return specs.flatMap(({ field }): ListFilter[] => {
    const entry = draft[field];
    if (!entry) return [];
    const type = resource.fields[field]?.type;
    const parse = (v: string): FilterValue => (type === 'integer' || type === 'decimal' ? Number(v) : v);
    // Zakres dat obejmuje cały dzień końcowy.
    const until = (v: string) => (type === 'datetime' && v.length === 10 ? `${v}T23:59:59.999Z` : parse(v));
    return [
      ...(entry.eq?.length ? [{ field, op: 'eq' as const, values: entry.eq }] : []),
      ...(entry.gte ? [{ field, op: 'gte' as const, values: [parse(entry.gte)] }] : []),
      ...(entry.lte ? [{ field, op: 'lte' as const, values: [until(entry.lte)] }] : []),
    ];
  });
}

export function FilterDrawer({ resource, specs, query, facets, onApply, onClose }: FilterDrawerProps) {
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(query.filters.filter((f) => specs.some((s) => s.field === f.field))),
  );
  const [count, setCount] = useState<number | null>(null);
  const others = query.filters.filter((f) => !specs.some((s) => s.field === f.field));
  const filters = toFilters(resource, specs, draft);
  const preview = toSearchParams(resource, {
    ...query,
    filters: [...others, ...filters],
    page: 1,
    pageSize: 1,
    facets: [],
  }).toString();

  // Liczba wyników przed zastosowaniem filtrów (przycisk „Pokaż N wyników”).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<ListResponse<unknown>>(`/admin/${resource.name}?${preview}`, { signal: controller.signal })
        .then((r) => setCount(r.total))
        .catch(() => setCount(null));
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [resource.name, preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (field: string, patch: Draft[string]) =>
    setDraft((d) => ({ ...d, [field]: { ...d[field], ...patch } }));
  const toggle = (field: string, value: FilterValue) => {
    // Porównanie po tekście: wartości z adresu bywają liczbami lub wartościami logicznymi, a opcje to tekst.
    const current = draft[field]?.eq ?? [];
    const has = current.some((v) => String(v) === String(value));
    update(field, { eq: has ? current.filter((v) => String(v) !== String(value)) : [...current, value] });
  };
  const optionsOf = (spec: FilterSpec) =>
    spec.options ??
    (resource.fields[spec.field]?.values ?? []).map((v) => ({ value: v, label: valueLabel(resource, spec.field, v) }));

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="filters-title">
        <div className="drawer-head">
          <h2 id="filters-title">{t('list.filtersTitle')}</h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="drawer-body">
          {specs.map((spec) => {
            const label = fieldLabel(resource, spec.field);
            const entry = draft[spec.field] ?? {};
            const isDate = spec.kind === 'dateRange';
            switch (spec.kind) {
              case 'checklist':
                return (
                  <fieldset key={spec.field} className="filter">
                    <legend>{label}</legend>
                    {optionsOf(spec).map(({ value, label: optionLabel }) => (
                      <label key={value} className="check-row">
                        <input
                          type="checkbox"
                          className="cb"
                          checked={entry.eq?.some((v) => String(v) === value) ?? false}
                          onChange={() => toggle(spec.field, value)}
                        />
                        {optionLabel}
                        <span className="n num">{facets[spec.field]?.[value] ?? 0}</span>
                      </label>
                    ))}
                  </fieldset>
                );
              case 'chips':
                return (
                  <fieldset key={spec.field} className="filter">
                    <legend>{label}</legend>
                    <div className="seg">
                      {optionsOf(spec).map(({ value, label: optionLabel }) => (
                        <button
                          key={value}
                          type="button"
                          className="chip"
                          aria-pressed={entry.eq?.some((v) => String(v) === value) ?? false}
                          onClick={() => toggle(spec.field, value)}
                        >
                          {optionLabel}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                );
              case 'boolean':
              case 'select': {
                const options =
                  spec.kind === 'boolean'
                    ? ['true', 'false'].map((v) => ({ value: v, label: valueLabel(resource, spec.field, v) }))
                    : optionsOf(spec);
                return (
                  <fieldset key={spec.field} className="filter">
                    <legend>{label}</legend>
                    <select
                      className="input"
                      value={entry.eq?.length ? String(entry.eq[0]) : ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        update(spec.field, { eq: raw === '' ? [] : [spec.kind === 'boolean' ? raw === 'true' : raw] });
                      }}
                    >
                      <option value="">{t('list.any')}</option>
                      {options.map(({ value, label: optionLabel }) => (
                        <option key={value} value={value}>
                          {optionLabel}
                        </option>
                      ))}
                    </select>
                  </fieldset>
                );
              }
              case 'range':
              case 'dateRange':
                return (
                  <fieldset key={spec.field} className="filter">
                    <legend>{label}</legend>
                    <div className="range">
                      {(['gte', 'lte'] as const).map((op) => (
                        <input
                          key={op}
                          className="input"
                          type={isDate ? 'date' : 'number'}
                          aria-label={`${label}: ${t(op === 'gte' ? 'list.from' : 'list.to')}`}
                          placeholder={t(op === 'gte' ? 'list.from' : 'list.to')}
                          value={entry[op] ?? ''}
                          onChange={(e) => update(spec.field, { [op]: e.target.value || undefined })}
                        />
                      ))}
                    </div>
                  </fieldset>
                );
            }
          })}
        </div>
        <div className="drawer-foot">
          <button type="button" className="btn" onClick={() => setDraft({})}>
            {t('list.clear')}
          </button>
          <button type="button" className="btn primary" onClick={() => onApply(filters)}>
            {count === null ? t('list.filtersTitle') : t('list.apply', { count })}
          </button>
        </div>
      </aside>
    </>
  );
}
