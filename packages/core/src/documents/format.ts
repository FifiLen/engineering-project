/**
 * Formatowanie wartości przed wstawieniem do szablonu (ADR 0067): szablon nie ma wyrażeń ani filtrów, więc kwoty,
 * daty i liczby przychodzą jako gotowe teksty. Kwoty formatuje `formatPln` z packages/shared (API przekazuje go
 * jako `money`, bo core nie zależy od shared); daty w strefie Europe/Warsaw `dd.MM.yyyy, HH:mm`.
 */
export const DOCUMENT_TIME_ZONE = 'Europe/Warsaw';

export interface DocumentFormatters {
  /** Kwota w groszach, np. `1250` → „12,50 zł”. */
  money(grosze: number): string;
  /** `18.11.2026, 14:05` w czasie polskim. */
  dateTime(at: Date): string;
  /** `18.11.2026`. */
  date(at: Date): string;
  /** Liczba z polskim separatorem dziesiętnym, np. `2,4`. */
  number(value: number, fractionDigits?: number): string;
}

const dateParts = new Intl.DateTimeFormat('pl-PL', {
  timeZone: DOCUMENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(at: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const out = { year: '', month: '', day: '', hour: '', minute: '' };
  for (const part of dateParts.formatToParts(at)) {
    if (part.type in out) out[part.type as keyof typeof out] = part.value;
  }
  return out;
}

/** Data w strefie polskiej `dd.MM.yyyy`. */
export function formatDocumentDate(at: Date): string {
  const p = parts(at);
  return `${p.day}.${p.month}.${p.year}`;
}

/** Data i czas w strefie polskiej `dd.MM.yyyy, HH:mm`. */
export function formatDocumentDateTime(at: Date): string {
  const p = parts(at);
  return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
}

/** Data w strefie polskiej jako `RRRR-MM-DD` (nazwy plików). */
export function documentDateStamp(at: Date): string {
  const p = parts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

const numberFormats = new Map<number, Intl.NumberFormat>();

/** Liczba po polsku (przecinek dziesiętny, spacje tysięcy według CLDR). */
export function formatDocumentNumber(value: number, fractionDigits = 0): string {
  let format = numberFormats.get(fractionDigits);
  if (!format) {
    format = new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    numberFormats.set(fractionDigits, format);
  }
  return format.format(value);
}

/** Formatery wydruku z formatowaniem kwot z shared (`formatPln`). */
export const documentFormatters = (money: (grosze: number) => string): DocumentFormatters => ({
  money,
  dateTime: formatDocumentDateTime,
  date: formatDocumentDate,
  number: formatDocumentNumber,
});
