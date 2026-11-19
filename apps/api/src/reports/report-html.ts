import {
  isTableTruncated,
  REPORT_CATALOG,
  REPORT_LIMITS,
  shortReportRunId,
  type ReportChartModel,
  type ReportModel,
  type ReportOrientation,
  type ReportTableModel,
  type ReportTileModel,
  type ReportValueKind,
  type ResolvedReportParams,
} from '@hulajnogi/core';
import {
  barSeries,
  CHART_COLORS,
  heatmap,
  shareBar,
  type CompanyPublicView,
  type ReportFormat,
} from '@hulajnogi/shared';
import { chartToSvg, escapeHtml, legendHtml } from './chart-svg.js';
import {
  axisFormat,
  axisLabel,
  bucketTitle,
  formatChange,
  formatInstant,
  formatRange,
  formatReportValue,
  REPORT_FORMAT_LABELS,
  REPORT_ORIENTATION_LABELS,
} from './report-format.js';

/**
 * HTML raportu PDF (ADR 0071, D3; plansza `32-panel-raporty/raport-pdf`): budowany w API funkcjami z ucieczką
 * znaków (jak naklejka QR), bez Reacta i bez zasobów z sieci. Pierwsza strona ma nagłówek z danymi firmy
 * (`company_profile`), nazwę i opis z `report_definitions`, parametry, chwilę danych i zlecającego; dalej kafelki
 * z porównaniem, wykresy SVG z geometrii w packages/shared (ADR 0072) i tabele z powtarzanym `thead`, skrócone do
 * 50 wierszy z dopiskiem o XLSX. Stopka każdej strony to osobny dokument `footer.html` z licznikami Chromium
 * (`pageNumber`, `totalPages`) przekazany do Gotenberga obok `index.html`. W PDF zamkniętego okresu nie ma
 * bieżącej wartości, więc wykresy nie mają kobaltu (kolory stanów hulajnogi zostają, bo są kategoriami).
 */
export interface ReportDocumentContext {
  runId: string;
  name: string;
  description: string | null;
  params: ResolvedReportParams;
  paramLabels: Array<{ label: string; value: string }>;
  company: Pick<CompanyPublicView, 'name' | 'street' | 'postalCode' | 'city' | 'taxId'>;
  dataAsOf: Date;
  generatedAt: Date;
  requestedBy: string;
  format: ReportFormat;
}

/** Szerokość treści strony A4 przy marginesach 14 mm (px przy 96 dpi): pionowo 182 mm, poziomo 269 mm. */
const CONTENT_WIDTH: Record<ReportOrientation, number> = { portrait: 688, landscape: 1016 };
const PAGE_MARGIN_MM = { top: 14, side: 14, bottom: 20 };
/** Zapas z lewej na podpisy osi Y (szerokość tekstu w geometrii jest szacowana). */
const AXIS_PAD = 16;

const NUMERIC_KINDS: ReadonlySet<ReportValueKind> = new Set(['money', 'number', 'duration', 'distance', 'percent']);

/** Kolory odcinków paska udziałów: stany hulajnogi jak na mapie floty, źródła zgłoszeń w skali szarości. */
const SHARE_COLORS: Record<string, string> = {
  ...CHART_COLORS.status,
  USER: CHART_COLORS.ink,
  AUTO: CHART_COLORS.bar,
  STAFF: CHART_COLORS.status.OFFLINE,
};
const shareColor = (key: string, index: number): string =>
  SHARE_COLORS[key] ?? CHART_COLORS.heatmap[Math.min(4, index + 1)]!;

function tileHtml(tile: ReportTileModel): string {
  const value = formatReportValue(tile.kind, tile.value, tile.decimals);
  const previous =
    tile.previous === null
      ? ''
      : `<div class="tile-change">${tile.change === null ? '' : `${escapeHtml(formatChange(tile.change))} · `}` +
        `poprzednio <span class="num">${escapeHtml(formatReportValue(tile.kind, tile.previous, tile.decimals))}</span></div>`;
  return (
    `<div class="tile"><div class="tile-label">${escapeHtml(tile.label)}</div>` +
    `<div class="tile-value num">${escapeHtml(value)}</div>${previous}</div>`
  );
}

