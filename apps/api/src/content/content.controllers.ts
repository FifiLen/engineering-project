import {
  companyProfileUpdateSchema,
  contentBlocksResource,
  contentSectionKeyParamSchema,
  contentSectionSaveSchema,
  faqCategoriesResource,
  faqCategoryCreateSchema,
  faqCategoryOrderSchema,
  faqCategoryUpdateSchema,
  faqItemCreateSchema,
  faqItemsResource,
  faqItemUpdateSchema,
  faqOrderSchema,
  mediaCreateSchema,
  mediaReplaceFileSchema,
  mediaResource,
  mediaUpdateSchema,
  newsCreateSchema,
  newsResource,
  newsUpdateSchema,
  type CompanyProfileUpdate,
  type ContentSectionSave,
  type FaqCategoryCreate,
  type FaqCategoryOrder,
  type FaqCategoryUpdate,
  type FaqItemCreate,
  type FaqItemUpdate,
  type FaqOrder,
  type ListQuery,
  type MediaCreate,
  type MediaReplaceFile,
  type MediaUpdate,
  type NewsCreate,
  type NewsUpdate,
  type ListExportRequest,
} from '@hulajnogi/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentStaff, RequirePermission, type StaffPrincipal } from '../auth/decorators.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { CompanyService } from './company.service.js';
import { FaqService } from './faq.service.js';
import { MediaService } from './media.service.js';
import { NewsService } from './news.service.js';
import { SectionsService } from './sections.service.js';
import type { FastifyReply } from 'fastify';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

const sectionKeyParam = new ZodPipe(contentSectionKeyParamSchema);
const idParam = new ZodPipe(z.uuid());
const versionQuery = new ZodPipe(z.object({ version: z.coerce.number().int().min(1) }));

/** Zasób listy `content-blocks` (wymaganie 12): bloki wszystkich sekcji, tylko do odczytu (zapis przez sekcję). */
@ApiTags('panel: treści')
@Controller('admin/content-blocks')
export class ContentBlocksController {
  constructor(
    private readonly sections: SectionsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('content.read')
  @Get()
  @ApiOperation({ summary: 'Bloki treści według wzorca listy z licznikami sekcji (elementy, opublikowane, szkice)' })
  list(@Query(new ListQueryPipe(contentBlocksResource)) query: ListQuery) {
    return this.sections.listBlocks(query);
  }

  @RequirePermission('content.read')
  @ListExport('bloki treści')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, contentBlocksResource, body, (db, query) =>
      this.sections.listBlocks(query, db),
    );
  }
}

/** Sekcje z rejestru (ADR 0062, D1): edytor nagłówka i elementów sekcji-list, historia z „Przywróć”. */
@ApiTags('panel: treści')
@Controller('admin/content-sections')
export class ContentSectionsController {
  constructor(private readonly sections: SectionsService) {}

  @RequirePermission('content.read')
  @Get()
  @ApiOperation({ summary: 'Sekcje z rejestru w jego kolejności ze stanem nagłówka i licznikami elementów' })
  list() {
    return this.sections.sections();
  }

  @RequirePermission('content.read')
  @Get(':key')
  @ApiOperation({ summary: 'Sekcja w edytorze: nagłówek (blok pojedynczy) i elementy w kolejności pozycji' })
  details(@Param('key', sectionKeyParam) key: string) {
    return this.sections.section(key);
  }

  @RequirePermission('content.read')
  @Get(':key/history')
  @ApiOperation({ summary: 'Historia sekcji z dziennika audytu z pełnym stanem po zmianie (do „Przywróć”)' })
  history(@Param('key', sectionKeyParam) key: string) {
    return this.sections.history(key);
  }

  @RequirePermission('content.write')
  @Put(':key')
  @ApiOperation({
    summary:
      'Zapis sekcji jednym żądaniem (blokada wersji nagłówka): kolejność elementów z tablicy, element bez id nowy, brakujący usunięty; 422 CONTENT_VALIDATION_FAILED z details.issues[] (pole, wiersz, kolumna), CONTENT_SECTION_REQUIRED, CONTENT_DELETE_PUBLISHED',
  })
  save(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('key', sectionKeyParam) key: string,
    @Body(new ZodPipe(contentSectionSaveSchema)) body: ContentSectionSave,
  ) {
    return this.sections.save(staff.staffId, key, body);
  }
}

