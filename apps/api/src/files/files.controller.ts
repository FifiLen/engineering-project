import '@fastify/multipart';
import {
  FILE_CONTENT_TYPES,
  FILE_MAX_BYTES,
  fileSignatureQuerySchema,
  fileUploadFieldsSchema,
  UPLOAD_FILE_PURPOSES,
  filesResource,
  type FileSignatureQuery,
  type FileView,
  type ListQuery,
} from '@hulajnogi/shared';
import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CurrentPrincipal,
  CurrentStaff,
  CustomerOrStaffAuth,
  Public,
  StaffAuth,
  type Principal,
  type StaffPrincipal,
} from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { ListQueryPipe } from '../common/list-query.pipe.js';
import { ZodPipe } from '../common/zod-query.js';
import { FilesService } from './files.service.js';

/** Limity parsera `multipart/form-data` (rejestracja w `bootstrap.ts`): jeden plik, pole `purpose`. */
export const MULTIPART_LIMITS = { fileSize: FILE_MAX_BYTES, files: 1, fields: 4, fieldSize: 1024, parts: 6 };

/** Pliki (ADR 0057): wysyłka z aplikacji i panelu, odczyt po podpisanym adresie z widoku rekordu. */
@ApiTags('pliki')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @CustomerOrStaffAuth()
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['purpose', 'file'],
      properties: {
        purpose: { type: 'string', enum: [...UPLOAD_FILE_PURPOSES] },
        file: { type: 'string', format: 'binary', description: `${FILE_CONTENT_TYPES.join(', ')}; najwyżej 10 MB` },
      },
    },
  })
  @ApiOperation({
    summary:
      'Wysyłka zdjęcia (201): klient albo operator z uprawnieniem do celu; typ po sygnaturze (JPEG, PNG, WebP), limit 10 MB; FILE_TOO_LARGE (413), FILE_TYPE_NOT_ALLOWED (415)',
  })
  async upload(
    @CurrentPrincipal() principal: Principal,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<FileView> {
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
          fields[part.fieldname] = part.value;
        }
      }
    } catch (error) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', (error as Error).message);
    }
    const parsed = fileUploadFieldsSchema.safeParse(fields);
    if (!parsed.success || !file) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Nieprawidłowe parametry żądania',
        parsed.success ? [{ path: ['file'], message: 'Brak pliku' }] : parsed.error.issues,
      );
    }
    const view = await this.files.upload(principal, { purpose: parsed.data.purpose, ...file });
    void reply.status(201);
    return view;
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary:
      'Odczyt pliku po adresie z widoku przejazdu albo zgłoszenia (podpis HMAC ważny 10 min); FILE_SIGNATURE_INVALID (403), FILE_URL_EXPIRED (403), FILE_DELETED (410)',
  })
  async read(
    @Param('id', new ZodPipe(z.uuid())) id: string,
    @Query(new ZodPipe(fileSignatureQuerySchema)) query: FileSignatureQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const object = await this.files.read(id, query.exp, query.sig);
    void reply
      .header('content-type', object.contentType)
      .header('cache-control', 'private, max-age=600')
      .header('x-content-type-options', 'nosniff');
    if (object.sizeBytes !== null) void reply.header('content-length', String(object.sizeBytes));
    await reply.send(object.body);
  }
}

/** Zasób panelu `files` (ADR 0057): lista plików modułów, do których operator ma uprawnienie, i usunięcie nieużywanego. */
@ApiTags('panel: pliki')
@Controller('admin/files')
export class AdminFilesController {
  constructor(private readonly files: FilesService) {}

  // Uprawnienie modułu sprawdza serwis: `rentals.read` (zdjęcia parkowania) albo `tickets.read` (zdjęcia zgłoszeń).
  @StaffAuth()
  @Get()
  @ApiOperation({
    summary:
      'Pliki według wzorca listy, zawężone do celów z uprawnieniem modułu (rentals.read, tickets.read), z podpisanym adresem podglądu',
  })
  list(@CurrentStaff() staff: StaffPrincipal, @Query(new ListQueryPipe(filesResource)) query: ListQuery) {
    return this.files.list(staff.staffId, query);
  }

  @StaffAuth()
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Usunięcie nieprzypiętego pliku (409 FILE_ATTACHED) z uprawnieniem do celu jak przy wysyłce',
  })
  async remove(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ZodPipe(z.uuid())) id: string): Promise<void> {
    await this.files.remove(staff.staffId, id);
  }
}
