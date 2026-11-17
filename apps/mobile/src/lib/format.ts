/**
 * Formatowanie liczb, czasu i odległości na ekranach wypożyczenia. Jednostki i słowa pochodzą z pliku
 * tłumaczeń; tu są tylko liczby w polskim zapisie.
 */
import { t } from '../i18n';

const decimal1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const amount = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' });

/** Tempo marszu do szacunku „2 min pieszo” (ok. 5 km/h). */
const WALK_M_PER_MIN = 80;

/** Numer hulajnogi zawsze w czterech cyfrach, jak w panelu i w MQTT (ADR 0041). */
export const scooterNo = (n: number): string => n.toString().padStart(4, '0');

/** Kwota w groszach bez symbolu waluty („12,50”); jednostka „zł” jest osobną etykietą. */
export const money = (grosze: number): string => amount.format(grosze / 100);

/** „120 m” do kilometra, dalej „1,2 km”. */
export function distance(m: number): string {
  return m < 1000 ? t('units.m', { value: Math.round(m) }) : t('units.km', { value: decimal1.format(m / 1000) });
}

/** Dystans przejazdu zawsze w kilometrach („0,4 km”), jak na ekranie jazdy. */
export const km = (m: number): string => t('units.km', { value: decimal1.format(m / 1000) });

export const walkMinutes = (m: number): number => Math.max(1, Math.round(m / WALK_M_PER_MIN));

/** Licznik „12:48”, a od godziny „1:02:48”. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m.toString().padStart(2, '0')}:${sec}`;
}

/** Czas w drodze w profilu: „5 h 40 min” albo „40 min”. */
export function hoursMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  return h ? t('units.hoursMinutes', { h, m: minutes % 60 }) : t('units.minutes', { m: minutes });
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** „Dziś, 14:32”, „Wczoraj, 08:10”, „5 listopada, 17:45”. */
export function dayTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const hm = time.format(d);
  if (sameDay(d, now)) return t('dates.today', { time: hm });
  if (sameDay(d, yesterday)) return t('dates.yesterday', { time: hm });
  return t('dates.dayTime', { day: dayMonth.format(d), time: hm });
}

/** Nagłówek miesiąca w historii („Listopad”). */
export const monthName = (iso: string): string => t.dynamic(`dates.months.${new Date(iso).getMonth()}`);

/** Dystans łączny w profilu: od 10 km bez części dziesiętnej („61 km”). */
export const totalDistance = (m: number): string => (m >= 10000 ? t('units.km', { value: Math.round(m / 1000) }) : distance(m));
