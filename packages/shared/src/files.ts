/**
 * Pliki: zdjęcia zgłoszeń i parkowania (ADR 0057). Wysyłka i odczyt przez API, które strumieniuje do SeaweedFS;
 * widoki podają gotowy adres z podpisem ważnym 10 min, więc `<img>` i `Image` działają bez nagłówków.
 */
import { z } from 'zod';

/** Cele plików przyjmowanych przez `POST /files` (typ `file_purpose` ma też cele panelu z iteracji 7). */
export const UPLOAD_FILE_PURPOSES = ['PARKING_PHOTO', 'TICKET_PHOTO'] as const;
export type UploadFilePurpose = (typeof UPLOAD_FILE_PURPOSES)[number];

/** Stan pliku (`files.status`): obiekt usunięty po 30 dniach zostawia wiersz dla kluczy obcych. */
export const FILE_STATUSES = ['READY', 'DELETED'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/** Limity wysyłki; typ API rozpoznaje po sygnaturze pliku, nie po nagłówku. */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type FileContentType = (typeof FILE_CONTENT_TYPES)[number];

/**
 * Cele wysyłane przez operatora w `POST /files`: `MEDIA` z `content.write` i limitem 5 MB (ADR 0064); klient wysyła
 * tylko `UPLOAD_FILE_PURPOSES`. Pełny typ `file_purpose` jest w `FILE_PURPOSES` (zasób listy plików).
 */
export const STAFF_UPLOAD_FILE_PURPOSES = ['PARKING_PHOTO', 'TICKET_PHOTO', 'MEDIA'] as const;
export type StaffUploadFilePurpose = (typeof STAFF_UPLOAD_FILE_PURPOSES)[number];

/** Pole `purpose` formularza operatora (z `MEDIA`); klient dalej używa `fileUploadFieldsSchema`. */
export const staffFileUploadFieldsSchema = z.object({ purpose: z.enum(STAFF_UPLOAD_FILE_PURPOSES) });

/** Pole `purpose` formularza `multipart/form-data` obok jednego pola `file`. */
export const fileUploadFieldsSchema = z.object({ purpose: z.enum(UPLOAD_FILE_PURPOSES) });
export type FileUploadFields = z.infer<typeof fileUploadFieldsSchema>;

/** Odczyt `GET /files/{id}?exp=…&sig=…`: podpis HMAC wystawia API tylko temu, kto ma dostęp do rekordu. */
export const fileSignatureQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
});
export type FileSignatureQuery = z.infer<typeof fileSignatureQuerySchema>;

export interface FileView {
  id: string;
  purpose: StaffUploadFilePurpose;
  contentType: FileContentType;
  sizeBytes: number;
  status: FileStatus;
  /** Podpisany adres odczytu; `null` po usunięciu (widok pokazuje „Zdjęcie usunięte po 30 dniach”). */
  url: string | null;
  /** Ważność podpisu adresu. */
  urlExpiresAt: string | null;
  createdAt: string;
  /** Wymiary grafiki biblioteki mediów (cel `MEDIA`, ADR 0064); inne pliki ich nie mają. */
  width?: number | null;
  height?: number | null;
  /** Ostrzeżenia wysyłki grafiki: `IMAGE_LARGE_DIMENSIONS` powyżej 2560 px („możesz dodać mimo to”). */
  warnings?: string[];
}
