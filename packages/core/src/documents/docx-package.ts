import { DomainError } from '../errors.js';

/**
 * Rozpoznanie szablonu DOCX po zawartości (ADR 0067), czysty TypeScript na `Uint8Array`: limit rozmiaru pliku,
 * sygnatura ZIP i katalog centralny archiwum przed rozpakowaniem (ochrona przed bombą ZIP), bez ZIP64,
 * szyfrowania i makr. Zadeklarowane rozmiary mogą kłamać, więc API rozpakowuje każdą część z limitem
 * `maxOutputLength` równym rozmiarowi z katalogu (`zlib.inflateRawSync`), zanim przekaże archiwum do `pizzip`.
 */
export const TEMPLATE_MAX_BYTES = 5 * 1024 * 1024;
export const TEMPLATE_MAX_ENTRIES = 1000;
export const TEMPLATE_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const TEMPLATE_MAX_RATIO = 200;
/**
 * Stosunek rozpakowania sprawdzamy dla części od 64 KiB: małe, powtarzalne pliki XML (np. puste style) mają
 * naturalnie wysoki stosunek, a suma 50 MB i limit przy rozpakowaniu i tak je ograniczają.
 */
export const TEMPLATE_RATIO_MIN_BYTES = 64 * 1024;

export const DOCX_MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

export interface DocxEntry {
  name: string;
  /** 0: bez kompresji, 8: deflate. */
  method: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
  /** Początek skompresowanych danych (po nagłówku lokalnym). */
  dataOffset: number;
}

export interface DocxPackage {
  entries: DocxEntry[];
  sizeBytes: number;
  uncompressedBytes: number;
}

const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + b[i + 3]! * 0x1000000;

const hasControlCharacters = (value: string): boolean => [...value].some((ch) => ch.charCodeAt(0) < 0x20);

const notDocx = (reason: string) => new DomainError('TEMPLATE_NOT_DOCX', { reason });
const tooLarge = (reason: string, details: Record<string, unknown> = {}) =>
  new DomainError('TEMPLATE_TOO_LARGE_UNPACKED', { reason, ...details });

/** UTF-8 bez `TextDecoder` (core nie ma typów DOM); nazwy części DOCX są w praktyce w ASCII. */
function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    let code: number;
    let extra: number;
    if (b < 0x80) [code, extra] = [b, 0];
    else if (b >= 0xc2 && b < 0xe0) [code, extra] = [b & 0x1f, 1];
    else if (b >= 0xe0 && b < 0xf0) [code, extra] = [b & 0x0f, 2];
    else if (b >= 0xf0 && b < 0xf5) [code, extra] = [b & 0x07, 3];
    else throw notDocx('name_encoding');
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) throw notDocx('name_encoding');
      code = (code << 6) | (next & 0x3f);
    }
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

/** Koniec katalogu centralnego: sygnatura `PK\x05\x06` w ostatnich 22 + 65535 bajtach (komentarz archiwum). */
function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

/**
 * Struktura archiwum z katalogu centralnego: najwyżej 1000 części, suma po rozpakowaniu do 50 MB i stosunek
 * rozpakowania do 200:1 (`TEMPLATE_TOO_LARGE_UNPACKED`); bez ZIP64, szyfrowania, archiwum wieloczęściowego, ścieżek
 * spoza archiwum i powtórzonych nazw (`TEMPLATE_NOT_DOCX`); wymagane `[Content_Types].xml` i `word/document.xml`;
 * `vbaProject.bin` daje `TEMPLATE_MACROS`. Typ części głównej sprawdza `checkDocxContentTypes` po rozpakowaniu.
 */
