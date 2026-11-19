'use client';

/**
 * Lista wzorca widoku tabeli w szczegółach rekordu nadrzędnego (ADR 0076): karta hulajnogi → Komendy i Historia stanów,
 * karta klienta → Zapisane miejsca. Ten sam kontrakt list (filtry, sortowanie w nagłówkach, stronicowanie, eksport)
 * co `ResourceList`, ale stan jest lokalny: adres karty należy do karty (zakładka `?tab=…`), a warunek rekordu
 * nadrzędnego (np. `scooterId`) jest stałym filtrem, którego operator nie zdejmuje.
 */
import {
  toSearchParams,
  type ListFilter,
  type ListQuery,
  type ListResponse,
  type ResourceDefinition,
} from '@hulajnogi/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { t } from '../../lib/i18n';
import { FilterDrawer, type FilterSpec } from './filter-drawer';
import { AlertIcon, ArrowDown, ArrowUp, CloseIcon, FilterIcon } from './icons';
import { fieldLabel, filterLabel } from './labels';
import { ExportButton, exportParams, exportScope, type ExportParams } from './list-export';
import type { Column } from './resource-list';

export interface InlineListProps<T> {
  resource: ResourceDefinition;
  columns: Column<T>[];
  /** Stałe filtry rekordu nadrzędnego (np. `scooterId`); nie ma ich w etykietach ani w panelu filtrów. */
  fixed: ListFilter[];
  /** Parametry spoza kontraktu listy (np. okres `from`, `to` historii stanów). */
  extra?: ExportParams;
  filters: FilterSpec[];
  title: ReactNode;
  pageSize?: number;
  rowKey: (item: T) => string | number;
  /** Kliknięcie wiersza (np. przejście do przejazdu). */
  onRow?: (item: T) => void;
  emptyText: string;
  revision?: number;
  exportColumns?: readonly string[];
  /** Ciało wiersza zastępujące pustą przestrzeń po prawej (np. strzałka). */
  trailing?: (item: T) => ReactNode;
}

type State<T> = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; data: ListResponse<T> };

