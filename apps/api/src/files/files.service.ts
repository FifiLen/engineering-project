import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  DomainError,
  ensureFileAttachable,
  ensureMediaUpload,
  ensureUpload,
  FILE_UNATTACHED_TTL_MS,
  FILE_URL_TTL_MS,
  fileStorageKey,
  notFound,
  PARKING_PHOTO_RETENTION_MS,
  stripImageMetadata,
  uploadPermission,
  type MediaUploadWarning,
  type StaffUploadFilePurpose,
} from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleFileRepository,
  type FileDeletionRule,
  type FileRecord,
} from '@hulajnogi/db';
import type { FileContentType, FileListItem, FilePurpose, FileView, ListQuery, ListResponse } from '@hulajnogi/shared';
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Principal } from '../auth/decorators.js';
import { StaffPermissionsService } from '../auth/staff-permissions.service.js';
import { CONFIG, type AppConfig } from '../config.js';
import { DB } from '../database/database.module.js';
import { JOBS, JobsService } from '../jobs/jobs.service.js';
import { FILE_STORAGE, S3FileStorage, type FileStorage, type StoredObject } from './file-storage.js';

/** Plik z wysyłki `multipart/form-data` po odczycie pola `file` (najwyżej limit + 1 bajt). */
export interface UploadedFile {
  purpose: StaffUploadFilePurpose;
  data: Buffer;
  /** Strumień przekroczył limit rozmiaru i został ucięty. */
  truncated: boolean;
  filename: string | null;
}

/**
 * Moduł Pliki (ADR 0057): wysyłka przez API do magazynu S3, odczyt po podpisanym adresie, przypięcie do rekordu
 * i sprzątanie. Klucz obiektu wybiera API, typ rozpoznaje core po sygnaturze, a podpis HMAC wystawia tylko widok
 * rekordu, do którego wywołujący ma dostęp.
 */
