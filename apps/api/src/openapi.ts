import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Kontrakt REST API (OpenAPI) budowany z kontrolerów. Ten sam dokument serwuje `/docs` i zapisuje
 * `pnpm api:openapi` do docs/kontrakty/openapi.json; test API pilnuje, żeby plik był aktualny.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('System wypożyczania hulajnóg: API')
    .setDescription(
      'REST API dla aplikacji mobilnej i panelu operatora. Błędy: { code, message, details }. ' +
        'Uwierzytelnianie: token dostępowy w nagłówku Authorization (ADR 0035).',
    )
    .setVersion('0.4.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Dokument w stałej kolejności kluczy, żeby różnice w repozytorium pokazywały tylko zmiany API. */
export function serializeOpenApi(document: OpenAPIObject): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, sort(v)]),
          )
        : value;
  return `${JSON.stringify(sort(document), null, 2)}\n`;
}
