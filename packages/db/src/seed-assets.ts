import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pliki danych startowych iteracji 7: rendery hulajnogi jako grafiki biblioteki (ADR 0064) i szablony startowe
 * wydruków DOCX (ADR 0067, D4). Seed zapisuje je w magazynie plików przez port `SeedFileStorage`, więc wczytanie
 * z dysku jest tutaj, a nie w `seed.ts` (testy podają bajty bez magazynu S3).
 */

/** Katalog szablonów startowych DOCX z `manifest.json` (odtwarza je `seed/templates/build.mjs`). */
export const starterTemplatesDir = join(import.meta.dirname, '..', 'seed', 'templates');

/** Katalog renderów hulajnogi w dokumentacji projektu (źródło grafik systemowych). */
export const renderImagesDir = join(import.meta.dirname, '..', '..', '..', 'docs', 'projekt', 'rendery');

/** Magazyn plików dla danych startowych: ten sam kształt co `FileStorage.put` w API (ADR 0057). */
export interface SeedFileStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

export interface SeedMediaFile {
  /** Klucz grafiki: systemowy `scooter.*` (rejestr `SYSTEM_MEDIA_KEYS` w packages/shared) albo z nazwy pliku. */
  key: string;
  /** Nazwa wyświetlana w bibliotece (nazwa pliku). */
  name: string;
  altText: string;
  caption: string | null;
  contentType: 'image/png';
  width: number;
  height: number;
  bytes: Buffer;
  sha256: string;
}

export interface SeedTemplateFile {
  file: string;
  /** Rodzaj dokumentu; `null` dla systemowej listy pól (`lista-pol.docx`), która nie jest szablonem rodzaju. */
  documentType: string | null;
  name: string;
  description: string;
  /** Użyte ścieżki jak `usedFields` inspekcji API i `document_template_versions.fields` (`items[].lineNo`). */
  fields: string[];
  sizeBytes: number;
  uncompressedBytes: number;
  bytes: Buffer;
  sha256: string;
}

/** Wymiary z nagłówka PNG (IHDR w bajtach 16–23); rendery są PNG. */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((b, i) => bytes[i] === b)) {
    throw new Error('Plik nie jest obrazem PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Rendery wariantów z `docs/projekt/rendery`: cztery grafiki systemowe (aplikacja pokazuje je dla wariantów,
 * ADR 0064, pytanie 12) i widok z przodu jako zwykła grafika biblioteki. Tekst alternatywny jak na makiecie
 * `tresci-media`.
 */
export const DEV_MEDIA = [
  {
    key: 'scooter.grafit.trzy',
    file: 'hulajnoga-grafit-trzy.png',
    altText: 'Hulajnoga [nazwa] w kolorze grafitowym, widok z trzech czwartych',
  },
  {
    key: 'scooter.beton.trzy',
    file: 'hulajnoga-beton-trzy.png',
    altText: 'Hulajnoga [nazwa] w kolorze betonowym, widok z trzech czwartych',
  },
  {
    key: 'scooter.kobalt.trzy',
    file: 'hulajnoga-kobalt-trzy.png',
    altText: 'Hulajnoga [nazwa] w kolorze kobaltowym, widok z trzech czwartych',
  },
  {
    key: 'scooter.grafit.bok',
    file: 'hulajnoga-grafit-bok.png',
    altText: 'Hulajnoga [nazwa] w kolorze grafitowym, widok z boku',
  },
  {
    key: 'hulajnoga-grafit-przod',
    file: 'hulajnoga-grafit-przod.png',
    altText: 'Hulajnoga [nazwa] w kolorze grafitowym, widok z przodu',
  },
] as const;

export function loadSeedMedia(dir = renderImagesDir): SeedMediaFile[] {
  return DEV_MEDIA.map((media) => {
    const bytes = readFileSync(join(dir, media.file));
    return {
      key: media.key,
      name: media.file,
      altText: media.altText,
      caption: null,
      contentType: 'image/png' as const,
      ...pngSize(bytes),
      bytes,
      sha256: sha256(bytes),
    };
  });
}

interface ManifestEntry {
  file: string;
  documentType: string | null;
  name: string;
  description: string;
  fields: string[];
  sizeBytes: number;
  uncompressedBytes: number;
}

/** Szablony startowe z `manifest.json`; rozmiar pliku musi się zgadzać z manifestem (plik odtworzony skryptem). */
export function loadStarterTemplates(dir = starterTemplatesDir): SeedTemplateFile[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ManifestEntry[];
  return manifest.map((entry) => {
    const bytes = readFileSync(join(dir, entry.file));
    if (bytes.length !== entry.sizeBytes) {
      throw new Error(`Szablon ${entry.file} nie zgadza się z manifest.json. Uruchom: node seed/templates/build.mjs`);
    }
    return { ...entry, bytes, sha256: sha256(bytes) };
  });
}
