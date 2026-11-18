'use client';

/**
 * Pulpit „Wymaga uwagi” (D1 iteracji 6, makieta 27-panel-serwis/pulpit-uwaga): cztery grupy z liczbą i najwyżej
 * czterema pozycjami z `GET /admin/dashboard/attention`. Grupa jest w odpowiedzi tylko z uprawnieniem listy docelowej
 * (ADR 0055), a odnośnik prowadzi do tej listy z tym samym filtrem. Odświeżanie przez Socket.IO tam, gdzie są
 * zdarzenia (przejazdy, flota, zgłoszenia), a płatności co minutę.
 */
import {
  formatPln,
  type AttentionCriticalBattery,
  type AttentionFailedPayment,
  type AttentionOfflineRental,
  type AttentionUrgentTicket,
  type DashboardAttention,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { startOfToday, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { BatteryIcon, CardIcon, ChevronRightIcon, SearchIcon, ServiceIcon, WifiOffIcon } from '../icons';
import { ageLabel, categoryLabel, taskNumber, ticketNumber, TICKETS_BASE } from '../service/service-format';

/** Zdarzenia przychodzą często (pozycje floty co kilka sekund), więc pulpit odświeża się najwyżej co 5 s. */
const EVENT_REFRESH_MS = 5_000;
/** Nieudane płatności nie mają zdarzenia w panelu: odświeżenie co minutę. */
const POLL_MS = 60_000;

const today = new Intl.DateTimeFormat('pl', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Warsaw',
});

function useAttention() {
  const { can } = useSession();
  const [data, setData] = useState<DashboardAttention | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setRevision((n) => n + 1);
    }, EVENT_REFRESH_MS);
  }, []);
  const live = useStaffFeed({
    rentals: can('rentals.read') ? schedule : undefined,
    fleet: can('scooters.read') ? schedule : undefined,
    tickets: can('tickets.read') ? schedule : undefined,
    reconnected: () => setRevision((n) => n + 1),
  });

  useEffect(() => {
    const controller = new AbortController();
    api<DashboardAttention>('/admin/dashboard/attention', { signal: controller.signal })
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const poll = setInterval(() => setRevision((n) => n + 1), POLL_MS);
    return () => {
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { data, error, live };
}

/** Bieżąca chwila odświeżana co 30 s (czas bez sygnału, wiek zgłoszenia). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const since = (iso: string | null, now: number) =>
  iso ? ageLabel(Math.max(0, (now - Date.parse(iso)) / 1000)) : t('common.none');

export function DashboardPage() {
  const router = useRouter();
  const { can } = useSession();
  const { data, error, live } = useAttention();
  const now = useMinuteClock();
  const [query, setQuery] = useState('');

  // Pulpit tylko z `dashboard.read`; bez niego panel otwiera mapę floty jak przed iteracją 6.
  const allowed = can('dashboard.read');
  useEffect(() => {
    if (!allowed) router.replace('/admin/mapa');
  }, [allowed, router]);
  if (!allowed) return null;

  const groups = data
    ? [data.offlineInRental, data.criticalBattery, data.urgentTickets, data.failedPayments].filter((g) => g !== null)
    : [];
  const total = groups.reduce((sum, g) => sum + g.count, 0);

  // Wyszukiwarka z makiety: numer przejazdu, hulajnogi albo dane klienta prowadzą do listy z wyszukiwaniem.
  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const rental = /^r-?(\d+)$/i.exec(q);
    const scooter = /^#?(\d{1,4})$/.exec(q);
    if (rental && can('rentals.read')) router.push(`/admin/przejazdy?q=${rental[1]}`);
    else if (scooter && can('scooters.read')) router.push(`/admin/flota?q=${scooter[1]}`);
    else if (can('users.read')) router.push(`/admin/klienci?q=${encodeURIComponent(q)}`);
    else if (can('rentals.read')) router.push(`/admin/przejazdy?q=${encodeURIComponent(q)}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('dashboard.title')}</h1>
          <div className="sub">{capitalize(today.format(new Date(now)))}</div>
        </div>
        <div className="actions">
          <form className="search" role="search" onSubmit={search}>
            <SearchIcon />
            <span className="visually-hidden">{t('dashboard.search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('dashboard.search')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <span className="chip">
            <span className={live ? 'live' : 'live off'}>{t('dashboard.live')}</span>
          </span>
        </div>
      </div>

      <div className="att-head">
        <h2>{t('dashboard.attention')}</h2>
        {data && <span className="small">{t('dashboard.summary', { count: total, groups: groups.length })}</span>}
      </div>

      {error && <Banner kind="danger">{error}</Banner>}

      <div className="att-grid" aria-busy={!data}>
        {data?.offlineInRental && <OfflineGroup group={data.offlineInRental} now={now} />}
        {data?.criticalBattery && <BatteryGroup group={data.criticalBattery} pct={data.criticalBatteryPct} />}
        {data?.urgentTickets && <TicketsGroup group={data.urgentTickets} now={now} />}
        {data?.failedPayments && <PaymentsGroup group={data.failedPayments} />}
        {data && groups.length === 0 && (
          <section className="att empty">
            <span className="small">{t('dashboard.noGroups')}</span>
          </section>
        )}
      </div>
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface GroupProps {
  icon: ReactNode;
  tone: 'warn' | 'danger';
  title: string;
  count: number;
  note: string;
  link: { href: string; label: string };
  children: ReactNode;
}

function Group({ icon, tone, title, count, note, link, children }: GroupProps) {
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

function Item({ href, title, detail, value }: { href: string; title: string; detail: string; value: string }) {
  return (
    <Link className="att-item" href={href}>
      <span className="stack grow">
        <span className="strong">{title}</span>
        <span className="small">{detail}</span>
      </span>
      <span className="num">{value}</span>
      <ChevronRightIcon size={16} />
    </Link>
  );
}

const zoneLabel = (code: string | null, name: string | null) => (code ? [code, name].filter(Boolean).join(' ') : null);

function OfflineGroup({ group, now }: { group: NonNullable<DashboardAttention['offlineInRental']>; now: number }) {
  const detail = (r: AttentionOfflineRental) =>
    [
      r.userName ?? t('service.customer'),
      r.ticketNumber !== null
        ? t('dashboard.offline.ticket', { number: ticketNumber(r.ticketNumber) })
        : zoneLabel(r.parkingZoneCode, r.parkingZoneName) &&
          t('dashboard.offline.near', { zone: zoneLabel(r.parkingZoneCode, r.parkingZoneName) }),
      r.billingStopped && t('dashboard.offline.billingStopped'),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <Group
      icon={<WifiOffIcon size={18} />}
      tone="warn"
      title={t('dashboard.offline.title')}
      count={group.count}
      note={
        group.billingStopped > 0
          ? t('dashboard.offline.noteStopped', { count: group.billingStopped })
          : t('dashboard.offline.note')
      }
      link={{ href: '/admin/przejazdy?hasProblem=true', label: t('dashboard.offline.link') }}
    >
      {group.items.map((r) => (
        <Item
          key={r.rentalId}
          href={`/admin/przejazdy/${r.rentalId}`}
          title={`${scooterNumber(r.scooterNumber)} · ${rentalNumber(r.rentalNumber)}`}
          detail={detail(r)}
          value={since(r.lastSeenAt, now)}
        />
      ))}
    </Group>
  );
}

function batteryDetail(s: AttentionCriticalBattery): string {
  const zone = zoneLabel(s.parkingZoneCode, s.parkingZoneName);
  const where =
    s.rentalNumber !== null
      ? t('dashboard.battery.inRental', { number: rentalNumber(s.rentalNumber) })
      : s.status === 'MAINTENANCE'
        ? t('dashboard.battery.inService')
        : [t('dashboard.battery.free'), zone].filter(Boolean).join(', ');
  const task =
    s.taskNumber === null
      ? t('dashboard.battery.noTask')
      : s.taskOverdue
        ? t('dashboard.battery.taskOverdue', { number: taskNumber(s.taskNumber) })
        : s.taskAssigneeName
          ? t('dashboard.battery.taskAssigned', { number: taskNumber(s.taskNumber), name: s.taskAssigneeName })
          : t('dashboard.battery.taskUnassigned', { number: taskNumber(s.taskNumber) });
  return `${where} · ${task}`;
}

function BatteryGroup({ group, pct }: { group: NonNullable<DashboardAttention['criticalBattery']>; pct: number }) {
  // Ten sam warunek co w `fn_dashboard_attention`: hulajnogi w ruchu z baterią poniżej progu krytycznego.
  const href = `/admin/flota?status=AVAILABLE,RESERVED,IN_USE&batteryPct.lte=${Math.max(0, pct - 1)}`;
  return (
    <Group
      icon={<BatteryIcon size={18} />}
      tone="warn"
      title={t('dashboard.battery.title')}
      count={group.count}
      note={t('dashboard.battery.note', { pct })}
      link={{ href, label: t('dashboard.battery.link') }}
    >
      {group.items.map((s) => (
        <Item
          key={s.scooterId}
          href={`/admin/flota/${s.scooterId}`}
          title={scooterNumber(s.scooterNumber)}
          detail={batteryDetail(s)}
          value={s.batteryPct === null ? t('common.none') : t('common.percent', { value: s.batteryPct })}
        />
      ))}
    </Group>
  );
}

function TicketsGroup({ group, now }: { group: NonNullable<DashboardAttention['urgentTickets']>; now: number }) {
  const detail = (ticket: AttentionUrgentTicket) =>
    [
      scooterNumber(ticket.scooterNumber),
      ticket.reporterName ?? t('service.customer'),
      ticket.photos > 0 && t('service.photoCount', { count: ticket.photos }),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <Group
      icon={<ServiceIcon size={18} />}
      tone="danger"
      title={t('dashboard.tickets.title')}
      count={group.count}
      note={t('dashboard.tickets.note')}
      link={{ href: `${TICKETS_BASE}?status=NEW&urgent=true`, label: t('dashboard.tickets.link') }}
    >
      {group.items.map((ticket) => (
        <Item
          key={ticket.ticketId}
          href={`${TICKETS_BASE}/${ticket.ticketId}`}
          title={`${ticketNumber(ticket.ticketNumber)} · ${ticket.categories.map(categoryLabel).join(', ')}`}
          detail={detail(ticket)}
          value={since(ticket.createdAt, now)}
        />
      ))}
    </Group>
  );
}

function paymentDetail(p: AttentionFailedPayment): string {
  const subject =
    p.purpose === 'RIDE' && p.rentalNumber !== null
      ? rentalNumber(p.rentalNumber)
      : t.dynamic(`dashboard.payments.purpose.${p.purpose}`, {
          method: t.dynamic(`dashboard.payments.method.${p.method}`),
        });
  const reason =
    p.failureCode && t.has(`dashboard.payments.failure.${p.failureCode}`)
      ? t.dynamic(`dashboard.payments.failure.${p.failureCode}`)
      : t('dashboard.payments.declined');
  return `${subject} · ${reason}`;
}

function PaymentsGroup({ group }: { group: NonNullable<DashboardAttention['failedPayments']> }) {
  const href = `/admin/platnosci?status=FAILED&createdAt.gte=${encodeURIComponent(startOfToday())}`;
  return (
    <Group
      icon={<CardIcon size={18} />}
      tone="danger"
      title={t('dashboard.payments.title')}
      count={group.count}
      note={t('dashboard.payments.note', { count: group.unpaidRentals })}
      link={{ href, label: t('dashboard.payments.link') }}
    >
      {group.items.map((p) => (
        <Item
          key={p.paymentId}
          href={`/admin/platnosci/${p.paymentId}`}
          title={p.userName ?? t('service.customer')}
          detail={paymentDetail(p)}
          value={formatPln(p.amount)}
        />
      ))}
    </Group>
  );
}
