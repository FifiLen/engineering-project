import { Global, Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { AdminDataExportsController, CustomerDataExportController } from './data-export.controllers.js';
import { DataExportRegistry } from './data-export.registry.js';
import { DataExportService } from './data-export.service.js';

/**
 * Moduł Eksport danych klienta (iteracja 7, ADR 0069). Globalny, bo porty eksportu modułów Konta, Wypożyczenia,
 * Płatności, Operacje i Powiadomienia rejestrują się w `DataExportRegistry`.
 */
@Global()
@Module({
  imports: [FilesModule],
  controllers: [CustomerDataExportController, AdminDataExportsController],
  providers: [DataExportRegistry, DataExportService],
  exports: [DataExportRegistry, DataExportService],
})
export class DataExportModule {}
