import { createTranslator } from '@hulajnogi/shared';
import messages from '../messages/pl.json';

/** Etykiety panelu i strony z pliku tłumaczeń (ADR 0027, ADR 0032); w komponentach tylko klucze. */
export const t = createTranslator(messages, 'pl');
export type T = typeof t;

const relative = new Intl.RelativeTimeFormat('pl', { numeric: 'always', style: 'narrow' });
const dateTime = new Intl.DateTimeFormat('pl', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
const date = new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' });

/** „4 s temu”, „6 min temu”; czas prezentujemy w strefie Europe/Warsaw (arc42 §8.5). */
export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return t('common.relative.never');
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(Math.min(seconds, 0), 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatKm = (meters: number) => t('common.km', { value: meters / 1000 });

const time = new Intl.DateTimeFormat('pl', { timeStyle: 'medium', timeZone: 'Europe/Warsaw' });
export const formatTime = (iso: string) => time.format(new Date(iso));
