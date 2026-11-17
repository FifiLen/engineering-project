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

const clock = new Intl.DateTimeFormat('pl', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
const day = new Intl.DateTimeFormat('pl', { dateStyle: 'short', timeZone: 'Europe/Warsaw' });
/** „14:05”; godzina bez sekund w wierszach tabel. */
export const formatClock = (iso: string) => clock.format(new Date(iso));
/** Czy chwila przypada na dzisiejszy dzień w strefie Europe/Warsaw. */
export const isToday = (iso: string, now = Date.now()) => day.format(new Date(iso)) === day.format(new Date(now));

/** Czas trwania jak na liczniku: „06:10”, powyżej godziny „1:05:12”. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Początek dzisiejszego dnia w strefie Europe/Warsaw jako chwila UTC (filtry „dziś”). */
export function startOfToday(now = Date.now()): string {
  const d = new Date(now);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', timeZoneName: 'longOffset' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return new Date(`${ymd}T00:00:00${offset === 'GMT' ? 'Z' : offset.slice(3)}`).toISOString();
}
