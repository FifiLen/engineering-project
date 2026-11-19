import { inflateSync } from 'node:zlib';
import { documentFormatters, documentSampleData, DOCUMENT_TEXTS_PL, scooterLabelData } from '@hulajnogi/core';
import { formatPln } from '@hulajnogi/shared';
import { describe, expect, it } from 'vitest';
import { GotenbergRenderer } from '../src/documents/renderers.js';
import { scooterLabelHtml } from '../src/documents/scooter-label.js';
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
});