export function InlineList<T>(props: InlineListProps<T>) {
  const { resource, columns, fixed, extra, filters, title, rowKey, onRow, emptyText, revision = 0 } = props;
  const pageSize = props.pageSize ?? 10;
  const [query, setQuery] = useState<ListQuery>(() => ({
    filters: [],
    sort: resource.defaultSort.map((key) => ({ field: key.replace(/^-/, ''), desc: key.startsWith('-') })),
    page: 1,
    pageSize,
    facets: [],
  }));
  const [state, setState] = useState<State<T>>({ status: 'loading' });
  const [drawer, setDrawer] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const fixedKey = JSON.stringify(fixed);
  const extraKey = JSON.stringify(extra ?? {});
  const full = useMemo<ListQuery>(
    () => ({ ...query, filters: [...(JSON.parse(fixedKey) as ListFilter[]), ...query.filters] }),
    [query, fixedKey],
  );
  const facetFields = filters.filter((f) => f.kind === 'checklist').map((f) => f.field);
  const params = new URLSearchParams(toSearchParams(resource, { ...full, facets: facetFields }));
  for (const [key, value] of Object.entries(JSON.parse(extraKey) as ExportParams)) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  const requestParams = params.toString();

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    api<ListResponse<T>>(`/admin/${resource.name}?${requestParams}`, { signal: controller.signal })
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError')
          setState({ status: 'error', code: error instanceof ApiRequestError ? error.code : 'INTERNAL_ERROR' });
      });
    return () => controller.abort();
  }, [resource.name, requestParams, revision, reload]);

  const data = state.status === 'ready' ? state.data : null;
  const grid = `${columns.map((c) => c.width).join(' ')}${props.trailing ? ' 28px' : ''}`;
  const sortInfo = query.sort[0];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const toggleSort = (field: string) => {
    const current = query.sort[0];
    const sort = current?.field !== field ? [{ field, desc: false }] : current.desc ? [] : [{ field, desc: true }];
    setQuery({ ...query, sort, page: 1 });
  };
  const exportFields = props.exportColumns ?? columns.filter((c) => c.header === undefined).map((c) => c.field).filter((f) => f in resource.fields);

  return (
    <section className="card il-card">
      <div className="il-head">
        <h2>{title}</h2>
        {query.filters.map((filter) => (
          <span key={`${filter.field}.${filter.op}`} className="tag">
            <span>
              {fieldLabel(resource, filter.field)}
              {': '}
              <b>{filterLabel(resource, filter)}</b>
            </span>
            <button
              type="button"
              aria-label={t('list.removeFilter', { label: fieldLabel(resource, filter.field) })}
              onClick={() => setQuery({ ...query, page: 1, filters: query.filters.filter((f) => f !== filter) })}
            >
              <CloseIcon size={14} />
            </button>
          </span>
        ))}
        {query.filters.length > 0 && (
          <button type="button" className="link" onClick={() => setQuery({ ...query, page: 1, filters: [] })}>
            {t('list.clearFilters')}
          </button>
        )}
        <span className="spacer" />
        {data && (
          <span className="summary">
            {query.filters.length > 0
              ? t('inlineList.filtered', { count: data.total })
              : t('list.results', { count: data.total })}
            {sortInfo &&
              ` · ${t('list.sortedBy', { field: fieldLabel(resource, sortInfo.field).toLowerCase(), direction: t(sortInfo.desc ? 'list.descending' : 'list.ascending') })}`}
          </span>
        )}
        <ExportButton
          resource={resource}
          params={exportParams(resource, full, extra)}
          rows={data?.total ?? null}
          {...exportScope(resource, query)}
          columns={exportFields}
          onChangeFilters={() => setDrawer(true)}
          onDone={(file) => setNotice(t('listExport.done', { file }))}
          disabled={!data}
        />
        {filters.length > 0 && (
          <button type="button" className={query.filters.length ? 'btn dark' : 'btn'} onClick={() => setDrawer(true)}>
            <FilterIcon />
            {t('list.filters')}
            {query.filters.length > 0 && <span className="num">{query.filters.length}</span>}
          </button>
        )}
      </div>
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

      <div className="table" role="table" aria-rowcount={data?.total} aria-busy={state.status === 'loading'}>
        <div className="row head" role="row" style={{ gridTemplateColumns: grid }}>
          {columns.map(({ field, header }) => {
            if (header !== undefined)
              return (
                <span key={field} role="columnheader">
                  {header}
                </span>
              );
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
          {props.trailing && <span role="columnheader" />}
        </div>
        {state.status === 'loading' && <div className="row" aria-busy="true" />}
        {state.status === 'error' && (
          <div className="state" role="alert">
            <div className="icon danger">
              <AlertIcon />
            </div>
            <h2>{t('list.errorTitle')}</h2>
            <small>{t('list.errorCode', { code: state.code })}</small>
            <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>
              {t('list.retry')}
            </button>
          </div>
        )}
        {data && data.items.length === 0 && <p className="il-empty muted">{emptyText}</p>}
        {data?.items.map((item) => (
          <div
            key={rowKey(item)}
            role="row"
            className={onRow ? 'row link-row' : 'row'}
            style={{ gridTemplateColumns: grid }}
            onClick={(e) => {
              if (onRow && !(e.target as HTMLElement).closest('input,button,a')) onRow(item);
            }}
          >
            {columns.map(({ field, render }) => (
              <span key={field} role="cell">
                {render ? render(item) : String((item as Record<string, unknown>)[field] ?? t('common.none'))}
              </span>
            ))}
            {props.trailing && <span role="cell">{props.trailing(item)}</span>}
          </div>
        ))}
      </div>

      {data && data.total > data.pageSize && (
        <div className="pager">
          <div className="left">
            <span className="num">
              {t('list.range', {
                from: (data.page - 1) * data.pageSize + 1,
                to: Math.min(data.page * data.pageSize, data.total),
                total: data.total,
              })}
            </span>
          </div>
          <div className="right">
            <button
              type="button"
              className="btn"
              disabled={query.page <= 1}
              onClick={() => setQuery({ ...query, page: query.page - 1 })}
            >
              {t('list.previous')}
            </button>
            <span className="num il-page">{t('inlineList.page', { page: query.page, pages })}</span>
            <button
              type="button"
              className="btn"
              disabled={query.page >= pages}
              onClick={() => setQuery({ ...query, page: query.page + 1 })}
            >
              {t('list.next')}
            </button>
          </div>
        </div>
      )}

      {drawer && (
        <FilterDrawer
          resource={resource}
          specs={filters}
          query={full}
          facets={data?.facets ?? {}}
          onApply={(next) => {
            setDrawer(false);
            setQuery({ ...query, page: 1, filters: next });
          }}
          onClose={() => setDrawer(false)}
        />
      )}
    </section>
  );
}
