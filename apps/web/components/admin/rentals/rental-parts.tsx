'use client';

/**
 * Wspólne elementy przejazdu w panelu (lista z panelem bocznym i szczegóły, makiety 21-panel-przejazdy):
 * stan, problem, liczniki na żywo, oś czasu i komendy przejazdu z `v_rental_timeline` (ADR 0036).
 */
import {
  formatPln,
  rentalsResource,
  type RentalAdminDetails,
  type RentalListItem,
  type RentalState,
  type RentalTimelineEntry,
} from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { formatClock, formatDuration, formatKm, formatTime, t } from '../../../lib/i18n';
import { WarningIcon } from '../icons';
import { valueLabel } from '../labels';

const STATE_PILL: Record<RentalState, string> = {
  RESERVED: 'pill',
  UNLOCKING: 'pill accent',
  ACTIVE: 'pill accent',
  PAUSED: 'pill',
  ENDING: 'pill accent',
  ENDED: 'pill muted',
  EXPIRED: 'pill muted',
  UNLOCK_FAILED: 'pill danger',
  UNPAID: 'pill warn',
};

/** Stany, w których hulajnoga jest odblokowana albo czeka na blokadę: liczniki rosną, operator może zakończyć. */
export const RUNNING_STATES: readonly RentalState[] = ['UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING'];
/** Zdalne zakończenie (D7, ADR 0036). */
export const REMOTE_END_STATES: readonly RentalState[] = ['ACTIVE', 'PAUSED', 'ENDING'];
export const OPEN_STATES: readonly RentalState[] = ['RESERVED', ...RUNNING_STATES];

export const customerName = (r: Pick<RentalListItem, 'userName'>) => r.userName ?? t('access.users.noName');

export function RentalStatePill({ state }: { state: RentalState }) {
  return <span className={STATE_PILL[state]}>{valueLabel(rentalsResource, 'state', state)}</span>;
}

export function ProblemMark() {
  return (
    <span className="warnmark" title={t('rentals.problem')} aria-label={t('rentals.problem')} role="img">
      <WarningIcon size={13} />
    </span>
  );
}

/** Kwota w wierszu listy: zakończony przejazd z kwotą, „bez opłaty” bez odblokowania, w trakcie kreska. */
export function amountLabel(r: RentalListItem): string {
  if (r.totalAmount !== null) return formatPln(r.totalAmount);
  return r.startedAt === null && !RUNNING_STATES.includes(r.state) ? t('rentals.free') : t('common.none');
}

/** Bieżąca chwila odświeżana co sekundę (liczniki jazdy); bez odświeżania, gdy nic nie biegnie. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** Czas od odblokowania w wierszu listy, liczony dalej od chwili wczytania listy. */
export function ElapsedCell({ item }: { item: RentalListItem }) {
  const running = item.startedAt !== null && item.endedAt === null && RUNNING_STATES.includes(item.state);
  const [loadedAt] = useState(() => Date.now());
  const now = useNow(running);
  if (item.startedAt === null) return <span className="muted">{t('common.none')}</span>;
  const seconds = item.elapsedSeconds + (running ? (now - loadedAt) / 1000 : 0);
  return <span className="num">{formatDuration(seconds)}</span>;
}

export function DistanceCell({ item }: { item: RentalListItem }) {
  // Dystans otwartego przejazdu liczy widok szczegółów z telemetrii; lista zna go po zakończeniu.
  if (item.distanceM <= 0) return <span className="muted">{t('common.none')}</span>;
  return <span className="num">{formatKm(item.distanceM)}</span>;
}

/**
 * Liczniki przejazdu na chwilę `now`: API liczy je na chwilę `asOf`, a panel dolicza upływ czasu (jazda
 * w `ACTIVE`, pauza w `PAUSED`), dopóki naliczanie trwa (`billedUntil` puste), jak aplikacja klienta.
 */
export function liveCounters(r: RentalAdminDetails, receivedAt: number, now: number) {
  const delta = r.billedUntil === null ? Math.max(0, (now - receivedAt) / 1000) : 0;
  return {
    rideSeconds: r.rideSeconds + (r.state === 'ACTIVE' ? delta : 0),
    pauseSeconds: r.pauseSeconds + (r.state === 'PAUSED' ? delta : 0),
  };
}

// ---------------------------------------------------------------------------------------------
// Problem przejazdu (ta sama reguła co flaga `has_problem` w widoku `v_rental_details`)
// ---------------------------------------------------------------------------------------------

