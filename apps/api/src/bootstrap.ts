import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import type { AppConfig } from './config.js';
import { buildOpenApiDocument } from './openapi.js';

export async function createApp(
  config: AppConfig,
  options: { logger?: boolean } = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter({ logger: options.logger ?? false }),
    // Surowa treść żądania do weryfikacji podpisu webhooka operatora płatności (ADR 0050).
    { logger: options.logger === false ? false : undefined, rawBody: true },
  );
  await app.register(fastifyCookie);
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  // Panel działa na innym porcie niż API; w trybie deweloperskim dopuszczamy każdy localhost.
  const origins = config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: config.NODE_ENV === 'production' ? origins : [...origins, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    // Ciasteczko sesji panelu (ADR 0035) wymaga poświadczeń w żądaniach z innego portu.
    credentials: true,
    allowedHeaders: ['content-type', 'authorization'],
  });

  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app));
  return app;
}
