import { DomainError } from '../errors.js';
import { detectImageType, type FileContentType } from '../files/files.js';

/**
 * Biblioteka mediów (ADR 0064): JPEG, PNG i WebP do 5 MB, typ po sygnaturze i wymiary z nagłówka pliku bez
 * bibliotek (ADR 0025: bez `node:*`). Serwer nie skaluje grafik, więc wymiary chronią przeglądarkę i telefon przed
 * ogromną bitmapą, a panel ostrzega powyżej 2560 px.
 */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_DIMENSION = 8000;
export const MEDIA_WARN_DIMENSION = 2560;

export interface ImageInfo {
  contentType: FileContentType;
  /** Wymiary do wyświetlenia (po obrocie z EXIF dla JPEG ze zdjęć telefonu). */
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
const ascii = (b: Uint8Array, i: number, length: number) => String.fromCharCode(...b.subarray(i, i + length));

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  // Po sygnaturze pierwszy fragment to `IHDR`: długość (4), typ (4), szerokość i wysokość (po 4, big-endian).
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 25) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null;
    // Ramka kluczowa VP8: kod startu 9D 01 2A, potem 14 bitów szerokości i wysokości (little-endian).
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Sygnatura 0x2F, potem 14 bitów (szerokość − 1) i 14 bitów (wysokość − 1).
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    // Płótno: 24 bity (szerokość − 1) i 24 bity (wysokość − 1) od bajtu 24.
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  return null;
}

/** Orientacja z EXIF (APP1 `Exif\0\0`, znacznik 0x0112 w IFD0); 1, gdy brak albo dane są uszkodzone. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (end - start < 14 || ascii(bytes, start, 6) !== 'Exif\0\0') return 1;
  const tiff = start + 6;
  const order = ascii(bytes, tiff, 2);
  if (order !== 'II' && order !== 'MM') return 1;
  const little = order === 'II';
  const read16 = (i: number) => (little ? u16le(bytes, i) : u16be(bytes, i));
  const read32 = (i: number) => (little ? read16(i) + read16(i + 2) * 0x10000 : read16(i) * 0x10000 + read16(i + 2));
  const ifd = tiff + read32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = read16(ifd);
  for (let n = 0; n < entries; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > end) return 1;
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** SOF0–SOF15 bez DHT (C4), JPG (C8) i DAC (CC): znaczniki z wymiarami ramki. */
const isStartOfFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  let orientation = 1;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1]!;
    // Bajty wypełnienia 0xFF przed znacznikiem.
    while (marker === 0xff && i + 2 < bytes.length) marker = bytes[++i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(bytes, i + 2);
    if (length < 2) return null;
    const segmentEnd = i + 2 + length;
    if (marker === 0xe1)
      orientation = Math.max(orientation, exifOrientation(bytes, i + 4, Math.min(segmentEnd, bytes.length)));
    if (isStartOfFrame(marker)) {
      if (i + 9 > bytes.length) return null;
      const height = u16be(bytes, i + 5);
      const width = u16be(bytes, i + 7);
      // Orientacje 5–8 obracają obraz o 90°: przeglądarka pokaże go z zamienionymi wymiarami.
      return orientation >= 5 ? { width: height, height: width } : { width, height };
    }
    // Segmenty (także APP1 z miniaturą EXIF) przeskakujemy po długości, więc miniatura nie myli wymiarów.
    i = segmentEnd;
  }
  return null;
}

/**
 * Typ i wymiary z nagłówka całego pliku: PNG z `IHDR`, JPEG ze znacznika `SOFn` po przejściu segmentów, WebP
 * z fragmentu `VP8 `, `VP8L` albo `VP8X`. `null`, gdy typu nie rozpoznano albo nagłówek jest uszkodzony.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const contentType = detectImageType(bytes);
  if (!contentType) return null;
  const size =
    contentType === 'image/png' ? pngSize(bytes) : contentType === 'image/webp' ? webpSize(bytes) : jpegSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return { contentType, ...size };
}

// --- Metadane grafik biblioteki ---------------------------------------------------------------------

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/**
 * Segment APP1 z samym znacznikiem orientacji (TIFF big-endian, jeden wpis IFD0 0x0112): grafika po usunięciu EXIF
 * wyświetla się tak samo, a wymiary z `readImageInfo` się nie zmieniają.
 */
