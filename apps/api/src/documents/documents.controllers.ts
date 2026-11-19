import '@fastify/multipart';
import {
  documentGenerateSchema,
  documentTemplateCreateSchema,
  documentTemplateUpdateSchema,
  documentTemplatesResource,
  generatedDocumentsResource,
  templateVersionUploadFieldsSchema,
  type DocumentGenerate,
  type DocumentTemplateCreate,
  type DocumentTemplateUpdate,
  type ListQuery,
  type ListExportRequest,
} from '@hulajnogi/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CurrentCustomer,
  CurrentStaff,
  CustomerAuth,
  RequirePermission,
  StaffAuth,
  type CustomerPrincipal,
  type StaffPrincipal,
} from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { DocumentsService } from './documents.service.js';
import { TemplatesService } from './templates.service.js';
import { ListExport, listExportBody } from '../common/list-export/list-export.decorators.js';
import { ListExportService } from '../common/list-export/list-export.service.js';

const idParam = new ZodPipe(z.uuid());
const typeParam = new ZodPipe(z.string().regex(/^[A-Z_]{3,40}$/));
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Odczyt `multipart/form-data` wgrania wersji: jedno pole `file` i notatka. */
async function readUpload(request: FastifyRequest) {
  if (!request.isMultipart()) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Oczekiwano multipart/form-data z polem file');
  }
  const fields: Record<string, unknown> = {};
  let file: { data: Buffer; truncated: boolean; filename: string | null } | null = null;
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) {
          part.file.resume();
          continue;
        }
        const data = await part.toBuffer();
        file = { data, truncated: part.file.truncated, filename: part.filename || null };
      } else {
        fields[part.fieldname] = part.value === '' ? null : part.value;
      }
    }
  } catch (error) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', (error as Error).message);
  }
  const parsed = templateVersionUploadFieldsSchema.safeParse(fields);
  if (!parsed.success || !file) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Nieprawidłowe parametry żądania',
      parsed.success ? [{ path: ['file'], message: 'Brak pliku' }] : parsed.error.issues,
    );
  }
  return { ...file, note: parsed.data.note };
}

