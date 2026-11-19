import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { barSeries } from './bar-series.js';
import { CHART_COLORS } from './colors.js';
import { heatmap, heatmapLegend, heatmapStep } from './heatmap.js';
import { intervalTimeline, statusTimelineKey, warsawDayRows, warsawDayStart } from './interval-timeline.js';
import { fitText, labelStride, niceTicks } from './scale.js';
import { shareBar } from './share-bar.js';
import type { ChartModel, ChartRect } from './types.js';

const rects = (model: ChartModel) => model.shapes.filter((s): s is ChartRect => s.kind === 'rect');

describe('podziałki i tekst', () => {
  it('ładne podziałki z zerem w zakresie', () => {
    expect(niceTicks(0, 3200).ticks).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(niceTicks(0, 37).ticks).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(-1236, 3200).ticks[0]).toBeLessThanOrEqual(-1236);
    expect(niceTicks(0, 0.153, 4).ticks).toEqual([0, 0.05, 0.1, 0.15, 0.2]);
    expect(niceTicks(0, 0).ticks).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('wąski wykres pokazuje rzadsze podpisy, długi tekst kończy się wielokropkiem', () => {
    expect(labelStride(['24', '25'], 30, 11)).toBe(1);
    expect(labelStride(['pn 12.10'], 10, 11)).toBeGreaterThan(1);
    expect(fitText('Poniedziałek', 40, 11)).toMatch(/…$/);
    expect(fitText('pn', 40, 11)).toBe('pn');
  });
});

describe('słupki', () => {
  const items = [
    { key: '2026-10-01', label: '1', value: 2000, previous: 1500 },
    { key: '2026-10-02', label: '2', value: -500, previous: null },
    { key: '2026-10-03', label: '3', value: 3200, previous: 2654, highlight: true, weekend: true },
    { key: '2026-10-31', label: '31', value: null, previous: null },
  ];
  const model = barSeries({
    width: 600,
    height: 200,
    title: 'Sprzedaż brutto według dni',
    items,
    seriesLabel: 'Październik 2026',
    previousLabel: 'Wrzesień 2026',
    categoryLabel: 'Dzień',
    format: (v) => `${v / 100} zł`,
  });

  it('słupek bieżący na słupku poprzedniego okresu, zaznaczony kobaltem, ujemny w dół od zera', () => {
    const bars = rects(model);
    expect(bars.filter((r) => r.fill === CHART_COLORS.previous)).toHaveLength(2);
    expect(bars.filter((r) => r.fill === CHART_COLORS.current)).toHaveLength(1);
    const zeroLine = model.shapes.find((s) => s.kind === 'line' && s.strokeWidth === 1.5)!;
    const negative = bars.find((r) => r.index === 1 && r.fill === CHART_COLORS.bar)!;
    if (zeroLine.kind !== 'line') throw new Error('linia');
    expect(negative.y).toBeCloseTo(zeroLine.y1, 0);
    const current = bars.find((r) => r.index === 0 && r.fill === CHART_COLORS.bar)!;
    const previous = bars.find((r) => r.index === 0 && r.fill === CHART_COLORS.previous)!;
    expect(previous.width).toBeGreaterThan(current.width);
    expect(bars.some((r) => r.index === 3)).toBe(false);
    for (const r of bars) expect(r.x + r.width).toBeLessThanOrEqual(600.5);
  });

  it('dymki, opis i tabela tych samych danych', () => {
    expect(model.targets).toHaveLength(4);
    expect(model.targets[2]!.lines).toEqual(['Październik 2026: 32 zł', 'Wrzesień 2026: 26.54 zł']);
    expect(model.description).toBe(
      'Sprzedaż brutto według dni: wykres słupkowy, 4 słupków, najwyższa wartość 32 zł (3), z porównaniem: Wrzesień 2026.',
    );
    expect(model.table.columns).toEqual(['Dzień', 'Październik 2026', 'Wrzesień 2026']);
    expect(model.table.rows[3]).toEqual(['31', '—', '—']);
    expect(model.legend.map((l) => l.color)).toEqual([CHART_COLORS.bar, CHART_COLORS.previous]);
  });

  it('znaczniki średniej grafitowe, także dla godzin bez słupka', () => {
    const hours = barSeries({
      width: 480,
      height: 160,
      title: 'Przejazdy dziś według godzin',
      seriesLabel: 'Dziś',
      markerLabel: 'Średnia z 4 ostatnich czwartków',
      items: Array.from({ length: 24 }, (_, h) => ({
        key: String(h),
        label: String(h),
        value: h <= 14 ? 10 : null,
        marker: 9.75,
        highlight: h === 14,
      })),
    });
    expect(hours.shapes.filter((s) => s.kind === 'line' && s.stroke === CHART_COLORS.average)).toHaveLength(24);
    expect(rects(hours).filter((r) => r.fill === CHART_COLORS.current)).toHaveLength(1);
    expect(hours.legend.map((l) => l.key)).toEqual(['value', 'marker']);
  });
});

describe('mapa ciepła', () => {
  const thresholds = [3, 6, 10, 15];

  it('stałe progi: pięć stopni i legenda z progami', () => {
    expect([null, 0, 2.9, 3, 6, 9.9, 10, 15, 20.3].map((v) => heatmapStep(v, thresholds))).toEqual([
      0, 0, 0, 1, 2, 2, 3, 4, 4,
    ]);
    expect(heatmapLegend(thresholds).map((l) => l.label)).toEqual(['poniżej 3', '3–6', '6–10', '10–15', '15 i więcej']);
  });

  it('siatka 7 × 24 z kolorami stopni, zaznaczeniem i tabelą', () => {
    const values = Array.from({ length: 7 }, (_, r) =>
      Array.from({ length: 24 }, (_, c) => (r === 4 && c === 17 ? 20.25 : r === 0 ? null : 4)),
    );
    const model = heatmap({
      width: 640,
      title: 'Godzina startu według dnia tygodnia',
      rowLabels: ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'],
      columnLabels: Array.from({ length: 24 }, (_, h) => String(h)),
      values,
      thresholds,
      valueLabel: 'Średnio',
      selected: { row: 4, column: 17 },
      columnLabelStride: 3,
      details: (r, c) => (r === 4 && c === 17 ? ['Razem 81 w 4 piątki'] : []),
    });
    const cells = rects(model).filter((r) => r.index !== undefined);
    expect(cells).toHaveLength(168);
    expect(cells.find((r) => r.index === 4 * 24 + 17)!.fill).toBe(CHART_COLORS.heatmap[4]);
    expect(cells.find((r) => r.index === 24)!.fill).toBe(CHART_COLORS.heatmap[1]);
    expect(rects(model).some((r) => r.stroke === CHART_COLORS.current)).toBe(true);
    expect(model.targets[4 * 24 + 17]).toMatchObject({
      title: 'Pt, 17',
      lines: ['Średnio: 20,3', 'Razem 81 w 4 piątki'],
    });
    expect(model.table.rows[0]![1]).toBe('—');
    expect(model.description).toContain('najwięcej 20,3 (Pt, 17)');
    expect(model.shapes.filter((s) => s.kind === 'text' && /^\d+$/.test(s.text))).toHaveLength(8);
  });
});

describe('pasek udziałów', () => {
  it('odcinki proporcjonalne z minimalną szerokością i legendą z procentami', () => {
    const model = shareBar({
      width: 400,
      title: 'Stan floty',
      segments: [
        { key: 'AVAILABLE', label: 'Dostępne', value: 163, color: CHART_COLORS.status.AVAILABLE },
        { key: 'IN_USE', label: 'W użyciu i rezerwacje', value: 43, color: CHART_COLORS.status.IN_RIDE },
        { key: 'OFFLINE', label: 'Bez łączności', value: 1, color: CHART_COLORS.status.OFFLINE },
        { key: 'MAINTENANCE', label: 'Serwis', value: 0, color: CHART_COLORS.status.SERVICE },
      ],
    });
    const bars = rects(model);
    expect(bars).toHaveLength(3);
    expect(bars[2]!.width).toBeGreaterThanOrEqual(3);
    const end = bars[2]!.x + bars[2]!.width;
    expect(end).toBeGreaterThan(398);
    expect(end).toBeLessThanOrEqual(400.5);
    expect(model.legend[0]!.value).toBe('163 · 78,7%');
    expect(model.description).toBe(
      'Stan floty: Dostępne 163 (78,7%), W użyciu i rezerwacje 43 (20,8%), Bez łączności 1 (0,5%).',
    );
  });

  it('pusty pasek bez danych', () => {
    const model = shareBar({ width: 100, title: 'Stan floty', segments: [] });
    expect(rects(model)).toHaveLength(1);
    expect(model.description).toBe('Stan floty: brak danych.');
  });
});

describe('oś czasu stanów', () => {
  it('doby polskie od północy, także doba 25-godzinna', () => {
    expect(warsawDayStart('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    const rows = warsawDayRows('2026-10-26', 2);
    expect(rows.map((r) => [r.key, (r.to.getTime() - r.from.getTime()) / 3_600_000])).toEqual([
      ['2026-10-25', 25],
      ['2026-10-26', 24],
    ]);
  });

  it('brak łączności przykrywa stan, przedziały przycięte do doby i do teraz', () => {
    expect(statusTimelineKey('IN_USE', false)).toBe('OFFLINE');
    expect(statusTimelineKey('RESERVED', true)).toBe('RESERVED');
    expect(statusTimelineKey('RETIRED', false)).toBe('RETIRED');
    const rows = warsawDayRows('2026-11-19', 2);
    const now = new Date('2026-11-19T13:35:00Z');
    const model = intervalTimeline({
      width: 500,
      title: 'Historia stanów #0110',
      rows,
      now,
      intervals: [
        {
          from: new Date('2026-11-18T10:00:00Z'),
          to: new Date('2026-11-19T01:00:00Z'),
          color: 'AVAILABLE',
          label: 'Dostępna',
        },
        {
          from: new Date('2026-11-19T01:00:00Z'),
          to: null,
          color: 'IN_RIDE',
          label: 'W użyciu',
          details: ['Przejazd R-51854'],
        },
      ],
      legend: [
        { key: 'AVAILABLE', label: 'Dostępna' },
        { key: 'IN_RIDE', label: 'W użyciu' },
      ],
    });
    const states = rects(model).filter((r) => r.index !== undefined);
    // Pierwszy przedział przecina północ: dwa odcinki; otwarty kończy się teraz.
    expect(states.filter((r) => r.index === 0)).toHaveLength(2);
    const open = states.find((r) => r.index === 1)!;
    const plotEnd = 500;
    expect(open.x + open.width).toBeLessThan(plotEnd * 0.75);
    expect(model.shapes.some((s) => s.kind === 'text' && s.text === '14:35')).toBe(true);
    expect(model.targets.find((t) => t.index === 1)!.lines).toEqual(['02:00–14:35 (12 h 35 min)', 'Przejazd R-51854']);
    expect(model.table.rows[1]).toEqual(['W użyciu', '19.11 02:00', '', '12 h 35 min']);
  });
});

describe('kolory wykresów', () => {
  it('są kopią sekcji chart w docs/projekt/tokens.json', () => {
    const tokens = JSON.parse(readFileSync(new URL('../../../../docs/projekt/tokens.json', import.meta.url), 'utf8'));
    const chart = { ...tokens.color.chart };
    delete chart.$opis;
    expect(chart).toEqual(CHART_COLORS);
  });
});