/** Zasób `faq-items`: pytania FAQ z kategorią, kolejnością, widocznością na stronie i w aplikacji. */
@ApiTags('panel: treści')
@Controller('admin/faq-items')
export class FaqItemsController {
  constructor(
    private readonly faq: FaqService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('content.read')
  @Get()
  list(@Query(new ListQueryPipe(faqItemsResource)) query: ListQuery) {
    return this.faq.list(query);
  }

  @RequirePermission('content.read')
  @ListExport('pytania FAQ')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, faqItemsResource, body, (db, query) => this.faq.list(query, db));
  }

  @RequirePermission('content.write')
  @Put('order')
  @ApiOperation({ summary: 'Kolejność pytań jednej kategorii z wersjami wszystkich pytań (ORDER_MISMATCH, CONFLICT)' })
  reorder(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(faqOrderSchema)) body: FaqOrder) {
    return this.faq.reorder(staff.staffId, body);
  }

  @RequirePermission('content.read')
  @Get(':id')
  details(@Param('id', idParam) id: string) {
    return this.faq.details(id);
  }

  @RequirePermission('content.read')
  @Get(':id/history')
  history(@Param('id', idParam) id: string) {
    return this.faq.history(id);
  }

  @RequirePermission('content.write')
  @Post()
  @ApiOperation({ summary: 'Nowe pytanie na końcu kategorii; nazwa kategorii, której nie ma, tworzy kategorię' })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(faqItemCreateSchema)) body: FaqItemCreate) {
    return this.faq.create(staff.staffId, body);
  }

  @RequirePermission('content.write')
  @Patch(':id')
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(faqItemUpdateSchema)) body: FaqItemUpdate,
  ) {
    return this.faq.update(staff.staffId, id, body);
  }

  @RequirePermission('content.write')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie szkicu albo pytania z archiwum (CONTENT_DELETE_PUBLISHED)' })
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ): Promise<void> {
    await this.faq.remove(staff.staffId, id, version);
  }
}

/** Zasób `faq-categories`: kategorie FAQ z jawną kolejnością; usunięcie tylko pustej. */
@ApiTags('panel: treści')
@Controller('admin/faq-categories')
export class FaqCategoriesController {
  constructor(
    private readonly faq: FaqService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('content.read')
  @Get()
  list(@Query(new ListQueryPipe(faqCategoriesResource)) query: ListQuery) {
    return this.faq.listCategories(query);
  }

  @RequirePermission('content.read')
  @ListExport('kategorie FAQ')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, faqCategoriesResource, body, (db, query) =>
      this.faq.listCategories(query, db),
    );
  }

  @RequirePermission('content.write')
  @Put('order')
  @ApiOperation({ summary: 'Kolejność wszystkich kategorii z wersjami (ORDER_MISMATCH, CONFLICT)' })
  reorder(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(faqCategoryOrderSchema)) body: FaqCategoryOrder) {
    return this.faq.reorderCategories(staff.staffId, body);
  }

  @RequirePermission('content.read')
  @Get(':id')
  details(@Param('id', idParam) id: string) {
    return this.faq.categoryDetails(id);
  }

  @RequirePermission('content.read')
  @Get(':id/history')
  history(@Param('id', idParam) id: string) {
    return this.faq.categoryHistory(id);
  }

  @RequirePermission('content.write')
  @Post()
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(faqCategoryCreateSchema)) body: FaqCategoryCreate) {
    return this.faq.createCategory(staff.staffId, body);
  }

  @RequirePermission('content.write')
  @Patch(':id')
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(faqCategoryUpdateSchema)) body: FaqCategoryUpdate,
  ) {
    return this.faq.updateCategory(staff.staffId, id, body);
  }

  @RequirePermission('content.write')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie kategorii bez pytań (FAQ_CATEGORY_NOT_EMPTY)' })
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ): Promise<void> {
    await this.faq.removeCategory(staff.staffId, id, version);
  }
}

