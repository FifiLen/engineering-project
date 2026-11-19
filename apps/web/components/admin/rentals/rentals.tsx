'use client';

/**
 * Zasób `rentals` w panelu (makieta przejazdy-lista, ADR 0036): lista według wzorca z szybkimi filtrami,
 * podgląd przejazdu w panelu bocznym (trasa, liczniki, oś czasu) i zmiany na żywo z pokoju `rentals`.
 */
import { formatPln, rentalsResource, type ListResponse, type RentalListItem } from '@hulajnogi/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import {
  formatClock,
  formatDate,
  formatDuration,
  formatKm,
  formatTime,
  isToday,
  startOfToday,
  t,
} from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { ChevronRightIcon, CloseIcon, RouteIcon, StopIcon, WarningIcon } from '../icons';
import { valueLabel } from '../labels';
import { SETTLEMENT_PILL } from '../payments/payment-format';
import { RentalTabs } from '../areas';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import { useRentalDetails } from './rental-data';
import {
  amountLabel,
  buildTimeline,
  customerName,
  DistanceCell,
  ElapsedCell,
  liveCounters,
  ProblemMark,
  problemNotice,
  REMOTE_END_STATES,
  RentalStatePill,
  rentalProblem,
  RUNNING_STATES,
  Timeline,
  useNow,
} from './rental-parts';
import { RemoteEndDialog } from './remote-end-dialog';
import { RouteMap } from './route-map';

const BASE = '/admin/przejazdy';
/** Panel boczny pokazuje ostatnie wpisy osi czasu; pełna oś jest w szczegółach. */
const DRAWER_TIMELINE = 8;

const columns: Column<RentalListItem>[] = [
  { field: 'number', width: '62px', render: (r) => rentalNumber(r.number) },
  {
    field: 'state',
    width: '140px',
    render: (r) => (
      <span className="pill-row">
        <RentalStatePill state={r.state} />
        {r.hasProblem && <ProblemMark />}
      </span>
    ),
  },
  { field: 'userName', width: 'minmax(0,1fr)', render: customerName },
  {
    field: 'scooterNumber',
    width: '64px',
    render: (r) => <span className="strong">{scooterNumber(r.scooterNumber)}</span>,
  },
  {
    field: 'createdAt',
    width: '46px',
    render: (r) => (
      <span className="num" title={formatTime(r.createdAt)}>
        {isToday(r.createdAt) ? formatClock(r.createdAt) : formatDate(r.createdAt)}
      </span>
    ),
  },
  { field: 'elapsedSeconds', width: '50px', render: (r) => <ElapsedCell item={r} /> },
  { field: 'distanceM', width: '58px', render: (r) => <DistanceCell item={r} /> },
  {
    field: 'totalAmount',
    width: '80px',
    render: (r) => <span className={r.totalAmount === null ? 'muted' : 'num'}>{amountLabel(r)}</span>,
  },
  {
    field: 'settlement',
    width: '112px',
    render: (r) =>
      r.settlement === 'NONE' ? (
        <span className="muted">{t('common.none')}</span>
      ) : (
        <span className={`${SETTLEMENT_PILL[r.settlement]} sm`}>
          {valueLabel(rentalsResource, 'settlement', r.settlement)}
        </span>
      ),
  },
];

const filters: FilterSpec[] = [
  { field: 'state', kind: 'checklist' },
  { field: 'hasProblem', kind: 'boolean' },
  { field: 'settlement', kind: 'checklist' },
  { field: 'createdAt', kind: 'dateRange' },
  { field: 'endedAt', kind: 'dateRange' },
];

const sum = (counts: Record<string, number> | undefined, keys: readonly string[]) =>
  keys.reduce((total, key) => total + (counts?.[key] ?? 0), 0);

