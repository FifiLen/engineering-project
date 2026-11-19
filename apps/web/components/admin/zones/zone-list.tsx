'use client';

/**
 * Lista stref po lewej stronie edytora (D2, ADR 0031): kontrakt list z wyszukiwaniem, szybkimi filtrami
 * typu z licznikami, filtrem aktywności, sortowaniem i stronicowaniem. Stan jest w adresie URL.
 */
import {
  PAGE_SIZES,
  type ListFilter,
  type ListQuery,
  type ListResponse,
  type ZoneListItem,
  type ZoneType,
} from '@hulajnogi/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../../lib/i18n';
import { AlertIcon, ChevronDownIcon, EyeOffIcon, PlusIcon, PolygonIcon, SearchIcon, SortIcon } from '../icons';
import { ZONE_TYPE_ORDER, ZoneTypeIcon, zoneDescription } from './zone-format';

/** Sortowania z makiety: kod, nazwa, typ i data zmiany. */
const SORTS = ['code', '-code', 'name', '-name', 'type', '-updatedAt'] as const;

export type ListState =
  { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; data: ListResponse<ZoneListItem> };

interface ZoneListProps {
  query: ListQuery;
  /** Filtr aktywności: domyślnie aktywne (ustalenia z plansz). */
  active: boolean;
  state: ListState;
  selectedId: string | null;
  /** Szkic nowej strefy na górze listy z liczbą punktów. */
  draftPoints: number | null;
  canWrite: boolean;
  onNavigate(next: Partial<ListQuery>): void;
  onOpen(id: string): void;
  onCreate(): void;
  onRetry(): void;
  /** Odnośniki do list technicznych stref i „Eksportuj” (iteracja 8, ADR 0073 i 0076). */
  tools?: ReactNode;
}

