import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { buildOpenApiDocument, serializeOpenApi } from '../src/openapi.js';

describe('kontrakt OpenAPI', () => {
  it('docs/kontrakty/openapi.json odpowiada kontrolerom (po zmianie API: pnpm api:openapi)', async () => {
    const app = await createApp(loadConfig({ NODE_ENV: 'test', MQTT_ENABLED: 'false', JOBS_ENABLED: 'false' }), { logger: false });
    const generated = serializeOpenApi(buildOpenApiDocument(app));
    await app.close();
    const committed = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'kontrakty', 'openapi.json'), 'utf8');
    expect(committed).toBe(generated);
    const paths = Object.keys(JSON.parse(generated).paths as object);
    expect(paths).toEqual(expect.arrayContaining(['/auth/otp', '/auth/otp/verify', '/me', '/legal/{slug}', '/admin/auth/login']));
  });
});