/** Szybkie filtry z makiety; „Wygasłe” rezerwacje i nieudane odblokowania są tylko we „Wszystkie”. */
const presets: { items: QuickPreset[]; facets: string[]; total: (f: ListResponse<unknown>['facets']) => number } = {
  facets: ['state', 'hasProblem'],
  total: (f) => Object.values(f.state ?? {}).reduce((a, b) => a + b, 0),
  items: [
    { key: 'inProgress', states: RUNNING_STATES },
    { key: 'reserved', states: ['RESERVED'] },
    { key: 'ended', states: ['ENDED'] },
    // Zaległości po odmowie obciążenia karty (ADR 0049).
    { key: 'unpaid', states: ['UNPAID'] },
  ]
    .map(({ key, states }): QuickPreset => ({
      key,
      label: t.dynamic(`resource.rentals.quick.${key}`),
      filters: [{ field: 'state', op: 'eq', values: [...states] }],
      count: (f) => sum(f.state, states),
    }))
    .concat({
      key: 'problems',
      label: t('resource.rentals.quick.problems'),
      filters: [{ field: 'hasProblem', op: 'eq', values: [true] }],
      count: (f) => f.hasProblem?.true ?? 0,
    }),
};

/** Podtytuł z makiety: przejazdy zakończone dziś i trwające teraz (bez filtrów listy). */
function useTodaySummary(revision: number): { ended: number; active: number } | null {
  const [summary, setSummary] = useState<{ ended: number; active: number } | null>(null);
  useEffect(() => {
    const ended = api<ListResponse<RentalListItem>>(
      `/admin/rentals?state=ENDED&endedAt.gte=${encodeURIComponent(startOfToday())}&pageSize=1`,
    );
    const active = api<ListResponse<RentalListItem>>(`/admin/rentals?state=${RUNNING_STATES.join(',')}&pageSize=1`);
    Promise.all([ended, active])
      .then(([e, a]) => setSummary({ ended: e.total, active: a.total }))
      .catch(() => setSummary(null));
  }, [revision]);
  return summary;
}

