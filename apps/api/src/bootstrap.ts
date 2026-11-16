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
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  // Panel działa na innym porcie niż API; w trybie deweloperskim dopuszczamy każdy localhost.
  const origins = config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: config.NODE_ENV === 'production' ? origins : [...origins, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  const openApi = new DocumentBuilder()
    .setTitle('System wypożyczania hulajnóg: API')
    .setDescription('REST API dla aplikacji mobilnej i panelu operatora')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApi));
  return app;
}