export function ZoneList({
  query,
  active,
  state,
  selectedId,
  draftPoints,
  canWrite,
  onNavigate,
  onOpen,
  onCreate,
  onRetry,
  tools,
}: ZoneListProps) {
  const [search, setSearch] = useState(query.q ?? '');

  // Wyszukiwanie po krótkiej przerwie w pisaniu.
  useEffect(() => {
    if ((query.q ?? '') === search.trim()) return;
    const timer = setTimeout(() => onNavigate({ q: search.trim() || undefined }), 300);
    return () => clearTimeout(timer);
  }, [search, query.q, onNavigate]);

  const data = state.status === 'ready' ? state.data : null;
  const typeFilter = query.filters.find((f) => f.field === 'type');
  const currentType = typeFilter?.values.length === 1 ? (typeFilter.values[0] as ZoneType) : null;
  const typeCounts = data?.facets.type ?? {};
  const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  const others = query.filters.filter((f) => f.field !== 'type' && f.field !== 'active');
  const setFilters = (type: ZoneType | null, isActive: boolean) => {
    const filters: ListFilter[] = [...others, { field: 'active', op: 'eq', values: [isActive] }];
    if (type) filters.push({ field: 'type', op: 'eq', values: [type] });
    onNavigate({ filters });
  };
  const sortValue = query.sort[0] ? `${query.sort[0].desc ? '-' : ''}${query.sort[0].field}` : 'code';
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="zl" aria-label={t('zones.list.label')}>
      <div className="zl-head">
        <h1>{t('resource.zones.title')}</h1>
        {canWrite && (
          <button type="button" className="btn primary" onClick={onCreate}>
            <PlusIcon />
            {t('resource.zones.new')}
          </button>
        )}
      </div>
      {tools && <div className="zl-tools">{tools}</div>}

      <label className="zl-search">
        <SearchIcon />
        <span className="visually-hidden">{t('list.search')}</span>
        <input
          type="search"
          value={search}
          placeholder={t('resource.zones.searchPlaceholder')}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <div className="zl-chips" role="group" aria-label={t('zones.list.typeGroup')}>
        <button
          type="button"
          className="zl-chip"
          aria-pressed={currentType === null}
          onClick={() => setFilters(null, active)}
        >
          {t('common.all')}
          <span className="n num">{total}</span>
        </button>
        {ZONE_TYPE_ORDER.map((type) => (
          <button
            key={type}
            type="button"
            className="zl-chip"
            aria-pressed={currentType === type}
            onClick={() => setFilters(currentType === type ? null : type, active)}
          >
            {t.dynamic(`zones.list.typeShort.${type}`)}
            <span className="n num">{typeCounts[type] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="zl-row">
        <div className="zl-seg" role="group" aria-label={t('zones.list.activityGroup')}>
          <button type="button" aria-pressed={active} onClick={() => setFilters(currentType, true)}>
            {t('zones.list.active')}
          </button>
          <button type="button" aria-pressed={!active} onClick={() => setFilters(currentType, false)}>
            {t('zones.list.inactive')}
          </button>
        </div>
        <label className="zl-select">
          <SortIcon />
          <span className="visually-hidden">{t('zones.list.sort')}</span>
          <select
            value={sortValue}
            onChange={(e) => {
              const raw = e.target.value;
              const desc = raw.startsWith('-');
              onNavigate({ sort: [{ field: desc ? raw.slice(1) : raw, desc }] });
            }}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t.dynamic(`zones.list.sorts.${s.replace('-', 'desc_')}`)}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="chev" />
        </label>
      </div>

      {data && (
        <div className="small zl-summary">
          {t(active ? 'zones.list.summaryActive' : 'zones.list.summaryInactive', { count: data.total })}
        </div>
      )}

      <div className="zl-items" aria-busy={state.status === 'loading'}>
        {draftPoints !== null && (
          <div className="zi draft sel" aria-current="true">
            <span className="ico">
              <PolygonIcon size={15} style={{ color: 'var(--accent)' }} />
            </span>
            <span className="tx">
              <span className="t">{t('zones.card.newTitle')}</span>
              <span className="d">{t('zones.list.draft', { count: draftPoints })}</span>
            </span>
          </div>
        )}

        {state.status === 'loading' &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="zi">
              <span className="ico" />
              <span className="tx">
                <i className="skeleton" style={{ width: `${55 + ((i * 13) % 35)}%` }} />
              </span>
            </div>
          ))}

        {state.status === 'error' && (
          <div className="zl-state" role="alert">
            <AlertIcon size={20} />
            <span>{t('list.errorTitle')}</span>
            <small>{t('list.errorCode', { code: state.code })}</small>
            <button type="button" className="btn" onClick={onRetry}>
              {t('list.retry')}
            </button>
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="zl-state">
            <span>{query.q || currentType ? t('list.noResultsTitle') : t('resource.zones.emptyTitle')}</span>
            <small>{active ? t('resource.zones.emptyBody') : t('zones.list.noInactive')}</small>
          </div>
        )}

        {data?.items.map((z) => (
          <button
            key={z.id}
            type="button"
            className={z.id === selectedId ? 'zi sel' : 'zi'}
            aria-current={z.id === selectedId ? 'true' : undefined}
            onClick={() => onOpen(z.id)}
          >
            <span className="ico">
              <ZoneTypeIcon type={z.type} />
            </span>
            <span className="tx">
              <span className="t">
                <b>{z.code}</b> {z.name}
                {!z.visibleInApp && z.type !== 'SERVICE_AREA' && (
                  <EyeOffIcon
                    size={13}
                    className="hidden-mark"
                    aria-label={t('zones.list.hiddenInApp')}
                    role="img"
                    aria-hidden={false}
                  />
                )}
              </span>
              <span className="d">{zoneDescription(z)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="zl-pager">
        <span className="num">
          {data && data.total > 0
            ? t('list.range', {
                from: (data.page - 1) * data.pageSize + 1,
                to: Math.min(data.page * data.pageSize, data.total),
                total: data.total,
              })
            : null}
        </span>
        <span className="zl-pages">
          {pages > 1 && (
            <>
              <button
                type="button"
                className="icon-btn plain"
                disabled={query.page <= 1}
                aria-label={t('list.previous')}
                onClick={() => onNavigate({ page: query.page - 1 })}
              >
                <ChevronDownIcon style={{ transform: 'rotate(90deg)' }} />
              </button>
              <span className="num">{t('zones.list.page', { page: query.page, pages })}</span>
              <button
                type="button"
                className="icon-btn plain"
                disabled={query.page >= pages}
                aria-label={t('list.next')}
                onClick={() => onNavigate({ page: query.page + 1 })}
              >
                <ChevronDownIcon style={{ transform: 'rotate(-90deg)' }} />
              </button>
            </>
          )}
          <label className="zl-select small-select">
            <span className="visually-hidden">{t('list.pageSize', { count: query.pageSize })}</span>
            <select value={query.pageSize} onChange={(e) => onNavigate({ pageSize: Number(e.target.value) })}>
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {t('list.pageSize', { count: size })}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="chev" />
          </label>
        </span>
      </div>
    </section>
  );
}
