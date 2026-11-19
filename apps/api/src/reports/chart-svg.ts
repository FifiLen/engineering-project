import type { ChartLegendItem, ChartModel, ChartShape } from '@hulajnogi/shared';

/**
 * Tekst SVG z modelu wykresu (ADR 0072): ten sam model co komponent `Chart` w panelu, zamieniony na SVG w HTML
 * raportu PDF. Każdy tekst i atrybut przechodzi przez ucieczkę znaków (jak naklejka QR), liczby są zaokrąglane,
 * a kolor przyjmujemy tylko w postaci `#RRGGBB` (z tokenów design systemu), więc dane raportu nie wstawią znaczników.
 */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const n = (value: number): string => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0');
const color = (value: string | undefined): string => (value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : 'none');
const ANCHORS = { start: 'start', middle: 'middle', end: 'end' } as const;
const HATCH_ID = 'hatch';

function shapeSvg(shape: ChartShape): string {
  switch (shape.kind) {
    case 'rect': {
      const base =
        `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.width)}" height="${n(shape.height)}"` +
        `${shape.rx ? ` rx="${n(shape.rx)}"` : ''} fill="${color(shape.fill)}"` +
        `${shape.stroke ? ` stroke="${color(shape.stroke)}" stroke-width="${n(shape.strokeWidth ?? 1)}"` : ''}/>`;
      if (!shape.hatch) return base;
      return (
        base +
        `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.width)}" height="${n(shape.height)}"` +
        `${shape.rx ? ` rx="${n(shape.rx)}"` : ''} fill="url(#${HATCH_ID})"/>`
      );
    }
    case 'line':
      return (
        `<line x1="${n(shape.x1)}" y1="${n(shape.y1)}" x2="${n(shape.x2)}" y2="${n(shape.y2)}"` +
        ` stroke="${color(shape.stroke)}" stroke-width="${n(shape.strokeWidth)}"` +
        `${shape.dash && /^[\d.\s,]+$/.test(shape.dash) ? ` stroke-dasharray="${shape.dash}"` : ''}/>`
      );
    case 'text':
      return (
        `<text x="${n(shape.x)}" y="${n(shape.y)}" fill="${color(shape.fill)}" font-size="${n(shape.fontSize)}"` +
        ` font-weight="${shape.fontWeight}" text-anchor="${ANCHORS[shape.anchor]}"` +
        `${shape.numeric ? ' class="num"' : ''}>${escapeHtml(shape.text)}</text>`
      );
    case 'path':
      return /^[MLHVCSQTAZmlhvcsqtaz\d\s.,-]*$/.test(shape.d)
        ? `<path d="${shape.d}" fill="${color(shape.fill)}"` +
            `${shape.stroke ? ` stroke="${color(shape.stroke)}" stroke-width="${n(shape.strokeWidth ?? 1)}"` : ''}/>`
        : '';
  }
}

/**
 * SVG wykresu z opisem dla czytników (`role="img"`, `aria-label`). Geometria szacuje szerokość podpisów osi, więc
 * `padLeft` dokłada zapas z lewej, żeby podpis szerszy niż szacunek nie został ucięty na krawędzi strony.
 */
export function chartToSvg(model: ChartModel, padLeft = 0): string {
  const hatch = model.shapes.some((s) => s.kind === 'rect' && s.hatch);
  const defs = hatch
    ? `<defs><pattern id="${HATCH_ID}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<line x1="0" y1="0" x2="0" y2="6" stroke="#FFFFFF" stroke-width="2"/></pattern></defs>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="${n(-padLeft)} 0 ${n(model.width + padLeft)} ${n(
      model.height,
    )}" width="${n(model.width + padLeft)}" height="${n(model.height)}" role="img"` +
    ` aria-label="${escapeHtml(model.description)}">` +
    defs +
    model.shapes.map(shapeSvg).join('') +
    '</svg>'
  );
}

/** Legenda pod wykresem (kwadrat koloru, etykieta, opcjonalnie liczba i udział). */
export function legendHtml(items: readonly ChartLegendItem[]): string {
  if (!items.length) return '';
  return `<ul class="legend">${items
    .map(
      (item) =>
        `<li><span class="swatch${item.hatch ? ' hatch' : ''}" style="background:${color(item.color)}"></span>` +
        `${escapeHtml(item.label)}${item.value ? ` <span class="num muted">${escapeHtml(item.value)}</span>` : ''}</li>`,
    )
    .join('')}</ul>`;
}
