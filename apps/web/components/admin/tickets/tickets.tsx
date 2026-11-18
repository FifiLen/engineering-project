'use client';

/**
 * Zasób `tickets` w panelu (makieta zgloszenia-lista, ADR 0055): lista według wzorca z szybkimi filtrami stanu,
 * przełącznikami pilności i źródła z licznikami, podgląd zgłoszenia w panelu bocznym i zmiany na żywo z pokoju
 * `tickets`. Domyślnie lista pokazuje zgłoszenia otwarte.
 */
import {
  parseListQuery,
  ticketsResource,
  toSearchParams,
  type ListFilter,
  type ListResponse,
  type ServiceTaskDetails,
  type TicketListItem,
  type TicketSource,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { formatClock, t } from '../../../lib/i18n';
import { useStaffFeed } from '../../../lib/realtime';
import { useSession } from '../../../lib/session';
import type { FilterSpec } from '../filter-drawer';
import { rentalNumber, scooterNumber } from '../fleet/fleet-format';
import { CloseIcon, ImageIcon, ServiceIcon } from '../icons';
import { ResourceList, type Column, type QuickPreset } from '../resource-list';
import {
  ageLabel,
  Categories,
  reporterLabel,
  TASKS_BASE,
  TICKETS_BASE,
  TicketStatusPill,
  taskNumber,
  ticketNumber,
} from '../service/service-format';
import { ServiceTimeline, ticketTimeline } from '../service/service-timeline';
import { TaskCreateDialog } from '../service/task-create-dialog';
import { Assignee, AssignControl, ScooterStatePill, TicketPhotos, useTicketDetails } from './ticket-parts';

/** Otwarte zgłoszenia: wszystko poza rozwiązanymi (domyślny szybki filtr). */
export const OPEN_TICKET_STATES = ['NEW', 'IN_PROGRESS', 'AT_SERVICE'] as const;
/** Panel boczny pokazuje ostatnie wpisy osi czasu; pełna oś jest w szczegółach. */
const DRAWER_TIMELINE = 3;

const columns: Column<TicketListItem>[] = [
  { field: 'number', width: '56px', render: (x) => <span className="strong">{ticketNumber(x.number)}</span> },
  {
    field: 'categories',
    width: 'minmax(0,1fr)',
    render: (x) => (
      <span className="cats">
        <Categories categories={x.categories} urgent={x.urgent} />
        {x.photos > 0 && (
          <span className="camn">
            <ImageIcon />
            {x.photos}
          </span>
        )}
      </span>
    ),
  },
  {
    field: 'scooterNumber',
    width: '52px',
    render: (x) => <span className="strong">{scooterNumber(x.scooterNumber)}</span>,
  },
  {
    field: 'reporterName',
    width: '118px',
    render: (x) => (
      <span className={x.source === 'USER' && x.reporterName ? undefined : 'muted'}>
        {reporterLabel(x.source, x.reporterName)}
      </span>
    ),
  },
  { field: 'status', width: '92px', render: (x) => <TicketStatusPill status={x.status} /> },
  { field: 'assigneeName', width: '112px', render: (x) => <Assignee name={x.assigneeName} short /> },
  { field: 'ageSeconds', width: '64px', render: (x) => <span className="num muted">{ageLabel(x.ageSeconds)}</span> },
];

const filters: FilterSpec[] = [
  { field: 'categories', kind: 'chips' },
  { field: 'autoKind', kind: 'chips' },
  { field: 'createdAt', kind: 'dateRange' },
  { field: 'resolvedAt', kind: 'dateRange' },
];

const sum = (counts: Record<string, number> | undefined, keys: readonly string[]) =>
  keys.reduce((total, key) => total + (counts?.[key] ?? 0), 0);

const presets: { items: QuickPreset[]; facets: string[]; total: (f: ListResponse<unknown>['facets']) => number } = {
  facets: ['status'],
  total: (f) => Object.values(f.status ?? {}).reduce((a, b) => a + b, 0),
  items: [
    { key: 'open', states: OPEN_TICKET_STATES },
    { key: 'NEW', states: ['NEW'] },
    { key: 'IN_PROGRESS', states: ['IN_PROGRESS'] },
    { key: 'AT_SERVICE', states: ['AT_SERVICE'] },
    { key: 'RESOLVED', states: ['RESOLVED'] },
  ].map(({ key, states }) => ({
    key,
    label: key === 'open' ? t('resource.tickets.quick.open') : t.dynamic(`service.ticketStatus.${key}`),
    filters: [{ field: 'status', op: 'eq', values: [...states] }],
    count: (f) => sum(f.status, states),
  })),
};

/** Podtytuł z makiety: otwarte, w tym nowe i pilne (bez filtrów listy). */
function useOpenSummary(revision: number): { open: number; fresh: number; urgent: number } | null {
  const [summary, setSummary] = useState<{ open: number; fresh: number; urgent: number } | null>(null);
  useEffect(() => {
    api<ListResponse<TicketListItem>>(
      `/admin/tickets?status=${OPEN_TICKET_STATES.join(',')}&pageSize=1&facets=status,urgent`,
    )
      .then((r) => setSummary({ open: r.total, fresh: r.facets.status?.NEW ?? 0, urgent: r.facets.urgent?.true ?? 0 }))
      .catch(() => setSummary(null));
  }, [revision]);
  return summary;
}

/**
 * Przełączniki „Pilność” i „Źródło” pod szybkimi filtrami (makieta): filtry listy w adresie URL, liczniki
 * z osobnego zapytania z pozostałymi filtrami listy.
 */
function TicketToggles({ revision }: { revision: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const parsed = parseListQuery(ticketsResource, searchParams);
  const query = parsed.ok ? parsed.query : null;
  const [counts, setCounts] = useState<{ urgent: number; source: Record<string, number> } | null>(null);
  const others = query?.filters.filter((f) => f.field !== 'urgent' && f.field !== 'source') ?? [];
  const countsParams = query
    ? toSearchParams(ticketsResource, { q: query.q, filters: others, pageSize: 1, facets: ['urgent', 'source'] })
    : null;
  const key = countsParams?.toString() ?? '';

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    api<ListResponse<TicketListItem>>(`/admin/tickets?${key}`, { signal: controller.signal })
      .then((r) => setCounts({ urgent: r.facets.urgent?.true ?? 0, source: r.facets.source ?? {} }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [key, revision]);

  if (!query) return null;
  const current = (field: string) => query.filters.find((f) => f.field === field && f.op === 'eq')?.values;
  const urgent = current('urgent')?.[0] === true;
  const source = current('source');
  const activeSource = source?.length === 1 ? String(source[0]) : null;

  const set = (field: 'urgent' | 'source', filter: ListFilter | null) => {
    const next = [...query.filters.filter((f) => f.field !== field), ...(filter ? [filter] : [])];
    const params = toSearchParams(ticketsResource, { ...query, page: 1, filters: next, facets: [] });
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  };

  return (
    <div className="ticket-toggles">
      <span className="segl" id="ticket-urgent">
        {t('tickets.toggles.urgency')}
      </span>
      <div className="zc-seg compact" role="radiogroup" aria-labelledby="ticket-urgent">
        <button type="button" role="radio" aria-checked={!urgent} onClick={() => set('urgent', null)}>
          {t('common.all')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={urgent}
          onClick={() => set('urgent', { field: 'urgent', op: 'eq', values: [true] })}
        >
          {t('service.urgent')}
          <span className="n num">{counts?.urgent ?? 0}</span>
        </button>
      </div>
      <span className="segl" id="ticket-source">
        {t('tickets.toggles.source')}
      </span>
      <div className="zc-seg compact" role="radiogroup" aria-labelledby="ticket-source">
        <button type="button" role="radio" aria-checked={!activeSource} onClick={() => set('source', null)}>
          {t('common.all')}
        </button>
        {(['USER', 'AUTO', 'STAFF'] as TicketSource[]).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={activeSource === value}
            onClick={() => set('source', { field: 'source', op: 'eq', values: [value] })}
          >
            {t.dynamic(`service.source.${value}`)}
            <span className="n num">{counts?.source[value] ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pierwsze wejście bez filtrów otwiera „Otwarte” (makieta); „Wszystkie” wybrane później zostaje. */
function useDefaultOpen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (searchParams.size === 0)
      router.replace(`${pathname}?status=${OPEN_TICKET_STATES.join(',')}`, { scroll: false });
  }, [router, pathname, searchParams]);
}

export function TicketList() {
  useDefaultOpen();
  const [openId, setOpenId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [countsRevision, setCountsRevision] = useState(0);
  const listeners = useRef(new Set<(item: TicketListItem | null) => void>());
  const openRef = useRef(openId);
  openRef.current = openId;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summary = useOpenSummary(countsRevision);

  const refreshCounts = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCountsRevision((n) => n + 1), 1500);
  };
  // Zdarzenie niesie tylko stan bez nazwisk: lista odświeża się po przerwie, otwarty podgląd od razu.
  useStaffFeed({
    tickets: (ticket) => {
      for (const listener of listeners.current) listener(null);
      if (ticket.id === openRef.current) setRevision((n) => n + 1);
      refreshCounts();
    },
    reconnected: () => {
      for (const listener of listeners.current) listener(null);
      setRevision((n) => n + 1);
      refreshCounts();
    },
  });
  const subscribe = useCallback((listener: (item: TicketListItem | null) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return (
    <>
      <ResourceList<TicketListItem>
        resource={ticketsResource}
        basePath={TICKETS_BASE}
        columns={columns}
        presets={presets}
        filters={filters}
        rowLabel={(x) => ticketNumber(x.number)}
        summary={(data) =>
          summary ? t('resource.tickets.summaryOpen', summary) : t('resource.tickets.summary', { count: data.total })
        }
        emptyIcon={<ServiceIcon size={22} />}
        createLabel={null}
        selectable={false}
        onOpen={(x) => setOpenId(x.id)}
        activeId={openId}
        subscribe={subscribe}
        tabs={<TicketToggles revision={countsRevision} />}
      />
      {openId && (
        <TicketDrawer
          key={openId}
          id={openId}
          revision={revision}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            for (const listener of listeners.current) listener(null);
            refreshCounts();
          }}
        />
      )}
    </>
  );
}

/** Panel boczny listy (makieta zgloszenia-lista): opis, zdjęcia, hulajnoga, przypisanie i początek osi czasu. */
function TicketDrawer({
  id,
  revision,
  onClose,
  onChanged,
}: {
  id: string;
  revision: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const { ticket, error, apply, refresh } = useTicketDetails(id, revision);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !creating && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, creating]);

  const number = ticket ? ticketNumber(ticket.number) : '';
  const openTask = ticket?.tasks.find((x) => x.status === 'OPEN' || x.status === 'IN_PROGRESS') ?? ticket?.tasks[0];
  const timeline = ticket ? ticketTimeline(ticket.timeline) : [];

  return (
    <aside className="rental-drawer ticket-drawer" aria-label={t('tickets.preview', { number })}>
      <div className="rd-head">
        <div>
          <div className="rd-title">
            <h2>{ticket ? number : t('common.loading')}</h2>
            {ticket && <TicketStatusPill status={ticket.status} />}
            {ticket?.urgent && <span className="urgent">{t('service.urgent')}</span>}
          </div>
          {ticket && <div className="rd-sub">{ticketSub(ticket.source, ticket.reporter?.name ?? null, ticket)}</div>}
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
        {ticket && (
          <>
            <div className="ticket-desc">
              <Categories categories={ticket.categories} />
              {ticket.description && <div className="quote">{ticket.description}</div>}
            </div>
            <TicketPhotos photos={ticket.photos} number={number} />
            <dl className="kv-grid ticket-kv">
              <dt>{t('tickets.scooter')}</dt>
              <dd className="wrap">
                {can('scooters.read') ? (
                  <Link className="link" href={`/admin/flota/${ticket.scooter.id}`}>
                    {scooterNumber(ticket.scooter.number)}
                  </Link>
                ) : (
                  scooterNumber(ticket.scooter.number)
                )}{' '}
                <ScooterStatePill status={ticket.scooter.status} />
              </dd>
              {ticket.rental && (
                <>
                  <dt>{t('tickets.rental')}</dt>
                  <dd>
                    {can('rentals.read') ? (
                      <Link className="link" href={`/admin/przejazdy/${ticket.rental.id}`}>
                        {rentalNumber(ticket.rental.number)}
                      </Link>
                    ) : (
                      rentalNumber(ticket.rental.number)
                    )}
                  </dd>
                </>
              )}
              <dt>{t('tickets.task')}</dt>
              <dd>
                {openTask ? (
                  can('service.read') ? (
                    <Link className="link" href={`${TASKS_BASE}/${openTask.id}`}>
                      {taskNumber(openTask.number)}
                    </Link>
                  ) : (
                    taskNumber(openTask.number)
                  )
                ) : (
                  <span className="muted">{t('tickets.noTask')}</span>
                )}
              </dd>
            </dl>
            <AssignControl
              ticket={ticket}
              onAssigned={(next) => {
                apply(next);
                onChanged();
              }}
            />
            <section>
              <div className="rd-section-head">
                <h3>{t('tickets.history')}</h3>
                <Link className="link small-link" href={`${TICKETS_BASE}/${id}`}>
                  {t('tickets.fullTimeline')}
                </Link>
              </div>
              <ServiceTimeline items={timeline.slice(0, DRAWER_TIMELINE)} />
            </section>
          </>
        )}
      </div>

      <div className="rd-foot">
        <Link className="btn" href={`${TICKETS_BASE}/${id}`}>
          {t('tickets.details')}
        </Link>
        <span className="spacer" />
        {ticket && can('service.manage') && ticket.status !== 'RESOLVED' && ticket.availableTaskTypes.length > 0 && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <ServiceIcon size={15} />
            {t('tickets.createTask')}
          </button>
        )}
      </div>

      {creating && ticket && (
        <TaskCreateDialog
          mode="create"
          scooter={ticket.scooter}
          ticket={ticket}
          suggestedType={ticket.suggestedTaskType}
          availableTypes={ticket.availableTaskTypes}
          onClose={() => setCreating(false)}
          onCreated={(_task: ServiceTaskDetails) => {
            setCreating(false);
            refresh();
            onChanged();
          }}
        />
      )}
    </aside>
  );
}

/** „Ola Kamińska · w aplikacji po przejeździe · 14:23”. */
export function ticketSub(
  source: TicketSource,
  name: string | null,
  ticket: { rental: { number: number } | null; createdAt: string; autoKind: string | null },
): string {
  const origin =
    source === 'USER'
      ? ticket.rental
        ? t('tickets.origin.appRental')
        : t('tickets.origin.app')
      : source === 'AUTO'
        ? t.dynamic(`service.autoKind.${ticket.autoKind ?? 'OFFLINE'}`)
        : t('tickets.origin.staff');
  return [reporterLabel(source, name), origin, formatClock(ticket.createdAt)].join(' · ');
}