export type RentalProblem = {
  kind: 'LOCK_FAILED' | 'PAUSE_FAILED' | 'RESUME_FAILED' | 'UNLOCK_FAILED' | 'OFFLINE';
  at: string;
};

const FAILURE_EVENTS = ['LOCK_FAILED', 'PAUSE_FAILED', 'RESUME_FAILED'] as const;

export function rentalProblem(r: RentalAdminDetails): RentalProblem | null {
  if (!r.hasProblem) return null;
  const events = r.timeline.filter((e) => e.kind === 'EVENT');
  if (r.state === 'UNLOCK_FAILED') {
    const failed = events.findLast((e) => e.type === 'STATE_CHANGED' && e.toState === 'UNLOCK_FAILED');
    return { kind: 'UNLOCK_FAILED', at: failed?.at ?? r.createdAt };
  }
  const lastChange = events.findLast((e) => e.type === 'STATE_CHANGED' && e.toState !== 'ENDING');
  const failure = events.findLast(
    (e) => (FAILURE_EVENTS as readonly string[]).includes(e.type) && (!lastChange || e.at >= lastChange.at),
  );
  if (failure) return { kind: failure.type as RentalProblem['kind'], at: failure.at };
  return { kind: 'OFFLINE', at: r.asOf };
}

export const problemPill = (p: RentalProblem) => t.dynamic(`rentals.problems.pill.${p.kind}`);
export const problemNotice = (p: RentalProblem) =>
  t.dynamic(`rentals.problems.notice.${p.kind}`, { time: formatClock(p.at) });

// ---------------------------------------------------------------------------------------------
// Oś czasu
// ---------------------------------------------------------------------------------------------

export interface TimelineItem {
  key: string;
  at: string | null;
  title: string;
  detail: string | null;
  /** Stan albo typ zdarzenia drobnym pismem po prawej, jak w makiecie. */
  state: string;
  tone: '' | 'muted' | 'warn' | 'danger' | 'accent';
}

const ackReason = (reason: unknown) =>
  typeof reason === 'string' && t.has(`rentals.ackReason.${reason}`)
    ? t.dynamic(`rentals.ackReason.${reason}`)
    : String(reason ?? '');

/** Przyczyna nieudanej komendy: brak odpowiedzi albo odmowa hulajnogi z powodem. */
function failureDetail(reason: unknown): string {
  if (!reason || reason === 'timeout') return t('rentals.ackReason.timeout');
  return t('rentals.timeline.refused', { reason: ackReason(reason) });
}

/**
 * Wpisy osi czasu ze zdarzeń przejazdu. Zdarzenia zapisane w tej samej transakcji co zmiana stanu
 * (żądanie zakończenia, nieudana blokada przy kończeniu, zdalne zakończenie) to jeden wpis.
 */
