import type { Permission } from '../access/permissions.js';
import { DomainError } from '../errors.js';

/**
 * Pliki: zdjęcia parkowania i zgłoszeń (ADR 0057). Wysyłka i odczyt idą przez API; typ pliku rozpoznaje się
 * po sygnaturze zawartości, nie po nagłówku, a klucz w magazynie wybiera API.
 */
export const UPLOAD_FILE_PURPOSES = ['PARKING_PHOTO', 'TICKET_PHOTO'] as const;
export type UploadFilePurpose = (typeof UPLOAD_FILE_PURPOSES)[number];

export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type FileContentType = (typeof FILE_CONTENT_TYPES)[number];

/** Ważność podpisanego adresu odczytu w widokach API. */
export const FILE_URL_TTL_MS = 10 * 60_000;
/** Plik wysłany, ale nieprzypięty do przejazdu ani zgłoszenia, usuwa zadanie `files.cleanup` po tym czasie. */
export const FILE_UNATTACHED_TTL_MS = 24 * 60 * 60_000;
/** Zdjęcie parkowania spoza zgłoszenia usuwa zadanie `files.retention` po 30 dniach (pytanie 9). */
export const PARKING_PHOTO_RETENTION_MS = 30 * 24 * 60 * 60_000;

const EXTENSIONS: Record<FileContentType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

/** Typ obrazu z pierwszych bajtów: JPEG (FF D8 FF), PNG (sygnatura 8 bajtów), WebP (RIFF….WEBP); inaczej `null`. */
export function detectImageType(head: Uint8Array): FileContentType | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Warunki wysyłki: limit rozmiaru i obraz rozpoznany po sygnaturze (`FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`). */
export function ensureUpload(input: { sizeBytes: number; head: Uint8Array; truncated?: boolean }): FileContentType {
  if (input.truncated || input.sizeBytes > FILE_MAX_BYTES) {
    throw new DomainError('FILE_TOO_LARGE', { maxBytes: FILE_MAX_BYTES });
  }
  const type = input.sizeBytes > 0 ? detectImageType(input.head) : null;
  if (!type) throw new DomainError('FILE_TYPE_NOT_ALLOWED', { allowed: [...FILE_CONTENT_TYPES] });
  return type;
}

/** Klucz obiektu `{cel}/{rrrr}/{mm}/{uuid}.{rozszerzenie}` (czas UTC). */
export function fileStorageKey(input: {
  purpose: UploadFilePurpose;
  id: string;
  contentType: FileContentType;
  at: Date;
}): string {
  const purpose = input.purpose.toLowerCase().replace(/_/g, '-');
  const year = input.at.getUTCFullYear();
  const month = String(input.at.getUTCMonth() + 1).padStart(2, '0');
  return `${purpose}/${year}/${month}/${input.id}.${EXTENSIONS[input.contentType]}`;
}

/** Uprawnienie operatora do wysyłki pliku danego celu (klient wysyła zawsze własne zdjęcia). */
export function uploadPermission(purpose: UploadFilePurpose): Permission {
  return purpose === 'TICKET_PHOTO' ? 'tickets.manage' : 'rentals.manage';
}

export interface AttachableFile {
  purpose: string;
  status: 'READY' | 'DELETED';
  /** Klient, który wysłał plik (`files.uploaded_by`); `null` dla pliku operatora. */
  uploadedBy: string | null;
  uploadedByStaff: string | null;
  /** Plik jest już zdjęciem parkowania albo zdjęciem zgłoszenia. */
  attached: boolean;
}

/**
 * Przypięcie pliku do rekordu (ADR 0057): tylko własny plik, z właściwym celem, jeszcze nieprzypięty i nieusunięty.
 * Cudzy plik daje `NOT_FOUND`, żeby nie zdradzać, że istnieje.
 */
export function ensureFileAttachable(
  file: AttachableFile | null,
  owner: { userId?: string; staffId?: string },
  purpose: UploadFilePurpose,
  fileId: string,
): void {
  const own = owner.userId ? file?.uploadedBy === owner.userId : file?.uploadedByStaff === owner.staffId;
  if (!file || !own) throw new DomainError('NOT_FOUND', { entity: 'file', id: fileId });
  if (file.status !== 'READY') throw new DomainError('FILE_DELETED', { fileId });
  if (file.purpose !== purpose) throw new DomainError('FILE_PURPOSE_MISMATCH', { expected: purpose });
  if (file.attached) throw new DomainError('FILE_ALREADY_ATTACHED', { fileId });
}

/**
 * Zdjęcie parkowania po zakończeniu przejazdu (pytanie 9): przejazd zakończony (`ENDED`, `UNPAID`) i bez zdjęcia.
 * Zdjęcie jest opcjonalne, a wymagane po zakończeniu bez łączności (`parkingPhotoRequired`).
 */
export function ensureCanAddParkingPhoto(rental: {
  state: string;
  endMode?: string | null;
  parkingPhotoId: string | null;
}): void {
  // Przy zakończeniu bez łączności zdjęcie powstaje, gdy blokada jeszcze czeka w `ENDING` (ADR 0056).
  const waitingOffline = rental.state === 'ENDING' && rental.endMode === 'CUSTOMER_OFFLINE';
  if (rental.state !== 'ENDED' && rental.state !== 'UNPAID' && !waitingOffline) {
    throw new DomainError('RENTAL_NOT_ENDED', { state: rental.state });
  }
  if (rental.parkingPhotoId) throw new DomainError('PARKING_PHOTO_EXISTS');
}

/** Zdjęcie parkowania do usunięcia przez `files.retention`: starsze niż 30 dni i nie w zgłoszeniu. */
export const parkingPhotoExpired = (file: { createdAt: Date; inTicket: boolean }, now: Date): boolean =>
  !file.inTicket && now.getTime() - file.createdAt.getTime() > PARKING_PHOTO_RETENTION_MS;
