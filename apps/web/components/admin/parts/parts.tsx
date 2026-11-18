'use client';

/**
 * Magazyn części (iteracja 6, makieta czesci-magazyn, ADR 0055): lista na wzorcu z szybkimi filtrami stanu,
 * przyjęcie dostawy i korekta stanu z wiersza listy oraz ruchy magazynowe tylko do odczytu.
 */
import {
  formatPln,
  sparePartMovementsResource,
  sparePartsResource,
  type ListResponse,
  type SparePartListItem,
  type SparePartMovementItem,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock, formatDate, formatDateTime, isToday, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import type { FilterSpec } from '../filter-drawer';
import { scooterNumber } from '../fleet/fleet-format';
import { BoxIcon, PlusIcon, WarningIcon } from '../icons';
import { valueLabel } from '../labels';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import { PARTS_BASE, taskNumber, TASKS_BASE } from '../service/service-format';
import { StockDialog } from './stock-dialog';

export const MOVEMENTS_PATH = `${PARTS_BASE}/ruchy`;

/** Zakładki „Części” i „Ruchy magazynowe”. */
export function PartsTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: PARTS_BASE, label: t('parts.tabs.parts') },
    { href: MOVEMENTS_PATH, label: t('parts.tabs.movements') },
  ];
  const active = pathname.startsWith(MOVEMENTS_PATH) ? MOVEMENTS_PATH : PARTS_BASE;
  return (
    <nav className="tabs" aria-label={t('admin.nav.parts')}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="tab" aria-current={tab.href === active ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Chwila w wierszu: „dziś 13:40” albo „12 lis”. */
export function shortWhen(iso: string): string {
  return isToday(iso) ? t('parts.today', { time: formatClock(iso) }) : formatDate(iso);
}

/** „użycie S-1037, dziś 13:40”, „dostawa, 12 lis”. */
function lastMovement(p: SparePartListItem): string {
  if (!p.lastMovementAt || !p.lastMovementKind) return t('common.none');
  const kind = t.dynamic(`parts.lastMovement.${p.lastMovementKind}`, {
    task: p.lastMovementTaskNumber !== null ? taskNumber(p.lastMovementTaskNumber) : '',
    hasTask: p.lastMovementTaskNumber !== null ? 'true' : 'false',
  });
  return t('parts.lastMovementAt', { kind, when: shortWhen(p.lastMovementAt) });
}

export function StockQty({ part }: { part: Pick<SparePartListItem, 'stockQty' | 'belowMinimum'> }) {
  if (!part.belowMinimum) return <span className="num">{part.stockQty}</span>;
  return (
    <span className="low" title={t('parts.belowMinimum')}>
      <WarningIcon size={14} />
      <span className="num">{part.stockQty}</span>
    </span>
  );
}

const filters: FilterSpec[] = [
  { field: 'active', kind: 'boolean' },
  { field: 'belowMinimum', kind: 'boolean' },
  { field: 'stockQty', kind: 'range' },
  { field: 'unitCost', kind: 'range' },
  { field: 'lastMovementAt', kind: 'dateRange' },
];

/** Szybkie filtry z makiety; „Aktywne” jest domyślne (adres bez filtrów dostaje `active=true`). */
const presets: { items: QuickPreset[]; facets: string[]; total: (f: ListResponse<unknown>['facets']) => number } = {
  facets: ['active', 'belowMinimum'],
  total: (f) => (f.active?.true ?? 0) + (f.active?.false ?? 0),
  items: [
    {
      key: 'active',
      label: t('resource.spare-parts.quick.active'),
      filters: [{ field: 'active', op: 'eq', values: [true] }],
      count: (f) => f.active?.true ?? 0,
    },
    {
      key: 'belowMinimum',
      label: t('resource.spare-parts.quick.belowMinimum'),
      filters: [{ field: 'belowMinimum', op: 'eq', values: [true] }],
      count: (f) => f.belowMinimum?.true ?? 0,
    },
    {
      key: 'inactive',
      label: t('resource.spare-parts.quick.inactive'),
      filters: [{ field: 'active', op: 'eq', values: [false] }],
      count: (f) => f.active?.false ?? 0,
    },
  ],
};

export function PartList() {
  const { can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [receiving, setReceiving] = useState<SparePartListItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listeners = useRef(new Set<(item: SparePartListItem | null) => void>());
  const canManage = can('service.manage');

  // Domyślnie lista pokazuje aktywne części (makieta); tylko przy wejściu, bo „Wszystkie” zdejmuje filtr.
  const initial = useRef(searchParams.size === 0);
  useEffect(() => {
    if (!initial.current) return;
    initial.current = false;
    router.replace(`${pathname}?active=true`, { scroll: false });
  }, [pathname, router]);

  const subscribe = useCallback((listener: (item: SparePartListItem | null) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const columns: Column<SparePartListItem>[] = [
    { field: 'sku', width: '110px', render: (p) => <span className="code ink">{p.sku}</span> },
    {
      field: 'name',
      width: 'minmax(0,1fr)',
      render: (p) => (p.active ? p.name : <span className="muted">{p.name}</span>),
    },
    { field: 'stockQty', width: '84px', render: (p) => <StockQty part={p} /> },
    { field: 'minStockQty', width: '76px', render: (p) => <span className="num muted">{p.minStockQty}</span> },
    { field: 'unitCost', width: '96px', render: (p) => <span className="num">{formatPln(p.unitCost)}</span> },
    { field: 'used30d', width: '104px', render: (p) => <span className="num">{p.used30d}</span> },
    {
      field: 'lastMovementAt',
      width: 'minmax(0,190px)',
      render: (p) => <span className="small-13">{lastMovement(p)}</span>,
    },
    ...(canManage
      ? [
          {
            field: 'actions',
            width: '104px',
            render: (p: SparePartListItem) =>
              p.active ? (
                <button type="button" className="btn sm-btn" onClick={() => setReceiving(p)}>
                  <PlusIcon size={14} />
                  {t('parts.receive.short')}
                </button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      {notice && (
        <div className="banner ok" role="status">
          <span>{notice}</span>
        </div>
      )}
      <ResourceList<SparePartListItem>
        resource={sparePartsResource}
        basePath={PARTS_BASE}
        columns={columns}
        presets={presets}
        filters={filters}
        rowLabel={(p) => p.sku}
        summary={(data) =>
          t('resource.spare-parts.summary', {
            active: data.facets.active?.true ?? data.total,
            below: data.facets.belowMinimum?.true ?? 0,
          })
        }
        emptyIcon={<BoxIcon size={22} />}
        tabs={<PartsTabs />}
        activeId={receiving?.id ?? null}
        subscribe={subscribe}
      />
      {receiving && (
        <StockDialog
          part={receiving}
          onClose={() => setReceiving(null)}
          onDone={(part, message) => {
            setReceiving(null);
            setNotice(message);
            for (const listener of listeners.current) listener(part);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Ruchy magazynowe
// ---------------------------------------------------------------------------------------------

/** Zmiana stanu ze znakiem: „+20”, „−1”. */
export const signedQty = (delta: number) => (delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '0');

/** Opis ruchu: zadanie z hulajnogą, dokument dostawy albo powód korekty z notatką. */
export function MovementDetail({ m }: { m: SparePartMovementItem }) {
  const { can } = useSession();
  if (m.taskId && m.taskNumber !== null) {
    const label = [taskNumber(m.taskNumber), m.scooterNumber !== null ? scooterNumber(m.scooterNumber) : null]
      .filter(Boolean)
      .join(' · ');
    return can('service.read') ? (
      <Link className="link" href={`${TASKS_BASE}/${m.taskId}`}>
        {label}
      </Link>
    ) : (
      <span>{label}</span>
    );
  }
  if (m.reason)
    return (
      <span>
        {valueLabel(sparePartMovementsResource, 'reason', m.reason)}
        {m.note && <span className="muted">{` · ${m.note}`}</span>}
      </span>
    );
  return <span>{m.document ?? t('common.none')}</span>;
}

const movementColumns: Column<SparePartMovementItem>[] = [
  {
    field: 'createdAt',
    width: '120px',
    render: (m) => (
      <span className="num" title={formatDateTime(m.createdAt)}>
        {shortWhen(m.createdAt)}
      </span>
    ),
  },
  {
    field: 'partName',
    width: 'minmax(0,1.2fr)',
    render: (m) => (
      <span className="stack">
        <span>{m.partName}</span>
        <span className="code">{m.sku}</span>
      </span>
    ),
  },
  { field: 'kind', width: '96px', render: (m) => valueLabel(sparePartMovementsResource, 'kind', m.kind) },
  {
    field: 'delta',
    width: '72px',
    render: (m) => <span className={m.delta < 0 ? 'num bad' : 'num'}>{signedQty(m.delta)}</span>,
  },
  { field: 'stockAfter', width: '72px', render: (m) => <span className="num">{m.stockAfter}</span> },
  {
    field: 'unitCost',
    width: '96px',
    render: (m) => <span className="num">{m.unitCost === null ? t('common.none') : formatPln(m.unitCost)}</span>,
  },
  { field: 'document', width: 'minmax(0,1.2fr)', render: (m) => <MovementDetail m={m} /> },
  { field: 'staffName', width: 'minmax(0,1fr)', render: (m) => m.staffName ?? t('audit.system') },
];

const movementFilters: FilterSpec[] = [
  { field: 'kind', kind: 'checklist' },
  { field: 'reason', kind: 'checklist' },
  { field: 'createdAt', kind: 'dateRange' },
];

export function MovementList() {
  return (
    <ResourceList<SparePartMovementItem>
      resource={sparePartMovementsResource}
      basePath={MOVEMENTS_PATH}
      columns={movementColumns}
      quick={{ field: 'kind', values: ['RECEIPT', 'ADJUSTMENT', 'USE', 'RETURN'] }}
      filters={movementFilters}
      rowLabel={(m) => `${m.sku} ${m.id}`}
      itemHref={(m) => `${PARTS_BASE}/${m.partId}`}
      summary={(data) => t('resource.spare-part-movements.summary', { count: data.total })}
      emptyIcon={<BoxIcon size={22} />}
      tabs={<PartsTabs />}
      createLabel={null}
      selectable={false}
    />
  );
}
