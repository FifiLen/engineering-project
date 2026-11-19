import { LIST_EXPORT_CONCURRENCY, LIST_EXPORT_CONTENT_TYPES, LIST_EXPORT_LIMIT } from '@hulajnogi/core';
import { LIST_EXPORT_FORMATS, listExportRequestSchema } from '@hulajnogi/shared';
import { applyDecorators, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiProduces } from '@nestjs/swagger';
import { ZodPipe } from '../zod-query.js';

/** Treść żądania eksportu (ADR 0073): zapytanie listy, format i kolumny z etykietami z panelu. */
export const listExportBody = new ZodPipe(listExportRequestSchema);

const BODY_SCHEMA = {
  type: 'object',
  required: ['format', 'columns'],
  properties: {
    query: {
      type: 'object',
      description: 'Parametry listy jak w adresie GET (q, filtry, sort); page, pageSize i facets są pomijane',
      additionalProperties: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    },
    format: { type: 'string', enum: [...LIST_EXPORT_FORMATS] },
    columns: {
      type: 'array',
      minItems: 1,
      maxItems: 80,
      items: {
        type: 'object',
        required: ['field', 'label'],
        properties: {
          field: { type: 'string', description: 'Pole z definicji zasobu' },
          label: { type: 'string', maxLength: 80, description: 'Nagłówek kolumny z pl.json panelu' },
          values: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Teksty wartości pola enum (kod → etykieta)',
          },
        },
      },
    },
  },
} as const;

/**
 * `POST {lista}/export` (ADR 0073): plik XLSX albo CSV strumieniem z bieżącymi filtrami i sortowaniem listy. Uprawnienie
 * deklaruje kontroler (`@RequirePermission` jak przy `GET` listy), a odpowiedź wysyła `ListExportService`.
 */
export function ListExport(what: string, path = 'export') {
  return applyDecorators(
    Post(path),
    HttpCode(200),
    ApiOperation({
      summary: `Eksport listy (${what}) do XLSX albo CSV z filtrami i sortowaniem listy; powyżej ${LIST_EXPORT_LIMIT} wierszy 422 LIST_EXPORT_LIMIT, ponad ${LIST_EXPORT_CONCURRENCY} eksporty naraz 429 LIST_EXPORT_BUSY, kolumna spoza definicji 400 VALIDATION_FAILED, wpis list.exported`,
    }),
    ApiBody({ schema: BODY_SCHEMA as never }),
    ApiProduces(LIST_EXPORT_CONTENT_TYPES.xlsx, LIST_EXPORT_CONTENT_TYPES.csv),
    ApiOkResponse({
      description: 'Plik z nagłówkiem content-disposition: attachment; filename="{zasób}-{data}.{xlsx|csv}"',
    }),
  );
}
