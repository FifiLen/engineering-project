'use client';

/**
 * Wspólny widok tabeli w panelu (ADR 0031, makiety 17-panel-wzorce): wyszukiwarka, szybkie filtry
 * z licznikami, panel filtrów, sortowanie w nagłówkach, stronicowanie, zaznaczanie i operacje grupowe.
 * Stan listy jest w adresie URL, więc działa „wstecz”, odświeżenie i udostępnienie odnośnika.
 * Lista może też otwierać podgląd rekordu obok tabeli i przyjmować zmiany na żywo (przejazdy).
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

/**
 * Szybki filtr złożony z kilku filtrów albo z kilku wartości pola (np. „W trakcie” = cztery stany przejazdu,
 * „Problemy” = flaga). Licznik liczy się z liczników listy bez szybkich filtrów.
 */
export interface QuickPreset {
  key: string;
  label: string;
  filters: ListFilter[];
  count: (facets: Facets) => number;
}

type Facets = ListResponse<unknown>['facets'];

export interface ResourceListProps<T extends ListRecord> {
  resource: ResourceDefinition;
  basePath: string;
  columns: Column<T>[];
  /** Szybkie filtry nad tabelą: pole z licznikami (`facets`) i kolejność wartości. */
  quick?: { field: string; values: readonly string[]; pluralKey?: string };
  /** Szybkie filtry złożone; zamiast `quick`. `total` to licznik „Wszystkie”, `facets` to pola liczników. */
  presets?: { items: QuickPreset[]; facets: string[]; total: (facets: Facets) => number };
  /**
   * Adres wiersza zamiast `basePath/id` (np. księga prowadzi do portfela klienta); `null` to wiersz bez
   * odnośnika (lista tylko do odczytu bez szczegółów).
   */
  itemHref?: (item: T) => string | null;
  /** Klucz wiersza, gdy rekord listy nie ma pola `id` (np. portfele: `userId`). */
  rowKey?: (item: T) => string | number;
  /** Kliknięcie wiersza otwiera podgląd zamiast karty rekordu; `activeId` wyróżnia otwarty wiersz. */
  onOpen?: (item: T) => void;
  activeId?: string | number | null;
  /** Bez kolumny zaznaczania (lista tylko do odczytu, bez operacji grupowych). */
  selectable?: boolean;
  /**
   * Zmiany rekordów na żywo: wiersz na bieżącej stronie zmienia się od razu, a lista z licznikami
   * odświeża się po krótkiej przerwie (nowe rekordy, zmiana kolejności). `null` to samo odświeżenie
   * (np. po ponownym połączeniu, gdy zdarzenia z przerwy przepadły).
   */
  subscribe?: (listener: (item: T | null) => void) => () => void;
  filters: FilterSpec[];
  rowLabel: (item: T) => string;
  summary?: (data: ListResponse<T>) => string;
  emptyIcon: ReactNode;
  /** Zakładki pod tytułem (np. Operatorzy, Role, Dziennik audytu). */
  tabs?: ReactNode;
  /** Przycisk dodawania z własnym podpisem albo bez niego (np. dziennik audytu). */
  createLabel?: string | null;
}

/** Rekord listy; tabele tylko do dopisywania (dziennik audytu) nie mają wersji. */
export type ListRecord = { id: string | number; version?: number };

type LoadState<T> =
  { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; data: ListResponse<T> };

const EMPTY: ListQuery = { filters: [], sort: [], page: 1, pageSize: 25, facets: [] };