/** Szablony wydruków (ADR 0067): podgląd z `templates.read`, zmiany z `templates.write` (Administrator). */
@ApiTags('panel: wydruki')
@Controller('admin/document-templates')
export class DocumentTemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('templates.read')
  @Get()
  @ApiOperation({
    summary: 'Szablony wydruków według wzorca listy z aktywną wersją, liczbą wersji i ostatnim wydrukiem',
  })
  list(@Query(new ListQueryPipe(documentTemplatesResource)) query: ListQuery) {
    return this.templates.list(query);
  }

  @RequirePermission('templates.read')
  @ListExport('szablony wydruków')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, documentTemplatesResource, body, (db, query) =>
      this.templates.list(query, db),
    );
  }

  @RequirePermission('templates.write')
  @Post()
  @ApiOperation({
    summary: 'Nowy szablon rodzaju z katalogu (bez wersji); nazwa unikalna w rodzaju (409 TEMPLATE_NAME_TAKEN)',
  })
  create(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(new ZodPipe(documentTemplateCreateSchema)) body: DocumentTemplateCreate,
  ) {
    return this.templates.create(staff.staffId, body);
  }

  @RequirePermission('templates.read')
  @Get(':id')
  @ApiOperation({ summary: 'Szablon z wersjami (ACTIVE, ARCHIVED, PENDING), polami i ostrzeżeniami' })
  details(@Param('id', idParam) id: string) {
    return this.templates.details(id);
  }

  @RequirePermission('templates.write')
  @Patch(':id')
  @ApiOperation({
    summary:
      'Nazwa i opis szablonu z blokadą optymistyczną (409 CONFLICT); zajęta nazwa w rodzaju 409 TEMPLATE_NAME_TAKEN; wpis document_template.updated',
  })
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(documentTemplateUpdateSchema)) body: DocumentTemplateUpdate,
  ) {
    return this.templates.update(staff.staffId, id, body);
  }

  @RequirePermission('templates.write')
  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Dezaktywacja szablonu (znika z „Drukuj”, wersje i wydruki zostają); domyślny z aktywną wersją 409 TEMPLATE_IS_DEFAULT; wpis document_template.deactivated',
  })
  deactivate(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.templates.deactivate(staff.staffId, id);
  }

  @RequirePermission('templates.write')
  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOperation({ summary: '„Aktywuj ponownie”: szablon wraca jako aktywny, bez roli domyślnego' })
  reactivate(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.templates.reactivate(staff.staffId, id);
  }

  @RequirePermission('templates.write')
  @Post(':id/versions')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'DOCX do 5 MB (bez makr, bez .dotx i .docm)' },
        note: { type: 'string', maxLength: 300 },
      },
    },
  })
  @ApiOperation({
    summary:
      'Wgranie wersji (201, stan PENDING): archiwum (TEMPLATE_NOT_DOCX, TEMPLATE_MACROS 415; TEMPLATE_TOO_LARGE, TEMPLATE_TOO_LARGE_UNPACKED 413), znaczniki względem katalogu i próbne wypełnienie (422 TEMPLATE_INVALID z details.issues[]: code, tag, place, suggestion, available, loop)',
  })
  async upload(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const view = await this.templates.uploadVersion(staff.staffId, id, await readUpload(request));
    void reply.status(201);
    return view;
  }

  @RequirePermission('templates.write')
  @Post(':id/versions/:versionId/activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Aktywacja wersji albo „Przywróć” starszej (bez kopiowania pliku); działa od kolejnych wydruków',
  })
  activate(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Param('versionId', idParam) versionId: string,
  ) {
    return this.templates.activate(staff.staffId, id, versionId);
  }

  @RequirePermission('templates.write')
  @Post(':id/default')
  @HttpCode(200)
  @ApiOperation({ summary: 'Szablon domyślny rodzaju (409 TEMPLATE_NO_ACTIVE_VERSION, TEMPLATE_INACTIVE)' })
  setDefault(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.templates.setDefault(staff.staffId, id);
  }

  @RequirePermission('templates.write')
  @Delete(':id/versions/:versionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie wersji „Do aktywacji” (409 TEMPLATE_VERSION_IN_USE dla aktywnej i archiwalnej)' })
  async removeVersion(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id', idParam) id: string,
    @Param('versionId', idParam) versionId: string,
  ): Promise<void> {
    await this.templates.deleteVersion(staff.staffId, id, versionId);
  }

  @RequirePermission('templates.read')
  @Get(':id/versions/:versionId/file')
  @ApiOperation({ summary: '„Pobierz aktywną” i pobranie dowolnej wersji: adres z podpisem na 10 min' })
  file(@Param('id', idParam) id: string, @Param('versionId', idParam) versionId: string) {
    return this.templates.versionFile(id, versionId);
  }

  @RequirePermission('templates.read')
  @Get(':id/versions/:versionId/preview.pdf')
  @ApiOperation({
    summary:
      'Podgląd PDF na danych przykładowych (synchronicznie, limit 30 s; zapamiętany przy wersji); RENDER_TIMEOUT 504, RENDERER_UNAVAILABLE 503, RENDER_FAILED 502',
  })
  async preview(
    @Param('id', idParam) id: string,
    @Param('versionId', idParam) versionId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const pdf = await this.templates.preview(id, versionId);
    await reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${pdf.fileName}"`)
      .header('cache-control', 'private, no-store')
      .send(pdf.bytes);
  }
}

/** Katalog rodzajów i pól z core (ADR 0067): panel nie powiela opisu pól. */
@ApiTags('panel: wydruki')
@Controller('admin/document-types')
export class DocumentTypesController {
  constructor(private readonly templates: TemplatesService) {}

  // Zakres zależy od uprawnień: `templates.read` widzi wszystkie rodzaje, inaczej tylko te z prawem druku.
  @StaffAuth()
  @Get()
  @ApiOperation({ summary: 'Rodzaje dokumentów z parametrami, szablonami i widocznością „Drukuj” dla operatora' })
  list(@CurrentStaff() staff: StaffPrincipal) {
    return this.templates.documentTypes(staff.staffId);
  }

  @RequirePermission('templates.read')
  @Get(':type/fields')
  @ApiOperation({
    summary: 'Pola i pętle rodzaju dla autora szablonu (ścieżka, etykieta, typ, przykład, dane klienta)',
  })
  fields(@Param('type', typeParam) type: string) {
    return this.templates.fieldCatalog(type);
  }

