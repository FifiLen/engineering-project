import { inflateSync } from 'node:zlib';

/**
 * Liczba stron PDF do `report_runs.page_count`: największe `/Count` drzewa stron albo liczba obiektów `/Type /Page`,
 * także w skompresowanych strumieniach obiektów (`/ObjStm`), które Chromium stosuje w plikach z Gotenberga.
 * `null`, gdy pliku nie da się odczytać (raport i tak powstaje).
 */
export function pdfPageCount(pdf: Uint8Array): number | null {
  const text = Buffer.from(pdf).toString('latin1');
  if (!text.startsWith('%PDF-')) return null;
  const chunks = [text];
  for (const match of text.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      chunks.push(inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1'));
    } catch {
      // Strumień bez kompresji, obraz albo czcionka.
    }
  }
  let pages = 0;
  let count = 0;
  for (const chunk of chunks) {
    pages += [...chunk.matchAll(/\/Type\s*\/Page(?![a-zA-Z])/g)].length;
    for (const m of chunk.matchAll(
      /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g,
    )) {
      count = Math.max(count, Number(m[1] ?? m[2]));
    }
  }
  return count || pages || null;
}
