import { Global, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config.js';
import { FilesModule } from '../files/files.module.js';
import { GeoModule } from '../geo/geo.module.js';
import {
  AdminDocumentsController,
  CustomerDocumentsController,
  DocumentTemplatesController,
  DocumentTypesController,
  GeneratedDocumentsController,
} from './documents.controllers.js';
import { DocumentsService } from './documents.service.js';
import { DOCUMENT_RENDERER, FakeRenderer, GotenbergRenderer, type DocumentEngine } from './renderers.js';
import { TemplatesService } from './templates.service.js';

/** Silnik z konfiguracji (ADR 0066): Gotenberg albo atrapa w testach API (`DOCUMENT_RENDERER=fake`). */
export function createDocumentRenderer(config: AppConfig): DocumentEngine {
  if (config.DOCUMENT_RENDERER === 'fake') return new FakeRenderer();
  return new GotenbergRenderer(config.GOTENBERG_URL, config.GOTENBERG_TIMEOUT_MS);
}

/**
 * Moduł Dokumenty (iteracja 7, ADR 0066–0068): szablony DOCX z wersjami, wydruki z kart obiektów i paragon PDF
 * klienta przez zadanie pg-boss, silnik dokumentów za portem `DocumentRenderer`. Globalny, bo stan silnika czyta
 * `GET /health`, a iteracja 8 użyje portu do raportów.
 */
@Global()
@Module({
  imports: [FilesModule, GeoModule],
  controllers: [
    DocumentTemplatesController,
    DocumentTypesController,
    AdminDocumentsController,
    GeneratedDocumentsController,
    CustomerDocumentsController,
  ],
  providers: [
    { provide: DOCUMENT_RENDERER, inject: [CONFIG], useFactory: createDocumentRenderer },
    TemplatesService,
    DocumentsService,
  ],
  exports: [DOCUMENT_RENDERER, DocumentsService],
})
export class DocumentsModule {}