function orientationSegment(orientation: number): Uint8Array {
  const payload = [
    ...[0x45, 0x78, 0x69, 0x66, 0, 0], // „Exif\0\0”
    ...[0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8], // „MM”, 42, IFD0 od bajtu 8
    ...[0, 1], // jeden wpis
    ...[0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0], // Orientation, SHORT, 1 wartość
    ...[0, 0, 0, 0], // brak kolejnego IFD
  ];
  return Uint8Array.from([0xff, 0xe1, 0, payload.length + 2, ...payload]);
}

const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

/**
 * JPEG bez metadanych: usuwa APP1 (EXIF z GPS, numerem aparatu i miniaturą, XMP), APP13 (IPTC), komentarze i pozostałe
 * segmenty APPn poza APP0 (JFIF), APP2 z profilem kolorów ICC i APP14 (Adobe, przestrzeń barw) oraz dane po EOI
 * (np. wideo „zdjęcia ruchomego”). Orientację z EXIF zachowuje w nowym, minimalnym segmencie APP1.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let orientation = 1;
  let i = 2;
  while (i + 2 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    let marker = bytes[i + 1]!;
    while (marker === 0xff && i + 2 < bytes.length) marker = bytes[++i + 1]!;
    if (marker === 0xd9) {
      parts.push(bytes.subarray(i, i + 2));
      i = bytes.length;
      break;
    }
    if (marker === 0x01 || isRestart(marker)) {
      parts.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) break;
    const segmentEnd = Math.min(i + 2 + u16be(bytes, i + 2), bytes.length);
    if (marker === 0xda) {
      // Dane skanu do następnego znacznika (0xFF00 to bajt danych, RSTn należy do skanu).
      let j = segmentEnd;
      while (j + 1 < bytes.length) {
        const next = bytes[j + 1]!;
        if (bytes[j] === 0xff && next !== 0x00 && next !== 0xff && !isRestart(next)) break;
        j += 1;
      }
      if (j + 1 >= bytes.length) j = bytes.length;
      parts.push(bytes.subarray(i, j));
      i = j;
      continue;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep =
      !isApp || marker === 0xe0 || marker === 0xee || (marker === 0xe2 && ascii(bytes, i + 4, 11) === 'ICC_PROFILE');
    if (marker === 0xe1) orientation = Math.max(orientation, exifOrientation(bytes, i + 4, segmentEnd));
    if (keep && marker !== 0xfe) parts.push(bytes.subarray(i, segmentEnd));
    i = segmentEnd;
  }
  // Niepełna struktura po skanie: reszta pliku to dane obrazu, nie metadane.
  if (i < bytes.length) parts.push(bytes.subarray(i));
  const soi = bytes.subarray(0, 2);
  return concat(orientation > 1 ? [soi, orientationSegment(orientation), ...parts] : [soi, ...parts]);
}

/** Fragmenty PNG z metadanymi: EXIF, teksty (także skompresowane i międzynarodowe) i czas modyfikacji. */
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

/** PNG bez metadanych: usuwa fragmenty `eXIf`, `tEXt`, `iTXt`, `zTXt` i `tIME` oraz dane po `IEND`. */
function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const end = i + 12 + u32be(bytes, i);
    if (end > bytes.length) break;
    const type = ascii(bytes, i + 4, 4);
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
  if (i < bytes.length) parts.push(bytes.subarray(i));
  return concat(parts);
}

const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** WebP bez metadanych: usuwa fragmenty `EXIF` i `XMP ` (z flagami w `VP8X`) i dane poza kontenerem RIFF. */
function stripWebp(bytes: Uint8Array): Uint8Array {
  const riffEnd = Math.min(8 + u32le(bytes, 4), bytes.length);
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const size = u32le(bytes, i + 4);
    const end = Math.min(i + 8 + size + (size % 2), riffEnd);
    const type = ascii(bytes, i, 4);
    if (type === 'VP8X' && end - i >= 9) {
      const chunk = bytes.slice(i, end);
      chunk[8] = chunk[8]! & ~0x0c; // flagi EXIF (0x08) i XMP (0x04)
      parts.push(chunk);
    } else if (type !== 'EXIF' && type !== 'XMP ') parts.push(bytes.subarray(i, end));
    i = end;
  }
  const body = concat(parts);
  const head = bytes.slice(0, 12);
  const size = body.length + 4;
  head.set([size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff], 4);
  return concat([head, body]);
}

