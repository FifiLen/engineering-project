import { SCOOTER_LABEL_LAYOUTS, type ScooterLabelData } from '@hulajnogi/core';
import QRCode from 'qrcode';

/**
 * Naklejka z kodem QR (ADR 0068, D5): wbudowany HTML w API, poza szablonami DOCX, zamieniany na PDF przez Chromium
 * w Gotenbergu (`preferCssPageSize`). Kod SVG z biblioteki `qrcode` dla `${PUBLIC_SITE_URL}/h/{numer}` (ADR 0041),
 * czcionka Inter z kontenera, bez obrazów zewnętrznych i skryptów. Tekst naklejki pochodzi z sekcji
 * `admin.scooter-label`, więc nie jest wpisany w kod.
 */
const escape = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export async function scooterLabelHtml(label: ScooterLabelData): Promise<string> {
  const layout = SCOOTER_LABEL_LAYOUTS[label.layout];
  const qr = await QRCode.toString(label.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
  const sticker = `
    <section class="label">
      <div class="title">${escape(label.title)}</div>
      <div class="qr">${qr}</div>
      <div class="number">#${escape(label.number)}</div>
      <div class="body">${escape(label.body)}</div>
    </section>`;
  const grid = layout.perPage > 1;
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<title>${escape(label.number)}</title>
<style>
  @page { size: ${layout.pageWidthMm}mm ${layout.pageHeightMm}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${layout.pageWidthMm}mm; height: ${layout.pageHeightMm}mm; }
  body { font-family: Inter, sans-serif; color: #16181D; background: #FFFFFF; }
  .sheet { width: 100%; height: 100%; display: grid;
           grid-template-columns: repeat(${layout.columns}, 1fr); grid-template-rows: repeat(${layout.rows}, 1fr);
           place-items: center; }
  .label { width: 60mm; height: 80mm; padding: 5mm; display: flex; flex-direction: column; align-items: center;
           justify-content: space-between; background: #F6F6F3; border-radius: ${grid ? '3mm' : '0'};
           ${grid ? 'border: 0.2mm dashed #E3E3DE;' : ''} }
  .title { font-size: 9pt; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: #6B6E75; }
  .qr { width: 42mm; height: 42mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .number { font-size: 22pt; font-weight: 500; letter-spacing: 0.02em; }
  .body { font-size: 8pt; text-align: center; color: #6B6E75; }
</style>
</head>
<body><main class="sheet">${Array.from({ length: label.copies }, () => sticker).join('')}</main></body>
</html>`;
}
