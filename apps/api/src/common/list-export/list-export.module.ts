import { Global, Module } from '@nestjs/common';
import { ListExportService } from './list-export.service.js';

/** Eksport list (ADR 0073) dla kontrolerów wszystkich modułów panelu. */
@Global()
@Module({ providers: [ListExportService], exports: [ListExportService] })
export class ListExportModule {}
