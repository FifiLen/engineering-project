import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { type DbExecutor, DrizzleFileRepository, type FileRecord } from '@hulajnogi/db';
import type { DocumentFileLink } from '@hulajnogi/shared';
import type { FilesService } from '../files/files.service.js';
import type { FileStorage } from '../files/file-storage.js';

/** Bajty obiektu z magazynu (szablon DOCX do wypełnienia, zapisany DOCX przy ponowieniu PDF). */
export async function readObject(storage: FileStorage, key: string): Promise<Buffer | null> {
  const object = await storage.get(key);
  if (!object) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of object.body as Readable) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * Plik wytworzony przez API: obiekt w magazynie, potem wiersz `files` (`READY`). Błąd zapisu wiersza usuwa obiekt,
 * żeby nie został nieosiągalny.
 */
export async function storeFile(
  storage: FileStorage,
  db: DbExecutor,
  input: {
    id?: string;
    purpose: 'DOCUMENT_TEMPLATE' | 'GENERATED_DOCUMENT' | 'DATA_EXPORT' | 'REPORT_EXPORT';
    key: (id: string) => string;
    bytes: Uint8Array;
    contentType: string;
    originalName: string;
    staffId?: string | null;
    userId?: string | null;
  },
): Promise<FileRecord> {
  const id = input.id ?? randomUUID();
  const storageKey = input.key(id);
  const body = Buffer.from(input.bytes);
  await storage.put(storageKey, body, input.contentType);
  try {
    return await new DrizzleFileRepository(db).insertStored({
      id,
      storageKey,
      purpose: input.purpose,
      contentType: input.contentType,
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      originalName: input.originalName.slice(0, 255),
      uploadedBy: input.userId ?? null,
      uploadedByStaff: input.staffId ?? null,
    });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

/** Plik wydruku z adresem z podpisem HMAC na 10 min (ADR 0057); usunięty plik nie ma adresu. */
export function fileLink(
  files: FilesService,
  file: { id: string; sizeBytes: number; status: string } | null,
  fileName: string,
  now = new Date(),
): DocumentFileLink | null {
  if (!file || file.status !== 'READY') return null;
  const signed = files.sign(file.id, now);
  return { url: signed.url, urlExpiresAt: signed.expiresAt.toISOString(), fileName, sizeBytes: file.sizeBytes };
}
