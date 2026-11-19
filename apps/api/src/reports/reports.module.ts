import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { FilesModule } from '../files/files.module.js';
import { ReportDefinitionsService } from './report-definitions.service.js';
import { ReportGeneratorService } from './report-generator.service.js';
import { ReportDefinitionsController, ReportRunsController, ReportsController } from './reports.controllers.js';
import { ReportsService } from './reports.service.js';

/**
 * Moduł Raporty (iteracja 8, ADR 0071, ADR 0072): katalog i podgląd synchroniczny z funkcji `fn_report_*`, eksport
 * PDF (Gotenberg przez port `DocumentRenderer` z modułu Dokumenty) i XLSX (ExcelJS za portem `SpreadsheetWriter`)
 * zadaniem `report.generate`, historia uruchomień, definicje z panelu, porządki i retencja plików.
 */
@Module({
  imports: [FilesModule, ContentModule],
  controllers: [ReportsController, ReportRunsController, ReportDefinitionsController],
  providers: [ReportsService, ReportDefinitionsService, ReportGeneratorService],
  exports: [ReportGeneratorService],
})
export class ReportsModule {}
