import { inflateSync } from 'node:zlib';
import {
  documentFormatters,
  documentSampleData,
  DOCUMENT_TEXTS_PL,
  REPORT_CATALOG,
  resolveReportParams,
  scooterLabelData,
  type ReportModel,
} from '@hulajnogi/core';
import { formatPln } from '@hulajnogi/shared';
import { describe, expect, it } from 'vitest';
import { GotenbergRenderer } from '../src/documents/renderers.js';
import { scooterLabelHtml } from '../src/documents/scooter-label.js';
import { pdfPageCount } from '../src/reports/pdf-pages.js';
import { reportFooterHtml, reportHtml } from '../src/reports/report-html.js';
import { STARTER_TEMPLATES, starterTemplate } from './document-helpers.js';

/**
 * Test integracyjny z prawdziwym Gotenbergiem (ADR 0066): uruchamia się tylko, gdy `GOTENBERG_URL` (domyślnie
 * http://localhost:3010 z `pnpm infra:up`) odpowiada na `/health`. Szablon startowy z polskimi znakami zamienia się
 * na PDF z osadzoną czcionką Inter; naklejka z kodem QR przechodzi przez Chromium.
 */
const url = process.env.GOTENBERG_URL || 'http://localhost:3010';
const available = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok)
  .catch(() => false);

/** Nazwy czcionek z PDF: słowniki obiektów i rozpakowane strumienie obiektów (`/ObjStm`). */
function fontNames(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString('latin1');
  const chunks = [text];
  for (const match of text.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      chunks.push(inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1'));
    } catch {
      // Strumień bez kompresji albo obraz.
    }
  }
  return [
    ...new Set(
      chunks.flatMap((c) => [...c.matchAll(/\/(?:BaseFont|FontName)\s*\/([A-Za-z0-9+_-]+)/g)].map((m) => m[1]!)),
    ),
  ];
}

/** Liczba stron PDF: obiekty `/Type /Page` (bez `/Pages`) w słownikach i w rozpakowanych strumieniach obiektów. */
function pageCount(pdf: Uint8Array): number {
  const text = Buffer.from(pdf).toString('latin1');
  const chunks = [text];
  for (const match of text.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      chunks.push(inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1'));
    } catch {
      // Strumień bez kompresji albo obraz.
    }
  }
  return chunks.reduce((sum, chunk) => sum + [...chunk.matchAll(/\/Type\s*\/Page(?![a-zA-Z])/g)].length, 0);
}

/**
 * Tekst stron PDF z Chromium (Skia: obiekty bez strumieni obiektów, czcionki Type0 z `ToUnicode`): czcionka z `Tf`
 * i kody glifów z `Tj` i `TJ` przez mapę `ToUnicode` tej czcionki. Wystarcza do sprawdzenia stopki.
 */
