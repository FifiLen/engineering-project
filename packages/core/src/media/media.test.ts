import { describe, expect, it } from 'vitest';
import { uploadPermission } from '../files/files.js';
import {
  detectRejectedImageType,
  ensureMediaDeletable,
  ensureMediaKeyAllowed,
  ensureMediaReplaceable,
  ensureMediaUpload,
  ensureMediaWidth,
  MEDIA_MAX_BYTES,
  mediaPublicPath,
  mediaWarnings,
  readImageInfo,
  resolveMediaRequest,
  stripImageMetadata,
  uploadLimit,
} from './media.js';

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];

/** PNG: sygnatura, fragment IHDR z wymiarami i resztą nagłówka. */
const png = (width: number, height: number) =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);

const segment = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
const sof0 = (width: number, height: number) =>
  segment(0xc0, [8, ...be16(height), ...be16(width), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);

/** APP1 z EXIF: orientacja w IFD0 i miniatura JPEG z własnym SOF0 (160 × 120), którą parser musi pominąć. */
function exif(orientation: number): number[] {
  const thumbnail = [0xff, 0xd8, ...sof0(160, 120), 0xff, 0xd9];
  const tiff = [
    ...ascii('II'),
    0x2a,
    0,
    ...le32(8),
    ...le16(1),
    ...le16(0x0112),
    ...le16(3),
    ...le32(1),
    ...le16(orientation),
    0,
    0,
    ...le32(0),
  ];
  return segment(0xe1, [...ascii('Exif'), 0, 0, ...tiff, ...thumbnail]);
}

const jpeg = (width: number, height: number, options: { orientation?: number; fill?: boolean } = {}) =>
  new Uint8Array([
    0xff,
    0xd8,
    ...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(options.orientation ? exif(options.orientation) : []),
    ...segment(
      0xdb,
      Array.from({ length: 65 }, () => 1),
    ),
    ...(options.fill ? [0xff, 0xff] : []),
    ...sof0(width, height),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);

const riff = (chunk: string, body: number[]) =>
  new Uint8Array([
    ...ascii('RIFF'),
    ...le32(4 + 8 + body.length),
    ...ascii('WEBP'),
    ...ascii(chunk),
    ...le32(body.length),
    ...body,
  ]);
const webpLossy = (width: number, height: number) =>
  riff('VP8 ', [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 0, 0]);
function webpLossless(width: number, height: number) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return riff('VP8L', [0x2f, ...le32(bits), 0, 0, 0, 0]);
}
const webpExtended = (width: number, height: number) =>
  riff('VP8X', [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1), 0, 0]);

