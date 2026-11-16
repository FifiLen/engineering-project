'use client';

/**
 * Wspólny widok tabeli w panelu (ADR 0031, makiety 17-panel-wzorce): wyszukiwarka, szybkie filtry
 * z licznikami, panel filtrów, sortowanie w nagłówkach, stronicowanie, zaznaczanie i operacje grupowe.
 * Stan listy jest w adresie URL, więc działa „wstecz”, odświeżenie i udostępnienie odnośnika.
 */
import {
  PAGE_SIZES,
  parseListQuery,
  toSearchParams,
  type ListFilter,
  type ListQuery,
  type ListResponse,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { ConfirmDialog } from './confirm-dialog';
import { FilterDrawer, type FilterSpec } from './filter-drawer';
import { AlertIcon, ArrowDown, ArrowUp, CloseIcon, FilterIcon, PlusIcon, SearchIcon } from './icons';
import { fieldLabel, filterLabel, valueLabel } from './labels';

export interface Column<T> {
  field: string;
  /** Szerokość w siatce CSS, np. `90px` albo `1.2fr`. */
  width: string;
  render?: (item: T) => ReactNode;
}

export interface ResourceListProps<T extends { id: string; version: number }> {
  resource: ResourceDefinition;
  basePath: string;
  columns: Column<T>[];
  /** Szybkie filtry nad tabelą: pole z licznikami (`facets`) i kolejność wartości. */
  quick?: { field: string; values: readonly string[]; pluralKey?: string };
  filters: FilterSpec[];
  rowLabel: (item: T) => string;
  summary?: (data: ListResponse<T>) => string;
  emptyIcon: ReactNode;
}

type LoadState<T> =
  { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; data: ListResponse<T> };

const EMPTY: ListQuery = { filters: [], sort: [], page: 1, pageSize: 25, facets: [] };

export function ResourceList<T extends { id: string; version: number }>(props: ResourceListProps<T>) {
  const { resource, basePath, columns, quick, filters, rowLabel, summary, emptyIcon } = props;
  const router = useRouter();
  // Panel ukrywa operacje bez uprawnień; decyzję podejmuje API (ADR 0028).
  const { can } = useSession();
  const canWrite = can(resource.permissions.write);
  const canDelete = resource.deleteMode !== 'none' && can(resource.permissions.delete ?? resource.permissions.write);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => {
    // Adres poprawiony ręcznie na niepoprawny: lista wraca do ustawień domyślnych.
    const parsed = parseListQuery(resource, searchParams);
    if (parsed.ok) return parsed.query;
    const fallback = parseListQuery(resource, {});
    return fallback.ok ? fallback.query : EMPTY;
  }, [resource, searchParams]);

  const facetFields = useMemo(
    () => [
      ...new Set([
        ...(quick ? [quick.field] : []),
        ...filters.filter((f) => f.kind === 'checklist').map((f) => f.field),
      ]),
    ],
    [quick, filters],
  );
  const requestParams = toSearchParams(resource, { ...query, facets: facetFields }).toString();

  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState(query.q ?? '');

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    api<ListResponse<T>>(`/admin/${resource.name}?${requestParams}`, { signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') {
          setState({ status: 'error', code: error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR' });
        }
      });
    setSelected(new Set());
    return () => controller.abort();
  }, [resource.name, requestParams, reload]);

  const navigate = useCallback(
    (next: Partial<ListQuery>) => {
      const params = toSearchParams(resource, { ...query, page: 1, ...next, facets: [] });
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    },
    [query, resource, pathname, router],
  );

  // Wyszukiwanie po krótkiej przerwie w pisaniu.
  useEffect(() => {
    if ((query.q ?? '') === search.trim()) return;
    const timer = setTimeout(() => navigate({ q: search.trim() || undefined }), 300);
    return () => clearTimeout(timer);
  }, [search, query.q, navigate]);

  // Szybki filtr to filtr pola z licznikami z jedną wartością z listy przycisków; inne filtry tego pola
  // (np. kilka statusów wybranych w panelu filtrów) są widoczne jako etykiety.
  const quickFilter = quick
    ? query.filters.find(
        (f) =>
          f.field === quick.field &&
          f.op === 'eq' &&
          f.values.length === 1 &&
          quick.values.includes(String(f.values[0])),
      )
    : undefined;
  const otherFilters = query.filters.filter((f) => f !== quickFilter);
  const setQuick = (value: string | null) =>
    navigate({
      filters: [
        ...query.filters.filter((f) => f.field !== quick?.field),
        ...(value && quick ? [{ field: quick.field, op: 'eq' as const, values: [value] }] : []),
      ],
    });
  const removeFilter = (filter: ListFilter) => navigate({ filters: query.filters.filter((f) => f !== filter) });

  const toggleSort = (field: string) => {
    const current = query.sort[0];
    const sort = current?.field !== field ? [{ field, desc: false }] : current.desc ? [] : [{ field, desc: true }];
    navigate({ sort: sort.length ? sort : undefined, page: query.page });
  };

  const data = state.status === 'ready' ? state.data : null;
  const items = data?.items ?? [];
  const grid = `28px ${columns.map((c) => c.width).join(' ')}`;
  const hasFilters = query.filters.length > 0 || Boolean(query.q);
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const someSelected = items.some((i) => selected.has(i.id));
  const facetCounts = quick && data?.facets[quick.field];
  const totalAll = facetCounts ? Object.values(facetCounts).reduce((a, b) => a + b, 0) : undefined;

  const bulkRemove = async () => {
    setConfirm(false);
    const targets = items.filter((i) => selected.has(i.id));
    const results = await Promise.allSettled(
      targets.map((i) => api(`/admin/${resource.name}/${i.id}?version=${i.version}`, { method: 'DELETE' })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setNotice(t('list.bulkDone', { done: targets.length - failed, count: targets.length, failed }));
    setReload((n) => n + 1);
  };

  const sortInfo = query.sort[0];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pages || Math.abs(p - query.page) <= 1,
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.dynamic(`resource.${resource.name}.title`)}</h1>
          {data && summary && <div className="sub">{summary(data)}</div>}
        </div>
        <div className="actions">
          {canWrite && (
            <Link className="btn primary" href={`${basePath}/nowy`}>
              <PlusIcon />
              {t.dynamic(`resource.${resource.name}.new`)}
            </Link>
          )}
        </div>
      </div>

      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <span className="visually-hidden">{t('list.search')}</span>
          <input
            type="search"
            value={search}
            placeholder={t.dynamic(`resource.${resource.name}.searchPlaceholder`)}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {quick && (
          <>
            <button type="button" className="chip" aria-pressed={!quickFilter} onClick={() => setQuick(null)}>
              {t('common.all')}
              {totalAll !== undefined && <span className="n num">{totalAll}</span>}
            </button>
            {quick.values.map((value) => (
              <button
                key={value}
                type="button"
                className="chip"
                aria-pressed={quickFilter?.values.length === 1 && quickFilter.values[0] === value}
                onClick={() => setQuick(value)}
              >
                {quick.pluralKey ? t.dynamic(`${quick.pluralKey}.${value}`) : valueLabel(resource, quick.field, value)}
                <span className="n num">{facetCounts?.[value] ?? 0}</span>
              </button>
            ))}
          </>
        )}
        <span className="spacer" />
        <button type="button" className={otherFilters.length ? 'btn dark' : 'btn'} onClick={() => setDrawer(true)}>
          <FilterIcon />
          {t('list.filters')}
          {otherFilters.length > 0 && <span className="num">{otherFilters.length}</span>}
        </button>
      </div>

      {(otherFilters.length > 0 || data) && (
        <div className="tags">
          {otherFilters.map((filter) => (
            <span key={`${filter.field}.${filter.op}`} className="tag">
              <span>
                {fieldLabel(resource, filter.field)}
                {': '}
                <b>{filterLabel(resource, filter)}</b>
              </span>
              <button
                type="button"
                aria-label={t('list.removeFilter', { label: fieldLabel(resource, filter.field) })}
                onClick={() => removeFilter(filter)}
              >
                <CloseIcon size={14} />
              </button>
            </span>
          ))}
          {otherFilters.length > 0 && (
            <button
              type="button"
              className="link"
              onClick={() => navigate({ filters: quickFilter ? [quickFilter] : [] })}
            >
              {t('list.clearFilters')}
            </button>
          )}
          {data && (
            <span className="summary">
              {t('list.results', { count: data.total })}
              {sortInfo &&
                ` · ${t('list.sortedBy', { field: fieldLabel(resource, sortInfo.field).toLowerCase(), direction: t(sortInfo.desc ? 'list.descending' : 'list.ascending') })}`}
            </span>
          )}
        </div>
      )}

      {notice && (
        <div className="banner ok" role="status">
          <span>{notice}</span>
          <div className="actions">
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setNotice(null)}>
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      <div className="card" aria-busy={state.status === 'loading'}>
        <div className="table" role="table" aria-rowcount={data?.total}>
          <div className="row head" role="row" style={{ gridTemplateColumns: grid }}>
            <span role="columnheader">
              {canDelete && (
              <input
                type="checkbox"
                className="cb"
                aria-label={t('list.selectAll')}
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
              />
              )}
            </span>
            {columns.map(({ field }) => {
              const sortable = resource.fields[field]?.sortable;
              const active = sortInfo?.field === field;
              return (
                <span
                  key={field}
                  role="columnheader"
                  aria-sort={active ? (sortInfo.desc ? 'descending' : 'ascending') : sortable ? 'none' : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={active ? 'th-sort active' : 'th-sort'}
                      onClick={() => toggleSort(field)}
                      aria-label={t('list.sortBy', { field: fieldLabel(resource, field) })}
                    >
                      {fieldLabel(resource, field)}
                      {active && (sortInfo.desc ? <ArrowDown /> : <ArrowUp />)}
                    </button>
                  ) : (
                    fieldLabel(resource, field)
                  )}
                </span>
              );
            })}
          </div>

          {state.status === 'loading' &&
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="row" role="row" style={{ gridTemplateColumns: grid }}>
                {[28, ...columns.map(() => 0)].map((w, j) => (
                  <span key={j}>
                    <i className="skeleton" style={{ width: w ? 18 : `${50 + ((i * 7 + j * 13) % 40)}%` }} />
                  </span>
                ))}
              </div>
            ))}

          {state.status === 'error' && (
            <div className="state" role="alert">
              <div className="icon danger">
                <AlertIcon />
              </div>
              <h2>{t('list.errorTitle')}</h2>
              <p>{t('list.errorBody')}</p>
              <small>{t('list.errorCode', { code: state.code })}</small>
              <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>
                {t('list.retry')}
              </button>
            </div>
          )}

          {data && items.length === 0 && !hasFilters && (
            <div className="state">
              <div className="icon">{emptyIcon}</div>
              <h2>{t.dynamic(`resource.${resource.name}.emptyTitle`)}</h2>
              <p>{t.dynamic(`resource.${resource.name}.emptyBody`)}</p>
              {canWrite && (
                <Link className="btn primary" href={`${basePath}/nowy`}>
                  <PlusIcon />
                  {t.dynamic(`resource.${resource.name}.new`)}
                </Link>
              )}
            </div>
          )}

          {data && items.length === 0 && hasFilters && (
            <div className="state">
              <div className="icon">
                <SearchIcon size={22} />
              </div>
              <h2>{t('list.noResultsTitle')}</h2>
              <p>
                {query.filters.map((f) => `${fieldLabel(resource, f.field)}: ${filterLabel(resource, f)}`).join(' · ')}
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSearch('');
                  navigate({ filters: [], q: undefined });
                }}
              >
                {t('list.clearFilters')}
              </button>
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              role="row"
              className={selected.has(item.id) ? 'row link-row selected' : 'row link-row'}
              style={{ gridTemplateColumns: grid }}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('input,button,a')) router.push(`${basePath}/${item.id}`);
              }}
            >
              <span role="cell">
                {canDelete && (
                <input
                  type="checkbox"
                  className="cb"
                  aria-label={t('list.selectRow', { label: rowLabel(item) })}
                  checked={selected.has(item.id)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    setSelected(next);
                  }}
                />
                )}
              </span>
              {columns.map(({ field, render }, i) => (
                <span key={field} role="cell">
                  {i === 0 ? (
                    <Link
                      href={`${basePath}/${item.id}`}
                      className="strong"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {render ? render(item) : String((item as Record<string, unknown>)[field] ?? '')}
                    </Link>
                  ) : render ? (
                    render(item)
                  ) : (
                    String((item as Record<string, unknown>)[field] ?? t('common.none'))
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>

        {data && data.total > 0 && (
          <div className="pager">
            <div className="left">
              <span className="num">
                {t('list.range', {
                  from: (data.page - 1) * data.pageSize + 1,
                  to: Math.min(data.page * data.pageSize, data.total),
                  total: data.total,
                })}
              </span>
              <select
                className="select"
                value={query.pageSize}
                aria-label={t('list.pageSize', { count: query.pageSize })}
                onChange={(e) => navigate({ pageSize: Number(e.target.value) })}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t('list.pageSize', { count: size })}
                  </option>
                ))}
              </select>
            </div>
            <div className="right">
              <button
                type="button"
                className="btn"
                disabled={query.page <= 1}
                onClick={() => navigate({ page: query.page - 1 })}
              >
                {t('list.previous')}
              </button>
              {pageNumbers.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="page-btn num"
                  aria-current={p === query.page ? 'page' : undefined}
                  aria-label={t('list.page', { page: p })}
                  onClick={() => navigate({ page: p })}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                className="btn"
                disabled={query.page >= pages}
                onClick={() => navigate({ page: query.page + 1 })}
              >
                {t('list.next')}
              </button>
            </div>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bulk" role="toolbar" aria-label={t('list.selected', { count: selected.size })}>
          <span className="count">{t('list.selected', { count: selected.size })}</span>
          {canDelete && (
            <button type="button" className="danger" onClick={() => setConfirm(true)}>
              {t.dynamic(`resource.${resource.name}.bulkRemove`)}
            </button>
          )}
          <button type="button" aria-label={t('list.clearSelection')} onClick={() => setSelected(new Set())}>
            <CloseIcon />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        danger
        title={t('list.bulkConfirmTitle', {
          action: t.dynamic(`resource.${resource.name}.bulkRemove`),
          count: selected.size,
        })}
        body={t.dynamic(`resource.${resource.name}.removeBody`)}
        action={t.dynamic(`resource.${resource.name}.bulkRemove`)}
        onConfirm={() => void bulkRemove().catch((e: unknown) => setNotice(errorMessage(e)))}
        onClose={() => setConfirm(false)}
      />

      {drawer && (
        <FilterDrawer
          resource={resource}
          specs={filters}
          query={query}
          facets={data?.facets ?? {}}
          onApply={(next) => {
            setDrawer(false);
            // Pole szybkiego filtra, które jest też w panelu, ustawia panel.
            const keepQuick = quickFilter && !filters.some((f) => f.field === quickFilter.field);
            navigate({ filters: [...(keepQuick ? [quickFilter] : []), ...next] });
          }}
          onClose={() => setDrawer(false)}
        />
      )}
    </>
  );
}
