import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';
import { buildOpenApiDocument, serializeOpenApi } from './openapi.js';

// Zapis kontraktu bez uruchamiania serwera: aplikacja jest tworzona, ale nie łączy się z brokerem.
const app = await createApp(loadConfig({ NODE_ENV: 'test', MQTT_ENABLED: 'false' }), { logger: false });
const target = join(import.meta.dirname, '..', '..', '..', 'docs', 'kontrakty', 'openapi.json');
writeFileSync(target, serializeOpenApi(buildOpenApiDocument(app)));
await app.close();
console.log(`Zapisano ${target}`);
