'use client';

/**
 * Oś czasu zgłoszenia (`v_ticket_timeline`, D6) i zadania (historia z dziennika audytu) w panelu: wpisy dziennika,
 * zwroty i powiadomienia jako wpisy wspólnej osi z modułu przejazdów (makiety zgloszenie-szczegoly, zadanie-zakoncz).
 */
import { formatPln, type AuditLogDetails, type TicketTimelineEntry } from '@hulajnogi/shared';
import { formatDate, formatTime, isToday, t } from '../../../lib/i18n';
import type { TimelineItem } from '../rentals/rental-parts';
import { categoryLabel, taskNumber, taskTypeLabel } from './service-format';

type Data = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Zmiana pola zapisana w dzienniku jako `changes: { pole: [przed, po] }`. */
function change(data: Data, field: string): [unknown, unknown] | null {
  const changes = data.changes as Record<string, unknown> | undefined;
  const pair = changes?.[field];
  return Array.isArray(pair) && pair.length === 2 ? [pair[0], pair[1]] : null;
}

const arrow = (pair: [unknown, unknown] | null, fallback = '') =>
  pair ? `${pair[0] ?? ''} → ${pair[1] ?? ''}`.trim() : fallback;

/** Autor wpisu: operator z imieniem, system albo klient. */
function actorLabel(actor: string, staffName: string | null): string {
  if (actor === 'STAFF') return staffName ?? t('service.source.STAFF');
  if (actor === 'CUSTOMER') return t('service.customer');
  return t('service.system');
}

/** Wspólna część wpisów zgłoszenia i zadania (te same akcje dziennika audytu). */
function auditItem(
  action: string,
  actor: string,
  staffName: string | null,
  data: Data,
): Omit<TimelineItem, 'key' | 'at'> {
  const who = actorLabel(actor, staffName);
  const base = { title: actionTitle(action), detail: who, state: '', tone: '' as TimelineItem['tone'] };
  switch (action) {
    case 'ticket.created': {
      const categories = Array.isArray(data.categories) ? data.categories.map(String).map(categoryLabel) : [];
      const photos = num(data.photos) ?? 0;
      return {
        ...base,
        state: '→ NEW',
        tone: 'muted',
        detail: [who, categories.join(', '), photos ? t('service.photoCount', { count: photos }) : null]
          .filter(Boolean)
          .join(', '),
      };
    }
    case 'ticket.assigned':
    case 'service_task.assigned': {
      const to = change(data, 'assigneeId')?.[1];
      return {
        ...base,
        title: to ? actionTitle(action) : t('tickets.timeline.unassigned'),
        detail: to ? t('tickets.timeline.assignedBy', { by: who, to: str(data.assigneeName) ?? '' }) : who,
      };
    }
    case 'ticket.status_changed': {
      const pair = change(data, 'status');
      const reply = str(data.reply);
      return {
        ...base,
        title: pair
          ? t('tickets.timeline.statusTo', { status: t.dynamic(`service.ticketStatus.${String(pair[1])}`) })
          : base.title,
        state: arrow(pair),
        detail: reply ? t('tickets.timeline.withReply', { who, reply }) : who,
      };
    }
    case 'ticket.replied':
      return { ...base, detail: t('tickets.timeline.withReply', { who, reply: str(data.reply) ?? '' }) };
    case 'service_task.created':
      return {
        ...base,
        title: num(data.number)
          ? t('tickets.timeline.taskCreated', { number: taskNumber(num(data.number)!) })
          : base.title,
        state: '→ OPEN',
        tone: 'muted',
        detail: [who, str(data.type) && taskTypeLabel(String(data.type))].filter(Boolean).join(', '),
      };
    case 'service_task.started':
    case 'service_task.completed':
    case 'service_task.cancelled': {
      const note = str(data.note) ?? str(data.reason);
      return { ...base, state: arrow(change(data, 'status')), detail: note ? `${who}, ${note}` : who };
    }
    case 'service_task.part_added':
    case 'service_task.part_removed': {
      const quantity = num(data.quantity) ?? num(data.lineQuantity);
      const after = num(data.stockAfter);
      return {
        ...base,
        detail: t('tasks.timeline.part', {
          sku: str(data.sku) ?? '',
          quantity: quantity ?? '',
          stock: after ?? '',
          who,
        }),
      };
    }
    case 'rental.refunded':
      return {
        ...base,
        title: t('tickets.timeline.refund', { amount: formatPln(num(data.amount) ?? 0) }),
        state: '→ PENDING',
        detail: [who, str(data.reason) && t.dynamic(`payments.refundReason.${String(data.reason)}`)]
          .filter(Boolean)
          .join(', '),
      };
    default:
      return base;
  }
}