export function buildTimeline(r: RentalAdminDetails): TimelineItem[] {
  const events = r.timeline.filter((e) => e.kind === 'EVENT');
  const items: TimelineItem[] = [];
  let lockFailure: RentalTimelineEntry | null = null;
  let remoteEnd: RentalTimelineEntry | null = null;
  let lostAt: string | null = null;

  for (const e of events) {
    if (e.type === 'END_REQUESTED') continue;
    if (e.type === 'ENDED_REMOTELY') {
      remoteEnd = e;
      continue;
    }
    if (
      e.type === 'LOCK_FAILED' &&
      events.some((x) => x.at === e.at && isAction(x, ['ABORT_END', 'ABORT_END_PAUSED']))
    ) {
      lockFailure = e;
      continue;
    }
    if (e.type === 'STATE_CHANGED') {
      const action =
        typeof e.data.action === 'string'
          ? e.data.action
          : e.fromState === null && e.toState === 'RESERVED'
            ? 'RESERVE'
            : 'START';
      let detail: string | null = t.has(`rentals.timeline.details.${action}`)
        ? t.dynamic(`rentals.timeline.details.${action}`)
        : null;
      let tone: TimelineItem['tone'] = action === 'RESERVE' ? 'muted' : '';
      if (action === 'UNLOCK_TIMEOUT') {
        detail = failureDetail(e.data.reason);
        tone = 'danger';
      }
      if (action === 'ABORT_END' || action === 'ABORT_END_PAUSED') {
        detail = failureDetail(lockFailure?.data.reason);
        tone = 'danger';
      }
      if (action === 'REQUEST_END' && e.zoneCode) detail = t('rentals.timeline.inZone', { zone: e.zoneCode });
      if (action === 'END_REMOTELY' && remoteEnd) {
        detail = t('rentals.timeline.remoteReason', {
          reason: t.dynamic(`rentals.end.reasons.${String(remoteEnd.data.reason)}`).toLowerCase(),
        });
        // Opłata za odholowanie pobrana przy zdalnym zakończeniu (ADR 0060).
        if (r.towingFee) detail = `${detail} · ${t('rentals.timeline.towingFee', { fee: formatPln(r.towingFee) })}`;
      }
      if (action === 'END_UNCONFIRMED') tone = 'warn';
      items.push({
        key: `${e.at}-${items.length}`,
        at: e.at,
        title: t.has(`rentals.timeline.titles.${action}`) ? t.dynamic(`rentals.timeline.titles.${action}`) : action,
        detail,
        state: `${e.fromState ?? ''} → ${e.toState ?? ''}`.trim(),
        tone,
      });
      continue;
    }
    let detail: string | null = t.has(`rentals.timeline.details.${e.type}`)
      ? t.dynamic(`rentals.timeline.details.${e.type}`)
      : null;
    let tone: TimelineItem['tone'] = '';
    if ((FAILURE_EVENTS as readonly string[]).includes(e.type)) {
      detail = failureDetail(e.data.reason);
      tone = 'danger';
    }
    if (e.type === 'CONNECTION_LOST') {
      lostAt = e.at;
      tone = 'warn';
    }
    if (e.type === 'LATE_UNLOCK_LOCKED') tone = 'warn';
    // Iteracja 6 (ADR 0056): progi baterii, koniec naliczania bez łączności, ruch po zakończeniu offline.
    if (e.type === 'BATTERY_LOW') {
      const threshold = typeof e.data.threshold === 'string' ? e.data.threshold : null;
      if (typeof e.data.batteryPct === 'number')
        detail = t('rentals.timeline.battery', {
          pct: e.data.batteryPct,
          threshold:
            threshold && t.has(`rentals.timeline.batteryThreshold.${threshold}`)
              ? t.dynamic(`rentals.timeline.batteryThreshold.${threshold}`)
              : String(threshold ?? ''),
        });
      tone = threshold === 'CRITICAL' ? 'danger' : 'warn';
    }
    if (e.type === 'BILLING_STOPPED') {
      if (typeof e.data.connectionLostAt === 'string')
        detail = t('rentals.timeline.billingStopped', { time: formatClock(e.data.connectionLostAt) });
      tone = 'warn';
    }
    if (e.type === 'MOVED_AFTER_END') {
      if (typeof e.data.distanceM === 'number')
        detail = t('rentals.timeline.movedAfterEnd', { meters: Math.round(e.data.distanceM) });
      tone = 'warn';
    }
    if (e.type === 'CONNECTION_RESTORED' && lostAt)
      detail = t('rentals.timeline.restoredAfter', {
        seconds: Math.round((Date.parse(e.at) - Date.parse(lostAt)) / 1000),
      });
    if (e.type === 'ZONE_ENTERED' || e.type === 'ZONE_EXITED') {
      // Zdarzenia stref (ADR 0043): kod strefy z widoku osi czasu albo z danych zdarzenia, do tego typ strefy.
      const code = e.zoneCode ?? (typeof e.data.code === 'string' ? e.data.code : null);
      const zoneType = typeof e.data.zoneType === 'string' ? e.data.zoneType : null;
      if (code)
        detail = zoneType
          ? t('rentals.timeline.zone', { code, type: t.dynamic(`rentals.timeline.zoneTypes.${zoneType}`) })
          : code;
      // Wjazd do zakazu albo wyjazd poza obszar działania zatrzymuje hulajnogę (pytania 2 i 3).
      if (
        (e.type === 'ZONE_ENTERED' && zoneType === 'NO_RIDE') ||
        (e.type === 'ZONE_EXITED' && zoneType === 'SERVICE_AREA')
      )
        tone = 'warn';
    }
    if (e.zoneCode && !detail) detail = e.zoneCode;
    items.push({
      key: `${e.at}-${items.length}`,
      at: e.at,
      title: t.has(`rentals.timeline.titles.${e.type}`) ? t.dynamic(`rentals.timeline.titles.${e.type}`) : e.type,
      detail,
      state: e.type,
      tone,
    });
  }

  if (OPEN_STATES.includes(r.state)) {
    items.push({
      key: 'live',
      at: null,
      title: t.dynamic(`rentals.timeline.live.${r.state}`),
      detail: r.pendingCommand
        ? t('rentals.timeline.waiting', { command: t.dynamic(`command.${r.pendingCommand}`) })
        : t('rentals.timeline.liveDetail'),
      state: r.state,
      tone: 'accent',
    });
  }
  return items;
}