/**
 * Grafika biblioteki bez metadanych (publiczny adres, ADR 0064): zdjęcie z telefonu nie zdradza położenia (GPS),
 * aparatu ani daty. JPEG zachowuje orientację, więc wymiary z `readImageInfo` są te same; suma SHA-256 i rozmiar
 * liczą się z wyniku. Typ spoza JPEG, PNG i WebP wraca bez zmian.
 */
export function stripImageMetadata(bytes: Uint8Array, contentType: FileContentType): Uint8Array {
  if (contentType === 'image/jpeg') return stripJpeg(bytes);
  if (contentType === 'image/png') return stripPng(bytes);
  if (contentType === 'image/webp') return stripWebp(bytes);
  return bytes;
}

/** Typ rozpoznany, ale niedozwolony: komunikat „SVG może zawierać skrypty” albo „bez GIF” w panelu. */
export function detectRejectedImageType(head: Uint8Array): 'image/svg+xml' | 'image/gif' | null {
  if (head.length >= 4 && ascii(head, 0, 4) === 'GIF8') return 'image/gif';
  let text = '';
  for (let i = 0; i < Math.min(head.length, 512); i++) text += String.fromCharCode(head[i]!);
  // Znacznik kolejności bajtów UTF-8 (EF BB BF) czytany bajt po bajcie.
  if (text.startsWith('\xef\xbb\xbf')) text = text.slice(3);
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)
    ? 'image/svg+xml'
    : null;
}

export type MediaUploadWarning = 'IMAGE_LARGE_DIMENSIONS';

export interface MediaUpload extends ImageInfo {
  warnings: MediaUploadWarning[];
}

/**
 * Wysyłka grafiki do biblioteki (`POST /files` z celem `MEDIA`): limit 5 MB (`FILE_TOO_LARGE`), typ po sygnaturze
 * (`FILE_TYPE_NOT_ALLOWED` z rozpoznanym SVG albo GIF), wymiary z nagłówka (`IMAGE_UNREADABLE`), najwyżej 8000 px
 * w każdym wymiarze (`IMAGE_DIMENSIONS_TOO_LARGE`) i ostrzeżenie powyżej 2560 px.
 */
export function ensureMediaUpload(input: { bytes: Uint8Array; sizeBytes?: number; truncated?: boolean }): MediaUpload {
  const sizeBytes = input.sizeBytes ?? input.bytes.length;
  if (input.truncated || sizeBytes > MEDIA_MAX_BYTES) {
    throw new DomainError('FILE_TOO_LARGE', { maxBytes: MEDIA_MAX_BYTES, sizeBytes });
  }
  if (!detectImageType(input.bytes)) {
    const detected = detectRejectedImageType(input.bytes);
    throw new DomainError('FILE_TYPE_NOT_ALLOWED', {
      allowed: ['image/jpeg', 'image/png', 'image/webp'],
      ...(detected ? { detected } : {}),
    });
  }
  const info = readImageInfo(input.bytes);
  if (!info) throw new DomainError('IMAGE_UNREADABLE');
  if (info.width > MEDIA_MAX_DIMENSION || info.height > MEDIA_MAX_DIMENSION) {
    throw new DomainError('IMAGE_DIMENSIONS_TOO_LARGE', {
      maxDimension: MEDIA_MAX_DIMENSION,
      width: info.width,
      height: info.height,
    });
  }
  return { ...info, warnings: mediaWarnings(info) };
}

/** Ostrzeżenie panelu („możesz dodać mimo to”): strona i aplikacja pobiorą cały plik. */
export const mediaWarnings = (size: { width: number; height: number }): MediaUploadWarning[] =>
  size.width > MEDIA_WARN_DIMENSION || size.height > MEDIA_WARN_DIMENSION ? ['IMAGE_LARGE_DIMENSIONS'] : [];

/** Limit wysyłki według celu pliku: grafiki z biblioteki 5 MB, zdjęcia klientów 10 MB (ADR 0057). */
export const uploadLimit = (purpose: string): number => (purpose === 'MEDIA' ? MEDIA_MAX_BYTES : 10 * 1024 * 1024);