describe('media: typ i wymiary z nagłówka (ADR 0064)', () => {
  it('PNG z IHDR', () => {
    expect(readImageInfo(png(2400, 1600))).toEqual({ contentType: 'image/png', width: 2400, height: 1600 });
  });

  it('JPEG ze znacznika SOF po segmentach: miniatura EXIF nie myli wymiarów, bajty wypełnienia są pomijane', () => {
    expect(readImageInfo(jpeg(1920, 1080))).toEqual({ contentType: 'image/jpeg', width: 1920, height: 1080 });
    expect(readImageInfo(jpeg(1920, 1080, { orientation: 1 }))).toEqual({
      contentType: 'image/jpeg',
      width: 1920,
      height: 1080,
    });
    expect(readImageInfo(jpeg(1920, 1080, { fill: true }))).toMatchObject({ width: 1920, height: 1080 });
  });

  it('JPEG obrócony w EXIF (orientacja 6) ma zamienione wymiary wyświetlania', () => {
    expect(readImageInfo(jpeg(4032, 3024, { orientation: 6 }))).toMatchObject({ width: 3024, height: 4032 });
    expect(readImageInfo(jpeg(4032, 3024, { orientation: 3 }))).toMatchObject({ width: 4032, height: 3024 });
  });

  it('WebP: VP8, VP8L i VP8X', () => {
    expect(readImageInfo(webpLossy(1920, 1080))).toEqual({ contentType: 'image/webp', width: 1920, height: 1080 });
    expect(readImageInfo(webpLossless(1200, 1600))).toEqual({ contentType: 'image/webp', width: 1200, height: 1600 });
    expect(readImageInfo(webpExtended(8000, 4500))).toEqual({ contentType: 'image/webp', width: 8000, height: 4500 });
  });

  it('uszkodzony albo ucięty nagłówek daje `null`, bez wyjątku', () => {
    expect(readImageInfo(png(2400, 1600).subarray(0, 20))).toBeNull();
    expect(readImageInfo(png(0, 100))).toBeNull();
    expect(readImageInfo(jpeg(1920, 1080).subarray(0, 30))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBeNull();
    expect(readImageInfo(riff('VP8 ', [0, 0, 0, 1, 2, 3, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(
      readImageInfo(
        riff(
          'ALPH',
          Array.from({ length: 12 }, () => 0),
        ),
      ),
    ).toBeNull();
    expect(readImageInfo(new Uint8Array(ascii('%PDF-1.7')))).toBeNull();
    for (let n = 0; n < 200; n++) {
      const bytes = jpeg(1920, 1080, { orientation: 6 });
      bytes[(n * 7) % bytes.length] = (n * 31) & 0xff;
      expect(() => readImageInfo(bytes)).not.toThrow();
    }
  });
});

describe('media: wysyłka do biblioteki', () => {
  it('limit 5 MB, typ po sygnaturze z rozpoznaniem SVG i GIF', () => {
    expect(ensureMediaUpload({ bytes: png(1200, 800) })).toEqual({
      contentType: 'image/png',
      width: 1200,
      height: 800,
      warnings: [],
    });
    expect(() => ensureMediaUpload({ bytes: png(1200, 800), sizeBytes: MEDIA_MAX_BYTES + 1 })).toThrow(
      expect.objectContaining({
        code: 'FILE_TOO_LARGE',
        details: { maxBytes: MEDIA_MAX_BYTES, sizeBytes: MEDIA_MAX_BYTES + 1 },
      }),
    );
    expect(() => ensureMediaUpload({ bytes: png(1200, 800), truncated: true })).toThrow(
      expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
    );
    const svg = new Uint8Array(
      ascii('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    );
    expect(() => ensureMediaUpload({ bytes: svg })).toThrow(
      expect.objectContaining({
        code: 'FILE_TYPE_NOT_ALLOWED',
        details: expect.objectContaining({ detected: 'image/svg+xml' }),
      }),
    );
    expect(() => ensureMediaUpload({ bytes: new Uint8Array(ascii('GIF89a....')) })).toThrow(
      expect.objectContaining({
        code: 'FILE_TYPE_NOT_ALLOWED',
        details: expect.objectContaining({ detected: 'image/gif' }),
      }),
    );
    expect(detectRejectedImageType(new Uint8Array([0xef, 0xbb, 0xbf, ...ascii('<!-- logo --><svg>')]))).toBe(
      'image/svg+xml',
    );
    expect(detectRejectedImageType(new Uint8Array(ascii('<html><svg>')))).toBeNull();
  });

  it('wymiary: nieczytelny nagłówek, powyżej 8000 px błąd, powyżej 2560 px ostrzeżenie', () => {
    expect(() => ensureMediaUpload({ bytes: png(0, 0) })).toThrow(
      expect.objectContaining({ code: 'IMAGE_UNREADABLE' }),
    );
    expect(() => ensureMediaUpload({ bytes: webpExtended(8001, 100) })).toThrow(
      expect.objectContaining({
        code: 'IMAGE_DIMENSIONS_TOO_LARGE',
        details: { maxDimension: 8000, width: 8001, height: 100 },
      }),
    );
    expect(ensureMediaUpload({ bytes: png(3840, 3840) }).warnings).toEqual(['IMAGE_LARGE_DIMENSIONS']);
    expect(mediaWarnings({ width: 2560, height: 2560 })).toEqual([]);
  });

  it('limit i uprawnienie wysyłki według celu', () => {
    expect(uploadLimit('MEDIA')).toBe(5 * 1024 * 1024);
    expect(uploadLimit('PARKING_PHOTO')).toBe(10 * 1024 * 1024);
    expect(uploadPermission('MEDIA')).toBe('content.write');
    expect(uploadPermission('TICKET_PHOTO')).toBe('tickets.manage');
  });
});

describe('media: usunięcie, szerokość, adres publiczny', () => {
  const usages = [
    { kind: 'CONTENT_BLOCK' as const, id: 'b1', label: 'web.hero', minWidth: 1200 },
    { kind: 'SCOOTER_MODEL' as const, id: 'm1', label: 'M1' },
  ];

  it('klucz nowej grafiki: wzorzec, bez przedrostka systemowego i bez kolizji', () => {
    expect(() => ensureMediaKeyAllowed('aktualnosc-kampus-2', new Set(['aktualnosc-kampus']))).not.toThrow();
    expect(() => ensureMediaKeyAllowed('scooter.kobalt.bok')).toThrow(
      expect.objectContaining({ code: 'MEDIA_KEY_RESERVED' }),
    );
    expect(() => ensureMediaKeyAllowed('aktualnosc-kampus', new Set(['aktualnosc-kampus']))).toThrow(
      expect.objectContaining({ code: 'MEDIA_KEY_TAKEN' }),
    );
    expect(() => ensureMediaKeyAllowed('Aktualność')).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('usunięcie tylko nieużytej i niesystemowej grafiki', () => {
    expect(() => ensureMediaDeletable({ isSystem: true, usages: [] })).toThrow(
      expect.objectContaining({ code: 'MEDIA_SYSTEM' }),
    );
    expect(() => ensureMediaDeletable({ isSystem: false, usages })).toThrow(
      expect.objectContaining({
        code: 'MEDIA_IN_USE',
        details: {
          usages: [
            { kind: 'CONTENT_BLOCK', id: 'b1', label: 'web.hero' },
            { kind: 'SCOOTER_MODEL', id: 'm1', label: 'M1' },
          ],
        },
      }),
    );
    expect(() => ensureMediaDeletable({ isSystem: false, usages: [] })).not.toThrow();
  });

  it('minimalna szerokość sekcji przy przypięciu i przy zastąpieniu pliku', () => {
    expect(() => ensureMediaWidth(1199, { section: 'web.hero', minWidth: 1200 })).toThrow(
      expect.objectContaining({
        code: 'MEDIA_TOO_NARROW',
        details: { section: 'web.hero', minWidth: 1200, width: 1199 },
      }),
    );
    expect(() => ensureMediaWidth(500, { section: 'web.app' })).not.toThrow();
    expect(() => ensureMediaReplaceable({ width: 1000 }, usages)).toThrow(
      expect.objectContaining({ code: 'MEDIA_TOO_NARROW' }),
    );
    expect(() => ensureMediaReplaceable({ width: 1600 }, usages)).not.toThrow();
  });

  it('adres z sumą SHA-256: bieżąca daje plik, starsza przekierowanie, reszta 404', () => {
    const sha = 'a'.repeat(64);
    const media = { id: 'id-1', sha256: sha, contentType: 'image/webp' as const };
    expect(mediaPublicPath(media)).toBe(`/media/id-1/${sha}.webp`);
    expect(resolveMediaRequest(media, { sha256: sha, ext: 'webp' })).toBe('serve');
    expect(resolveMediaRequest(media, { sha256: sha, ext: 'png' })).toBe('redirect');
    expect(resolveMediaRequest(media, { sha256: 'b'.repeat(64), ext: 'webp' })).toBe('redirect');
    expect(resolveMediaRequest(media, { sha256: 'nie-suma', ext: 'webp' })).toBe('not_found');
    expect(resolveMediaRequest(null, { sha256: sha, ext: 'webp' })).toBe('not_found');
  });
});

describe('media: grafiki biblioteki bez metadanych (GPS z EXIF)', () => {
  const contains = (bytes: Uint8Array, text: string) => String.fromCharCode(...bytes).includes(text);
  const chunk = (type: string, body: number[]) => [...be32(body.length), ...ascii(type), ...body, 0, 0, 0, 0];

  it('JPEG: bez EXIF z GPS, IPTC, komentarza i danych po EOI; orientacja i wymiary zostają', () => {
    const original = jpeg(4032, 3024, { orientation: 6 });
    const gps = segment(0xe1, [...exif(6).slice(4), ...ascii('GPS-50.0919N-18.5417E')]);
    const xmp = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/ <x:xmpmeta>Rybnik</x:xmpmeta>'));
    const iptc = segment(0xed, ascii('Photoshop 3.0 8BIM city=Rybnik'));
    const comment = segment(0xfe, ascii('aparat telefonu Anny'));
    const icc = segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1]);
    const withMetadata = new Uint8Array([
      ...original.subarray(0, 2),
      ...gps,
      ...xmp,
      ...iptc,
      ...comment,
      ...icc,
      ...original.subarray(2),
      ...ascii('MotionPhoto_Data ftypmp42'),
    ]);
    const stripped = stripImageMetadata(withMetadata, 'image/jpeg');
    for (const leaked of ['GPS-50', 'xmpmeta', 'Photoshop', 'aparat telefonu', 'MotionPhoto']) {
      expect(contains(stripped, leaked), leaked).toBe(false);
    }
    expect(contains(stripped, 'ICC_PROFILE')).toBe(true);
    expect(readImageInfo(stripped)).toEqual({ contentType: 'image/jpeg', width: 3024, height: 4032 });
    expect(readImageInfo(withMetadata)).toEqual(readImageInfo(stripped));
    expect([...stripped.subarray(-2)]).toEqual([0xff, 0xd9]);
    // Bez orientacji (1) segment APP1 nie powstaje; dane skanu zostają bajt w bajt.
    const plain = stripImageMetadata(jpeg(1920, 1080, { orientation: 1 }), 'image/jpeg');
    expect(contains(plain, 'Exif')).toBe(false);
    expect(plain).toEqual(jpeg(1920, 1080));
  });

  it('PNG: bez eXIf, tEXt, iTXt, zTXt i tIME oraz danych po IEND', () => {
    const withMetadata = new Uint8Array([
      ...png(2400, 1600),
      ...chunk('tEXt', ascii('Author\0Anna Kowalska')),
      ...chunk('eXIf', ascii('MM GPS-50.0919N')),
      ...chunk('iTXt', ascii('XML:com.adobe.xmp')),
      ...chunk('IDAT', [1, 2, 3]),
      ...chunk('IEND', []),
      ...ascii('dopisek'),
    ]);
    const stripped = stripImageMetadata(withMetadata, 'image/png');
    for (const leaked of ['Anna', 'GPS-50', 'adobe', 'dopisek']) expect(contains(stripped, leaked), leaked).toBe(false);
    expect(contains(stripped, 'IDAT')).toBe(true);
    expect(readImageInfo(stripped)).toEqual({ contentType: 'image/png', width: 2400, height: 1600 });
  });

  it('WebP: bez fragmentów EXIF i XMP, flagi VP8X wyzerowane, rozmiar RIFF przeliczony', () => {
    const vp8x = [...ascii('VP8X'), ...le32(10), 0x10 | 0x0c, 0, 0, 0, ...le24(1919), ...le24(1079)];
    const exifChunk = [...ascii('EXIF'), ...le32(11), ...ascii('GPS-50.0919'), 0];
    const xmpChunk = [...ascii('XMP '), ...le32(6), ...ascii('Rybnik')];
    const body = [...ascii('WEBP'), ...vp8x, ...exifChunk, ...xmpChunk];
    const withMetadata = new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]);
    const stripped = stripImageMetadata(withMetadata, 'image/webp');
    expect(contains(stripped, 'GPS-50')).toBe(false);
    expect(contains(stripped, 'Rybnik')).toBe(false);
    expect(stripped[20]! & 0x0c).toBe(0);
    expect(new DataView(stripped.buffer, stripped.byteOffset).getUint32(4, true)).toBe(stripped.length - 8);
    expect(readImageInfo(stripped)).toEqual({ contentType: 'image/webp', width: 1920, height: 1080 });
  });
});
