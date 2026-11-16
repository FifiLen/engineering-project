import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import type { AppConfig } from './config.js';

export async function createApp(config: AppConfig, options: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config),
    new FastifyAdapter({ logger: options.logger ?? false }),
    { logger: options.logger === false ? false : undefined },
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

  const openApi = new DocumentBuilder()
    .setTitle('System wypożyczania hulajnóg: API')
    .setDescription('REST API dla aplikacji mobilnej i panelu operatora')
    .setVersion('0.2.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApi));
  return app;
}