/** Klucz grafiki: małe litery i cyfry z `-` albo `.` (kopia `MEDIA_KEY_PATTERN` z shared). */
export const MEDIA_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
/** Przedrostek kluczy systemowych (rendery wariantów); takie grafiki pochodzą tylko z danych startowych. */
export const SYSTEM_MEDIA_KEY_PREFIX = 'scooter.';

/**
 * Klucz nowej grafiki z panelu (`POST /admin/media`): wzorzec i do 80 znaków (`VALIDATION_FAILED`), bez przedrostka
 * kluczy systemowych (`MEDIA_KEY_RESERVED`) i bez kolizji (`MEDIA_KEY_TAKEN`; panel podpowiada klucz z przyrostkiem).
 */
export function ensureMediaKeyAllowed(key: string, taken: ReadonlySet<string> = new Set()): void {
  if (key.length > 80 || !MEDIA_KEY_PATTERN.test(key)) throw new DomainError('VALIDATION_FAILED', { fields: ['key'] });
  if (key.startsWith(SYSTEM_MEDIA_KEY_PREFIX)) throw new DomainError('MEDIA_KEY_RESERVED', { key });
  if (taken.has(key)) throw new DomainError('MEDIA_KEY_TAKEN', { key });
}

export type MediaUsageKind = 'CONTENT_BLOCK' | 'NEWS' | 'SCOOTER_MODEL';

export interface MediaUsage {
  kind: MediaUsageKind;
  id: string;
  label: string;
  /** Minimalna szerokość grafiki w tym miejscu (sekcja z rejestru); brak: bez wymagania. */
  minWidth?: number | null;
}

/**
 * Usunięcie grafiki (`DELETE /admin/media/{id}`): grafika systemowa (`MEDIA_SYSTEM`) i używana (`MEDIA_IN_USE`
 * z miejscami użycia) zostają. Klucze obce `RESTRICT` i wyzwalacz w bazie pilnują tego samego.
 */
export function ensureMediaDeletable(media: { isSystem: boolean; usages: readonly MediaUsage[] }): void {
  if (media.isSystem) throw new DomainError('MEDIA_SYSTEM');
  if (media.usages.length) {
    throw new DomainError('MEDIA_IN_USE', {
      usages: media.usages.map(({ kind, id, label }) => ({ kind, id, label })),
    });
  }
}

/** Przypięcie grafiki do sekcji z minimalną szerokością (hero: 760 px, ADR 0070): za wąska daje `MEDIA_TOO_NARROW`. */
export function ensureMediaWidth(width: number, requirement: { section: string; minWidth?: number | null }): void {
  if (requirement.minWidth && width < requirement.minWidth) {
    throw new DomainError('MEDIA_TOO_NARROW', { section: requirement.section, minWidth: requirement.minWidth, width });
  }
}

/**
 * „Zastąp plik” (`POST /admin/media/{id}/file`): nowy plik musi spełniać wymagania wszystkich miejsc, w których
 * grafika jest już użyta; pierwsze niespełnione daje `MEDIA_TOO_NARROW` z sekcją.
 */
export function ensureMediaReplaceable(next: { width: number }, usages: readonly MediaUsage[]): void {
  for (const usage of usages) ensureMediaWidth(next.width, { section: usage.label, minWidth: usage.minWidth });
}

const EXTENSIONS: Record<FileContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Publiczny adres grafiki `/media/{id}/{sha256}.{ext}` (D3): zawartość pod adresem się nie zmienia, więc odpowiedź
 * ma `Cache-Control: public, immutable`, a zastąpienie pliku daje nowy adres.
 */
export const mediaPublicPath = (media: { id: string; sha256: string; contentType: FileContentType }): string =>
  `/media/${media.id}/${media.sha256}.${EXTENSIONS[media.contentType]}`;

export type MediaRequestResolution = 'serve' | 'redirect' | 'not_found';

/** `GET /media/{id}/{sha}.{ext}`: bieżąca suma daje plik, starsza przekierowanie `308` na bieżący adres, reszta 404. */
export function resolveMediaRequest(
  media: { sha256: string; contentType: FileContentType } | null,
  request: { sha256: string; ext: string },
): MediaRequestResolution {
  if (!media) return 'not_found';
  if (media.sha256 === request.sha256 && EXTENSIONS[media.contentType] === request.ext) return 'serve';
  return /^[0-9a-f]{64}$/.test(request.sha256) ? 'redirect' : 'not_found';
}
