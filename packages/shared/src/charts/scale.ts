/**
 * Skale, podziałki i szacowanie szerokości tekstu (ADR 0072). Szerokość tekstu Inter szacujemy z liczby znaków
 * i stałego współczynnika (bez pomiaru w DOM), a za długie etykiety skracamy wielokropkiem.
 */

/** Średnia szerokość znaku Inter jako ułamek rozmiaru czcionki (cyfry Medium i małe litery). */
export const INTER_CHAR_WIDTH = 0.56;

export const estimateTextWidth = (text: string, fontSize: number): number => text.length * fontSize * INTER_CHAR_WIDTH;

/** Tekst skrócony do szerokości wielokropkiem (pełna wartość jest w dymku i w tabeli). */
export function fitText(text: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const chars = Math.max(1, Math.floor(maxWidth / (fontSize * INTER_CHAR_WIDTH)) - 1);
  return `${text.slice(0, chars)}…`;
}

export interface NiceTicks {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

function niceStep(raw: number): number {
  const exponent = Math.floor(Math.log10(raw));
  const fraction = raw / 10 ** exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/**
 * Podziałki osi „ładne” (1, 2, 2,5, 5 × 10ⁿ) obejmujące `[min, max]`, z zerem w zakresie (słupki rosną od zera).
 * `count` to przybliżona liczba odstępów; przy pustym zakresie oś 0–1.
 */
export function niceTicks(min: number, max: number, count = 4): NiceTicks {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
  if (hi === lo) hi = lo + 1;
  const step = niceStep((hi - lo) / Math.max(1, count));
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  // Liczby zmiennoprzecinkowe (0,1 + 0,2): zaokrąglenie do precyzji kroku.
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return { min: start, max: end, step, ticks: ticks.map((t) => Number(t.toFixed(digits))) };
}

/** Skala liniowa domeny na zakres (piksele). */
export function linearScale(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Co który podpis osi pokazać, żeby się nie nakładały (rzadsze podziałki przy wąskim wykresie). */
export function labelStride(labels: readonly string[], band: number, fontSize: number, gap = 6): number {
  const widest = labels.reduce((max, l) => Math.max(max, estimateTextWidth(l, fontSize)), 0);
  return Math.max(1, Math.ceil((widest + gap) / Math.max(1, band)));
}

/** Zaokrąglenie współrzędnych do 0,5 px (ostre linie w SVG i krótszy tekst SVG w PDF). */
export const px = (value: number): number => Math.round(value * 2) / 2;

/** Liczba po polsku (domyślne formatowanie wartości osi i dymków). */
const plNumber = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 });
export const formatChartNumber = (value: number): string => plNumber.format(value);
