'use client';

/**
 * Wykres panelu (ADR 0072): kształty z geometrii w packages/shared (`barSeries`, `heatmap`, `shareBar`,
 * `intervalTimeline`) jako elementy React SVG, bez biblioteki wykresów, bez `dangerouslySetInnerHTML` i bez animacji.
 *
 * - `role="img"` z `aria-label` z opisu modelu; obszar wykresu przyjmuje fokus, strzałki przesuwają zaznaczenie
 *   po obszarach `targets`, a dymek jest też regionem `aria-live`.
 * - Najechanie albo fokus zaznacza punkt: słupek w szarości dostaje kobalt, inne prostokąty (komórka mapy ciepła,
 *   odcinek paska) obwódkę w kobalcie.
 * - Legenda z `legend` modelu (w nagłówku, pod wykresem albo w wierszach z wartościami) i przycisk
 *   „Pokaż jako tabelę” z `table` modelu.
 * - Szerokość: `build(width)` liczy model dla szerokości kontenera (ResizeObserver), `model` to gotowy model.
 */
import {
  CHART_COLORS,
  type ChartLegendItem,
  type ChartModel,
  type ChartShape,
  type ChartTarget,
} from '@hulajnogi/shared';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { t } from '../../../lib/i18n';

export interface ChartTooltip {
  title: string;
  lines: string[];
}

export interface ChartProps {
  /** Model dla szerokości kontenera (geometria z packages/shared); zamiast `model`. */
  build?: (width: number) => ChartModel;
  /** Gotowy model o stałej szerokości (skalowany do kontenera przez `viewBox`). */
  model?: ChartModel;
  /** Wysokość zastępcza przed pierwszym pomiarem szerokości (bez przeskoku układu). */
  placeholderHeight?: number;
  /** Lewa część nagłówka (zwykle tytuł `<h2>`); bez nagłówka, gdy pusty i legenda nie jest w nagłówku. */
  header?: ReactNode;
  /** Opis pod tytułem albo obok legendy (np. „157 startów do 14:35”). */
  meta?: ReactNode;
  /** Legenda: w nagłówku (domyślnie), pod wykresem, w wierszach z wartościami (pasek udziałów) albo bez. */
  legend?: 'header' | 'below' | 'rows' | 'none';
  /** Dodatkowe pozycje legendy (np. kreska „weekend”). */
  legendExtra?: ReactNode;
  /** Przycisk „Pokaż jako tabelę” (domyślnie włączony; ADR 0072 wymaga go przy każdym wykresie raportu). */
  tableToggle?: boolean;
  /** Własny tekst dymka (np. z danymi spoza modelu); `null` to dymek z `targets`. */
  tooltip?: (target: ChartTarget) => ChartTooltip | null;
  /** Kliknięcie punktu (np. przejście do listy z filtrem). */
  onSelect?: (index: number) => void;
  className?: string;
}

/** Kolory tekstu i linii osi w odcieniu motywu (tryb ciemny); wypełnienia zostają w kolorach z tokenów. */
const THEMED: Record<string, string> = {
  [CHART_COLORS.text]: 'var(--muted)',
  [CHART_COLORS.ink]: 'var(--ink)',
  [CHART_COLORS.axis]: 'var(--line)',
};
const themed = (color: string) => THEMED[color] ?? color;

