import type * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentTemplateDetails } from '../src/documents/templates.service.js';
import { documentContext, type DocumentContext } from './document-context.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('szablony wydruków: nazwa, opis i dezaktywacja (ADR 0076)', () => {
  let ctx: DocumentContext;
  const details = async (id: string) =>
    (await ctx.staff.admin({ method: 'GET', url: `/admin/document-templates/${id}` })).json<DocumentTemplateDetails>();
  const audits = async (entityId: string) =>
    (
      await ctx.pool.query<{ action: string; data: Record<string, unknown> }>(
        `SELECT action, data FROM audit_log WHERE entity_id = $1 ORDER BY id`,
        [entityId],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await documentContext('templates_edit_api', 2);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('zmiana nazwy i opisu z blokadą optymistyczną; zajęta nazwa w rodzaju to TEMPLATE_NAME_TAKEN', async () => {
    const created = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/document-templates',
      payload: { documentType: 'SERVICE_PROTOCOL', name: 'Protokół skrócony', description: null },
    });
    expect(created.statusCode).toBe(201);
    const template = created.json<DocumentTemplateDetails>();
    expect(template.version).toBe(1);
    const url = `/admin/document-templates/${template.id}`;

    expect((await ctx.editor({ method: 'PATCH', url, payload: { version: 1, name: 'Inna nazwa' } })).statusCode).toBe(
      403,
    );
    expect((await ctx.staff.admin({ method: 'PATCH', url, payload: { version: 1 } })).statusCode).toBe(400);
    const updated = await ctx.staff.admin({
      method: 'PATCH',
      url,
      payload: { version: 1, name: 'Protokół dla serwisu zewnętrznego', description: 'Bez cen części' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      name: 'Protokół dla serwisu zewnętrznego',
      description: 'Bez cen części',
      version: 2,
    });
    const stale = await ctx.staff.admin({ method: 'PATCH', url, payload: { version: 1, name: 'X' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT' });

    const starterName = (await details(ctx.templates.SERVICE_PROTOCOL)).name;
    const taken = await ctx.staff.admin({ method: 'PATCH', url, payload: { version: 2, name: starterName } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'TEMPLATE_NAME_TAKEN', details: { field: 'name' } });
    const duplicate = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/document-templates',
      payload: { documentType: 'SERVICE_PROTOCOL', name: starterName, description: null },
    });
    expect(duplicate.json()).toMatchObject({ code: 'TEMPLATE_NAME_TAKEN', details: { field: 'name' } });

    // Ten sam tekst niczego nie zmienia (bez nowej wersji rekordu i bez wpisu).
    const same = await ctx.staff.admin({
      method: 'PATCH',
      url,
      payload: { version: 2, description: 'Bez cen części' },
    });
    expect(same.json()).toMatchObject({ version: 2 });
    expect((await audits(template.id)).map((a) => [a.action, a.data])).toEqual([
      ['document_template.created', expect.any(Object)],
      [
        'document_template.updated',
        {
          documentType: 'SERVICE_PROTOCOL',
          changes: {
            name: ['Protokół skrócony', 'Protokół dla serwisu zewnętrznego'],
            description: [null, 'Bez cen części'],
          },
        },
      ],
    ]);
  });

  it('dezaktywacja: domyślny z aktywną wersją 409 TEMPLATE_IS_DEFAULT; nieaktywny znika z „Drukuj” i wraca bez roli domyślnego', async () => {
    const defaultId = ctx.templates.SERVICE_PROTOCOL;
    const blocked = await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${defaultId}/deactivate` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'TEMPLATE_IS_DEFAULT' });
    expect(
      (await ctx.editor({ method: 'POST', url: `/admin/document-templates/${defaultId}/deactivate` })).statusCode,
    ).toBe(403);

    const other = (
      await ctx.staff.admin({
        method: 'POST',
        url: '/admin/document-templates',
        payload: { documentType: 'RECEIPT', name: 'Paragon zapasowy', description: null },
      })
    ).json<DocumentTemplateDetails>();
    const off = await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${other.id}/deactivate` });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ active: false, isDefault: false });
    const listed = (await ctx.staff.admin({ method: 'GET', url: `/admin/document-templates?id=${other.id}` })).json<
      shared.ListResponse<shared.DocumentTemplateListItem>
    >();
    expect(listed.items[0]).toMatchObject({ active: false });
    // Ponowna dezaktywacja niczego nie zmienia.
    expect(
      (await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${other.id}/deactivate` })).statusCode,
    ).toBe(200);
    const on = await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${other.id}/reactivate` });
    expect(on.json()).toMatchObject({ active: true, isDefault: false });
    expect((await audits(other.id)).map((a) => [a.action, a.data.changes ?? null])).toEqual([
      ['document_template.created', null],
      ['document_template.deactivated', { active: [true, false] }],
      ['document_template.reactivated', { active: [false, true] }],
    ]);
    const missing = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/document-templates/00000000-0000-4000-8000-000000000000/deactivate',
    });
    expect(missing.statusCode).toBe(404);
  });
});
