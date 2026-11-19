'use client';

/** Wspólne formaty nowych list iteracji 8 (makiety 34-panel-domkniecie): chwile, czasy trwania, odstępy. */
import type { ReactNode } from 'react';
import { formatClock, formatDate, formatDateTime, formatTime, isToday, t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { InfoIcon } from './icons';

/**
 * Imię klienta na karcie rekordu: bez `users.read` API zwraca `null` (dane klienta ukryte), więc „Klient”;
 * z uprawnieniem `null` znaczy klienta bez imienia.
 */
export function useCustomerLabel(): (name: string | null | undefined) => string {
  const { can } = useSession();
  const sees = can('users.read');
  return (name) => name ?? (sees ? t('access.users.noName') : t('service.customer'));
}

/** „14:31:08” dziś, „18 lis, 09:12” wcześniej; pełna data w dymku. */
export function When({ at, seconds = false, sub }: { at: string | null; seconds?: boolean; sub?: ReactNode }) {
  if (!at) return <span className="muted">{t('common.none')}</span>;
  const text = isToday(at)
    ? seconds
      ? formatTime(at)
      : t('listFormat.today', { time: formatClock(at) })
    : t('listFormat.dateTime', { date: formatDate(at), time: formatClock(at) });
  return sub ? (
    <span className="stack">
      <span className="num" title={formatDateTime(at)}>
        {text}
      </span>
      <small>{sub}</small>
    </span>
  ) : (
    <span className="num" title={formatDateTime(at)}>
      {text}
    </span>
  );
}

/** „12 min”, „1 h 04 min”, „2 dni 3 h”, „45 s”. */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t('listFormat.seconds', { s });
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return s % 60 && minutes < 10 ? t('listFormat.minSec', { m: minutes, s: s % 60 }) : t('listFormat.minutes', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('listFormat.hours', { h: hours, m: String(minutes % 60).padStart(2, '0') });
  return t('listFormat.days', { d: Math.floor(hours / 24), h: hours % 24 });
}

/** „za 3 dni”, „jutro”, „za 5 h”, „wygasło” dla chwili w przyszłości. */
export function untilText(at: string, now = Date.now()): string {
  const ms = new Date(at).getTime() - now;
  if (ms <= 0) return t('listFormat.past');
  const hours = ms / 3_600_000;
  if (hours < 1) return t('listFormat.inMinutes', { m: Math.max(1, Math.round(ms / 60_000)) });
  if (hours < 24) return t('listFormat.inHours', { h: Math.round(hours) });
  const days = Math.round(hours / 24);
  return days === 1 ? t('listFormat.tomorrow') : t('listFormat.inDays', { d: days });
}

/** Odstęp z liczbą sekund: „po 0,6 s”, „po 5 min 28 s”. */
export function afterText(ms: number): string {
  if (ms < 60_000) return t('listFormat.afterSeconds', { s: Math.round(ms / 100) / 10 });
  return t('listFormat.afterMinutes', { m: Math.floor(ms / 60_000), s: Math.round((ms % 60_000) / 1000) });
}

/** Informacja pod listą tylko do odczytu (makiety: niebieska ramka z ikoną). */
export function ListNote({ children }: { children: ReactNode }) {
  return (
    <div className="notice info list-note">
      <span className="ic" aria-hidden="true">
        <InfoIcon size={14} />
      </span>
      <span>{children}</span>
    </div>
  );
}