function chartHtml(chart: ReportChartModel, params: ResolvedReportParams, width: number): string {
  let svg: string;
  let legend = '';
  switch (chart.type) {
    case 'bar': {
      const time = chart.axis === 'time';
      const model = barSeries({
        width: width - AXIS_PAD,
        height: 190,
        title: chart.title,
        items: chart.items.map((item) => ({
          key: item.key,
          label: time ? axisLabel(item.key, chart.granularity) : item.label,
          value: item.value,
          previous: item.previous,
          weekend: item.weekend,
          title: time ? bucketTitle(item.key, chart.granularity) : item.label,
        })),
        format: axisFormat(chart.kind, chart.decimals),
        seriesLabel: time ? formatRange(params.range.from, params.range.to) : chart.title,
        ...(chart.hasPrevious && params.comparison
          ? { previousLabel: formatRange(params.comparison.range.from, params.comparison.range.to) }
          : {}),
        categoryLabel: 'Okres',
        fontSize: 10,
      });
      svg = chartToSvg(model, AXIS_PAD);
      legend = model.legend.length > 1 ? legendHtml(model.legend) : '';
      break;
    }
    case 'heatmap': {
      const values = chart.rowLabels.map((_, r) =>
        Array.from({ length: 24 }, (_, hour) => {
          const cell = chart.cells.find((c) => c.isodow === r + 1 && c.hour === hour);
          return cell?.value ?? null;
        }),
      );
      const model = heatmap({
        width,
        title: chart.title,
        rowLabels: chart.rowLabels,
        columnLabels: Array.from({ length: 24 }, (_, hour) => String(hour)),
        values,
        thresholds: chart.thresholds,
        format: (v) => formatReportValue('number', v, chart.decimals ?? 1),
        valueLabel: chart.title,
        columnLabelStride: 2,
        fontSize: 10,
      });
      svg = chartToSvg(model);
      legend = legendHtml(model.legend);
      break;
    }
    case 'share': {
      const model = shareBar({
        width,
        height: 16,
        title: chart.title,
        segments: chart.segments.map((s, i) => ({
          key: s.key,
          label: s.label,
          value: s.value,
          color: shareColor(s.key, i),
        })),
        format: (v) => formatReportValue(chart.kind, v, chart.decimals),
      });
      svg = chartToSvg(model);
      legend = legendHtml(model.legend);
      break;
    }
  }
  return `<section class="block chart-block"><h2>${escapeHtml(chart.title)}</h2>${svg}${legend}</section>`;
}

function cellHtml(kind: ReportValueKind, value: Parameters<typeof formatReportValue>[1], decimals?: number): string {
  const numeric = NUMERIC_KINDS.has(kind);
  return `<td${numeric ? ' class="n num"' : ''}>${escapeHtml(formatReportValue(kind, value, decimals))}</td>`;
}

function tableHtml(table: ReportTableModel): string {
  const head = table.columns
    .map((c) => `<th${NUMERIC_KINDS.has(c.kind) ? ' class="n"' : ''}>${escapeHtml(c.label)}</th>`)
    .join('');
  const rows = table.rows
    .map(
      (row) =>
        `<tr${row.style === 'subtotal' ? ' class="subtotal"' : ''}>${table.columns
          .map((c) => cellHtml(c.kind, row.cells[c.key] ?? null, c.decimals))
          .join('')}</tr>`,
    )
    .join('');
  const totals = table.totals
    ? `<tr class="total">${table.columns.map((c) => cellHtml(c.kind, table.totals![c.key] ?? null, c.decimals)).join('')}</tr>`
    : '';
  const empty = table.rows.length
    ? ''
    : `<tr><td class="empty" colspan="${table.columns.length}">Brak wierszy w okresie</td></tr>`;
  const note = isTableTruncated(table)
    ? `<p class="note">Pokazano ${table.rows.length} z ${table.totalRows} wierszy. Pełne dane są w pliku XLSX tego raportu.</p>`
    : '';
  const wide = table.columns.length > 16 ? ' wide xwide' : table.columns.length > 10 ? ' wide' : '';
  return (
    `<section class="block table-block"><h2>${escapeHtml(table.title)}</h2>` +
    `${table.description ? `<p class="muted desc">${escapeHtml(table.description)}</p>` : ''}` +
    `<table class="data${wide}"><thead><tr>${head}</tr></thead><tbody>${rows}${totals}${empty}</tbody></table>${note}</section>`
  );
}