export function inspectDocxPackage(bytes: Uint8Array): DocxPackage {
  if (bytes.length > TEMPLATE_MAX_BYTES) throw new DomainError('TEMPLATE_TOO_LARGE', { maxBytes: TEMPLATE_MAX_BYTES });
  // Zaszyfrowany DOCX to plik OLE (D0 CF 11 E0), więc też tu odpada.
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw notDocx('signature');
  }
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw notDocx('central_directory');
  if (eocd >= 20 && u32(bytes, eocd - 20) === 0x07064b50) throw notDocx('zip64');
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) throw notDocx('multi_disk');
  const count = u16(bytes, eocd + 10);
  const directorySize = u32(bytes, eocd + 12);
  const directoryOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw notDocx('zip64');
  if (count !== u16(bytes, eocd + 8)) throw notDocx('multi_disk');
  if (count > TEMPLATE_MAX_ENTRIES) throw tooLarge('entries', { maxEntries: TEMPLATE_MAX_ENTRIES, entries: count });
  if (directoryOffset + directorySize > eocd) throw notDocx('central_directory');

  const entries: DocxEntry[] = [];
  const names = new Set<string>();
  let uncompressedBytes = 0;
  let p = directoryOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || u32(bytes, p) !== 0x02014b50) throw notDocx('central_directory');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const uncompressedSize = u32(bytes, p + 24);
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    const disk = u16(bytes, p + 34);
    const localOffset = u32(bytes, p + 42);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > eocd) throw notDocx('central_directory');
    const name = decodeUtf8(bytes.subarray(p + 46, p + 46 + nameLength));
    if (flags & 0x1) throw notDocx('encrypted');
    if (method !== 0 && method !== 8) throw notDocx('compression');
    if (disk !== 0) throw notDocx('multi_disk');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw notDocx('zip64');
    }
    for (let e = p + 46 + nameLength; e + 4 <= p + 46 + nameLength + extraLength;) {
      if (u16(bytes, e) === 0x0001) throw notDocx('zip64');
      e += 4 + u16(bytes, e + 2);
    }
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').includes('..') ||
      hasControlCharacters(name)
    ) {
      throw notDocx('path');
    }
    if (names.has(name.toLowerCase())) throw notDocx('duplicate_entry');
    names.add(name.toLowerCase());
    if (method === 0 && compressedSize !== uncompressedSize) throw notDocx('central_directory');
    if (
      uncompressedSize >= TEMPLATE_RATIO_MIN_BYTES &&
      uncompressedSize > TEMPLATE_MAX_RATIO * Math.max(compressedSize, 1)
    ) {
      throw tooLarge('ratio', { entry: name, maxRatio: TEMPLATE_MAX_RATIO });
    }
    uncompressedBytes += uncompressedSize;
    if (uncompressedBytes > TEMPLATE_MAX_UNCOMPRESSED_BYTES) {
      throw tooLarge('size', { maxUncompressedBytes: TEMPLATE_MAX_UNCOMPRESSED_BYTES });
    }
    if (localOffset + 30 > directoryOffset || u32(bytes, localOffset) !== 0x04034b50) throw notDocx('local_header');
    const dataOffset = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
    if (dataOffset + compressedSize > directoryOffset) throw notDocx('local_header');
    if (!name.endsWith('/')) {
      entries.push({ name, method: method as 0 | 8, compressedSize, uncompressedSize, dataOffset });
    }
    p = next;
  }
  if (entries.some((entry) => /(^|\/)vbaProject\.bin$/i.test(entry.name))) throw new DomainError('TEMPLATE_MACROS');
  for (const required of ['[Content_Types].xml', 'word/document.xml']) {
    if (!entries.some((entry) => entry.name === required)) throw notDocx('missing_part');
  }
  return { entries, sizeBytes: bytes.length, uncompressedBytes };
}

const attribute = (element: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
    .exec(element)
    ?.slice(1)
    .find((v) => v !== undefined) ?? null;

/**
 * Typ części głównej z rozpakowanego `[Content_Types].xml`: `…wordprocessingml.document.main+xml` dla
 * `/word/document.xml`. Dokument z makrami (`.docm`, `macroEnabled`, `vbaProject`) daje `TEMPLATE_MACROS`, a szablon
 * Worda (`.dotx`) i inny typ `TEMPLATE_NOT_DOCX`.
 */
export function checkDocxContentTypes(contentTypesXml: string): void {
  if (/macroEnabled|vbaProject/i.test(contentTypesXml)) throw new DomainError('TEMPLATE_MACROS');
  const overrides = contentTypesXml.match(/<Override\b[^>]*>/g) ?? [];
  const main = overrides.find((element) => attribute(element, 'PartName')?.toLowerCase() === '/word/document.xml');
  const type = main ? attribute(main, 'ContentType') : null;
  if (type === DOCX_MAIN_CONTENT_TYPE) return;
  throw notDocx(type?.includes('template.main+xml') ? 'dotx' : 'content_type');
}

/** Części z tekstem, w których mogą być znaczniki (treść, nagłówki, stopki, przypisy). */
export const isTemplatedPart = (name: string): boolean =>
  /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name);

/** Część dokumentu do opisu miejsca błędu: „treść”, „nagłówek 2”, „stopka 1”. */
export function templatePart(file: string): {
  part: 'document' | 'header' | 'footer' | 'footnotes' | 'endnotes' | 'other';
  partNumber: number | null;
} {
  const match = /^word\/(document|header|footer|footnotes|endnotes)(\d*)\.xml$/.exec(file);
  if (!match) return { part: 'other', partNumber: null };
  const part = match[1] as 'document' | 'header' | 'footer' | 'footnotes' | 'endnotes';
  return { part, partNumber: match[2] ? Number(match[2]) : null };
}