/** Zasób `news`: aktualności z publikacją od–do, stanem z dat i stałym adresem po pierwszej publikacji. */
@ApiTags('panel: treści')
@Controller('admin/news')
export class NewsController {
  constructor(
    private readonly news: NewsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('content.read')
  @Get()
  list(@Query(new ListQueryPipe(newsResource)) query: ListQuery) {
    return this.news.list(query);
  }

  @RequirePermission('content.read')
  @ListExport('aktualności')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, newsResource, body, (db, query) => this.news.list(query, db));
  }

  @RequirePermission('content.read')
  @Get(':id')
  details(@Param('id', idParam) id: string) {
    return this.news.details(id);
  }

  @RequirePermission('content.read')
  @Get(':id/history')
  history(@Param('id', idParam) id: string) {
    return this.news.history(id);
  }

  @RequirePermission('content.write')
  @Post()
  @ApiOperation({
    summary:
      'Nowa aktualność; slug z tytułu (unikalny), publikacja bez daty „od” od razu, granice w przyszłości planują content.news-boundary',
  })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(newsCreateSchema)) body: NewsCreate) {
    return this.news.create(staff.staffId, body);
  }

  @RequirePermission('content.write')
  @Patch(':id')
  @ApiOperation({ summary: 'Zapis z blokadą wersji; slug po pierwszej publikacji się nie zmienia (NEWS_SLUG_LOCKED)' })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(newsUpdateSchema)) body: NewsUpdate,
  ) {
    return this.news.update(staff.staffId, id, body);
  }

  @RequirePermission('content.write')
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ): Promise<void> {
    await this.news.remove(staff.staffId, id, version);
  }
}

/** Zasób `media` (ADR 0064): biblioteka grafik z miejscami użycia, „Zastąp plik” i usunięciem nieużytej. */
@ApiTags('panel: treści')
@Controller('admin/media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('content.read')
  @Get()
  @ApiOperation({ summary: 'Grafiki według wzorca listy; „Używane” usages.gte=1, „Nieużywane” usages.lte=0' })
  list(@Query(new ListQueryPipe(mediaResource)) query: ListQuery) {
    return this.media.list(query);
  }

  @RequirePermission('content.read')
  @ListExport('media')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, mediaResource, body, (db, query) => this.media.list(query, db));
  }

  @RequirePermission('content.read')
  @Get(':id')
  @ApiOperation({ summary: 'Grafika z miejscami użycia (bloki sekcji, aktualności, modele)' })
  details(@Param('id', idParam) id: string) {
    return this.media.details(id);
  }

  @RequirePermission('content.read')
  @Get(':id/history')
  history(@Param('id', idParam) id: string) {
    return this.media.history(id);
  }

  @RequirePermission('content.write')
  @Post()
  @ApiOperation({
    summary:
      'Grafika z pliku wysłanego przez POST /files (purpose=MEDIA): klucz niezmienny (MEDIA_KEY_RESERVED, MEDIA_KEY_TAKEN), tekst alternatywny 3–250 znaków',
  })
  create(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(mediaCreateSchema)) body: MediaCreate) {
    return this.media.create(staff.staffId, body);
  }

  @RequirePermission('content.write')
  @Patch(':id')
  @ApiOperation({ summary: 'Nazwa, tekst alternatywny i podpis (działają wszędzie, gdzie grafika jest użyta)' })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(mediaUpdateSchema)) body: MediaUpdate,
  ) {
    return this.media.update(staff.staffId, id, body);
  }

  @RequirePermission('content.write')
  @Post(':id/file')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '„Zastąp plik”: ten sam identyfikator i użycia, nowy adres z SHA-256; MEDIA_TOO_NARROW przy sekcji z minimalną szerokością',
  })
  replaceFile(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(mediaReplaceFileSchema)) body: MediaReplaceFile,
  ) {
    return this.media.replaceFile(staff.staffId, id, body);
  }

  @RequirePermission('content.write')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie grafiki nieużytej i niesystemowej (MEDIA_IN_USE z miejscami, MEDIA_SYSTEM)' })
  async remove(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Query(versionQuery) { version }: { version: number },
  ): Promise<void> {
    await this.media.remove(staff.staffId, id, version);
  }
}

/** Dane firmy (ADR 0062): podgląd z `content.read`, zapis tylko z `company.write` (Administrator). */
@ApiTags('panel: treści')
@Controller('admin/company')
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @RequirePermission('content.read')
  @Get()
  @ApiOperation({ summary: 'Dane firmy: sprzedawca na paragonach, kontakt pomocy, dane rejestrowe' })
  get() {
    return this.company.get();
  }

  @RequirePermission('content.read')
  @Get('history')
  history() {
    return this.company.history();
  }

  @RequirePermission('company.write')
  @Patch()
  @ApiOperation({
    summary:
      'Zapis częściowy z blokadą wersji; NIP i REGON z sumą kontrolną, KRS z sądem (422 CONTENT_VALIDATION_FAILED); paragony kopiują dane w chwili wystawienia',
  })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(new ZodPipe(companyProfileUpdateSchema)) body: CompanyProfileUpdate,
  ) {
    return this.company.update(staff.staffId, body);
  }
}