function companyLine(company: ReportDocumentContext['company']): string {
  const address = [company.street, [company.postalCode, company.city].filter(Boolean).join(' ')]
    .filter((part) => part && part.trim())
    .join(', ');
  return [address, company.taxId ? `NIP ${company.taxId}` : ''].filter(Boolean).join(' · ');
}

/** Dokument HTML raportu; tabele modelu powinny być już skrócone (`truncateReportTables(model, 50)`). */
export function reportHtml(model: ReportModel, ctx: ReportDocumentContext): string {
  const spec = REPORT_CATALOG[model.code];
  const orientation = spec.orientation;
  const width = CONTENT_WIDTH[orientation];
  const shortId = shortReportRunId(ctx.runId);
  const params = [
    ...ctx.paramLabels,
    { label: 'Strefa czasowa', value: 'Europe/Warsaw' },
    { label: 'Dane na', value: formatInstant(ctx.dataAsOf) },
    { label: 'Zlecił', value: ctx.requestedBy },
    { label: 'Format', value: `${REPORT_FORMAT_LABELS[ctx.format]}, ${REPORT_ORIENTATION_LABELS[orientation]}` },
  ];
  const body = model.empty
    ? `<section class="block notice">Brak danych w wybranym okresie. Raport nie ma kafelków, wykresów ani wierszy tabel.</section>`
    : [
        model.tiles.length ? `<section class="tiles">${model.tiles.map(tileHtml).join('')}</section>` : '',
        ...model.charts.map((c) => chartHtml(c, ctx.params, width)),
        ...model.tables.map(tableHtml),
      ].join('');

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(ctx.name)} · ${escapeHtml(shortId)}</title>
<style>
  @page { size: A4 ${orientation}; margin: ${PAGE_MARGIN_MM.top}mm ${PAGE_MARGIN_MM.side}mm ${PAGE_MARGIN_MM.bottom}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Inter, sans-serif; color: #16181D; background: #FFFFFF; font-size: 8.5pt; line-height: 1.4;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { font-weight: 500; font-variant-numeric: tabular-nums; }
  .muted { color: #6B6E75; }
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
              padding-bottom: 10px; border-bottom: 0.75pt solid #E3E3DE; }
  .brand { display: flex; gap: 8px; align-items: flex-start; }
  .brand-mark { width: 18px; height: 18px; border-radius: 5px; background: #2B3FF5; flex-shrink: 0; margin-top: 1px; }
  .brand-name { font-weight: 600; font-size: 9.5pt; }
  .brand-sub { color: #6B6E75; font-size: 7.5pt; }
  .run { text-align: right; font-size: 7.5pt; color: #6B6E75; white-space: nowrap; }
  .run b { color: #16181D; font-weight: 600; }
  h1 { font-size: 20pt; font-weight: 600; letter-spacing: -0.02em; margin: 14px 0 2px; }
  .lead { color: #6B6E75; margin: 0 0 12px; max-width: 150mm; }
  .params { display: grid; grid-template-columns: ${orientation === 'landscape' ? '1.4fr 1.4fr 1fr 1fr' : '1.3fr 1.3fr 1fr'}; gap: 6px 16px;
            background: #F6F6F3; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; break-inside: avoid; }
  .params dt { color: #6B6E75; font-size: 7pt; margin: 0; }
  .params dd { margin: 0; font-weight: 500; }
  .tiles { display: grid; grid-template-columns: repeat(${orientation === 'landscape' ? 6 : 3}, 1fr); gap: 8px;
           margin-bottom: 14px; break-inside: avoid; }
  .tile { border: 0.75pt solid #E3E3DE; border-radius: 8px; padding: 8px 10px; break-inside: avoid; }
  .tile-label { color: #6B6E75; font-size: 7pt; }
  .tile-value { font-size: 13pt; letter-spacing: -0.01em; margin-top: 2px; white-space: nowrap; }
  .tile-change { color: #6B6E75; font-size: 6.5pt; margin-top: 2px; }
  .tile-change .num { color: #16181D; }
  .block { margin-bottom: 14px; break-inside: avoid; }
  .table-block { break-inside: auto; }
  h2 { font-size: 10pt; font-weight: 600; margin: 0 0 6px; break-after: avoid; }
  .desc { margin: -3px 0 6px; font-size: 7pt; break-after: avoid; }
  svg.chart { display: block; font-family: Inter, sans-serif; overflow: visible; }
  svg.chart .num { font-variant-numeric: tabular-nums; }
  .legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 0; margin: 6px 0 0;
            font-size: 7pt; color: #6B6E75; }
  .legend li { display: flex; align-items: center; gap: 5px; }
  .legend .num { color: #16181D; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .swatch.hatch { background-image: repeating-linear-gradient(45deg, transparent 0 2px, #FFFFFF 2px 3px) !important; }
  table.data { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
  /* Szeroka tabela nie może być szersza od strony (Chromium pomniejszyłby wtedy cały dokument), więc ma stały
     układ kolumn i zawijane nagłówki. */
  table.data.wide { font-size: 6.5pt; table-layout: fixed; }
  table.data.wide th, table.data.wide td { padding: 3px 3px; overflow-wrap: anywhere; }
  table.data.wide .n { white-space: normal; }
  table.data.xwide { font-size: 6pt; }
  table.data.xwide th, table.data.xwide td { padding: 3px 2px; }
  table.data.xwide th:first-child { width: 15mm; }
  table.data thead { display: table-header-group; }
  table.data th { text-align: left; font-weight: 600; color: #6B6E75; padding: 4px 5px;
                  border-bottom: 0.75pt solid #16181D; vertical-align: bottom; }
  table.data td { padding: 3.5px 5px; border-bottom: 0.5pt solid #E3E3DE; vertical-align: top; }
  table.data .n { text-align: right; white-space: nowrap; }
  table.data tr { break-inside: avoid; }
  table.data tr.subtotal td { background: #F6F6F3; font-weight: 500; }
  table.data tr.total td { font-weight: 600; border-top: 0.75pt solid #16181D; }
  table.data td.empty { color: #6B6E75; text-align: center; padding: 10px; }
  .note { font-size: 7pt; color: #6B6E75; background: #F6F6F3; border-radius: 6px; padding: 6px 8px; margin: 6px 0 0; }
  .notice { background: #F6F6F3; border-radius: 8px; padding: 14px; color: #6B6E75; }
</style>
</head>
<body>
<header class="doc-head">
  <div class="brand"><span class="brand-mark"></span><div>
    <div class="brand-name">${escapeHtml(ctx.company.name)}</div>
    <div class="brand-sub">${escapeHtml(companyLine(ctx.company))}</div>
  </div></div>
  <div class="run">Raport <b>${escapeHtml(shortId)}</b><br>Wygenerowano <b>${escapeHtml(formatInstant(ctx.generatedAt))}</b></div>
</header>
<h1>${escapeHtml(ctx.name)}</h1>
${ctx.description ? `<p class="lead">${escapeHtml(ctx.description)}</p>` : ''}
<dl class="params">${params
    .map((p) => `<div><dt>${escapeHtml(p.label)}</dt><dd>${escapeHtml(p.value)}</dd></div>`)
    .join('')}</dl>
${body}
</body>
</html>`;
}

/**
 * Stopka każdej strony (`footer.html` Gotenberga): osobny dokument z własnym CSS, układ tabelą na całą szerokość
 * (flex z `body` nie rozciąga się w stopce Chromium), rozmiar czcionki podany wprost; mieści się w dolnym marginesie
 * `@page` (20 mm).
 */
export function reportFooterHtml(ctx: Pick<ReportDocumentContext, 'runId' | 'dataAsOf' | 'requestedBy'>): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: Inter, sans-serif; font-size: 7pt; color: #6B6E75; width: 100%;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { width: 100%; border-collapse: collapse; margin: 0 ${PAGE_MARGIN_MM.side}mm 6mm; width: calc(100% - ${
    PAGE_MARGIN_MM.side * 2
  }mm); }
  td { padding-top: 5px; border-top: 0.5pt solid #E3E3DE; font-size: 7pt; }
  td.r { text-align: right; white-space: nowrap; }
  b { color: #16181D; font-weight: 500; }
</style>
</head>
<body><table><tr>
  <td>Raport <b>${escapeHtml(shortReportRunId(ctx.runId))}</b> · dane na <b>${escapeHtml(
    formatInstant(ctx.dataAsOf),
  )}</b> · zlecił <b>${escapeHtml(ctx.requestedBy)}</b></td>
  <td class="r">Strona <b class="pageNumber"></b> z <b class="totalPages"></b></td>
</tr></table></body>
</html>`;
}

/** Limit wierszy tabel w PDF (dalej dopisek o XLSX). */
export const REPORT_PDF_ROWS = REPORT_LIMITS.pdfRows;
