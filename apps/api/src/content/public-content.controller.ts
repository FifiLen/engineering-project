import {
  contentClientParamSchema,
  legalVersionParamSchema,
  newsPageQuerySchema,
  newsSlugParamSchema,
  PUBLIC_CONTENT_CLIENTS,
  publicScooterNumberSchema,
  type NewsPageQuery,
  type PublicContent,
  type PublicContentClient,
} from '@hulajnogi/shared';
import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Public } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod-query.js';
import { MediaService } from './media.service.js';
import { contentEtag, PublicContentService } from './public-content.service.js';

/** Grafiki są niezmienne pod adresem z sumą SHA-256 (D3): rok w cache przeglądarki i `expo-image`. */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Przekierowanie ze starszej sumy na bieżący adres: krótko, bo adres zmienia „Zastąp plik”. */
export const MEDIA_REDIRECT_CACHE_CONTROL = 'public, max-age=300';

const slugParam = new ZodPipe(
  z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(100),
);

/** Strona i aplikacja (ADR 0062, ADR 0065): publiczne treści bez logowania, bez stanu floty. */
@ApiTags('treści')
@Public()
@Controller()
export class PublicContentController {
  constructor(private readonly content: PublicContentService) {}

  @Get('content/:client')
  @ApiOperation({
    summary:
      'Treści klienta (web albo mobile) jedną odpowiedzią z jednej migawki bazy: opublikowane sekcje z elementami, FAQ, dane firmy, grafiki systemowe, dla strony aktywne modele; ETag "content-{skrót treści}" (pole hash), If-None-Match daje 304',
  })
  @ApiOkResponse({ description: 'PublicContent' })
  @ApiParam({ name: 'client', enum: PUBLIC_CONTENT_CLIENTS })
  async get(
    @Param('client', new ZodPipe(contentClientParamSchema)) client: PublicContentClient,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicContent | undefined> {
    const content = await this.content.content(client);
    const etag = contentEtag(content.hash);
    void reply.header('ETag', etag).header('Cache-Control', 'no-cache');
    if (ifNoneMatch?.split(',').some((tag) => tag.trim() === etag)) {
      void reply.status(304);
      return undefined;
    }
    return content;
  }

  @Get('news')
  @ApiOperation({ summary: 'Opublikowane aktualności od najnowszej (bez zaplanowanych i wygasłych), po 12 na stronę' })
  news(@Query(new ZodPipe(newsPageQuerySchema)) query: NewsPageQuery) {
    return this.content.news(query);
  }

  @Get('news/:slug')
  @ApiOperation({ summary: 'Opublikowana aktualność; zaplanowana, wygasła albo nieznana daje 404' })
  article(@Param('slug', new ZodPipe(newsSlugParamSchema)) slug: string) {
    return this.content.article(slug);
  }

  @Get('legal/:slug/versions')
  @ApiOperation({ summary: 'Wersje dokumentu prawnego: obowiązująca i archiwalne z datą końca obowiązywania' })
  legalVersions(@Param('slug', slugParam) slug: string) {
    return this.content.legalVersions(slug);
  }

  @Get('legal/:slug/versions/:versionNo')
  @ApiOperation({ summary: 'Treść wersji opublikowanej albo archiwalnej (wersja robocza daje 404)' })
  legalVersion(
    @Param('slug', slugParam) slug: string,
    @Param('versionNo', new ZodPipe(legalVersionParamSchema)) versionNo: number,
  ) {
    return this.content.legalVersion(slug, versionNo);
  }

  @Get('public/scooters/:number')
  @ApiOperation({
    summary:
      'Strona /h/{numer}: numer i model ze zdjęciem; wycofana albo nieznana daje 404, bez dostępności, baterii i położenia',
  })
  scooter(@Param('number', new ZodPipe(publicScooterNumberSchema)) number: string) {
    return this.content.scooter(Number(number));
  }
}

/** Publiczny odczyt grafik biblioteki mediów (ADR 0064, zmienia ADR 0057 dla celu `MEDIA`). */
@ApiTags('treści')
@Public()
@Controller('media')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':id/:file')
  @ApiOperation({
    summary:
      'Grafika pod adresem /media/{id}/{sha256}.{ext}: Cache-Control immutable na rok i ETag z sumą; starsza suma daje 308 na bieżący adres, nieznana grafika 404',
  })
  async read(
    @Param('id') id: string,
    @Param('file') file: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const match = /^([^./]+)\.([a-z0-9]+)$/.exec(file);
    const parsedId = z.uuid().safeParse(id);
    if (!match || !parsedId.success) {
      await reply.status(404).send({ code: 'NOT_FOUND', message: 'Nie znaleziono grafiki' });
      return;
    }
    const result = await this.media.publicFile(parsedId.data, { sha256: match[1]!, ext: match[2]! });
    if (result.kind === 'redirect') {
      await reply
        .status(308)
        .header('location', result.location)
        .header('cache-control', MEDIA_REDIRECT_CACHE_CONTROL)
        .send();
      return;
    }
    const etag = `"${result.media.sha256}"`;
    void reply
      .header('cache-control', MEDIA_CACHE_CONTROL)
      .header('etag', etag)
      .header('x-content-type-options', 'nosniff');
    if (ifNoneMatch?.split(',').some((tag) => tag.trim() === etag)) {
      result.object.body.destroy();
      await reply.status(304).send();
      return;
    }
    void reply
      .header('content-type', result.media.contentType)
      .header('content-disposition', 'inline')
      .header('content-length', String(result.object.sizeBytes ?? result.media.sizeBytes));
    await reply.send(result.object.body);
  }
}