function pdfPagesText(pdf: Uint8Array): string[] {
  const text = Buffer.from(pdf).toString('latin1');
  const objects = new Map<number, { dict: string; stream: string | null }>();
  for (const m of text.matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g)) {
    const body = m[2]!;
    const at = body.indexOf('stream');
    const dict = at >= 0 ? body.slice(0, at) : body;
    let stream: string | null = null;
    if (at >= 0) {
      const start = body[at + 6] === '\r' ? at + 8 : at + 7;
      const raw = Buffer.from(body.slice(start, body.lastIndexOf('endstream')), 'latin1');
      try {
        stream = /FlateDecode/.test(dict) ? inflateSync(raw).toString('latin1') : raw.toString('latin1');
      } catch {
        stream = null;
      }
    }
    objects.set(Number(m[1]), { dict, stream });
  }
  const utf16 = (hex: string) =>
    Array.from({ length: hex.length / 4 }, (_, i) =>
      String.fromCharCode(parseInt(hex.slice(i * 4, i * 4 + 4), 16)),
    ).join('');
  const cmapOf = (ref: number) => {
    const map = new Map<number, string>();
    const src = objects.get(ref)?.stream ?? '';
    for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const e of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))
        map.set(parseInt(e[1]!, 16), utf16(e[2]!));
    for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
      for (const e of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const [lo, hi, dst] = [parseInt(e[1]!, 16), parseInt(e[2]!, 16), parseInt(e[3]!, 16)];
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(dst + c - lo));
      }
    return map;
  };
  const pages = [...objects.values()].filter((o) => /\/Type\s*\/Page(?![a-zA-Z])/.test(o.dict));
  return pages.map((page) => {
    const fonts = new Map<string, Map<number, string>>();
    for (const f of (/\/Font\s*<<([\s\S]*?)>>/.exec(page.dict)?.[1] ?? '').matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
      const toUnicode = /\/ToUnicode\s+(\d+) 0 R/.exec(objects.get(Number(f[2]))?.dict ?? '')?.[1];
      fonts.set(f[1]!, toUnicode ? cmapOf(Number(toUnicode)) : new Map());
    }
    const refs = /\/Contents\s+(\[[^\]]*\]|\d+ 0 R)/.exec(page.dict)?.[1] ?? '';
    let out = '';
    for (const ref of refs.matchAll(/(\d+) 0 R/g)) {
      let cmap = new Map<number, string>();
      const content = objects.get(Number(ref[1]))?.stream ?? '';
      for (const t of content.matchAll(/\/(\w+)\s+[\d.]+\s+Tf|(\[[^\]]*\])\s*TJ|<([0-9A-Fa-f]*)>\s*Tj|\bET\b/g)) {
        if (t[1]) cmap = fonts.get(t[1]) ?? new Map();
        else if (t[0] === 'ET') out += ' ';
        else
          for (const h of (t[2] ?? `<${t[3]}>`).matchAll(/<([0-9A-Fa-f]*)>/g))
            for (let i = 0; i < h[1]!.length; i += 4) out += cmap.get(parseInt(h[1]!.slice(i, i + 4), 16)) ?? '';
      }
    }
    return out.replace(/\s+/g, ' ');
  });
}

