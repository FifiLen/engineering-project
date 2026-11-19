import type * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentTemplateDetails } from '../src/documents/templates.service.js';
import { documentContext, uploadVersion, type DocumentContext } from './document-context.js';
import { lieAboutSize, modifyDocx, replaceInDocument, starterTemplate } from './document-helpers.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('szablony wydruków DOCX (ADR 0067)', () => {
  let ctx: DocumentContext;
  const details = async (id: string) =>
    (await ctx.staff.admin({ method: 'GET', url: `/admin/document-templates/${id}` })).json<DocumentTemplateDetails>();

  beforeAll(async () => {
    ctx = await documentContext('templates_api', 2);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('szablony startowe: lista z aktywną wersją 1 i domyślnym szablonem rodzaju, pola z katalogu w wersji', async () => {
    const list = (await ctx.editor({ method: 'GET', url: '/admin/document-templates?facets=documentType' })).json<
      shared.ListResponse<shared.DocumentTemplateListItem>
    >();
    expect(list.items).toHaveLength(4);
    expect(list.items.every((t) => t.isDefault && t.activeVersionNo === 1)).toBe(true);
    const protocol = await details(ctx.templates.SERVICE_PROTOCOL);
    expect(protocol.versions[0]).toMatchObject({ versionNo: 1, state: 'ACTIVE', createdByName: 'Admin Testowy' });
    expect(protocol.versions[0]!.fields).toEqual(expect.arrayContaining(['task.number', 'parts', 'parts[].cost']));
  });

  it('uprawnienia: templates.write tylko Administrator, Redaktor ogląda, Serwisant drukuje bez zmian szablonów', async () => {
    const payload = { documentType: 'INCIDENT_REPORT', name: 'Raport', description: null };
    for (const who of [ctx.editor, ctx.staff.dispatcher, ctx.staff.technician]) {
      const res = await who({ method: 'POST', url: '/admin/document-templates', payload });
      expect(res.statusCode).toBe(403);
    }
    expect(
      (await ctx.editor({ method: 'GET', url: `/admin/document-templates/${ctx.templates.RECEIPT}` })).statusCode,
    ).toBe(200);
    const upload = await uploadVersion(ctx.editor, ctx.templates.RECEIPT, starterTemplate('paragon.docx'));
    expect(upload.statusCode).toBe(403);
    // Naklejka nie ma szablonu (układ wbudowany): rodzaju nie ma w katalogu szablonów.
    const label = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/document-templates',
      payload: { documentType: 'SCOOTER_LABEL', name: 'Naklejka', description: null },
    });
    expect(label.statusCode).toBe(400);
  });

  it('nieznane pole: 422 TEMPLATE_INVALID z podpowiedzią, listą pól i miejscem; wersja nie powstaje', async () => {
    const before = (await details(ctx.templates.SERVICE_PROTOCOL)).versions.length;
    const broken = replaceInDocument(starterTemplate('protokol-serwisowy.docx'), '{unitPrice}', '{unitCost}');
    const res = await uploadVersion(ctx.staff.admin, ctx.templates.SERVICE_PROTOCOL, broken);
    expect(res.statusCode).toBe(422);
    const body = res.json<{ code: string; details: { issues: shared.TemplateIssueDetails[] } }>();
    expect(body.code).toBe('TEMPLATE_INVALID');
    expect(body.details.issues[0]).toMatchObject({
      code: 'TEMPLATE_UNKNOWN_FIELD',
      tag: '{unitCost}',
      suggestion: 'cost',
      loop: 'parts',
      place: { part: 'document', table: expect.any(Number), row: expect.any(Number), column: expect.any(Number) },
    });
    expect(body.details.issues[0]!.available).toEqual(['name', 'sku', 'quantity', 'unitPrice', 'cost']);
    expect((await details(ctx.templates.SERVICE_PROTOCOL)).versions).toHaveLength(before);
  });

  it('pętla bez zamknięcia, bomba ZIP i makra są odrzucane przed zapisem', async () => {
    const unclosed = replaceInDocument(starterTemplate('protokol-serwisowy.docx'), '{/parts}', '');
    const loop = await uploadVersion(ctx.staff.admin, ctx.templates.SERVICE_PROTOCOL, unclosed);
    expect(loop.statusCode).toBe(422);
    expect(loop.json().details.issues.map((i: { code: string }) => i.code)).toContain('TEMPLATE_LOOP_UNCLOSED');

    const lying = lieAboutSize(starterTemplate('paragon.docx'), 'word/document.xml', 64);
    const bomb = await uploadVersion(ctx.staff.admin, ctx.templates.RECEIPT, lying);
    expect(bomb.statusCode).toBe(413);
    expect(bomb.json().code).toBe('TEMPLATE_TOO_LARGE_UNPACKED');

    const vba = modifyDocx(starterTemplate('paragon.docx'), (zip) => zip.file('word/vbaProject.bin', Buffer.from('x')));
    const macros = await uploadVersion(ctx.staff.admin, ctx.templates.RECEIPT, vba);
    expect(macros.statusCode).toBe(415);
    expect(macros.json().code).toBe('TEMPLATE_MACROS');

    const notDocx = await uploadVersion(ctx.staff.admin, ctx.templates.RECEIPT, Buffer.from('%PDF-1.4 nie docx'));
    expect(notDocx.statusCode).toBe(415);
    expect(notDocx.json().code).toBe('TEMPLATE_NOT_DOCX');
  });

  it('wersja 2: „Do aktywacji”, podgląd PDF zapamiętany, aktywacja, przywrócenie v1 i usunięcie tylko PENDING', async () => {
    const id = ctx.templates.RENTAL_CONFIRMATION;
    const changed = replaceInDocument(
      starterTemplate('potwierdzenie-przejazdu.docx'),
      '{rental.number}',
      '{rental.number} ({rental.state})',
    );
    const uploaded = await uploadVersion(ctx.staff.admin, id, changed, 'Stan w nagłówku');
    expect(uploaded.statusCode).toBe(201);
    const v2 = uploaded.json<shared.DocumentTemplateVersionView>();
    expect(v2).toMatchObject({ versionNo: 2, state: 'PENDING', note: 'Stan w nagłówku', fileName: 'szablon.docx' });
    expect(v2.warnings.map((w) => w.field)).not.toContain('rental.state');

    const calls = ctx.renderer.calls.length;
    const preview = await ctx.editor({
      method: 'GET',
      url: `/admin/document-templates/${id}/versions/${v2.id}/preview.pdf`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('application/pdf');
    expect(preview.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(ctx.renderer.calls.at(-1)?.trace).toBe(`preview-${v2.id}`);
    await ctx.editor({ method: 'GET', url: `/admin/document-templates/${id}/versions/${v2.id}/preview.pdf` });
    expect(ctx.renderer.calls.length).toBe(calls + 1);

    const link = (
      await ctx.editor({ method: 'GET', url: `/admin/document-templates/${id}/versions/${v2.id}/file` })
    ).json<shared.DocumentFileLink>();
    expect(link.fileName).toBe('potwierdzenie-przejazdu-v2.docx');
    expect((await ctx.download(link.url)).subarray(0, 2).toString()).toBe('PK');

    let template = (
      await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${id}/versions/${v2.id}/activate` })
    ).json<DocumentTemplateDetails>();
    expect(template.activeVersionNo).toBe(2);
    expect(template.versions.map((v) => [v.versionNo, v.state])).toEqual([
      [2, 'ACTIVE'],
      [1, 'ARCHIVED'],
    ]);
    const v1 = template.versions[1]!;
    template = (
      await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${id}/versions/${v1.id}/activate` })
    ).json<DocumentTemplateDetails>();
    expect(template.versions.map((v) => [v.versionNo, v.state])).toEqual([
      [2, 'ARCHIVED'],
      [1, 'ACTIVE'],
    ]);
    const audit = await ctx.auditOf(id, 'document_template.version_restored');
    expect(audit).toHaveLength(1);

    const archived = await ctx.staff.admin({
      method: 'DELETE',
      url: `/admin/document-templates/${id}/versions/${v2.id}`,
    });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().code).toBe('TEMPLATE_VERSION_IN_USE');
    const pending = (
      await uploadVersion(ctx.staff.admin, id, starterTemplate('potwierdzenie-przejazdu.docx'))
    ).json<shared.DocumentTemplateVersionView>();
    expect(pending.versionNo).toBe(3);
    expect(
      (await ctx.staff.admin({ method: 'DELETE', url: `/admin/document-templates/${id}/versions/${pending.id}` }))
        .statusCode,
    ).toBe(204);
    expect((await details(id)).versions.map((v) => v.versionNo)).toEqual([2, 1]);
  });

  it('nowy szablon rodzaju bez szablonu startowego: bez wersji nie drukuje, domyślny wymaga aktywnej wersji', async () => {
    const created = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/document-templates',
      payload: { documentType: 'WALLET_ADJUSTMENT', name: 'Korekta salda', description: 'Potwierdzenie' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<DocumentTemplateDetails>().id;
    const noVersion = await ctx.staff.admin({ method: 'POST', url: `/admin/document-templates/${id}/default` });
    expect(noVersion.statusCode).toBe(409);
    expect(noVersion.json().code).toBe('TEMPLATE_NO_ACTIVE_VERSION');
    const duplicate = await ctx.staff.admin({
      method: 'POST',
      url: '/admin/document-templates',
      payload: { documentType: 'WALLET_ADJUSTMENT', name: 'Korekta salda', description: null },
    });
    expect(duplicate.statusCode).toBe(409);
    const types = (await ctx.staff.admin({ method: 'GET', url: '/admin/document-types' })).json<
      shared.DocumentTypeView[]
    >();
    expect(types.find((t) => t.documentType === 'WALLET_ADJUSTMENT')).toMatchObject({ printable: false });
    expect(types.find((t) => t.documentType === 'SCOOTER_LABEL')).toMatchObject({ printable: true, builtIn: true });
    expect(types.find((t) => t.documentType === 'SERVICE_PROTOCOL')).toMatchObject({ printable: true });
    // Serwisant nie ma `payments.read`, więc paragonu nie drukuje (i nie widzi rodzaju bez `templates.read`).
    const forTechnician = (await ctx.staff.technician({ method: 'GET', url: '/admin/document-types' })).json<
      shared.DocumentTypeView[]
    >();
    expect(forTechnician.find((t) => t.documentType === 'RECEIPT')).toMatchObject({ printable: false });
    expect(forTechnician.find((t) => t.documentType === 'SERVICE_PROTOCOL')).toMatchObject({ printable: true });
    const forEditor = (await ctx.editor({ method: 'GET', url: '/admin/document-types' })).json<
      shared.DocumentTypeView[]
    >();
    expect(forEditor.every((t) => !t.printable)).toBe(true);
  });

  it('lista pól: katalog z core i DOCX z szablonu systemowego', async () => {
    const fields = (
      await ctx.editor({ method: 'GET', url: '/admin/document-types/RECEIPT/fields' })
    ).json<shared.DocumentFieldCatalogView>();
    expect(fields.fields.find((f) => f.path === 'customer.name')).toMatchObject({ customer: true, type: 'text' });
    expect(fields.loops.map((l) => l.path)).toEqual(['items', 'vatGroups']);
    const docx = await ctx.editor({ method: 'GET', url: '/admin/document-types/RECEIPT/fields.docx' });
    expect(docx.statusCode).toBe(200);
    expect(docx.headers['content-disposition']).toContain('lista-pol-paragon.docx');
    expect(docx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await ctx.editor({ method: 'GET', url: '/admin/document-types/SCOOTER_LABEL/fields' })).statusCode).toBe(
      422,
    );
  });
});
