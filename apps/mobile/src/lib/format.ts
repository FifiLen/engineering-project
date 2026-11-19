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

/** „12,50 zł”, a ujemna kwota ze znakiem minus typograficznym („−3,40 zł”). */
export const pln = (grosze: number): string =>
  grosze < 0 ? t('units.minusAmount', { amount: money(-grosze) }) : t('units.amount', { amount: money(grosze) });

/** Kwota ruchu w portfelu ze znakiem („+50,00 zł”, „−12,40 zł”). */
export const signedPln = (grosze: number): string =>
  grosze < 0 ? t('units.minusAmount', { amount: money(-grosze) }) : t('units.plusAmount', { amount: money(grosze) });

/** Pełne złote bez groszy na pigułkach i przyciskach doładowania („50 zł”). */
export const wholePln = (grosze: number): string => t('units.amount', { amount: Math.round(grosze / 100) });

const numericDate = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** „17.11.2026” (paragon). */
export const dateNumeric = (iso: string): string => numericDate.format(new Date(iso));

/** „14:32”. */
export const timeOnly = (iso: string): string => time.format(new Date(iso));

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

/** „dziś około 9:15”, „jutro około 9:15”, „19 listopada około 9:15” (ponowienie płatności). */
export function around(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const hm = time.format(d);
  if (sameDay(d, now)) return t('dates.aroundToday', { time: hm });
  if (sameDay(d, tomorrow)) return t('dates.aroundTomorrow', { time: hm });
  return t('dates.aroundDay', { day: dayMonth.format(d), time: hm });
}

/** Nagłówek miesiąca w historii („Listopad”). */
export const monthName = (iso: string): string => t.dynamic(`dates.months.${new Date(iso).getMonth()}`);

/** Dystans łączny w profilu: od 10 km bez części dziesiętnej („61 km”). */
export const totalDistance = (m: number): string =>
  m >= 10000 ? t('units.km', { value: Math.round(m / 1000) }) : distance(m);

const shortDayMonth = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });

/** „dziś 16:05”, „wczoraj 18:12”, „12 lis 9:12” (zgłoszenia: odpowiedź, historia statusów, przejazd). */
export function shortDayTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const hm = time.format(d);
  if (sameDay(d, now)) return t('dates.todayShort', { time: hm });
  if (sameDay(d, yesterday)) return t('dates.yesterdayShort', { time: hm });
  return t('dates.dayShort', { day: shortDayMonth.format(d), time: hm });
}

/** „dziś 16:05”, „wczoraj 18:12”, a starsze bez godziny: „12 lis” (lista zgłoszeń). */
export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now) || sameDay(d, yesterday)) return shortDayTime(iso, now);
  return shortDayMonth.format(d);
}

/** „dziś”, „wczoraj”, „12 lis” (przejazd w nagłówku zgłoszenia: „dziś 14:16–14:32”). */
export function dayWord(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return t('dates.todayWord');
  if (sameDay(d, yesterday)) return t('dates.yesterdayWord');
  return shortDayMonth.format(d);
}

const dayMonthNumeric = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit' });

/** „25.11” (podpis stanu eksportu danych w ustawieniach). */
export const dateShort = (iso: string): string => dayMonthNumeric.format(new Date(iso));

/** „dziś o 14:32”, „wczoraj o 9:05”, „16 listopada o 14:32” (czas zlecenia eksportu danych). */
export function dayAt(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const hm = time.format(d);
  if (sameDay(d, now)) return t('dates.atToday', { time: hm });
  if (sameDay(d, yesterday)) return t('dates.atYesterday', { time: hm });
  return t('dates.atDay', { day: dayMonth.format(d), time: hm });
}

/** „dziś od 18:00”, „jutro od 14:32”, „20 listopada od 14:32” (kolejne zlecenie eksportu danych). */
export function dayFrom(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const hm = time.format(d);
  if (sameDay(d, now)) return t('dates.fromToday', { time: hm });
  if (sameDay(d, tomorrow)) return t('dates.fromTomorrow', { time: hm });
  return t('dates.fromDay', { day: dayMonth.format(d), time: hm });
}

/** Rozmiar pliku: „48 KB” (co najmniej 1 KB), od 1 MB „1,2 MB”. */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return t('units.kb', { value: Math.max(1, Math.round(bytes / 1024)) });
  return t('units.mb', { value: decimal1.format(bytes / (1024 * 1024)) });
}