export function RentalList() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [summaryRevision, setSummaryRevision] = useState(0);
  const listeners = useRef(new Set<(item: RentalListItem | null) => void>());
  const openRef = useRef(openId);
  openRef.current = openId;
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = useTodaySummary(summaryRevision);

  const refreshSummary = () => {
    if (summaryTimer.current) clearTimeout(summaryTimer.current);
    summaryTimer.current = setTimeout(() => setSummaryRevision((n) => n + 1), 1500);
  };
  useStaffFeed({
    rentals: (rental) => {
      for (const listener of listeners.current) listener(rental);
      if (rental.id === openRef.current) setRevision((n) => n + 1);
      refreshSummary();
    },
    reconnected: () => {
      for (const listener of listeners.current) listener(null);
      setRevision((n) => n + 1);
      refreshSummary();
    },
  });
  const subscribe = useCallback((listener: (item: RentalListItem | null) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return (
    <>
      <ResourceList<RentalListItem>
        resource={rentalsResource}
        basePath={BASE}
        columns={columns}
        presets={presets}
        filters={filters}
        rowLabel={(r) => rentalNumber(r.number)}
        summary={(data) =>
          today ? t('resource.rentals.summaryToday', today) : t('resource.rentals.summary', { count: data.total })
        }
        emptyIcon={<RouteIcon size={22} />}
        createLabel={null}
        selectable={false}
        tabs={<RentalTabs />}
        onOpen={(r) => setOpenId(r.id)}
        activeId={openId}
        subscribe={subscribe}
      />
      {openId && <RentalDrawer key={openId} id={openId} revision={revision} onClose={() => setOpenId(null)} />}
    </>
  );
}

/** Panel boczny listy (makieta przejazdy-lista): najważniejsze z przejazdu bez opuszczania listy. */
function RentalDrawer({ id, revision, onClose }: { id: string; revision: number; onClose: () => void }) {
  const { can } = useSession();
  const { rental, receivedAt, error, apply } = useRentalDetails(id, revision);
  const [ending, setEnding] = useState(false);
  const running = rental !== null && rental.billedUntil === null && RUNNING_STATES.includes(rental.state);
  const now = useNow(running);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !ending && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, ending]);

  const counters = rental ? liveCounters(rental, receivedAt, now) : null;
  const problem = rental ? rentalProblem(rental) : null;
  const timeline = rental ? buildTimeline(rental) : [];
  const shown = timeline.slice(-DRAWER_TIMELINE);
  // Otwarty przejazd: bieżąca pozycja hulajnogi; zakończony: ostatni punkt trasy.
  const position: [number, number] | null = !rental
    ? null
    : !RUNNING_STATES.includes(rental.state)
      ? (rental.route.at(-1) ?? null)
      : rental.scooterLon != null && rental.scooterLat != null
        ? [rental.scooterLon, rental.scooterLat]
        : null;

  return (
    <aside className="rental-drawer" aria-label={t('rentals.preview')}>
      <div className="rd-head">
        <div>
          <div className="rd-title">
            <h2>{rental ? rentalNumber(rental.number) : t('common.loading')}</h2>
            {rental && <RentalStatePill state={rental.state} />}
          </div>
          {rental && (
            <div className="rd-sub">
              {can('users.read') ? (
                <Link className="link" href={`/admin/klienci/${rental.userId}`}>
                  {customerName(rental)}
                </Link>
              ) : (
                customerName(rental)
              )}
              {' · '}
              {t('rentals.scooter')}{' '}
              {can('scooters.read') ? (
                <Link className="link" href={`/admin/flota/${rental.scooterId}`}>
                  {scooterNumber(rental.scooterNumber)}
                </Link>
              ) : (
                scooterNumber(rental.scooterNumber)
              )}
            </div>
          )}
        </div>
        <button type="button" className="icon-btn plain" aria-label={t('common.close')} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="rd-body">
        {error && (
          <div className="banner danger" role="alert">
            {error}
          </div>
        )}
        {problem && (
          <div className="notice warn" role="status">
            <span className="ic">
              <WarningIcon size={15} />
            </span>
            <span>{problemNotice(problem)}</span>
          </div>
        )}
        {rental && (
          <>
            <RouteMap
              route={rental.route}
              position={position}
              ended={!RUNNING_STATES.includes(rental.state)}
              interactive={false}
              label={t('rentals.map.label')}
            />
            <div className="stat-row">
              <div className="stat">
                <span className="v">{formatDuration(counters!.rideSeconds)}</span>
                <span className="l">{t('rentals.stats.ride')}</span>
              </div>
              <div className="stat">
                <span className="v">{formatDuration(counters!.pauseSeconds)}</span>
                <span className="l">{t('rentals.stats.pause')}</span>
              </div>
              <div className="stat">
                <span className="v">{formatKm(rental.distanceM)}</span>
                <span className="l">{t('rentals.stats.distance')}</span>
              </div>
              <div className="stat">
                <span className="v">{formatPln(rental.price.total)}</span>
                <span className="l">
                  {rental.billedUntil === null ? t('rentals.stats.soFar') : t('rentals.stats.total')}
                </span>
              </div>
            </div>
            <section>
              <div className="rd-section-head">
                <h3>{t('rentals.timeline.title')}</h3>
                {shown.length < timeline.length && (
                  <span className="small">
                    {t('rentals.timeline.lastOf', { shown: shown.length, total: timeline.length })}
                  </span>
                )}
              </div>
              <Timeline items={shown} showState={false} />
            </section>
          </>
        )}
      </div>

      <div className="rd-foot">
        {rental && can('rentals.manage') && REMOTE_END_STATES.includes(rental.state) && (
          <button type="button" className="btn danger" onClick={() => setEnding(true)}>
            <StopIcon size={15} />
            {t('rentals.endRemotely')}
          </button>
        )}
        <span className="spacer" />
        <Link className="btn primary" href={`${BASE}/${id}`}>
          {t('rentals.details')}
          <ChevronRightIcon size={15} />
        </Link>
      </div>

      {ending && rental && (
        <RemoteEndDialog
          rental={rental}
          onClose={() => setEnding(false)}
          onEnded={(ended) => {
            setEnding(false);
            apply(ended);
          }}
        />
      )}
    </aside>
  );
}
