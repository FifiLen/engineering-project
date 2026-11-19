import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { vi } from 'vitest';
import { FleetGateway } from '../src/realtime/fleet.gateway.js';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext } from './operations-helpers.js';

/** Sekret odświeżania strony w testach (co najmniej 32 znaki jak w konfiguracji). */
export const REVALIDATE_SECRET = 'test-revalidate-secret-0123456789abcdef';

/** Atrapa Route Handlera strony `POST /api/revalidate` (ADR 0065): zapisuje wywołania, odpowiada kodem z `status`. */
export async function revalidateServer() {
  const calls: Array<{ authorization: string | undefined; body: unknown }> = [];
  const state = { status: 200 };
  const read = (request: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = '';
      request.on('data', (chunk: Buffer) => (data += chunk.toString()));
      request.on('end', () => resolve(data));
    });
  const server: Server = createServer((request, response) => {
    void read(request).then((body) => {
      calls.push({ authorization: request.headers.authorization, body: JSON.parse(body || 'null') });
      response.statusCode = state.status;
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/api/revalidate`,
    calls,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Treść `multipart/form-data` dla `app.inject` (pole `purpose` i jedno pole `file`). */
export function multipart(fields: Record<string, string>, file?: { data: Buffer; filename?: string; type?: string }) {
  const boundary = `----hulajnogi${randomUUID()}`;
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
  );
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename ?? 'grafika.png'}"\r\n` +
          `Content-Type: ${file.type ?? 'image/png'}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** PNG o zadanych wymiarach: sygnatura i fragment `IHDR` (core czyta wymiary z nagłówka, bez dekodowania). */
export function png(width: number, height: number, padding = 64): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  return Buffer.concat([
    header,
    Buffer.from(
      randomUUID()
        .repeat(Math.ceil(padding / 36))
        .slice(0, padding),
    ),
  ]);
}

/**
 * Kontekst testów modułu Treści: baza z danymi startowymi (sekcje, FAQ, aktualności, dane firmy; bez grafik),
 * operatorzy Administrator, Dyspozytor, Serwisant i Redaktor, atrapa strony do `site.revalidate` i podgląd
 * `content.updated`.
 */
export async function contentContext(prefix: string, fleetSize = 2) {
  const site = await revalidateServer();
  const ctx = await operationsContext(prefix, fleetSize, {
    SITE_REVALIDATE_URL: site.url,
    SITE_REVALIDATE_SECRET: REVALIDATE_SECRET,
  });
  const editorId = (
    await ctx.pool.query<{ id: string }>(
      `INSERT INTO staff (email, name, password_hash) VALUES ('r@test.local', 'Redaktor Testowy', 'x') RETURNING id`,
    )
  ).rows[0]!.id;
  await ctx.pool.query(`INSERT INTO staff_roles (staff_id, role_id) SELECT $1, id FROM roles WHERE name = 'Redaktor'`, [
    editorId,
  ]);
  const editor = asStaff(ctx.app, staffToken(ctx.app, editorId));
  const events = vi.spyOn(ctx.app.get(FleetGateway), 'contentUpdated');
  const upload =
    (who: (options: InjectOptions) => ReturnType<NestFastifyApplication['inject']>) =>
    (purpose: string, file?: Parameters<typeof multipart>[1]) => {
      const body = multipart({ purpose }, file);
      return who({ method: 'POST', url: '/files', headers: body.headers, payload: body.payload });
    };
  return {
    ...ctx,
    site,
    editorId,
    editor,
    events,
    upload,
    async close() {
      await ctx.close();
      await site.close();
    },
  };
}

export type ContentContext = Awaited<ReturnType<typeof contentContext>>;
