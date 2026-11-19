import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DocumentTemplateVersionView, GeneratedDocumentView, TemplateDocumentType } from '@hulajnogi/shared';
import type { InjectOptions } from 'fastify';
import { expect, vi } from 'vitest';
import { DOCUMENT_RENDERER, type FakeRenderer } from '../src/documents/renderers.js';
import type { DocumentTemplateDetails } from '../src/documents/templates.service.js';
import { JOBS } from '../src/jobs/jobs.service.js';
import { FleetGateway } from '../src/realtime/fleet.gateway.js';
import { multipart } from './content-helpers.js';
import { STARTER_TEMPLATES, starterTemplate } from './document-helpers.js';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext } from './operations-helpers.js';

type Inject = (options: InjectOptions) => ReturnType<NestFastifyApplication['inject']>;

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Wgranie wersji szablonu (`multipart/form-data` z polem `file` i notatką). */
export function uploadVersion(who: Inject, templateId: string, data: Buffer, note = 'Test') {
  const body = multipart({ note }, { data, filename: 'szablon.docx', type: DOCX_TYPE });
  return who({
    method: 'POST',
    url: `/admin/document-templates/${templateId}/versions`,
    headers: body.headers,
    payload: body.payload,
  });
}

/**
 * Kontekst testów wydruków (ADR 0066–0068): baza z danymi startowymi, atrapa silnika (DOCX naprawdę
 * z docxtemplater), magazyn w pamięci, Photon na nieużywanym porcie (adres początku i końca z zapasu: strefa
 * i współrzędne), operator Redaktor i szablony startowe wgrane przez API (wersja 1, aktywna, domyślna).
 */
export async function documentContext(prefix: string, fleetSize = 6) {
  const ctx = await operationsContext(prefix, fleetSize, {
    DOCUMENT_RENDERER: 'fake',
    PHOTON_URL: 'http://127.0.0.1:9',
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
  const renderer = ctx.app.get<FakeRenderer>(DOCUMENT_RENDERER);
  const ready = vi.spyOn(ctx.app.get(FleetGateway), 'documentReady');
  const templates = {} as Record<TemplateDocumentType, string>;

  for (const starter of STARTER_TEMPLATES) {
    const created = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/document-templates',
      payload: { documentType: starter.documentType, name: starter.name, description: null },
    });
    expect(created.statusCode).toBe(201);
    const templateId = created.json<DocumentTemplateDetails>().id;
    const version = await uploadVersion(ctx.staff.admin, templateId, starterTemplate(starter.file));
    expect(version.statusCode).toBe(201);
    const versionId = version.json<DocumentTemplateVersionView>().id;
    expect(
      (
        await ctx.staff.admin({
          method: 'POST',
          url: `/admin/document-templates/${templateId}/versions/${versionId}/activate`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${templateId}/default` })).statusCode,
    ).toBe(200);
    templates[starter.documentType] = templateId;
  }

  /** Zadania `document.generate` zaplanowane od ostatniego wywołania, wykonane po kolei. */
  let done = 0;
  async function runDocumentJobs(attempt?: { retryCount: number; retryLimit: number }): Promise<void> {
    const pending = ctx
      .jobs()
      .sent.slice(done)
      .filter((job) => job.name === JOBS.documentGenerate);
    done = ctx.jobs().sent.length;
    for (const job of pending) await ctx.jobs().run(JOBS.documentGenerate, job.data, attempt);
  }

  /** Zlecenie wydruku i wykonanie zadania; wynik po `GET /admin/documents/{id}`. */
  async function print(who: Inject, payload: Record<string, unknown>): Promise<GeneratedDocumentView> {
    const res = await who({ method: 'POST', url: '/admin/documents', payload });
    expect(res.statusCode, res.body).toBe(202);
    await runDocumentJobs();
    return (await who({ method: 'GET', url: `/admin/documents/${res.json<GeneratedDocumentView>().id}` })).json();
  }

  /** Bajty pliku po adresie z podpisem (jak klient po `url`). */
  async function download(url: string): Promise<Buffer> {
    const res = await ctx.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.rawPayload;
  }

  return { ...ctx, editorId, editor, renderer, ready, templates, runDocumentJobs, print, download };
}

export type DocumentContext = Awaited<ReturnType<typeof documentContext>>;