  @RequirePermission('templates.read')
  @Get(':type/fields.docx')
  @ApiOperation({ summary: '„Lista pól (DOCX)” z szablonu systemowego lista-pol.docx' })
  async fieldsDocx(@Param('type', typeParam) type: string, @Res() reply: FastifyReply): Promise<void> {
    const docx = await this.templates.fieldListDocx(type);
    await reply
      .header('content-type', DOCX_TYPE)
      .header('content-disposition', `attachment; filename="${docx.fileName}"`)
      .header('cache-control', 'private, no-store')
      .send(Buffer.from(docx.bytes));
  }
}

/** Wydruki z kart obiektów (ADR 0068): `documents.generate` i uprawnienie odczytu rodzaju sprawdza serwis. */
@ApiTags('panel: wydruki')
@Controller('admin/documents')
export class AdminDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermission('documents.generate')
  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary:
      '„Drukuj” (202, zadanie document.generate): rodzaj, obiekt, szablon (domyślny bez templateId), format, parametry z katalogu; FORBIDDEN bez uprawnienia odczytu rodzaju, DOCUMENT_PARAM_INVALID 400, DOCUMENT_TYPE_NOT_PRINTABLE 422, TEMPLATE_NOT_ACTIVE 409; wynik w document.ready (pokój staff:{id}) albo GET /admin/documents/{id}',
  })
  print(@CurrentStaff() staff: StaffPrincipal, @Body(new ZodPipe(documentGenerateSchema)) body: DocumentGenerate) {
    return this.documents.print(staff.staffId, body);
  }

  @RequirePermission('documents.generate')
  @Get(':id')
  @ApiOperation({
    summary: 'Stan wydruku z adresami plików (podpis 10 min); zapas dla document.ready, odpytywanie co 2 s',
  })
  details(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.documents.staffDocument(staff.staffId, id);
  }

  @RequirePermission('documents.generate')
  @Post(':id/retry')
  @HttpCode(202)
  @ApiOperation({
    summary:
      '„Spróbuj ponownie” (błąd) albo „Wygeneruj ponownie” (pliki usunięte): nowy wiersz z retry_of z bieżących danych i aktywnej wersji; 409 DOCUMENT_NOT_RETRYABLE',
  })
  retry(@CurrentStaff() staff: StaffPrincipal, @Param('id', idParam) id: string) {
    return this.documents.retry(staff.staffId, id);
  }
}

/** Zasób `generated-documents` (tylko do odczytu): rodzaje z uprawnieniem odczytu, klient tylko z `users.read`. */
@ApiTags('panel: wydruki')
@Controller('admin/generated-documents')
export class GeneratedDocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly exporter: ListExportService,
  ) {}

  @RequirePermission('documents.generate')
  @Get()
  @ApiOperation({
    summary:
      'Wygenerowane dokumenty według wzorca listy (liczniki stanów, filtry rodzaju, stanu, formatu i zlecającego); q z 8 znaków szuka identyfikatora ze stopki',
  })
  list(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(generatedDocumentsResource)) query: ListQuery) {
    return this.documents.list(staff.staffId, query);
  }

  @RequirePermission('documents.generate')
  @ListExport('wygenerowane dokumenty')
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Body(listExportBody) body: ListExportRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.exporter.list(reply, staff.staffId, generatedDocumentsResource, body, (db, query) =>
      this.documents.list(staff.staffId, query, db),
    );
  }
}

/** Paragon PDF klienta (ADR 0068, pytanie 2). */
@ApiTags('aplikacja: dokumenty')
@Controller('me')
export class CustomerDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @CustomerAuth()
  @Post('receipts/:id/pdf')
  @ApiOperation({
    summary:
      'PDF własnego paragonu albo korekty: 200 z gotowym albo trwającym wydrukiem tej wersji szablonu, 202 z nowym zadaniem; wynik w document.ready (pokój user:{id}) albo GET /me/documents/{id}',
  })
  async receiptPdf(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Param('id', idParam) id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.documents.customerReceiptPdf(customer.userId, id);
    void reply.status(result.created ? 202 : 200);
    return result.view;
  }

  @CustomerAuth()
  @Get('documents/:id')
  @ApiOperation({
    summary: 'Stan własnego wydruku i adres PDF z podpisem na 10 min (aplikacja pyta co 2 s bez Socket.IO)',
  })
  document(@CurrentCustomer() customer: CustomerPrincipal, @Param('id', idParam) id: string) {
    return this.documents.customerDocument(customer.userId, id);
  }
}
