'use client';

/**
 * Karta hulajnogi → Historia stanów (ADR 0074, makieta hulajnoga-historia-stanow): oś czasu dób polskich z przedziałami
 * stanu i łączności (brak łączności przykrywa stan), udziały w okresie z `GET /admin/scooters/{id}/status-time` (jedna
 * definicja wykorzystania i dostępności w core) i lista przedziałów z filtrami i przyczyną dopasowaną w widoku
 * `v_scooter_status_history`. Okres: 24 h, 7 dni, 30 dni albo własny (do 31 dób na osi czasu).
 */
import {
  CHART_COLORS,
  intervalTimeline,
  scooterStatusHistoryResource,
  statusTimelineKey,
  warsawDayRows,
  type ChartStatusColor,
  type ScooterStatusHistoryItem,
  type ScooterStatusTime,
  type ScooterTimeCategory,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatClock, t } from '../../../lib/i18n';
import { Banner } from '../access/common';
import type { FilterSpec } from '../filter-drawer';
import { ChevronRightIcon } from '../icons';
import { InlineList } from '../inline-list';
import { valueLabel } from '../labels';
import { durationText, When } from '../list-format';
import type { Column } from '../resource-list';
import { taskNumber, taskTypeLabel, ticketNumber } from '../service/service-format';
import { rentalNumber } from './fleet-format';
import { TimelineChart } from './timeline-chart';

type PeriodKey = '24h' | '7d' | '30d' | 'custom';
const MAX_CUSTOM_DAYS = 31;

const CATEGORY_COLOR: Record<ScooterTimeCategory, ChartStatusColor> = {
  IN_RIDE: 'IN_RIDE',
  RESERVED: 'RESERVED',
  AVAILABLE: 'AVAILABLE',
  SERVICE: 'SERVICE',
  OFFLINE: 'OFFLINE',
  RETIRED: 'RETIRED',
};

const LEGEND: ChartStatusColor[] = ['AVAILABLE', 'RESERVED', 'IN_RIDE', 'SERVICE', 'OFFLINE', 'RETIRED'];

/** Dzisiejsza data w strefie Europe/Warsaw (`RRRR-MM-DD`). */
const warsawToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    now,
  );