/** Szerokość elementu (ResizeObserver); 0 przed pierwszym pomiarem. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function Chart(props: ChartProps) {
  const {
    build,
    model: fixed,
    placeholderHeight = 200,
    header,
    meta,
    legend = 'header',
    legendExtra,
    tableToggle = true,
    tooltip,
    onSelect,
    className,
  } = props;
  const [plotRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const model = fixed ?? (build && width > 0 ? build(width) : null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const targets = model?.targets ?? [];
  const target = active === null ? null : (targets.find((tg) => tg.index === active) ?? null);
  const tip = target ? (tooltip?.(target) ?? { title: target.title, lines: target.lines }) : null;

  // Model po zmianie danych może nie mieć zaznaczonego punktu.
  useEffect(() => {
    if (active !== null && !targets.some((tg) => tg.index === active)) setActive(null);
  }, [active, targets]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (targets.length === 0) return;
      const order = targets.map((tg) => tg.index);
      const at = active === null ? -1 : order.indexOf(active);
      let next: number | null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[Math.min(order.length - 1, at + 1)] ?? null;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[Math.max(0, at === -1 ? 0 : at - 1)] ?? null;
      else if (e.key === 'Home') next = order[0] ?? null;
      else if (e.key === 'End') next = order[order.length - 1] ?? null;
      else if (e.key === 'Escape') {
        setActive(null);
        return;
      } else if ((e.key === 'Enter' || e.key === ' ') && active !== null && onSelect) {
        e.preventDefault();
        onSelect(active);
        return;
      } else return;
      e.preventDefault();
      setActive(next);
    },
    [targets, active, onSelect],
  );

  const scale = model && fixed && width > 0 ? width / model.width : 1;
  const legendItems = model?.legend ?? [];
  const toggle = tableToggle && model && (
    <button type="button" className="link chart-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
      {asTable ? t('charts.showChart') : t('charts.showTable')}
    </button>
  );
  // Legenda pod wykresem ma przycisk tabeli w tym samym wierszu (plansze pulpitu i mapy ciepła).
  const toggleBelow = legend === 'below';
  const showHead =
    header !== undefined || meta !== undefined || legend === 'header' || (Boolean(toggle) && !toggleBelow);

  return (
    <div className={['chart', className].filter(Boolean).join(' ')}>
      {showHead && (
        <div className="chart-head">
          {header}
          {meta && <span className="chart-meta">{meta}</span>}
          <span className="chart-head-right">
            {legend === 'header' && <Legend items={legendItems} extra={legendExtra} />}
            {!toggleBelow && toggle}
          </span>
        </div>
      )}

      <div ref={plotRef} className="chart-plot-wrap">
        {asTable && model ? (
          <ChartTable model={model} />
        ) : model ? (
          <div
            className="chart-plot"
            tabIndex={targets.length > 0 ? 0 : undefined}
            role={targets.length > 0 ? 'group' : undefined}
            aria-label={targets.length > 0 ? t('charts.keyboard') : undefined}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
          >
            <svg
              role="img"
              aria-label={model.description}
              width={fixed ? Math.round(model.width * scale) : model.width}
              height={Math.round(model.height * scale)}
              viewBox={`0 0 ${model.width} ${model.height}`}
              className="chart-svg"
            >
              <Defs id={id} shapes={model.shapes} />
              {model.shapes.map((shape, i) => (
                <Shape key={i} shape={shape} id={id} active={active} />
              ))}
              {targets.map((tg) => (
                <rect
                  key={`t${tg.index}`}
                  x={tg.x}
                  y={tg.y}
                  width={Math.max(1, tg.width)}
                  height={Math.max(1, tg.height)}
                  fill="transparent"
                  className={onSelect ? 'chart-hit link' : 'chart-hit'}
                  onPointerEnter={() => setActive(tg.index)}
                  onPointerMove={() => active !== tg.index && setActive(tg.index)}
                  onClick={() => onSelect?.(tg.index)}
                />
              ))}
            </svg>
            <div className="chart-live" role="status" aria-live="polite">
              {tip && target && (
                <Tooltip
                  tip={tip}
                  target={target}
                  top={anchorTop(model.shapes, target)}
                  width={model.width}
                  scale={scale}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="chart-placeholder" style={{ height: placeholderHeight }} aria-hidden="true" />
        )}
      </div>

      {legend === 'below' && (
        <div className="chart-foot">
          {asTable ? <span /> : <Legend items={legendItems} extra={legendExtra} />}
          {toggle}
        </div>
      )}
      {legend === 'rows' && !asTable && <LegendRows items={legendItems} active={active} />}
    </div>
  );
}

/** Górna krawędź zaznaczonego punktu (najwyższy słupek albo komórka), żeby dymek stał tuż nad nim. */
function anchorTop(shapes: ChartShape[], target: ChartTarget): number {
  let top = Infinity;
  for (const s of shapes)
    if (s.kind === 'rect' && s.index === target.index && s.fill !== 'none') top = Math.min(top, s.y);
  return Number.isFinite(top) ? top : target.y;
}

/** Wysokość, poniżej której dymek nad punktem wyszedłby poza wykres: wtedy stoi pod górną krawędzią punktu. */
const TIP_ROOM = 64;