@Injectable()
export class FilesService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FilesService.name);
  /** Klucz podpisu adresów wyprowadzony z sekretu JWT, jak klucz kodów SMS (bez nowej zmiennej środowiskowej). */
  private readonly urlKey: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(CONFIG) config: AppConfig,
    private readonly jobs: JobsService,
    private readonly staffPermissions: StaffPermissionsService,
  ) {
    this.urlKey = `files:${config.JWT_SECRET}`;
  }

  onModuleInit(): void {
    this.jobs.handle(JOBS.filesCleanup, async () => {
      await this.cleanup();
    });
    this.jobs.handle(JOBS.filesRetention, async () => {
      await this.retention();
    });
  }

  onApplicationShutdown(): void {
    if (this.storage instanceof S3FileStorage) this.storage.close();
  }

  /**
   * `POST /files`: klient wysyła własne zdjęcie, operator z uprawnieniem do celu (ADR 0057). Grafika biblioteki
   * mediów (`MEDIA`, `content.write`) ma limit 5 MB, wymiary z nagłówka do 8000 px i ostrzeżenie powyżej 2560 px
   * (ADR 0064); wymiary zapisują się w `files`.
   */
  async upload(principal: Principal, file: UploadedFile): Promise<FileView> {
    if (principal.kind === 'staff') {
      (await this.staffPermissions.get(principal.staffId)).permissions.require(uploadPermission(file.purpose));
    } else if (file.purpose === 'MEDIA') {
      throw new DomainError('FORBIDDEN', { permission: uploadPermission('MEDIA') });
    }
    let image: { width: number; height: number; warnings: MediaUploadWarning[] } | null = null;
    let contentType: FileContentType;
    let data: Uint8Array = file.data;
    if (file.purpose === 'MEDIA') {
      const media = ensureMediaUpload({ bytes: file.data, sizeBytes: file.data.length, truncated: file.truncated });
      contentType = media.contentType;
      image = { width: media.width, height: media.height, warnings: media.warnings };
      // Grafika biblioteki ma publiczny adres: bez EXIF (GPS, aparat), XMP, IPTC i tekstów PNG; suma i rozmiar
      // liczą się z oczyszczonego pliku.
      data = stripImageMetadata(file.data, contentType);
    } else {
      contentType = ensureUpload({
        sizeBytes: file.data.length,
        head: file.data.subarray(0, 16),
        truncated: file.truncated,
      });
    }
    const id = randomUUID();
    const storageKey = fileStorageKey({ purpose: file.purpose, id, contentType, at: new Date() });
    await this.storage.put(storageKey, Buffer.from(data.buffer, data.byteOffset, data.length), contentType);
    try {
      const record = await new DrizzleFileRepository(this.db).insert({
        id,
        storageKey,
        purpose: file.purpose,
        contentType,
        sizeBytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        originalName: file.filename?.slice(0, 255) ?? null,
        uploadedBy: principal.kind === 'customer' ? principal.userId : null,
        uploadedByStaff: principal.kind === 'staff' ? principal.staffId : null,
        width: image?.width ?? null,
        height: image?.height ?? null,
      });
      return image ? { ...this.view(record), warnings: image.warnings } : this.view(record);
    } catch (error) {
      // Bez wiersza w bazie obiekt byłby nieosiągalny: usuwamy go od razu zamiast czekać na sprzątanie.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** Widok pliku z adresem podpisanym na 10 min; usunięty plik nie ma adresu. */
  view(file: FileRecord, now = new Date()): FileView {
    const signed = file.status === 'READY' ? this.sign(file.id, now) : null;
    return {
      id: file.id,
      purpose: file.purpose as FileView['purpose'],
      contentType: file.contentType as FileContentType,
      sizeBytes: file.sizeBytes ?? 0,
      status: file.status,
      url: signed?.url ?? null,
      urlExpiresAt: signed?.expiresAt.toISOString() ?? null,
      createdAt: file.createdAt.toISOString(),
      ...(file.width !== null ? { width: file.width, height: file.height } : {}),
    };
  }

  /** Widok pliku po identyfikatorze; wywołujący sprawdził już dostęp do rekordu, do którego plik należy. */
  async viewById(id: string | null, executor: DbExecutor = this.db): Promise<FileView | null> {
    if (!id) return null;
    const file = await new DrizzleFileRepository(executor).find(id);
    return file ? this.view(file) : null;
  }

  /**
   * Adres odczytu `/files/{id}?exp=…&sig=…` względem adresu API (klient zna go z `EXPO_PUBLIC_API_URL` albo
   * `NEXT_PUBLIC_API_URL`, więc działa także z telefonu w sieci lokalnej).
   */
  sign(id: string, now = new Date()): { url: string; expiresAt: Date } {
    const exp = Math.floor((now.getTime() + FILE_URL_TTL_MS) / 1000);
    return { url: `/files/${id}?exp=${exp}&sig=${this.signature(id, exp)}`, expiresAt: new Date(exp * 1000) };
  }

  /** `GET /files/{id}`: podpis i ważność, potem strumień z magazynu; usunięty obiekt to 410. */
  async read(
    id: string,
    exp: number,
    sig: string,
    now = new Date(),
  ): Promise<StoredObject & { contentType: string; purpose: string; originalName: string | null }> {
    const expected = Buffer.from(this.signature(id, exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new DomainError('FILE_SIGNATURE_INVALID');
    }
    if (exp * 1000 <= now.getTime()) throw new DomainError('FILE_URL_EXPIRED');
    const file = await new DrizzleFileRepository(this.db).find(id);
    if (!file) throw notFound('file', id);
    if (file.status !== 'READY') throw new DomainError('FILE_DELETED', { fileId: id });
    const object = await this.storage.get(file.storageKey);
    if (!object) throw notFound('file', id);
    return { ...object, contentType: file.contentType, purpose: file.purpose, originalName: file.originalName };
  }

  /** Warunek przypięcia w transakcji rekordu (blokada wiersza pliku): właściciel, cel, plik wolny. */
  async ensureAttachable(
    tx: DbExecutor,
    fileId: string,
    owner: { userId?: string; staffId?: string },
    purpose: StaffUploadFilePurpose,
  ): Promise<void> {
    ensureFileAttachable(await new DrizzleFileRepository(tx).lockAttachable(fileId), owner, purpose, fileId);
  }

  /**
   * Lista plików w panelu (zasób `files`): operator widzi cele, do których ma uprawnienie modułu (`rentals.read`
   * dla zdjęć parkowania, `tickets.read` dla zdjęć zgłoszeń); nazwa klienta tylko z `users.read`.
   */
  async list(staffId: string, query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<FileListItem>> {
    const { permissions } = await this.staffPermissions.get(staffId);
    const purposes: FilePurpose[] = [
      ...(permissions.has('rentals.read') ? (['PARKING_PHOTO'] as const) : []),
      ...(permissions.has('tickets.read') ? (['TICKET_PHOTO'] as const) : []),
    ];
    if (!purposes.length) throw new DomainError('FORBIDDEN', { permission: 'tickets.read' });
    const seesCustomers = permissions.has('users.read');
    const now = new Date();
    const result = await new DrizzleFileRepository(db).list(query, purposes);
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        uploadedByName: seesCustomers ? item.uploadedByName : null,
        url: item.status === 'READY' ? this.sign(item.id, now).url : null,
      })),
    };
  }

  /**
   * Usunięcie nieprzypiętego pliku z panelu (macierz operacji: „tak, jeśli nieużywany”) z uprawnieniem do celu
   * jak przy wysyłce; obiekt znika z magazynu, a wiersz zostaje jako `DELETED`.
   */
  async remove(staffId: string, id: string): Promise<void> {
    const repo = new DrizzleFileRepository(this.db);
    const file = await repo.find(id);
    if (!file) throw notFound('file', id);
    (await this.staffPermissions.get(staffId)).permissions.require(
      uploadPermission(file.purpose as StaffUploadFilePurpose),
    );
    const claim = await this.db.transaction((tx) => new DrizzleFileRepository(tx).claimForDeletion(id, 'UNATTACHED'));
    if (claim && 'attached' in claim) throw new DomainError('FILE_ATTACHED', { fileId: id });
    if (claim) await this.deleteObject(claim.claimed);
  }

  /** Zadanie `files.cleanup`: pliki nieprzypięte po 24 h (porzucona wysyłka) znikają z magazynu. */
  async cleanup(now = new Date()): Promise<number> {
    const repo = new DrizzleFileRepository(this.db);
    return this.purge(await repo.unattached(new Date(now.getTime() - FILE_UNATTACHED_TTL_MS)), 'UNATTACHED');
  }

  /** Zadanie `files.retention` raz na dobę: zdjęcia parkowania po 30 dniach, poza dowodami w sprawie. */
  async retention(now = new Date()): Promise<number> {
    const repo = new DrizzleFileRepository(this.db);
    return this.purge(
      await repo.expiredParkingPhotos(new Date(now.getTime() - PARKING_PHOTO_RETENTION_MS)),
      'RETENTION',
    );
  }

  /**
   * Kandydaci z zapytania bez blokady: każdy plik osobno oznaczamy `DELETED` w transakcji z blokadą i ponownym
   * sprawdzeniem warunku (plik przypięty w międzyczasie zostaje), a obiekt usuwamy po zatwierdzeniu. Błąd magazynu
   * zostawia w nim osierocony obiekt (wiersz już `DELETED`), ale nigdy nie usuwa obiektu przypiętego pliku.
   */
  private async purge(files: FileRecord[], rule: FileDeletionRule): Promise<number> {
    let deleted = 0;
    for (const file of files) {
      try {
        const claim = await this.db.transaction((tx) => new DrizzleFileRepository(tx).claimForDeletion(file.id, rule));
        if (!claim || 'attached' in claim) continue;
        await this.deleteObject(claim.claimed);
        deleted += 1;
      } catch (error) {
        this.logger.warn(`Nie usunięto pliku ${file.id}: ${(error as Error).message}`);
      }
    }
    if (deleted) this.logger.log(`Usunięte pliki: ${deleted}`);
    return deleted;
  }

  /**
   * Plik zwolniony w transakcji wywołującego (np. usunięta grafika biblioteki): oznaczenie `DELETED` z blokadą,
   * jeśli nic go już nie wskazuje. Obiekt usuwa `deleteObject` po zatwierdzeniu.
   */
  async claimReleased(tx: DbExecutor, fileId: string): Promise<FileRecord | null> {
    const claim = await new DrizzleFileRepository(tx).claimForDeletion(fileId, 'UNATTACHED');
    return claim && 'claimed' in claim ? claim.claimed : null;
  }

  /** Strumień obiektu pliku (publiczny odczyt grafik biblioteki mediów, ADR 0064). */
  readObject(storageKey: string): Promise<StoredObject | null> {
    return this.storage.get(storageKey);
  }

  /** Obiekt pliku oznaczonego już `DELETED`; błąd magazynu tylko w logu (wiersz i klucze obce zostają). */
  async deleteObject(file: FileRecord): Promise<void> {
    try {
      await this.storage.delete(file.storageKey);
    } catch (error) {
      this.logger.warn(`Nie usunięto obiektu ${file.storageKey} pliku ${file.id}: ${(error as Error).message}`);
    }
  }

  private signature(id: string, exp: number): string {
    return createHmac('sha256', this.urlKey).update(`${id}.${exp}`).digest('base64url');
  }
}