describe.skipIf(!available)('Gotenberg 9.5.1 z czcionką Inter (ADR 0066)', () => {
  const renderer = new GotenbergRenderer(url, 30_000);

  it('szablon startowy paragonu z polskimi znakami: PDF z osadzoną czcionką Inter', async () => {
    const data = documentSampleData('RECEIPT', {
      documentId: '7f3a2c91-0000-4000-8000-000000000000',
      template: { name: 'Potwierdzenie sprzedaży', versionNo: 1 },
      format: documentFormatters(formatPln),
      texts: DOCUMENT_TEXTS_PL,
    });
    const docx = renderer.fillDocx(starterTemplate('paragon.docx'), data);
    const pdf = await renderer.docxToPdf(docx, { trace: 'test-integration', fileName: 'PAR-2026-000126' });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(fontNames(pdf).some((name) => /Inter/.test(name))).toBe(true);
  });

  it.each(STARTER_TEMPLATES)(
    'szablon startowy $file z danymi przykładowymi mieści się na jednej stronie',
    async ({ file, documentType, name }) => {
      const data = documentSampleData(documentType, {
        documentId: '7f3a2c91-0000-4000-8000-000000000000',
        template: { name, versionNo: 1 },
        format: documentFormatters(formatPln),
        texts: DOCUMENT_TEXTS_PL,
      });
      const pdf = await renderer.docxToPdf(renderer.fillDocx(starterTemplate(file), data), {
        trace: `test-pages-${documentType}`,
        fileName: file.replace('.docx', ''),
      });
      expect(pageCount(pdf)).toBe(1);
    },
  );

  it('naklejka z kodem QR: HTML przez Chromium z rozmiarem strony z CSS', async () => {
    const html = await scooterLabelHtml(
      scooterLabelData({
        number: 7,
        siteUrl: 'https://example.test',
        layout: 'single',
        text: { title: 'hulajnoga', body: 'Zeskanuj w aplikacji albo aparatem' },
      }),
    );
    const pdf = await renderer.htmlToPdf(html, { trace: 'test-label', fileName: '0007-naklejka' });
    const text = Buffer.from(pdf).toString('latin1');
    // 60 × 80 mm to około 170 × 227 pt.
    const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(text)!;
    expect(Number(box[1])).toBeCloseTo(170.08, 0);
    expect(Number(box[2])).toBeCloseTo(226.77, 0);
    expect(fontNames(pdf).some((name) => /Inter/.test(name))).toBe(true);
    expect(await renderer.health()).toBe('up');
  });

  it('raport PDF (ADR 0071): A4 poziomo, tabela na kilku stronach, stopka „Strona X z Y” z footer.html', async () => {
    const spec = REPORT_CATALOG.fleet_usage;
    const table = spec.tables[0]!;
    const rows = Array.from({ length: 120 }, (_, i) => ({
      cells: Object.fromEntries(
        table.columns.map((c) => [
          c.key,
          c.kind === 'text'
            ? c.key === 'scooter'
              ? `#${String(i + 1).padStart(4, '0')}`
              : 'Model podstawowy'
            : i * 37,
        ]),
      ),
    }));
    const model: ReportModel = {
      code: 'fleet_usage',
      tiles: [{ key: 'rides', label: 'Przejazdy', kind: 'number', value: 6113, previous: 5789, change: 0.056 }],
      charts: [],
      tables: [
        {
          key: table.key,
          title: table.title,
          description: 'Zażółć gęślą jaźń',
          sheetName: table.sheetName,
          columns: [...table.columns],
          rows,
          totalRows: rows.length,
          totals: null,
        },
      ],
      empty: false,
      rowCount: rows.length,
    };
    const params = resolveReportParams(
      'fleet_usage',
      { from: '2026-10-01', to: '2026-10-31' },
      new Date('2026-11-19T12:00:00Z'),
    );
    const ctx = {
      runId: '9b27c3e1-0000-4000-8000-000000000000',
      name: 'Wykorzystanie floty',
      description: 'Czas w przejeździe według hulajnogi',
      params,
      paramLabels: [{ label: 'Okres', value: '1–31 października 2026' }],
      company: { name: '[nazwa]', street: 'ul. Testowa 1', postalCode: '44-200', city: 'Rybnik', taxId: '6420000000' },
      dataAsOf: new Date('2026-11-19T10:02:00Z'),
      generatedAt: new Date('2026-11-19T10:02:05Z'),
      requestedBy: 'Piotr Mazur',
      format: 'PDF' as const,
    };
    const pdf = await renderer.htmlToPdf(reportHtml(model, ctx), {
      trace: 'test-report',
      fileName: 'fleet-usage-2026-10',
      timeoutMs: 60_000,
      assets: [{ name: 'footer.html', bytes: new TextEncoder().encode(reportFooterHtml(ctx)) }],
    });
    const pages = pdfPageCount(pdf)!;
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(pages).toBe(pageCount(pdf));
    const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(Buffer.from(pdf).toString('latin1'))!;
    expect(Number(box[1])).toBeGreaterThan(Number(box[2]));
    const text = pdfPagesText(pdf);
    expect(text).toHaveLength(pages);
    expect(text[0]).toMatch(new RegExp(`Strona 1 z ${pages}`));
    expect(text.at(-1)).toMatch(new RegExp(`Strona ${pages} z ${pages}`));
    expect(text[0]).toContain('Raport 9b27c3e1');
    expect(text[0]).toContain('Zażółć gęślą jaźń');
    // Nagłówek tabeli (`thead`) powtarza się na kolejnych stronach.
    expect(text[1]).toContain(table.columns[0]!.label);
    expect(fontNames(pdf).some((name) => /Inter/.test(name))).toBe(true);
  });
});