function actionTitle(action: string): string {
  const key = `tickets.timeline.titles.${action.replace('.', '_')}`;
  if (t.has(key)) return t.dynamic(key);
  return t.has(`audit.actions.${action}`) ? t.dynamic(`audit.actions.${action}`) : action;
}

/** Wpisy osi czasu zgłoszenia od najstarszego (API podaje je w kolejności chronologicznej). */
export function ticketTimeline(entries: readonly TicketTimelineEntry[]): TimelineItem[] {
  return entries.map((e, i) => {
    const key = `${e.at}-${i}`;
    if (e.entityType === 'notification') {
      const status = str(e.data.status) ?? '';
      return {
        key,
        at: e.at,
        title: t('tickets.timeline.push'),
        detail: [
          e.action,
          num(e.data.templateVersion) && t('tickets.timeline.version', { version: num(e.data.templateVersion)! }),
        ]
          .filter(Boolean)
          .join(', '),
        state: status,
        tone: status === 'FAILED' ? 'danger' : 'muted',
      };
    }
    if (e.entityType === 'refund') {
      const status = str(e.data.status) ?? '';
      return {
        key,
        at: e.at,
        title: t.dynamic(`tickets.timeline.refundStatus.${status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED'}`, {
          amount: formatPln(num(e.data.amount) ?? 0),
        }),
        detail: str(e.data.failureReason) ?? t('service.system'),
        state: status,
        tone: status === 'SUCCEEDED' ? 'muted' : 'danger',
      };
    }
    return { key, at: e.at, ...auditItem(e.action, e.actor, e.staffName, e.data) };
  });
}

/** Historia zadania z dziennika audytu (od najnowszej w API) jako oś od najstarszego wpisu. */
export function taskTimeline(entries: readonly AuditLogDetails[]): TimelineItem[] {
  return [...entries].reverse().map((e, i) => {
    const key = `${e.createdAt}-${i}`;
    return {
      key,
      at: e.createdAt,
      ...auditItem(e.action, e.actor ?? (e.staffId ? 'STAFF' : 'SYSTEM'), e.staffName, e.data ?? {}),
    };
  });
}

/** Czas wpisu: dziś sama godzina, wcześniej z datą („17 lis, 15:02:10”). */
export function timelineTime(iso: string): string {
  return isToday(iso)
    ? formatTime(iso)
    : t('tickets.timeline.dateTime', { date: formatDate(iso), time: formatTime(iso) });
}

/** Oś czasu jak w module przejazdów, z datą przy wpisach sprzed dzisiaj; `pending` to zmiana w toku (makieta). */
export function ServiceTimeline({ items, pending }: { items: TimelineItem[]; pending?: string | null }) {
  const all: TimelineItem[] = pending
    ? [
        ...items,
        { key: 'pending', at: null, title: t('tickets.timeline.pending'), detail: pending, state: '', tone: 'accent' },
      ]
    : items;
  if (all.length === 0) return <p className="muted small">{t('tickets.timeline.empty')}</p>;
  return (
    <ol className="timeline">
      {all.map((item, i) => (
        <li key={item.key}>
          <span className="rail" aria-hidden="true">
            <span className={`dot ${item.tone}`} />
            {i < all.length - 1 && <span className="line" />}
          </span>
          <span className="body">
            <span className="head">
              <span className="title">{item.title}</span>
              {item.state && <span className="tl-state">{item.state}</span>}
            </span>
            <span className="detail wrap">
              {item.at && <span className="num">{timelineTime(item.at)}</span>}
              {item.at && item.detail && ' · '}
              {item.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
