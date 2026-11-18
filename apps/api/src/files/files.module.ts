import { Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { FILE_STORAGE, MemoryFileStorage, S3FileStorage, type FileStorage } from './file-storage.js';
import { AdminFilesController, FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';

/** Magazyn z konfiguracji (ADR 0057): SeaweedFS przez S3 albo pamięć procesu w testach API. */
export function createFileStorage(config: AppConfig): FileStorage {
  if (config.FILE_STORAGE === 'memory') return new MemoryFileStorage();
  return new S3FileStorage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  });
}

/** Moduł Pliki: wysyłka i odczyt zdjęć, przypięcie do rekordu, sprzątanie i retencja (ADR 0057). */
@Module({
  controllers: [FilesController, AdminFilesController],
  providers: [{ provide: FILE_STORAGE, inject: [CONFIG], useFactory: createFileStorage }, FilesService],
  exports: [FilesService, FILE_STORAGE],
})
export class FilesModule {}
