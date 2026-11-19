'use client';

/**
 * Pulpit z kafelkami i wykresami (iteracja 8, pytanie 9, plansze 33-panel-pulpit): `GET /admin/dashboard/summary`.
 * Kafelki w stałej kolejności katalogu (rola widzi pierwsze pięć dozwolonych) prowadzą do listy z tym samym filtrem;
 * „Przejazdy dziś według godzin” ze średnią z czterech tych samych dni tygodnia, „Stan floty” jako pasek udziałów,
 * „Twoje zadania” Serwisanta i kafelki z grupą „Treści” Redaktora. Pole bez uprawnienia ma wartość `null` i nie ma
 * swojej sekcji; wykresy rysuje `Chart` z geometrii w packages/shared (ADR 0072).
 */
import {
  barSeries,
  CHART_COLORS,
  formatPln,
  serviceTasksResource,
  shareBar,
  type DashboardSummary,
  type DashboardTile,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { formatClock, startOfToday, t } from '../../../lib/i18n';
import { Chart, Swatch } from '../charts/chart';
import { scooterNumber } from '../fleet/fleet-format';
import { ChevronRightIcon, MapIcon } from '../icons';
import { valueLabel } from '../labels';
import { formatFileSize, formatNumber, formatShare } from '../reports/reports-common';
import { taskNumber } from '../service/service-format';

// ---------------------------------------------------------------------------------------------
// Kafelki
// ---------------------------------------------------------------------------------------------

/** Lista docelowa kafelka z filtrem odpowiadającym liczbie (ten sam warunek co w `fn_dashboard_summary`). */
function tileHref(tile: DashboardTile): string {
  switch (tile.key) {
    case 'activeRides':
      return '/admin/przejazdy?state=UNLOCKING,ACTIVE,PAUSED,ENDING';
    case 'availableScooters':
      return '/admin/flota?status=AVAILABLE';
    case 'lowBattery':
      return `/admin/flota?status=AVAILABLE,RESERVED,IN_USE&batteryPct.lte=${Math.max(0, tile.thresholdPct - 1)}`;
    case 'salesToday':
      return `/admin/platnosci/paragony?issuedAt.gte=${encodeURIComponent(startOfToday())}`;
    case 'newTickets':
      return '/admin/zgloszenia?status=NEW';
    case 'tasksInProgress':
      return '/admin/zadania?status=OPEN,IN_PROGRESS';
    case 'partsBelowMinimum':
      return '/admin/czesci?belowMinimum=true';
  }
}

function tileContent(tile: DashboardTile): { value: string; suffix?: string; note: string; warn?: boolean } {
  switch (tile.key) {
    case 'activeRides':
      return {
        value: formatNumber(tile.value),
        note: t('dashboard.tiles.activeRidesNote', { count: tile.startedLastHour }),
      };
    case 'availableScooters':
      return {
        value: formatNumber(tile.value),
        suffix: t('dashboard.tiles.ofTotal', { total: formatNumber(tile.fleetTotal) }),
        note: t('dashboard.tiles.availableNote', {
          share: tile.share === null ? t('common.none') : formatShare(tile.share, 0),
        }),
      };
    case 'lowBattery':
      return tile.critical > 0
        ? {
            value: formatNumber(tile.value),
            note: t('dashboard.tiles.lowBatteryCritical', { count: tile.critical, pct: 10 }),
            warn: true,
          }
        : { value: formatNumber(tile.value), note: t('dashboard.tiles.lowBatteryNote', { pct: tile.thresholdPct }) };
    case 'salesToday':
      return { value: formatPln(tile.value), note: t('dashboard.tiles.salesNote', { count: tile.receipts }) };
    case 'newTickets':
      return {
        value: formatNumber(tile.value),
        note: t('dashboard.tiles.ticketsNote', { count: tile.urgentUnassigned }),
      };
    case 'tasksInProgress':
      return {
        value: formatNumber(tile.value),
        note: t('dashboard.tiles.tasksNote', { mine: tile.mine, overdue: tile.overdue }),
      };
    case 'partsBelowMinimum':
      return tile.value > 0
        ? { value: formatNumber(tile.value), note: tile.names.join(', '), warn: true }
        : { value: formatNumber(tile.value), note: t('dashboard.tiles.partsNone') };
  }
}

export function SummaryTile({
  href,
  label,
  value,
  suffix,
  note,
  warn,
}: {
  href: string;
  label: string;
  value: string;
  suffix?: string;
  note: string;
  warn?: boolean;
}) {
  return (
    <Link className="dash-tile" href={href}>
      <span className="dash-tile-label">
        {label}
        <ChevronRightIcon size={15} />
      </span>
      <span className="dash-tile-value num">
        {value}
        {suffix && <small>{suffix}</small>}
      </span>
      <span className={warn ? 'dash-tile-note warn' : 'dash-tile-note'}>{note}</span>
    </Link>
  );
}

export function SummaryTiles({ tiles }: { tiles: DashboardTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="dash-tiles" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
      {tiles.map((tile) => (
        <SummaryTile
          key={tile.key}
          href={tileHref(tile)}
          label={t.dynamic(`dashboard.tiles.${tile.key}`)}
          {...tileContent(tile)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Przejazdy dziś według godzin
// ---------------------------------------------------------------------------------------------

/** Dzień tygodnia doby `RRRR-MM-DD` (1 = poniedziałek) do podpisu średniej („z 4 ostatnich czwartków”). */
const isoDow = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

export function RidesByHourCard({ data, asOf }: { data: NonNullable<DashboardSummary['ridesByHour']>; asOf: string }) {
  const avgLabel = t('dashboard.rides.average', { dow: isoDow(data.day) });
  const current = data.currentHour;
  return (
    <section className="card dash-card dash-rides" aria-labelledby="dash-rides">
      <Chart
        header={
          <h2 className="rp-card-title" id="dash-rides">
            {t('dashboard.rides.title')}
          </h2>
        }
        meta={
          <>
            <b className="num">{formatNumber(data.ridesSoFar)}</b>{' '}
            {t('dashboard.rides.soFar', { count: data.ridesSoFar, time: formatClock(asOf) })}{' '}
            <b className="num">{formatNumber(Math.round(data.avgSoFar))}</b> {t('dashboard.rides.avgSoFar')}
          </>
        }
        legend="below"
        legendExtra={
          current !== null ? (
            <li>
              <Swatch item={{ color: CHART_COLORS.current }} />
              {t('dashboard.rides.currentHour', { time: formatClock(asOf) })}
            </li>
          ) : undefined
        }
        placeholderHeight={170}
        build={(width) =>
          barSeries({
            width,
            height: 170,
            title: t('dashboard.rides.title'),
            items: data.hours.map((h) => ({
              key: String(h.hour),
              label: String(h.hour),
              value: h.state === 'future' ? null : h.rides,
              marker: h.avgPrevious,
              highlight: h.state === 'current',
              title: t('dashboard.rides.hourTitle', { hour: h.hour }),
            })),
            seriesLabel: t('dashboard.rides.today'),
            markerLabel: avgLabel,
            categoryLabel: t('dashboard.rides.hour'),
          })
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Stan floty
// ---------------------------------------------------------------------------------------------

const FLEET_COLORS = {
  AVAILABLE: CHART_COLORS.status.AVAILABLE,
  IN_USE_OR_RESERVED: CHART_COLORS.status.IN_RIDE,
  LOW_BATTERY: CHART_COLORS.status.LOW_BATTERY,
  MAINTENANCE: CHART_COLORS.status.SERVICE,
  OFFLINE: CHART_COLORS.status.OFFLINE,
} as const;

/** Lista floty z filtrem odcinka paska. */
const FLEET_LINKS = {
  AVAILABLE: '/admin/flota?status=AVAILABLE',
  IN_USE_OR_RESERVED: '/admin/flota?status=RESERVED,IN_USE',
  LOW_BATTERY: '/admin/flota?status=AVAILABLE',
  MAINTENANCE: '/admin/flota?status=MAINTENANCE',
  OFFLINE: '/admin/flota?online=false',
} as const;

export function FleetStateCard({ data }: { data: NonNullable<DashboardSummary['fleetState']> }) {
  const router = useRouter();
  return (
    <section className="card dash-card dash-fleet" aria-labelledby="dash-fleet">
      <Chart
        header={
          <h2 className="rp-card-title" id="dash-fleet">
            {t('dashboard.fleet.title')}
          </h2>
        }
        meta={
          <>
            <b className="num">{formatNumber(data.total)}</b> {t('dashboard.fleet.inService')}
          </>
        }
        legend="rows"
        tableToggle={false}
        placeholderHeight={12}
        onSelect={(index) => {
          const segment = data.segments[index];
          if (segment) router.push(FLEET_LINKS[segment.key]);
        }}
        build={(width) =>
          shareBar({
            width,
            height: 12,
            title: t('dashboard.fleet.title'),
            segments: data.segments.map((s) => ({
              key: s.key,
              label: t.dynamic(`dashboard.fleet.segments.${s.key}`),
              value: s.count,
              color: FLEET_COLORS[s.key],
            })),
            format: (v) => formatNumber(v),
            formatShare: (v) => formatShare(v, 0),
          })
        }
      />
      <div className="dash-card-foot">
        <span className="small">{t('dashboard.fleet.retired', { count: data.retired })}</span>
        <Link className="btn" href="/admin/mapa">
          <MapIcon size={16} />
          {t('dashboard.fleet.openMap')}
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Twoje zadania (Serwisant)
// ---------------------------------------------------------------------------------------------

const dueFormat = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' });

function dueLabel(iso: string | null, now: number): string {
  if (!iso) return t('dashboard.myTasks.noDue');
  const day = dayKey.format(new Date(iso));
  const time = formatClock(iso);
  if (day === dayKey.format(new Date(now))) return t('dashboard.myTasks.today', { time });
  if (day === dayKey.format(new Date(now + 86_400_000))) return t('dashboard.myTasks.tomorrow', { time });
  return t('dashboard.myTasks.date', { date: dueFormat.format(new Date(iso)), time });
}

export function MyTasksCard({ data, now }: { data: NonNullable<DashboardSummary['myTasks']>; now: number }) {
  return (
    <section className="card dash-card dash-tasks" aria-labelledby="dash-tasks">
      <div className="chart-head">
        <h2 className="rp-card-title" id="dash-tasks">
          {t('dashboard.myTasks.title')}
        </h2>
        <span className="chart-meta">
          <b className="num">{data.assigned}</b>{' '}
          {t('dashboard.myTasks.summary', { total: data.inProgressTotal, overdue: data.overdue })}
        </span>
      </div>
      <div className="dash-task-table" role="table" aria-labelledby="dash-tasks">
        <div className="dash-task-row head" role="row">
          <span role="columnheader">{t('dashboard.myTasks.number')}</span>
          <span role="columnheader">{t('dashboard.myTasks.type')}</span>
          <span role="columnheader">{t('dashboard.myTasks.scooter')}</span>
          <span role="columnheader">{t('dashboard.myTasks.status')}</span>
          <span role="columnheader">{t('dashboard.myTasks.due')}</span>
          <span role="columnheader" />
        </div>
        {data.items.length === 0 && <p className="small dash-none">{t('dashboard.myTasks.empty')}</p>}
        {data.items.map((task) => (
          <Link key={task.taskId} role="row" className="dash-task-row" href={`/admin/zadania/${task.taskId}`}>
            <span role="cell" className="strong">
              {taskNumber(task.number)}
            </span>
            <span role="cell">{valueLabel(serviceTasksResource, 'type', task.type)}</span>
            <span role="cell" className="strong num">
              {scooterNumber(task.scooterNumber)}
            </span>
            <span role="cell">
              <span className={task.status === 'IN_PROGRESS' ? 'pill accent sm' : 'pill sm'}>
                {valueLabel(serviceTasksResource, 'status', task.status)}
              </span>
            </span>
            <span role="cell" className={task.overdue ? 'num overdue' : 'num'}>
              {dueLabel(task.dueAt, now)}
            </span>
            <span role="cell" className="muted">
              <ChevronRightIcon size={16} />
            </span>
          </Link>
        ))}
      </div>
      <div className="dash-card-foot">
        <span className="small">{t('dashboard.myTasks.unassigned', { count: data.unassigned })}</span>
        <Link className="link att-link" href="/admin/zadania?status=OPEN,IN_PROGRESS">
          {t('dashboard.myTasks.all')}
          <ChevronRightIcon size={14} />
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Treści (Redaktor)
// ---------------------------------------------------------------------------------------------

type Content = NonNullable<DashboardSummary['content']>;

export function ContentTiles({ content }: { content: Content }) {
  const { publishedNews, faq, sectionBlocks, media } = content.tiles;
  return (
    <div className="dash-tiles" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
      <SummaryTile
        href="/admin/tresci/aktualnosci?state=PUBLISHED"
        label={t('dashboard.contentTiles.news')}
        value={formatNumber(publishedNews.value)}
        note={t('dashboard.contentTiles.newsNote', {
          scheduled: publishedNews.scheduled,
          expiring: publishedNews.expiringSoon,
        })}
      />
      <SummaryTile
        href="/admin/tresci/faq"
        label={t('dashboard.contentTiles.faq')}
        value={formatNumber(faq.value)}
        note={t('dashboard.contentTiles.faqNote', { categories: faq.categories, unpublished: faq.unpublished })}
      />
      <SummaryTile
        href="/admin/tresci/bloki"
        label={t('dashboard.contentTiles.blocks')}
        value={formatNumber(sectionBlocks.value)}
        note={t('dashboard.contentTiles.blocksNote', {
          web: sectionBlocks.web,
          mobile: sectionBlocks.mobile,
          drafts: sectionBlocks.drafts,
        })}
      />
      <SummaryTile
        href="/admin/tresci/media"
        label={t('dashboard.contentTiles.media')}
        value={formatNumber(media.value)}
        note={t('dashboard.contentTiles.mediaNote', { unused: media.unused })}
      />
    </div>
  );
}

const whenFormat = new Intl.DateTimeFormat('pl', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Warsaw',
});
const shortDate = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' });
const days = (iso: string, now: number) => Math.round((new Date(iso).getTime() - now) / 86_400_000);

const DRAFT_LINKS = {
  NEWS: '/admin/tresci/aktualnosci?state=DRAFT',
  CONTENT_BLOCK: '/admin/tresci/bloki?status=DRAFT',
  LEGAL_DOCUMENT: '/admin/tresci',
} as const;

interface GroupProps {
  icon: ReactNode;
  tone: 'accent' | 'warn' | 'neutral';
  title: string;
  count: number;
  note: string;
  link: { href: string; label: string };
  children: ReactNode;
}

/** Grupa jak „Wymaga uwagi” (liczba i pozycje), z tonem ikony według planszy pulpit-redaktor. */
function ContentGroup({ icon, tone, title, count, note, link, children }: GroupProps) {
  return (
    <section className="att" aria-label={title}>
      <div className="att-side">
        <span className={`att-badge ${tone}`} aria-hidden="true">
          {icon}
        </span>
        <h3>{title}</h3>
        <span className="att-count num">{count}</span>
        <span className="small att-note">{note}</span>
        <span className="grow" />
        <Link className="link att-link" href={link.href}>
          {link.label}
          <ChevronRightIcon size={14} />
        </Link>
      </div>
      <div className="att-items">
        {count === 0 ? <p className="small att-none">{t('dashboard.nothing')}</p> : children}
      </div>
    </section>
  );
}

function ContentItem({ href, title, detail, value }: { href: string; title: string; detail: string; value?: string }) {
  return (
    <Link className="att-item" href={href}>
      <span className="stack grow">
        <span className="strong">{title}</span>
        <span className="small">{detail}</span>
      </span>
      {value && <span className="num">{value}</span>}
      <ChevronRightIcon size={16} />
    </Link>
  );
}

export function ContentGroups({
  content,
  now,
  icons,
}: {
  content: Content;
  now: number;
  icons: { calendar: ReactNode; clock: ReactNode; pencil: ReactNode; image: ReactNode };
}) {
  const total =
    content.scheduledNews.count + content.expiringNews.count + content.drafts.count + content.unusedMedia.count;
  return (
    <>
      <div className="att-head">
        <h2>{t('dashboard.content.title')}</h2>
        <span className="small">
          {t('dashboard.content.summaryGroups', { count: total })}
          {content.lastPublishedAt &&
            ` · ${t('dashboard.content.lastPublished', { when: whenFormat.format(new Date(content.lastPublishedAt)) })}`}
        </span>
      </div>
      <div className="att-grid dash-content-grid">
        <ContentGroup
          icon={icons.calendar}
          tone="accent"
          title={t('dashboard.content.scheduled')}
          count={content.scheduledNews.count}
          note={t('dashboard.content.scheduledNote7')}
          link={{ href: '/admin/tresci/aktualnosci?state=SCHEDULED', label: t('dashboard.content.scheduledAll') }}
        >
          {content.scheduledNews.items.map((n) => (
            <ContentItem
              key={n.id}
              href="/admin/tresci/aktualnosci?state=SCHEDULED"
              title={n.title}
              detail={[t('dashboard.content.from', { when: whenFormat.format(new Date(n.publishFrom)) }), n.authorName]
                .filter(Boolean)
                .join(' · ')}
              value={t('dashboard.content.inDays', { count: Math.max(0, days(n.publishFrom, now)) })}
            />
          ))}
        </ContentGroup>
        <ContentGroup
          icon={icons.clock}
          tone="warn"
          title={t('dashboard.content.expiring')}
          count={content.expiringNews.count}
          note={t('dashboard.content.expiringNote')}
          link={{ href: '/admin/tresci/aktualnosci?state=PUBLISHED', label: t('dashboard.content.expiringAll') }}
        >
          {content.expiringNews.items.map((n) => (
            <ContentItem
              key={n.id}
              href="/admin/tresci/aktualnosci?state=PUBLISHED"
              title={n.title}
              detail={[t('dashboard.content.until', { when: whenFormat.format(new Date(n.publishTo)) }), n.authorName]
                .filter(Boolean)
                .join(' · ')}
              value={t('dashboard.content.inDays', { count: Math.max(0, days(n.publishTo, now)) })}
            />
          ))}
        </ContentGroup>
        <ContentGroup
          icon={icons.pencil}
          tone="neutral"
          title={t('dashboard.content.drafts')}
          count={content.drafts.count}
          note={t('dashboard.content.draftsNoteOldest')}
          link={{ href: '/admin/tresci/bloki?status=DRAFT', label: t('dashboard.content.draftsAll') }}
        >
          {content.drafts.items.map((d) => (
            <ContentItem
              key={`${d.kind}-${d.id}`}
              href={DRAFT_LINKS[d.kind]}
              title={d.title}
              detail={[
                t.dynamic(`dashboard.content.kind.${d.kind}`),
                d.client ? t.dynamic(`dashboard.content.client.${d.client}`) : null,
                t('dashboard.content.draftSince', { date: shortDate.format(new Date(d.updatedAt)) }),
              ]
                .filter(Boolean)
                .join(' · ')}
              value={t('dashboard.content.ageDays', { count: Math.max(0, -days(d.updatedAt, now)) })}
            />
          ))}
        </ContentGroup>
        <ContentGroup
          icon={icons.image}
          tone="neutral"
          title={t('dashboard.content.unusedMedia')}
          count={content.unusedMedia.count}
          note={t('dashboard.content.unusedNote')}
          link={{ href: '/admin/tresci/media?usages.lte=0', label: t('dashboard.content.unusedAll') }}
        >
          {content.unusedMedia.items.map((m) => (
            <ContentItem
              key={m.id}
              href="/admin/tresci/media?usages.lte=0"
              title={m.originalName ?? t('dashboard.content.noName')}
              detail={[
                m.width && m.height ? t('dashboard.content.size', { width: m.width, height: m.height }) : null,
                formatFileSize(m.sizeBytes),
                t('dashboard.content.uploaded', { date: shortDate.format(new Date(m.createdAt)) }),
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </ContentGroup>
      </div>
    </>
  );
}
