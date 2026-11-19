/**
 * Daty kalendarzowe raportów w strefie Europe/Warsaw (ADR 0071): operator wybiera doby polskie, a funkcje raportowe
 * dostają okres półotwarty `[from, to)` jako chwile UTC. Granice dób liczy `Intl` (bez `node:*` i bez bibliotek dat),
 * więc doba zmiany czasu ma 23 albo 25 godzin, tak jak w bazie (`AT TIME ZONE 'Europe/Warsaw'`).
 */
import { DomainError } from '../errors.js';

export const REPORT_TIME_ZONE = 'Europe/Warsaw';

/** Data kalendarzowa w czasie polskim, `RRRR-MM-DD`. */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const warsawParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(at: Date): Parts {
  const out: Record<string, number> = {};
  for (const part of warsawParts.formatToParts(at)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out as unknown as Parts;
}

function split(date: LocalDate): { y: number; m: number; d: number } {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new DomainError('VALIDATION_FAILED', { field: 'date', value: date });
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const fromUtcDay = (ms: number): LocalDate => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const utcDay = (date: LocalDate): number => {
  const { y, m, d } = split(date);
  return Date.UTC(y, m - 1, d);
};

/** Poprawna data kalendarzowa `RRRR-MM-DD` (np. bez 31 września). */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Data polska chwili `at` (np. 2026-10-31T23:30Z to 2026-11-01). */
export function localDateOf(at: Date): LocalDate {
  const p = partsOf(at);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Chwila z polami UTC równymi czasowi polskiemu (`2026-10-31T23:30Z` → `2026-11-01T00:30Z`). ExcelJS zapisuje daty
 * jako UTC, więc arkusz pokazuje czas polski dopiero po tym przeliczeniu (ADR 0071).
 */
export function warsawWallClock(at: Date): Date {
  const p = partsOf(at);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, at.getUTCMilliseconds()));
}

/** Godzina polska chwili `at` (0–23). */
export const localHourOf = (at: Date): number => partsOf(at).hour;

/** Przesunięcie czasu polskiego względem UTC w chwili `at` (ms, 1 h zimą, 2 h latem). */
function offsetMs(at: Date): number {
  const p = partsOf(at);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Północ doby polskiej jako chwila UTC. Zmiana czasu w Polsce jest o 2:00 albo 3:00, więc północ zawsze istnieje
 * i jest jednoznaczna; drugie przybliżenie poprawia przesunięcie, gdy pierwsze trafiło po drugiej stronie zmiany.
 */
export function warsawMidnight(date: LocalDate): Date {
  const guess = utcDay(date);
  let at = guess - offsetMs(new Date(guess));
  const second = guess - offsetMs(new Date(at));
  if (second !== at) at = second;
  return new Date(at);
}

export const addDays = (date: LocalDate, days: number): LocalDate => fromUtcDay(utcDay(date) + days * DAY_MS);

/** Liczba dób od `from` do `to` (`to − from`); ujemna, gdy `to` jest wcześniej. */
export const daysBetween = (from: LocalDate, to: LocalDate): number => Math.round((utcDay(to) - utcDay(from)) / DAY_MS);

/** Pierwszy dzień miesiąca daty. */
export function startOfMonth(date: LocalDate): LocalDate {
  const { y, m } = split(date);
  return `${pad(y, 4)}-${pad(m)}-01`;
}

/** Ostatni dzień miesiąca daty. */
export function endOfMonth(date: LocalDate): LocalDate {
  const { y, m } = split(date);
  return `${pad(y, 4)}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}

/** Ten sam dzień miesiąca o `months` miesięcy wcześniej albo później, przycięty do długości miesiąca. */
export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const { y, m, d } = split(date);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

export const dayOfMonth = (date: LocalDate): number => split(date).d;

/** Dzień tygodnia ISO (1 = poniedziałek … 7 = niedziela). */
export function isoWeekday(date: LocalDate): number {
  const day = new Date(utcDay(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

export const isWeekend = (date: LocalDate): boolean => isoWeekday(date) >= 6;

export const sameMonth = (a: LocalDate, b: LocalDate): boolean => a.slice(0, 7) === b.slice(0, 7);

/** Długość okresu `[from, to)` w sekundach (październik 2026: 745 h przez zmianę czasu 25 października). */
export const intervalSeconds = (interval: { from: Date; to: Date }): number =>
  Math.max(0, Math.round((interval.to.getTime() - interval.from.getTime()) / 1000));