const dayParts = new Intl.DateTimeFormat('pl', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** „pt 13 lis” jak w makiecie (bez kropek i przecinków z `Intl`). */
const dayLabel = {
  format: (at: Date) => {
    const p = Object.fromEntries(dayParts.formatToParts(at).map((x) => [x.type, x.value]));
    return `${(p.weekday ?? '').replace('.', '')} ${p.day ?? ''} ${p.month ?? ''}`;
  },
};
const shiftDay = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

interface Period {
  key: PeriodKey;
  rows: ReturnType<typeof warsawDayRows>;
  from: string;
  to: string;
}

function periodOf(key: PeriodKey, custom: { from: string; to: string }, now: Date): Period {
  const today = warsawToday(now);
  const label = (d: string) => (d === today ? t('statusHistory.today') : dayLabel.format(new Date(`${d}T00:00:00Z`)));
  if (key === 'custom') {
    const days = Math.min(MAX_CUSTOM_DAYS, Math.max(1, daysBetween(custom.from, custom.to) + 1));
    const last = shiftDay(custom.from, days - 1);
    const rows = warsawDayRows(last, days, label);
    const end = Math.min(now.getTime(), rows[rows.length - 1]!.to.getTime());
    return { key, rows, from: rows[0]!.from.toISOString(), to: new Date(end).toISOString() };
  }
  const count = key === '24h' ? 2 : key === '7d' ? 7 : 30;
  const rows = warsawDayRows(today, count, label);
  const from = key === '24h' ? new Date(now.getTime() - 86_400_000) : rows[0]!.from;
  return { key, rows, from: from.toISOString(), to: now.toISOString() };
}

const categoryLabel = (c: ScooterTimeCategory) => valueLabel(scooterStatusHistoryResource, 'category', c);
const pct = (share: number | null) => (share === null ? t('common.none') : t('statusHistory.percent', { value: share * 100 }));

export function CategoryPill({ category }: { category: ScooterTimeCategory }) {
  return (
    <span className="pill sh-pill">
      <i style={{ background: CHART_COLORS.status[CATEGORY_COLOR[category]] }} aria-hidden="true" />
      {categoryLabel(category)}
    </span>
  );
}

/** Przyczyna przedziału z odnośnikiem do przejazdu, zadania albo zgłoszenia (ADR 0074). */
function Reason({ item }: { item: ScooterStatusHistoryItem }) {
  const reason = valueLabel(scooterStatusHistoryResource, 'reason', item.reason);
  switch (item.reason) {
    case 'RENTAL':
    case 'RESERVATION':
      return item.reasonRentalId && item.reasonRentalNumber !== null ? (
        <span>
          {reason}{' '}
          <Link className="link num" href={`/admin/przejazdy/${item.reasonRentalId}`}>
            {rentalNumber(item.reasonRentalNumber)}
          </Link>
        </span>
      ) : (
        <span>{reason}</span>
      );
    case 'SERVICE_TASK':
      return (
        <span>
          {reason}{' '}
          {item.reasonTaskId && item.reasonTaskNumber !== null && (
            <Link className="link num" href={`/admin/zadania/${item.reasonTaskId}`}>
              {taskNumber(item.reasonTaskNumber)}
            </Link>
          )}{' '}
          {[item.reasonTaskType && taskTypeLabel(item.reasonTaskType), item.reasonTaskAssigneeName]
            .filter(Boolean)
            .join(' · ')}
        </span>
      );
    case 'TICKET':
    case 'AUTO_OFFLINE':
      return (
        <span>
          {reason}
          {item.reasonTicketId && item.reasonTicketNumber !== null && (
            <>
              {' · '}
              <Link className="link num" href={`/admin/zgloszenia/${item.reasonTicketId}`}>
                {ticketNumber(item.reasonTicketNumber)}
              </Link>
              {item.reasonTicketAutoKind && ` ${t('statusHistory.automatic')}`}
            </>
          )}
        </span>
      );
    case 'STAFF':
      return (
        <span>
          {reason}
          {item.reasonStaffName && ` · ${item.reasonStaffName}`}
          {item.reasonAuditAction && <small className="code"> {item.reasonAuditAction}</small>}
        </span>
      );
    case 'NO_TELEMETRY':
      return (
        <span>
          {reason}
          {item.validTo && ` · ${t('statusHistory.cameBack')}`}
        </span>
      );
    default:
      return <span>{reason}</span>;
  }
}

const reasonHref = (item: ScooterStatusHistoryItem): string | null =>
  item.reasonRentalId
    ? `/admin/przejazdy/${item.reasonRentalId}`
    : item.reasonTaskId
      ? `/admin/zadania/${item.reasonTaskId}`
      : item.reasonTicketId
        ? `/admin/zgloszenia/${item.reasonTicketId}`
        : null;

const columns: Column<ScooterStatusHistoryItem>[] = [
  { field: 'category', width: '150px', render: (i) => <CategoryPill category={i.category} /> },
  { field: 'validFrom', width: '150px', render: (i) => <When at={i.validFrom} /> },
  {
    field: 'validTo',
    width: '150px',
    render: (i) => (i.validTo ? <When at={i.validTo} /> : <span className="live">{t('statusHistory.now')}</span>),
  },
  { field: 'durationSeconds', width: '120px', render: (i) => <span className="num">{durationText(i.durationSeconds)}</span> },
  { field: 'reason', width: 'minmax(0,1fr)', render: (i) => <Reason item={i} /> },
];

const filters: FilterSpec[] = [
  { field: 'category', kind: 'checklist' },
  { field: 'reason', kind: 'checklist' },
  { field: 'status', kind: 'checklist' },
  { field: 'online', kind: 'boolean' },
  { field: 'durationSeconds', kind: 'range' },
];

const EXPORT = [
  'scooterNumber',
  'category',
  'status',
  'online',
  'validFrom',
  'validTo',
  'durationSeconds',
  'reason',
  'reasonRentalNumber',
  'reasonTaskNumber',
  'reasonTicketNumber',
  'reasonStaffName',
] as const;

/** Szerokość kontenera dla geometrii wykresu (bez DOM w shared). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function StatusHistoryTab({ scooterId }: { scooterId: string }) {
  const [key, setKey] = useState<PeriodKey>('7d');
  const [custom, setCustom] = useState(() => ({ from: shiftDay(warsawToday(), -6), to: warsawToday() }));
  const [draft, setDraft] = useState(custom);
  const [now, setNow] = useState(() => new Date());
  const period = useMemo(() => periodOf(key, custom, now), [key, custom, now]);
  const [data, setData] = useState<ScooterStatusTime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ref, width } = useWidth();

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api<ScooterStatusTime>(
      `/admin/scooters/${scooterId}/status-time?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`,
      { signal: controller.signal },
    )
      .then(setData)
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [scooterId, period.from, period.to]);

  const model = useMemo(() => {
    if (!data) return null;
    return intervalTimeline({
      width: width - 4,
      title: t.dynamic(`statusHistory.periods.${period.key}`),
      rows: period.rows,
      intervals: data.intervals.map((i) => ({
        from: new Date(i.from),
        to: i.open ? null : new Date(i.to),
        color: statusTimelineKey(i.status, i.online),
        label: i.online ? categoryLabel(i.category) : categoryLabel('OFFLINE'),
        // Bez łączności przykrywa stan: dymek podaje stan hulajnogi pod spodem.
        details: i.online ? [] : [valueLabel(scooterStatusHistoryResource, 'status', i.status)],
      })),
      now: new Date(data.now),
      legend: LEGEND.filter((k) => k !== 'RETIRED' || data.totals.RETIRED > 0).map((k) => ({
        key: k,
        label: t.dynamic(`statusHistory.legend.${k}`),
      })),
      formatDuration: durationText,
      columns: [
        t('resource.scooter-status-history.fields.category'),
        t('resource.scooter-status-history.fields.validFrom'),
        t('resource.scooter-status-history.fields.validTo'),
        t('resource.scooter-status-history.fields.durationSeconds'),
      ],
    });
  }, [data, width, period]);

  const count = (category: ScooterTimeCategory) => data?.intervals.filter((i) => i.category === category).length ?? 0;
  const firstRow = period.rows[0];

  return (
    <div className="sh">
      <div className="sh-top">
        <section className="card sh-chart" ref={ref}>
          <div className="sh-head">
            <div className="stack">
              <h2>{t.dynamic(`statusHistory.periods.${period.key}`)}</h2>
              <span className="small num">
                {firstRow &&
                  t('statusHistory.periodText', {
                    from: `${dayLabel.format(new Date(`${firstRow.key}T00:00:00Z`))}, ${formatClock(period.from)}`,
                    duration: durationText(data?.periodSeconds ?? 0),
                  })}
              </span>
            </div>
            <span className="zc-seg sh-seg" role="radiogroup" aria-label={t('statusHistory.period')}>
              {(['24h', '7d', '30d', 'custom'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={key === k}
                  onClick={() => {
                    setNow(new Date());
                    setKey(k);
                  }}
                >
                  {t.dynamic(`statusHistory.periodButtons.${k}`)}
                </button>
              ))}
            </span>
          </div>
          {key === 'custom' && (
            <div className="sh-custom">
              <label className="field">
                <span className="label">{t('list.from')}</span>
                <input
                  className="input"
                  type="date"
                  value={draft.from}
                  max={warsawToday()}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="label">{t('list.to')}</span>
                <input
                  className="input"
                  type="date"
                  value={draft.to}
                  max={warsawToday()}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={!draft.from || !draft.to || draft.to < draft.from || daysBetween(draft.from, draft.to) >= MAX_CUSTOM_DAYS}
                onClick={() => {
                  setNow(new Date());
                  setCustom(draft);
                }}
              >
                {t('statusHistory.apply')}
              </button>
              <span className="hint">{t('statusHistory.customHint', { days: MAX_CUSTOM_DAYS })}</span>
            </div>
          )}
          {error && <Banner kind="danger">{error}</Banner>}
          {data && data.historySince === null && <p className="muted">{t('statusHistory.noHistory')}</p>}
          {data?.historySince && Date.parse(data.historySince) > Date.parse(period.from) && (
            <p className="hint">
              {t('statusHistory.since', { date: `${dayLabel.format(new Date(data.historySince))}, ${formatClock(data.historySince)}` })}
            </p>
          )}
          {model ? <TimelineChart model={model} /> : !error && <div className="sh-skeleton" aria-busy="true" />}
        </section>

        <section className="card sh-shares" aria-busy={!data}>
          <h2>{t('statusHistory.shares')}</h2>
          <Share
            label={t('statusHistory.utilization')}
            value={pct(data?.utilization ?? null)}
            share={data?.utilization ?? 0}
            color={CHART_COLORS.status.IN_RIDE}
            sub={t('statusHistory.utilizationSub', {
              duration: durationText(data?.totals.IN_RIDE ?? 0),
              count: count('IN_RIDE'),
            })}
          />
          <Share
            label={t('statusHistory.availability')}
            value={pct(data?.availability ?? null)}
            share={data?.availability ?? 0}
            color={CHART_COLORS.status.AVAILABLE}
            sub={t('statusHistory.availabilitySub')}
          />
          <Share
            label={t('statusHistory.service')}
            value={pct(data?.shares.SERVICE ?? null)}
            share={data?.shares.SERVICE ?? 0}
            color={CHART_COLORS.status.SERVICE}
            sub={t('statusHistory.serviceSub', {
              duration: durationText(data?.totals.SERVICE ?? 0),
              count: count('SERVICE'),
            })}
          />
          <Share
            label={t('statusHistory.offline')}
            value={pct(data?.shares.OFFLINE ?? null)}
            share={data?.shares.OFFLINE ?? 0}
            color={CHART_COLORS.status.OFFLINE}
            sub={t('statusHistory.offlineSub', {
              duration: durationText(data?.totals.OFFLINE ?? 0),
              count: count('OFFLINE'),
            })}
          />
        </section>
      </div>

      <InlineList<ScooterStatusHistoryItem>
        resource={scooterStatusHistoryResource}
        columns={columns}
        fixed={[{ field: 'scooterId', op: 'eq', values: [scooterId] }]}
        extra={{ from: period.from, to: period.to }}
        filters={filters}
        title={t('statusHistory.intervals')}
        rowKey={(i) => i.id}
        emptyText={t('statusHistory.emptyIntervals')}
        exportColumns={EXPORT}
        pageSize={10}
        trailing={(i) => {
          const href = reasonHref(i);
          return href ? (
            <Link href={href} className="icon-btn plain" aria-label={t('statusHistory.openReason')}>
              <ChevronRightIcon size={16} />
            </Link>
          ) : null;
        }}
      />
    </div>
  );
}

function Share(props: { label: string; value: string; share: number; color: string; sub: string }) {
  return (
    <div className="sh-share">
      <div className="sh-share-top">
        <span className="strong">{props.label}</span>
        <span className="sh-share-value num">{props.value}</span>
      </div>
      <span className="sh-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.max(0, props.share * 100))}%`, background: props.color }} />
      </span>
      <span className="small">{props.sub}</span>
    </div>
  );
}