function Tooltip({
  tip,
  target,
  top,
  width,
  scale,
}: {
  tip: ChartTooltip;
  target: ChartTarget;
  top: number;
  width: number;
  scale: number;
}) {
  const cx = (target.x + target.width / 2) * scale;
  // Dymek przy krawędzi wykresu nie wychodzi poza kontener: zakotwiczenie z lewej albo z prawej.
  const anchor = cx < width * scale * 0.25 ? 'start' : cx > width * scale * 0.75 ? 'end' : 'middle';
  const below = top * scale < TIP_ROOM;
  return (
    <div
      className={`chart-tip ${anchor}${below ? ' below' : ''}`}
      style={{ left: cx, top: below ? (top + target.height / 4) * scale : top * scale }}
    >
      <span className="chart-tip-title">{tip.title}</span>
      {tip.lines.map((line, i) => (
        <span key={i} className={i === 0 ? 'chart-tip-line' : 'chart-tip-line sub'}>
          {line}
        </span>
      ))}
    </div>
  );
}

/** Wzory ukośne dla prostokątów `hatch` (np. wyłączona z ruchu na osi czasu stanów), po jednym na kolor. */
function Defs({ id, shapes }: { id: string; shapes: ChartShape[] }) {
  const colors = [...new Set(shapes.flatMap((s) => (s.kind === 'rect' && s.hatch ? [s.fill] : [])))];
  if (colors.length === 0) return null;
  return (
    <defs>
      {colors.map((color) => (
        <pattern
          key={color}
          id={hatchId(id, color)}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill={color} />
          <line x1="0" y1="0" x2="0" y2="6" stroke={CHART_COLORS.bar} strokeWidth="1.5" />
        </pattern>
      ))}
    </defs>
  );
}

const hatchId = (id: string, color: string) => `hatch-${id}-${color.replace('#', '')}`;

function Shape({ shape, id, active }: { shape: ChartShape; id: string; active: number | null }) {
  switch (shape.kind) {
    case 'rect': {
      const selected = active !== null && shape.index === active && shape.fill !== 'none';
      // Słupek w szarości zmienia kolor na kobalt; inne prostokąty (komórka, odcinek) dostają obwódkę.
      const recolor = selected && shape.fill === CHART_COLORS.bar;
      const outline = selected && !recolor && shape.fill !== CHART_COLORS.previous;
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={Math.max(0, shape.width)}
          height={Math.max(0, shape.height)}
          rx={shape.rx}
          fill={shape.hatch ? `url(#${hatchId(id, shape.fill)})` : recolor ? CHART_COLORS.current : shape.fill}
          stroke={outline ? CHART_COLORS.current : shape.stroke}
          strokeWidth={outline ? 2 : shape.strokeWidth}
        />
      );
    }
    case 'line':
      return (
        <line
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          style={{ stroke: themed(shape.stroke) }}
          strokeWidth={shape.strokeWidth}
          strokeDasharray={shape.dash}
        />
      );
    case 'text':
      return (
        <text
          x={shape.x}
          y={shape.y}
          fontSize={shape.fontSize}
          fontWeight={shape.numeric ? Math.max(500, shape.fontWeight) : shape.fontWeight}
          textAnchor={shape.anchor}
          style={{ fill: themed(shape.fill), fontVariantNumeric: shape.numeric ? 'tabular-nums' : undefined }}
        >
          {shape.text}
        </text>
      );
    case 'path':
      return <path d={shape.d} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.strokeWidth} />;
  }
}

/** Próbka koloru legendy (wzór ukośny jak na wykresie). */
export function Swatch({ item }: { item: Pick<ChartLegendItem, 'color' | 'hatch'> }) {
  return <span className={item.hatch ? 'chart-swatch hatch' : 'chart-swatch'} style={{ background: item.color }} />;
}

function Legend({ items, extra }: { items: ChartLegendItem[]; extra?: ReactNode }) {
  if (items.length === 0 && !extra) return null;
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.key}>
          <Swatch item={item} />
          {item.label}
        </li>
      ))}
      {extra}
    </ul>
  );
}

/** Legenda paska udziałów w wierszach: nazwa, liczba i udział w osobnych kolumnach (plansza pulpitu). */
function LegendRows({ items, active }: { items: ChartLegendItem[]; active: number | null }) {
  return (
    <ul className="chart-legend-rows">
      {items.map((item, i) => {
        const [value, share] = (item.value ?? '').split(' · ');
        return (
          <li key={item.key} className={active === i ? 'on' : undefined}>
            <Swatch item={item} />
            <span className="grow">{item.label}</span>
            <span className="num">{value}</span>
            <span className="num muted">{share}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** „Pokaż jako tabelę”: dane modelu jako tabela (dostępność, ADR 0072). */
export function ChartTable({ model }: { model: ChartModel }) {
  const { columns, rows } = model.table;
  return (
    <div className="chart-table-wrap">
      <table className="chart-table">
        <caption className="visually-hidden">{model.description}</caption>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={c} className="num">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
