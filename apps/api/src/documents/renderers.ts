import {
  DomainError,
  renderErrorCode,
  type DocumentRenderer,
  type RenderFailure,
  type RenderOptions,
  type TemplateData,
} from '@hulajnogi/core';
import { Logger } from '@nestjs/common';
import { fillDocx } from './docx-engine.js';

/** Port silnika dokumentów z core (ADR 0066) i stan silnika dla `GET /health`. */
export interface DocumentEngine extends DocumentRenderer {
  readonly name: 'gotenberg' | 'fake';
  health(): Promise<'up' | 'down'>;
}

export const DOCUMENT_RENDERER = Symbol('DOCUMENT_RENDERER');

/** Błąd silnika z kodem z core (`RENDER_TIMEOUT`, `RENDERER_UNAVAILABLE`, `RENDER_FAILED`). */
export const renderError = (failure: RenderFailure, detail?: string) =>
  new DomainError(renderErrorCode(failure), detail ? { detail: detail.slice(0, 300) } : undefined);

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Gotenberg 9.5.1 (ADR 0066): `POST /forms/libreoffice/convert` dla DOCX i `POST /forms/chromium/convert/html`
 * dla HTML naklejki i raportu (stopka raportu jako plik `footer.html` w `assets`, ADR 0071), `multipart/form-data`
 * przez `fetch` z limitem czasu klienta (domyślny albo `timeoutMs` konwersji) i nagłówkiem `Gotenberg-Trace` równym
 * identyfikatorowi wydruku. Silnik nie ma dostępu do sieci, więc HTML dostaje pliki obok siebie.
 */
export class GotenbergRenderer implements DocumentEngine {
  readonly name = 'gotenberg' as const;
  private readonly logger = new Logger(GotenbergRenderer.name);

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  fillDocx(template: Uint8Array, data: TemplateData): Uint8Array {
    return fillDocx(template, data);
  }

  docxToPdf(docx: Uint8Array, opts: RenderOptions): Promise<Uint8Array> {
    const form = new FormData();
    form.append('files', new Blob([docx], { type: DOCX_TYPE }), `${opts.fileName}.docx`);
    return this.convert('/forms/libreoffice/convert', form, opts);
  }

  htmlToPdf(
    html: string,
    opts: RenderOptions & { assets?: Array<{ name: string; bytes: Uint8Array }> },
  ): Promise<Uint8Array> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    for (const asset of opts.assets ?? []) form.append('files', new Blob([asset.bytes]), asset.name);
    form.append('preferCssPageSize', 'true');
    form.append('printBackground', 'true');
    return this.convert('/forms/chromium/convert/html', form, opts);
  }

  async health(): Promise<'up' | 'down'> {
    try {
      const response = await fetch(new URL('/health', this.baseUrl), { signal: AbortSignal.timeout(3000) });
      return response.ok ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async convert(path: string, form: FormData, opts: RenderOptions): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        body: form,
        headers: { 'Gotenberg-Trace': opts.trace, 'Gotenberg-Output-Filename': opts.fileName },
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'TimeoutError' || name === 'AbortError') throw renderError({ kind: 'timeout' });
      this.logger.warn(`Gotenberg niedostępny (${opts.trace}): ${(error as Error).message}`);
      throw renderError({ kind: 'network' }, (error as Error).message);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.warn(`Gotenberg ${response.status} (${opts.trace}): ${detail.slice(0, 200)}`);
      throw renderError({ kind: 'http', status: response.status }, detail);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

/**
 * Najmniejszy poprawny PDF z jedną stroną i tekstem (identyfikator wydruku), z tabelą odsyłaczy liczoną na bieżąco.
 * Atrapa nie potrzebuje silnika, a test może sprawdzić, który wydruk dostał który plik.
 */
export function minimalPdf(text: string): Uint8Array {
  const safe = text.replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
  const stream = `BT /F1 12 Tf 40 780 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}

/**
 * Atrapa silnika do testów API (`DOCUMENT_RENDERER=fake`, ADR 0066): DOCX naprawdę z docxtemplater, a PDF to stały,
 * poprawny plik z identyfikatorem wydruku w treści. `failNext` symuluje błąd silnika w kolejnej konwersji.
 */
export class FakeRenderer implements DocumentEngine {
  readonly name = 'fake' as const;
  readonly calls: Array<{
    kind: 'docx' | 'html';
    trace: string;
    fileName: string;
    html?: string;
    assets?: string[];
    timeoutMs?: number;
  }> = [];
  private failures: RenderFailure[] = [];

  fillDocx(template: Uint8Array, data: TemplateData): Uint8Array {
    return fillDocx(template, data);
  }

  failNext(failure: RenderFailure, times = 1): void {
    for (let i = 0; i < times; i++) this.failures.push(failure);
  }

  docxToPdf(_docx: Uint8Array, opts: RenderOptions): Promise<Uint8Array> {
    this.calls.push({ kind: 'docx', trace: opts.trace, fileName: opts.fileName });
    return this.result(opts.trace);
  }

  htmlToPdf(
    html: string,
    opts: RenderOptions & { assets?: Array<{ name: string; bytes: Uint8Array }> },
  ): Promise<Uint8Array> {
    this.calls.push({
      kind: 'html',
      trace: opts.trace,
      fileName: opts.fileName,
      html,
      ...(opts.assets ? { assets: opts.assets.map((a) => a.name) } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return this.result(opts.trace);
  }

  health(): Promise<'up' | 'down'> {
    return Promise.resolve('up');
  }

  private result(trace: string): Promise<Uint8Array> {
    const failure = this.failures.shift();
    if (failure) return Promise.reject(renderError(failure));
    return Promise.resolve(minimalPdf(`hulajnogi fake pdf ${trace}`));
  }
}