function isAction(e: RentalTimelineEntry, actions: string[]): boolean {
  return e.type === 'STATE_CHANGED' && typeof e.data.action === 'string' && actions.includes(e.data.action);
}

export function Timeline({ items, showState }: { items: TimelineItem[]; showState: boolean }) {
  return (
    <ol className="timeline">
      {items.map((item, i) => (
        <li key={item.key}>
          <span className="rail" aria-hidden="true">
            <span className={`dot ${item.tone}`} />
            {i < items.length - 1 && <span className="line" />}
          </span>
          <span className="body">
            <span className="head">
              <span className="title">{item.title}</span>
              {showState && <span className="tl-state">{item.state}</span>}
            </span>
            <span className="detail">
              {item.at && <span className="num">{formatTime(item.at)}</span>}
              {item.at && item.detail && ' · '}
              {item.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------
// Komendy przejazdu
// ---------------------------------------------------------------------------------------------

/** Komendy wysyłane tylko przez system według stref (D7, ADR 0044). */
const ZONE_COMMANDS = ['SPEED_LIMIT', 'STOP_GRADUALLY', 'RELEASE_STOP'] as const;

/** Nazwa komendy; limit prędkości z wartością z ładunku komendy albo jako zdjęcie limitu (`{}`). */
export function commandLabel(entry: Pick<RentalTimelineEntry, 'type' | 'data'>): string {
  if (entry.type === 'SPEED_LIMIT') {
    const kmh = entry.data.kmh;
    return typeof kmh === 'number' ? t('rentals.commands.speedLimit', { kmh }) : t('rentals.commands.speedLimitOff');
  }
  return t.has(`command.${entry.type}`) ? t.dynamic(`command.${entry.type}`) : entry.type;
}

export interface CommandRow {
  entry: RentalTimelineEntry;
  /** Cel komendy wynikający ze stanu przejazdu w chwili wysłania. */
  context: string;
}

export function commandRows(r: RentalAdminDetails): CommandRow[] {
  let state: RentalState | null = null;
  let lastEvent: string | null = null;
  const rows: CommandRow[] = [];
  for (const e of r.timeline) {
    if (e.kind === 'EVENT') {
      if (e.type === 'STATE_CHANGED') {
        state = e.toState;
        lastEvent = typeof e.data.action === 'string' ? e.data.action : 'START';
      } else lastEvent = e.type;
      continue;
    }
    let context = 'other';
    if ((ZONE_COMMANDS as readonly string[]).includes(e.type)) context = 'zone';
    if (e.type === 'UNLOCK') context = state === 'UNLOCKING' ? 'start' : state === 'PAUSED' ? 'resume' : 'other';
    if (e.type === 'LOCK') {
      if (state === 'ACTIVE') context = 'pause';
      else if (state === 'ENDING') context = 'end';
      else if (lastEvent === 'END_REMOTELY') context = 'remoteEnd';
      else context = 'compensate';
    }
    rows.push({ entry: e, context: t.dynamic(`rentals.commands.context.${context}`) });
  }
  return rows;
}

const COMMAND_PILL: Record<string, string> = {
  SENT: 'pill accent',
  ACKED: 'pill',
  REJECTED: 'pill danger',
  TIMEOUT: 'pill danger',
};

export function CommandResult({ entry }: { entry: RentalTimelineEntry }) {
  const status = entry.commandStatus ?? 'SENT';
  return (
    <span className={COMMAND_PILL[status]} title={entry.ackReason ? ackReason(entry.ackReason) : undefined}>
      {t.dynamic(`command.status.${status}`)}
    </span>
  );
}

export function CommandResponse({ entry }: { entry: RentalTimelineEntry }) {
  if (entry.ackedAt)
    return (
      <span className="stack">
        <span className="num">{formatTime(entry.ackedAt)}</span>
        <small>
          {entry.ackReason
            ? ackReason(entry.ackReason)
            : t('rentals.commands.ms', { ms: Math.max(0, Date.parse(entry.ackedAt) - Date.parse(entry.at)) })}
        </small>
      </span>
    );
  return (
    <span className="stack">
      <span className="num">{t('common.none')}</span>
      <small>{t('rentals.commands.limit')}</small>
    </span>
  );
}
