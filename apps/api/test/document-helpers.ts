import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { starterTemplatesDir } from '@hulajnogi/db';
import PizZip from 'pizzip';

/** Szablony startowe z repozytorium (D4) z rodzajem dokumentu z `manifest.json`. */
export const STARTER_TEMPLATES = [
  { file: 'paragon.docx', documentType: 'RECEIPT', name: 'Potwierdzenie sprzedaży' },
  { file: 'potwierdzenie-przejazdu.docx', documentType: 'RENTAL_CONFIRMATION', name: 'Potwierdzenie przejazdu' },
  { file: 'protokol-serwisowy.docx', documentType: 'SERVICE_PROTOCOL', name: 'Protokół serwisowy' },
  { file: 'karta-hulajnogi.docx', documentType: 'SCOOTER_CARD', name: 'Karta hulajnogi' },
] as const;

export const starterTemplate = (file: string): Buffer => readFileSync(join(starterTemplatesDir, file));

/** Kopia szablonu ze zmienioną częścią (np. inny znacznik w `word/document.xml`). */
export function modifyDocx(
  source: Buffer,
  change: (zip: PizZip) => void,
  options: { compression?: 'DEFLATE' | 'STORE' } = {},
): Buffer {
  const zip = new PizZip(source);
  change(zip);
  return Buffer.from(zip.generate({ type: 'uint8array', compression: options.compression ?? 'DEFLATE' }));
}

/** Zamiana tekstu w treści dokumentu (znaczniki szablonów startowych stoją w jednym `w:t`). */
export function replaceInDocument(source: Buffer, from: string, to: string): Buffer {
  return modifyDocx(source, (zip) => {
    const xml = zip.file('word/document.xml')!.asText();
    if (!xml.includes(from)) throw new Error(`Brak „${from}” w treści szablonu`);
    zip.file('word/document.xml', xml.replace(from, to));
  });
}

/**
 * Archiwum z kłamliwym rozmiarem po rozpakowaniu w katalogu centralnym i nagłówku lokalnym części (bomba ZIP, która
 * przechodzi sprawdzenie katalogu): rozpakowanie z `maxOutputLength` musi je przerwać.
 */
export function lieAboutSize(source: Buffer, entry: string, declared: number): Buffer {
  const bytes = Buffer.from(source);
  for (let i = 0; i + 46 < bytes.length; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    const name = bytes.subarray(i + 46, i + 46 + nameLength).toString('utf8');
    if (name !== entry) continue;
    bytes.writeUInt32LE(declared, i + 24);
    const local = bytes.readUInt32LE(i + 42);
    bytes.writeUInt32LE(declared, local + 22);
    return bytes;
  }
  throw new Error(`Brak części ${entry}`);
}

/** Tekst wypełnionego DOCX (połączone `w:t` treści) do sprawdzenia danych w wydruku. */
export function docxText(bytes: Uint8Array, part = 'word/document.xml'): string {
  const xml = new PizZip(Buffer.from(bytes)).file(part)!.asText();
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
}