export function ResourceList<T extends ListRecord>(props: ResourceListProps<T>) {
  const { resource, basePath, columns, filters, rowLabel, summary, emptyIcon, tabs, createLabel } = props;
  const { onOpen, activeId, selectable = true, subscribe, itemHref, rowKey } = props;
  const hrefOf = (item: T) => (itemHref ? itemHref(item) : `${basePath}/${item.id}`);
  const router = useRouter();
  // Panel ukrywa operacje bez uprawnień; decyzję podejmuje API (ADR 0028).
  const { can } = useSession();
  const canWrite = can(resource.permissions.write) && createLabel !== null;
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

  // Szybki filtr jednego pola to szczególny przypadek filtrów złożonych.
  const quick = useMemo(() => {
    if (props.presets) return props.presets;
    if (!props.quick) return undefined;
    const { field, values, pluralKey } = props.quick;
    return {
      facets: [field],
      total: (facets: Facets) => Object.values(facets[field] ?? {}).reduce((a, b) => a + b, 0),
      items: values.map((value): QuickPreset => ({
        key: value,
        label: pluralKey ? t.dynamic(`${pluralKey}.${value}`) : valueLabel(resource, field, value),
        filters: [{ field, op: 'eq', values: [value] }],
        count: (facets) => facets[field]?.[value] ?? 0,
      })),
    };
  }, [props.presets, props.quick, resource]);
  const quickFields = useMemo(() => new Set(quick?.items.flatMap((p) => p.filters.map((f) => f.field)) ?? []), [quick]);

  const facetFields = useMemo(
    () => [
      ...new Set([...(quick?.facets ?? []), ...filters.filter((f) => f.kind === 'checklist').map((f) => f.field)]),
    ],
    [quick, filters],
  );
  const requestParams = toSearchParams(resource, { ...query, facets: facetFields }).toString();

  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState(query.q ?? '');
  const [quickFacets, setQuickFacets] = useState<Facets | null>(null);

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

  // Zmiany na żywo: wiersz od razu, lista i liczniki po przerwie (kilka zmian naraz to jedno odświeżenie).
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!subscribe) return;
    const unsubscribe = subscribe((changed) => {
      setState((s) =>
        changed && s.status === 'ready' && s.data.items.some((i) => i.id === changed.id)
          ? { ...s, data: { ...s.data, items: s.data.items.map((i) => (i.id === changed.id ? changed : i)) } }
          : s,
      );
      if (liveTimer.current) clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => setReload((n) => n + 1), 1500);
    });
    return () => {
      unsubscribe();
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, [subscribe]);

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

  // Szybki filtr jest aktywny, gdy filtry jego pól są dokładnie jego filtrami; inne filtry tych pól
  // (np. kilka statusów wybranych w panelu filtrów) są widoczne jako etykiety.
  const onQuickFields = query.filters.filter((f) => quickFields.has(f.field));
  const activePreset = quick?.items.find(
    (p) =>
      p.filters.length === onQuickFields.length &&
      p.filters.every((pf) => onQuickFields.some((f) => sameFilter(f, pf))),
  );
  const quickFilters = activePreset ? onQuickFields : [];
  const otherFilters = query.filters.filter((f) => !quickFilters.includes(f));
  const setQuick = (preset: QuickPreset | null) =>
    navigate({ filters: [...query.filters.filter((f) => !quickFields.has(f.field)), ...(preset?.filters ?? [])] });

  // Liczniki szybkich filtrów z kilku pól: przy aktywnym filtrze osobne zapytanie bez szybkich filtrów
  // (liczniki listy pomijają filtr tylko własnego pola).
  const countsParams =
    activePreset && quickFields.size > 1
      ? toSearchParams(resource, {
          q: query.q,
          filters: query.filters.filter((f) => !quickFields.has(f.field)),
          sort: [],
          page: 1,
          pageSize: 1,
          facets: quick?.facets ?? [],
        }).toString()
      : null;
  useEffect(() => {
    if (!countsParams) {
      setQuickFacets(null);
      return;
    }
    const controller = new AbortController();
    api<ListResponse<T>>(`/admin/${resource.name}?${countsParams}`, { signal: controller.signal })
      .then((data) => setQuickFacets(data.facets))
      .catch(() => undefined);
    return () => controller.abort();
  }, [resource.name, countsParams, reload]);
  const removeFilter = (filter: ListFilter) => navigate({ filters: query.filters.filter((f) => f !== filter) });

  const toggleSort = (field: string) => {
    const current = query.sort[0];
    const sort = current?.field !== field ? [{ field, desc: false }] : current.desc ? [] : [{ field, desc: true }];
    navigate({ sort: sort.length ? sort : undefined, page: query.page });
  };

  const data = state.status === 'ready' ? state.data : null;
  const items = data?.items ?? [];
  const grid = `${selectable ? '28px ' : ''}${columns.map((c) => c.width).join(' ')}`;
  const hasFilters = query.filters.length > 0 || Boolean(query.q);
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const someSelected = items.some((i) => selected.has(i.id));
  const facetCounts = quickFacets ?? (countsParams ? null : data?.facets);
  const totalAll = quick && facetCounts ? quick.total(facetCounts) : undefined;

  const bulkRemove = async () => {
    setConfirm(false);
    const targets = items.filter((i) => selected.has(i.id));
    const results = await Promise.allSettled(
      targets.map((i) => api(`/admin/${resource.name}/${i.id}?version=${i.version ?? 1}`, { method: 'DELETE' })),
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
              {createLabel ?? t.dynamic(`resource.${resource.name}.new`)}
            </Link>
          )}
        </div>
      </div>
      {tabs}

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
            <button type="button" className="chip" aria-pressed={!activePreset} onClick={() => setQuick(null)}>
              {t('common.all')}
              {totalAll !== undefined && <span className="n num">{totalAll}</span>}
            </button>
            {quick.items.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="chip"
                aria-pressed={activePreset === preset}
                onClick={() => setQuick(preset)}
              >
                {preset.label}
                <span className="n num">{facetCounts ? preset.count(facetCounts) : 0}</span>
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
            <button type="button" className="link" onClick={() => navigate({ filters: quickFilters })}>
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
            {selectable && (
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
            )}
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
                {[...(selectable ? [28] : []), ...columns.map(() => 0)].map((w, j) => (
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

          {items.map((item) => {
            const href = onOpen ? null : hrefOf(item);
            const linked = Boolean(onOpen) || href !== null;
            return (
              <div
                key={rowKey ? rowKey(item) : item.id}
                role="row"
                className={[
                  'row',
                  linked && 'link-row',
                  (selected.has(item.id) || (activeId != null && activeId === item.id)) && 'selected',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-selected={onOpen ? activeId === item.id : undefined}
                style={{ gridTemplateColumns: grid }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('input,button,a')) return;
                  if (onOpen) onOpen(item);
                  else if (href) router.push(href);
                }}
              >
                {selectable && (
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
                )}
                {columns.map(({ field, render }, i) => (
                  <span key={field} role="cell">
                    {i === 0 && onOpen ? (
                      // Podgląd obok tabeli: pierwsza kolumna jest przyciskiem, więc działa też z klawiatury.
                      <button type="button" className="row-open strong" onClick={() => onOpen(item)}>
                        {render ? render(item) : String((item as Record<string, unknown>)[field] ?? '')}
                      </button>
                    ) : i === 0 && href ? (
                      <Link href={href} className="strong" style={{ color: 'inherit', textDecoration: 'none' }}>
                        {render ? render(item) : String((item as Record<string, unknown>)[field] ?? '')}
                      </Link>
                    ) : i === 0 ? (
                      <span className="strong">
                        {render ? render(item) : String((item as Record<string, unknown>)[field] ?? '')}
                      </span>
                    ) : render ? (
                      render(item)
                    ) : (
                      String((item as Record<string, unknown>)[field] ?? t('common.none'))
                    )}
                  </span>
                ))}
              </div>
            );
          })}
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
            const keepQuick = quickFilters.filter((qf) => !filters.some((f) => f.field === qf.field));
            navigate({ filters: [...keepQuick, ...next] });
          }}
          onClose={() => setDrawer(false)}
        />
      )}
    </>
  );
}

function sameFilter(a: ListFilter, b: ListFilter): boolean {
  const values = (f: ListFilter) => f.values.map(String).sort().join(',');
  return a.field === b.field && a.op === b.op && values(a) === values(b);
}
