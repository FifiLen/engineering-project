/**
 * Port silnika dokumentów (ADR 0066). `fillDocx` wypełnia szablon w procesie API (docxtemplater z parserem ścieżek
 * z `readFieldPath`), a `docxToPdf` i `htmlToPdf` wołają Gotenberga (LibreOffice i Chromium) albo atrapę w testach.
 */

/** Dane szablonu: gotowe teksty, wartości logiczne warunków i listy pętli (szablon niczego nie formatuje). */
export type TemplateValue = string | boolean | TemplateData | TemplateData[];
export interface TemplateData {
  [key: string]: TemplateValue;
}

export interface RenderOptions {
  /** Nagłówek `Gotenberg-Trace`: identyfikator wydruku w logach silnika. */
  trace: string;
  fileName: string;
}

export interface DocumentRenderer {
  fillDocx(template: Uint8Array, data: TemplateData): Uint8Array;
  docxToPdf(docx: Uint8Array, opts: RenderOptions): Promise<Uint8Array>;
  htmlToPdf(
    html: string,
    opts: RenderOptions & { assets?: Array<{ name: string; bytes: Uint8Array }> },
  ): Promise<Uint8Array>;
}

/** Kody błędów silnika (ADR 0066); tylko `RENDERER_UNAVAILABLE` ponawia zadanie. */
export const RENDER_ERROR_CODES = [
  'RENDER_TIMEOUT',
  'RENDERER_UNAVAILABLE',
  'RENDER_FAILED',
  'TEMPLATE_RENDER_FAILED',
] as const;
export type RenderErrorCode = (typeof RENDER_ERROR_CODES)[number];

export type RenderFailure =
  { kind: 'timeout' } | { kind: 'network' } | { kind: 'http'; status: number } | { kind: 'template' };

/**
 * Błąd silnika na kod: limit czasu klienta HTTP albo `503` (limit `API_TIMEOUT` z kolejką) to `RENDER_TIMEOUT`,
 * brak połączenia albo `429` (pełna kolejka) to `RENDERER_UNAVAILABLE`, inne `4xx` i `5xx` to `RENDER_FAILED`,
 * a błąd wypełnienia szablonu `TEMPLATE_RENDER_FAILED`.
 */
export function renderErrorCode(failure: RenderFailure): RenderErrorCode {
  switch (failure.kind) {
    case 'timeout':
      return 'RENDER_TIMEOUT';
    case 'network':
      return 'RENDERER_UNAVAILABLE';
    case 'template':
      return 'TEMPLATE_RENDER_FAILED';
    case 'http':
      if (failure.status === 503) return 'RENDER_TIMEOUT';
      if (failure.status === 429) return 'RENDERER_UNAVAILABLE';
      return 'RENDER_FAILED';
  }
}

/** Zadanie `document.generate` ponawia (do 2 razy z rosnącym odstępem) tylko niedostępny silnik. */
export const isRetryableRenderError = (code: string): boolean => code === 'RENDERER_UNAVAILABLE';
