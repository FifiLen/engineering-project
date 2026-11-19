import { describe, expect, it } from 'vitest';
import {
  deletePermission,
  detectImageType,
  ensureCanAddParkingPhoto,
  ensureFileAttachable,
  ensureUpload,
  FILE_MAX_BYTES,
  fileStorageKey,
  parkingPhotoExpired,
  uploadPermission,
} from './files.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const text = (value: string) => [...value].map((c) => c.charCodeAt(0));
const WEBP = new Uint8Array([...text('RIFF'), 1, 2, 3, 4, ...text('WEBPVP8 ')]);

describe('pliki: wysyłka (ADR 0057)', () => {
  it('rozpoznaje JPEG, PNG i WebP po sygnaturze, a nie po rozszerzeniu', () => {
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(WEBP)).toBe('image/webp');
    expect(detectImageType(new Uint8Array([...text('RIFF'), 1, 2, 3, 4, ...text('WAVE')]))).toBeNull();
    expect(detectImageType(new Uint8Array(text('%PDF-1.7')))).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
  });

  it('limit 10 MB i pusty plik', () => {
    expect(ensureUpload({ sizeBytes: 1000, head: JPEG })).toBe('image/jpeg');
    expect(() => ensureUpload({ sizeBytes: FILE_MAX_BYTES + 1, head: JPEG })).toThrow(
      expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
    );
    expect(() => ensureUpload({ sizeBytes: 1000, head: JPEG, truncated: true })).toThrow(
      expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
    );
    expect(() => ensureUpload({ sizeBytes: 0, head: new Uint8Array() })).toThrow(
      expect.objectContaining({ code: 'FILE_TYPE_NOT_ALLOWED' }),
    );
  });

  it('klucz obiektu z celu, miesiąca UTC i identyfikatora', () => {
    expect(
      fileStorageKey({
        purpose: 'PARKING_PHOTO',
        id: 'abc',
        contentType: 'image/webp',
        at: new Date('2026-11-30T23:30:00-02:00'),
      }),
    ).toBe('parking-photo/2026/12/abc.webp');
  });

  it('operator wysyła zdjęcie zgłoszenia z uprawnieniem do zgłoszeń', () => {
    expect(uploadPermission('TICKET_PHOTO')).toBe('tickets.manage');
    expect(uploadPermission('PARKING_PHOTO')).toBe('rentals.manage');
  });

  it('operator usuwa tylko pliki z wysyłki; pliki raportu, wydruku i eksportu to FILE_ATTACHED', () => {
    expect(deletePermission('PARKING_PHOTO', 'f')).toBe('rentals.manage');
    expect(deletePermission('MEDIA', 'f')).toBe('content.write');
    for (const purpose of ['REPORT_EXPORT', 'GENERATED_DOCUMENT', 'DATA_EXPORT', 'DOCUMENT_TEMPLATE']) {
      expect(() => deletePermission(purpose, 'f')).toThrow(expect.objectContaining({ code: 'FILE_ATTACHED' }));
    }
  });
});

describe('pliki: przypięcie i retencja', () => {
  const file = {
    purpose: 'PARKING_PHOTO',
    status: 'READY' as const,
    uploadedBy: 'u1',
    uploadedByStaff: null,
    attached: false,
  };

  it('tylko własny, nieprzypięty plik z właściwym celem', () => {
    expect(() => ensureFileAttachable(file, { userId: 'u1' }, 'PARKING_PHOTO', 'f')).not.toThrow();
    expect(() => ensureFileAttachable(file, { userId: 'u2' }, 'PARKING_PHOTO', 'f')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => ensureFileAttachable(null, { userId: 'u1' }, 'PARKING_PHOTO', 'f')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() => ensureFileAttachable(file, { userId: 'u1' }, 'TICKET_PHOTO', 'f')).toThrow(
      expect.objectContaining({ code: 'FILE_PURPOSE_MISMATCH' }),
    );
    expect(() => ensureFileAttachable({ ...file, attached: true }, { userId: 'u1' }, 'PARKING_PHOTO', 'f')).toThrow(
      expect.objectContaining({ code: 'FILE_ALREADY_ATTACHED' }),
    );
    expect(() => ensureFileAttachable({ ...file, status: 'DELETED' }, { userId: 'u1' }, 'PARKING_PHOTO', 'f')).toThrow(
      expect.objectContaining({ code: 'FILE_DELETED' }),
    );
  });

  it('zdjęcie parkowania po zakończeniu, jedno na przejazd', () => {
    expect(() => ensureCanAddParkingPhoto({ state: 'ENDED', parkingPhotoId: null })).not.toThrow();
    expect(() => ensureCanAddParkingPhoto({ state: 'UNPAID', parkingPhotoId: null })).not.toThrow();
    expect(() => ensureCanAddParkingPhoto({ state: 'ENDING', parkingPhotoId: null })).toThrow(
      expect.objectContaining({ code: 'RENTAL_NOT_ENDED' }),
    );
    expect(() =>
      ensureCanAddParkingPhoto({ state: 'ENDING', endMode: 'CUSTOMER_OFFLINE', parkingPhotoId: null }),
    ).not.toThrow();
    expect(() => ensureCanAddParkingPhoto({ state: 'ENDING', endMode: 'CUSTOMER', parkingPhotoId: null })).toThrow(
      expect.objectContaining({ code: 'RENTAL_NOT_ENDED' }),
    );
    expect(() => ensureCanAddParkingPhoto({ state: 'ENDED', parkingPhotoId: 'f' })).toThrow(
      expect.objectContaining({ code: 'PARKING_PHOTO_EXISTS' }),
    );
  });

  it('retencja 30 dni pomija zdjęcia w zgłoszeniu', () => {
    const now = new Date('2026-12-31T00:00:00Z');
    expect(parkingPhotoExpired({ createdAt: new Date('2026-11-30T00:00:00Z'), inTicket: false }, now)).toBe(true);
    expect(parkingPhotoExpired({ createdAt: new Date('2026-11-30T00:00:00Z'), inTicket: true }, now)).toBe(false);
    expect(parkingPhotoExpired({ createdAt: new Date('2026-12-02T00:00:00Z'), inTicket: false }, now)).toBe(false);
  });
});
