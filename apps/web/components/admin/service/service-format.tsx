'use client';

/**
 * Wspólne elementy modułu Operacje w panelu (iteracja 6, makiety 27-panel-serwis): numery zgłoszeń i zadań,
 * stany, priorytety, kategorie, wiek zgłoszenia i adresy zdjęć z podpisem.
 */
import {
  serviceTaskLabel,
  ticketLabel,
  type ServiceTaskStatus,
  type TaskPriority,
  type TicketCategory,
  type TicketSource,
  type TicketStatus,
} from '@hulajnogi/shared';
import { API_URL } from '../../../lib/api';
import { t } from '../../../lib/i18n';

export const TICKETS_BASE = '/admin/zgloszenia';
export const TASKS_BASE = '/admin/zadania';
export const PARTS_BASE = '/admin/czesci';
export const NOTIFICATIONS_BASE = '/admin/powiadomienia';
export const SIMULATOR_BASE = '/admin/symulator';

/** `Z-1042`. */
export const ticketNumber = (n: number) => ticketLabel(n);
/** `S-1037`. */
export const taskNumber = (n: number) => serviceTaskLabel(n);

/** Podpisany adres zdjęcia z API jest względny (`/files/{id}?exp=&sig=`); panel dokleja adres API. */
export function fileUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//.test(url) ? url : `${API_URL}${url}`;
}

const TICKET_PILL: Record<TicketStatus, string> = {
  NEW: 'pill',
  IN_PROGRESS: 'pill accent',
  AT_SERVICE: 'pill accent',
  RESOLVED: 'pill muted',
};

export function TicketStatusPill({ status, small }: { status: TicketStatus; small?: boolean }) {
  return (
    <span className={`${TICKET_PILL[status]}${small ? ' sm' : ''}`}>{t.dynamic(`service.ticketStatus.${status}`)}</span>
  );
}

const TASK_PILL: Record<ServiceTaskStatus, string> = {
  OPEN: 'pill',
  IN_PROGRESS: 'pill accent',
  DONE: 'pill muted',
  CANCELLED: 'pill muted',
};

export function TaskStatusPill({ status, small }: { status: ServiceTaskStatus; small?: boolean }) {
  return (
    <span className={`${TASK_PILL[status]}${small ? ' sm' : ''}`}>{t.dynamic(`service.taskStatus.${status}`)}</span>
  );
}

const PRIORITY_PILL: Record<TaskPriority, string> = { HIGH: 'pill warn', NORMAL: 'pill', LOW: 'pill muted' };

export function PriorityPill({ priority, small }: { priority: TaskPriority; small?: boolean }) {
  return (
    <span className={`${PRIORITY_PILL[priority]}${small ? ' sm' : ''}`}>
      {t.dynamic(`service.priority.${priority}`)}
    </span>
  );
}

export const categoryLabel = (c: string) => t.dynamic(`service.category.${c}`);
export const taskTypeLabel = (type: string) => t.dynamic(`service.taskType.${type}`);

/** Kategorie zgłoszenia jako znaczniki; pilne zgłoszenie z czerwonym „Pilne” na początku (makieta). */
export function Categories({
  categories,
  urgent,
}: {
  categories: readonly TicketCategory[] | readonly string[];
  urgent?: boolean;
}) {
  return (
    <span className="cats">
      {urgent && <span className="urgent">{t('service.urgent')}</span>}
      {categories.map((c) => (
        <span key={c} className="cat">
          {categoryLabel(c)}
        </span>
      ))}
    </span>
  );
}

/**
 * Zgłaszający w liście: klient po imieniu (bez `users.read` API podaje `null`, panel pokazuje „Klient”), system jako
 * „Automatyczne”, operator z imieniem albo „Operator”.
 */
export function reporterLabel(source: TicketSource, name: string | null): string {
  if (source === 'USER') return name ?? t('service.customer');
  if (source === 'AUTO') return t('service.source.AUTO');
  return name ?? t('service.source.STAFF');
}

/** Wiek zgłoszenia jak w makiecie: „12 min”, „3 h”, „wczoraj”, „2 dni”. */
export function ageLabel(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return t('service.age.minutes', { value: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('service.age.hours', { value: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t('service.age.yesterday') : t('service.age.days', { value: days });
}
