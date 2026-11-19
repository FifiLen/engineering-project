/**
 * Model wykresu (ADR 0072): lista kształtów SVG jako dane, opis do `aria-label`, dane tabeli „Pokaż jako tabelę”
 * i obszary aktywne dla dymka i fokusu klawiatury. Geometria nie zna DOM ani nie mierzy tekstu; panel zamienia
 * kształty na elementy React SVG, a API na tekst SVG w HTML raportu PDF.
 */
export type ChartTextAnchor = 'start' | 'middle' | 'end';

export interface ChartRect {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  rx?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Wzór ukośny (wyłączona z ruchu na osi czasu stanów); renderer rysuje go na kolorze `fill`. */
  hatch?: boolean;
  /** Indeks punktu danych (zaznaczenie i dymek). */
  index?: number;
}

export interface ChartLine {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  dash?: string;
  index?: number;
}

export interface ChartText {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  fill: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600;
  anchor: ChartTextAnchor;
  /** Liczby zawsze Medium (design system). */
  numeric?: boolean;
}

export interface ChartPath {
  kind: 'path';
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

export type ChartShape = ChartRect | ChartLine | ChartText | ChartPath;

/** Obszar punktu danych: najechanie i fokus pokazują dymek z `title` i `lines`. */
export interface ChartTarget {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  lines: string[];
}

export interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  hatch?: boolean;
  /** Liczba albo udział w legendzie paska (np. „163 · 68%”). */
  value?: string;
}

export interface ChartTable {
  columns: string[];
  rows: string[][];
}

export interface ChartModel {
  width: number;
  height: number;
  shapes: ChartShape[];
  targets: ChartTarget[];
  legend: ChartLegendItem[];
  /** Opis do `aria-label` (`role="img"`). */
  description: string;
  table: ChartTable;
}

/** Formatowanie wartości (kwoty, liczby, udziały) przekazywane przez wywołującego. */
export type ChartFormat = (value: number) => string;
