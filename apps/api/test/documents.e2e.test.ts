import type * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryFileStorage } from '../src/files/file-storage.js';
import { FILE_STORAGE } from '../src/files/file-storage.js';
import { JOBS } from '../src/jobs/jobs.service.js';
import { documentContext, type DocumentContext } from './document-context.js';
import { docxText } from './document-helpers.js';

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('wydruki w procesach (ADR 0066, ADR 0068)', () => {
  let ctx: DocumentContext;
  let anna: { id: string; token: string };
  let rentalId: string;
  let saleId: string;
  let correctionId: string;
  let taskId: string;

  const docxOf = async (doc: shared.GeneratedDocumentView) => docxText(await ctx.download(doc.files.docx!.url));

  beforeAll(async () => {
    ctx = await documentContext('documents_api', 6);
    anna = await ctx.register('+48500700100', 'Anna Wydrukowa');

    // Przejazd z portfela: paragon sprzedaży przy zakończeniu (ADR 0052).
    rentalId = await ctx.ride(anna.token, 1);
    await ctx.endRide(anna.token, 1);
    saleId = (
      await ctx.pool.query<{ id: string }>(`SELECT id FROM receipts WHERE rental_id = $1 AND kind = 'SALE'`, [rentalId])
    ).rows[0]!.id;
    // Opłata za odholowanie jako pozycja poza VAT (ADR 0061) i korekta z częściowym zwrotem (dane testowe).
    await ctx.pool.query(
      `INSERT INTO receipt_items (receipt_id, line_no, description, quantity, unit_price, vat_rate, amount)
       SELECT $1, max(line_no) + 1, 'TOWING_FEE', 1, 5000, NULL, 5000 FROM receipt_items WHERE receipt_id = $1`,
      [saleId],
    );
    await ctx.pool.query(`UPDATE receipts SET total_amount = total_amount + 5000 WHERE id = $1`, [saleId]);
    correctionId = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO receipts (user_id, rental_id, buyer_name, buyer_phone, total_amount, kind, corrects_receipt_id,
                               payment_source, seller)
         SELECT user_id, rental_id, buyer_name, buyer_phone, -200, 'CORRECTION', id, payment_source, seller
         FROM receipts WHERE id = $1 RETURNING id`,
        [saleId],
      )
    ).rows[0]!.id;
    await ctx.pool.query(
      `INSERT INTO receipt_items (receipt_id, line_no, description, quantity, unit_price, vat_rate, amount)
       VALUES ($1, 1, 'REFUND', 1, -200, 23, -200)`,
      [correctionId],
    );

    // Zgłoszenie klienta → zadanie serwisowe z częścią → zakończenie (protokół serwisowy).
    const ticket = await ctx.customer(anna.token)({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId: await ctx.idOf(3), categories: ['BRAKES'], description: 'Nie hamuje' },
    });
    expect(ticket.statusCode).toBe(201);
    const created = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/service-tasks',
      payload: {
        scooterId: await ctx.idOf(3),
        ticketId: ticket.json<shared.CustomerTicketView>().id,
        type: 'REPAIR',
        priority: 'HIGH',
        assigneeId: ctx.staffIds.technician,
        description: 'Klocki',
      },
    });
    let task = created.json<shared.ServiceTaskDetails>();
    taskId = task.id;
    const command = (action: string, payload: object) =>
      ctx.staff.technician({ method: 'POST', url: `/admin/service-tasks/${taskId}/${action}`, payload });
    expect((await command('start', { version: task.version })).statusCode).toBe(201);
    const pad = (await ctx.pool.query<{ id: string }>(`SELECT id FROM spare_parts WHERE sku = 'BRK-PAD-R'`)).rows[0]!
      .id;
    task = (await command('parts', { partId: pad, quantity: 1 })).json();
    expect((await command('complete', { version: task.version, note: 'Wymieniono klocki' })).statusCode).toBe(201);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('paragon z korektą i opłatą poza VAT: DOCX i PDF, stopka z identyfikatorem, operatorem i wersją', async () => {
    const doc = await ctx.print(ctx.staff.dispatcher, {
      documentType: 'RECEIPT',
      entityId: correctionId,
      format: 'PDF',
    });
    expect(doc).toMatchObject({
      status: 'SUCCEEDED',
      state: 'SUCCEEDED',
      format: 'PDF',
      template: { name: 'Potwierdzenie sprzedaży', versionNo: 1 },
      requestedBy: { kind: 'staff', name: 'Dyspozytor Testowy' },
      errorCode: null,
    });
    expect(doc.entityLabel).toMatch(/^PAR\/\d{4}\/\d{6}$/);
    expect(doc.files.pdf!.fileName).toBe(`${doc.entityLabel.replace(/\//g, '-')}.pdf`);
    expect((await ctx.download(doc.files.pdf!.url)).subarray(0, 5).toString()).toBe('%PDF-');
    const text = await docxOf(doc);
    const sale = (await ctx.pool.query<{ number: string }>('SELECT number FROM receipts WHERE id = $1', [saleId]))
      .rows[0]!.number;
    expect(text).toContain(sale);
    expect(text).toContain('Anna Wydrukowa');
    expect(text).toContain('-2,00');
    const footer = docxText(await ctx.download(doc.files.docx!.url), 'word/footer1.xml');
    expect(footer).toContain(`Wydruk ${doc.id.replace(/-/g, '').slice(0, 8)}`);
    expect(footer).toContain('Potwierdzenie sprzedaży v1');
    expect(footer).toContain('Dyspozytor Testowy');
    expect(await ctx.auditOf(doc.id, 'generated_document.requested')).toHaveLength(1);

    const saleDoc = await ctx.print(ctx.staff.dispatcher, {
      documentType: 'RECEIPT',
      entityId: saleId,
      format: 'DOCX',
    });
    expect(saleDoc.files.pdf).toBeNull();
    const saleText = await docxOf(saleDoc);
    expect(saleText).toContain('Opłata za odholowanie');
    expect(saleText).toContain('np.');
    expect(ctx.ready).toHaveBeenCalledWith(
      { staffId: ctx.staffIds.dispatcher, userId: null },
      expect.objectContaining({ id: saleDoc.id, status: 'SUCCEEDED', files: { docx: expect.any(Object) } }),
    );
  });

  it('potwierdzenie przejazdu: numer, kwoty, miejsce jako strefa i współrzędne bez Photon, oś czasu z parametrem', async () => {
    const doc = await ctx.print(ctx.staff.dispatcher, {
      documentType: 'RENTAL_CONFIRMATION',
      entityId: rentalId,
      format: 'DOCX',
      params: { includeTimeline: true },
    });
    expect(doc.status).toBe('SUCCEEDED');
    expect(doc.entityLabel).toMatch(/^R-\d+$/);
    const text = await docxOf(doc);
    expect(text).toContain(doc.entityLabel);
    expect(text).toContain('P-01');
    expect(text).toContain('Odblokowano hulajnogę');
    expect(text).toContain('Anna Wydrukowa');
    const noTimeline = await ctx.print(ctx.staff.dispatcher, {
      documentType: 'RENTAL_CONFIRMATION',
      entityId: rentalId,
      format: 'DOCX',
      params: { includeTimeline: false },
    });
    expect(await docxOf(noTimeline)).not.toContain('Odblokowano hulajnogę');
    const invalid = await ctx.staff.dispatcher({
      method: 'POST',
      url: '/admin/documents',
      payload: { documentType: 'RENTAL_CONFIRMATION', entityId: rentalId, params: { historyDays: 30 } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'DOCUMENT_PARAM_INVALID', details: { param: 'historyDays' } });
  });

  it('protokół serwisowy: Serwisant drukuje, a bez users.read zgłaszający jest „Klientem”', async () => {
    const technician = await ctx.print(ctx.staff.technician, {
      documentType: 'SERVICE_PROTOCOL',
      entityId: taskId,
      format: 'PDF',
    });
    expect(technician.status).toBe('SUCCEEDED');
    expect(technician.entityLabel).toMatch(/^S-\d+$/);
    const masked = await docxOf(technician);
    expect(masked).toContain('Wymieniono klocki');
    expect(masked).toContain('BRK-PAD-R');
    expect(masked).not.toContain('Anna Wydrukowa');
    expect(masked).toContain('Klient');
    expect(masked).toContain('Serwisant Testowy');

    const dispatcher = await ctx.print(ctx.staff.dispatcher, {
      documentType: 'SERVICE_PROTOCOL',
      entityId: taskId,
      format: 'DOCX',
    });
    expect(await docxOf(dispatcher)).toContain('Anna Wydrukowa');
  });

  it('Serwisant nie pobiera wydruku Dyspozytora z danymi klienta (maskowanie wypalone w pliku)', async () => {
    const withCustomer = await ctx.print(ctx.staff.dispatcher, {
      documentType: 'SERVICE_PROTOCOL',
      entityId: taskId,
      format: 'DOCX',
    });
    expect(withCustomer.customerDataVisible).toBe(true);
    expect(await docxOf(withCustomer)).toContain('Anna Wydrukowa');
    const masked = await ctx.print(ctx.staff.technician, {
      documentType: 'SERVICE_PROTOCOL',
      entityId: taskId,
      format: 'DOCX',
    });
    expect(masked.customerDataVisible).toBe(false);

    // Szczegóły (z adresami plików) i ponowienie wydruku z danymi klienta: bez users.read 404.
    expect((await ctx.staff.technician({ method: 'GET', url: `/admin/documents/${withCustomer.id}` })).statusCode).toBe(
      404,
    );
    expect(
      (await ctx.staff.technician({ method: 'POST', url: `/admin/documents/${withCustomer.id}/retry` })).statusCode,
    ).toBe(404);
    // Na liście wiersz zostaje z flagą (panel nie pokazuje „Pobierz”), własny zamaskowany wydruk się pobiera.
    const list = (
      await ctx.staff.technician({ method: 'GET', url: '/admin/generated-documents', query: { pageSize: '100' } })
    ).json<shared.ListResponse<shared.GeneratedDocumentListItem>>();
    expect(list.items.find((item) => item.id === withCustomer.id)).toMatchObject({
      customerDataVisible: true,
      userName: null,
    });
    expect(list.items.find((item) => item.id === masked.id)).toMatchObject({ customerDataVisible: false });
    const own = (
      await ctx.staff.technician({ method: 'GET', url: `/admin/documents/${masked.id}` })
    ).json<shared.GeneratedDocumentView>();
    expect(await docxOf(own)).not.toContain('Anna Wydrukowa');
    // Dyspozytor (users.read) pobiera zamaskowany wydruk Serwisanta.
    expect((await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${masked.id}` })).statusCode).toBe(200);
  });

  it('restart API w trakcie wydruku: ponowienie przejmuje RUNNING po 120 s, sprzątanie kończy porzucony', async () => {
    const queue = async () => {
      const res = await ctx.staff.dispatcher({
        method: 'POST',
        url: '/admin/documents',
        payload: { documentType: 'RENTAL_CONFIRMATION', entityId: rentalId, format: 'PDF' },
      });
      expect(res.statusCode).toBe(202);
      return res.json<shared.GeneratedDocumentView>().id;
    };
    // Zadanie przerwane restartem: wiersz RUNNING od 3 min, ponowienie pg-boss przejmuje go i kończy wydruk.
    const taken = await queue();
    await ctx.pool.query(
      `UPDATE generated_documents SET status = 'RUNNING', started_at = now() - interval '3 minutes' WHERE id = $1`,
      [taken],
    );
    await ctx.runDocumentJobs();
    const done = await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${taken}` });
    expect(done.json()).toMatchObject({ status: 'SUCCEEDED', files: { pdf: expect.any(Object) } });
    // Świeży RUNNING (inny proces jeszcze pracuje) nie jest przejmowany.
    const busy = await queue();
    await ctx.pool.query(`UPDATE generated_documents SET status = 'RUNNING', started_at = now() WHERE id = $1`, [busy]);
    await ctx.runDocumentJobs();
    expect((await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${busy}` })).json().status).toBe(
      'RUNNING',
    );
    // Bez ponowień zostaje RUNNING: po 15 min `documents.sweep` kończy go jako RENDER_TIMEOUT z `document.ready`.
    await ctx.pool.query(`UPDATE generated_documents SET started_at = now() - interval '20 minutes' WHERE id = $1`, [
      busy,
    ]);
    const stale = await queue();
    await ctx.pool.query(`UPDATE generated_documents SET created_at = now() - interval '20 minutes' WHERE id = $1`, [
      stale,
    ]);
    ctx.ready.mockClear();
    await ctx.jobs().run(JOBS.documentsSweep);
    for (const id of [busy, stale]) {
      expect((await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${id}` })).json()).toMatchObject({
        status: 'FAILED',
        errorCode: 'RENDER_TIMEOUT',
        finishedAt: expect.any(String),
      });
      expect(ctx.ready).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id, status: 'FAILED', errorCode: 'RENDER_TIMEOUT' }),
      );
    }
    // Porzucony wydruk można ponowić; zadanie spóźnione po sprzątaniu niczego nie zmienia.
    await ctx.runDocumentJobs();
    expect((await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${stale}` })).json().status).toBe(
      'FAILED',
    );
    expect((await ctx.staff.dispatcher({ method: 'POST', url: `/admin/documents/${busy}/retry` })).statusCode).toBe(
      202,
    );
    await ctx.runDocumentJobs();
  });

  it('karta hulajnogi z okresem historii i naklejka z kodem QR bez szablonu', async () => {
    const card = await ctx.print(ctx.staff.technician, {
      documentType: 'SCOOTER_CARD',
      entityId: await ctx.idOf(3),
      format: 'DOCX',
      params: { historyDays: 30 },
    });
    expect(card.entityLabel).toBe('#0003');
    const text = await docxOf(card);
    expect(text).toContain('/h/0003');
    expect(text).toContain('30 dni');
    expect(text).toContain('Naprawa');

    const label = await ctx.print(ctx.staff.technician, {
      documentType: 'SCOOTER_LABEL',
      entityId: await ctx.idOf(3),
      format: 'PDF',
      params: { layout: 'a4x6' },
    });
    expect(label).toMatchObject({ status: 'SUCCEEDED', template: null, files: { docx: null } });
    expect(label.files.pdf!.fileName).toBe('0003-naklejka.pdf');
    const html = ctx.renderer.calls.findLast((c) => c.trace === label.id)!.html!;
    expect(html).toContain('size: 210mm 297mm');
    expect(html.match(/class="label"/g)).toHaveLength(6);
    expect(html).toContain('<svg');
    expect(html).toContain('Zeskanuj w aplikacji albo aparatem');
    const docx = await ctx.staff.technician({
      method: 'POST',
      url: '/admin/documents',
      payload: { documentType: 'SCOOTER_LABEL', entityId: await ctx.idOf(3), format: 'DOCX' },
    });
    expect(docx.statusCode).toBe(422);
    expect(docx.json().code).toBe('DOCUMENT_FORMAT_NOT_ALLOWED');
  });

  it('uprawnienia: Redaktor nie drukuje, Serwisant nie drukuje paragonu i nie widzi go na liście', async () => {
    const editor = await ctx.editor({
      method: 'POST',
      url: '/admin/documents',
      payload: { documentType: 'SERVICE_PROTOCOL', entityId: taskId },
    });
    expect(editor.statusCode).toBe(403);
    const receipt = await ctx.staff.technician({
      method: 'POST',
      url: '/admin/documents',
      payload: { documentType: 'RECEIPT', entityId: saleId },
    });
    expect(receipt.statusCode).toBe(403);
    expect(receipt.json()).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'payments.read' } });

    const all = (
      await ctx.staff.dispatcher({ method: 'GET', url: '/admin/generated-documents?facets=state,documentType' })
    ).json<shared.ListResponse<shared.GeneratedDocumentListItem>>();
    expect(all.items.some((d) => d.documentType === 'RECEIPT')).toBe(true);
    const mine = (await ctx.staff.technician({ method: 'GET', url: '/admin/generated-documents' })).json<
      shared.ListResponse<shared.GeneratedDocumentListItem>
    >();
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((d) => d.documentType !== 'RECEIPT')).toBe(true);
    const short = all.items[0]!.id.replace(/-/g, '').slice(0, 8);
    const found = (await ctx.staff.dispatcher({ method: 'GET', url: `/admin/generated-documents?q=${short}` })).json<
      shared.ListResponse<shared.GeneratedDocumentListItem>
    >();
    expect(found.items.map((d) => d.id)).toEqual([all.items[0]!.id]);
    expect((await ctx.editor({ method: 'GET', url: '/admin/generated-documents' })).statusCode).toBe(403);
    const foreign = await ctx.staff.technician({
      method: 'GET',
      url: `/admin/documents/${all.items.find((d) => d.documentType === 'RECEIPT')!.id}`,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('błąd PDF zostawia DOCX, „Spróbuj ponownie” tworzy nowy wiersz; niedostępny silnik wraca do kolejki', async () => {
    ctx.renderer.failNext({ kind: 'timeout' });
    const failed = await ctx.print(ctx.staff.dispatcher, {
      documentType: 'RENTAL_CONFIRMATION',
      entityId: rentalId,
      format: 'PDF',
    });
    expect(failed).toMatchObject({ status: 'FAILED', state: 'FAILED', errorCode: 'RENDER_TIMEOUT' });
    expect(failed.files.docx).not.toBeNull();
    expect(failed.files.pdf).toBeNull();
    expect(ctx.ready).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: failed.id, status: 'FAILED', errorCode: 'RENDER_TIMEOUT' }),
    );

    const retry = await ctx.staff.dispatcher({ method: 'POST', url: `/admin/documents/${failed.id}/retry` });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ retryOf: failed.id, status: 'QUEUED' });
    ctx.renderer.failNext({ kind: 'network' });
    await expect(ctx.runDocumentJobs({ retryCount: 0, retryLimit: 2 })).rejects.toMatchObject({
      code: 'RENDERER_UNAVAILABLE',
    });
    const retried = retry.json<shared.GeneratedDocumentView>().id;
    expect((await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${retried}` })).json().status).toBe(
      'QUEUED',
    );
    await ctx.jobs().run(JOBS.documentGenerate, { documentId: retried }, { retryCount: 1, retryLimit: 2 });
    const after = (await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${retried}` })).json();
    expect(after).toMatchObject({ status: 'SUCCEEDED', files: { docx: expect.any(Object), pdf: expect.any(Object) } });
    const again = await ctx.staff.dispatcher({ method: 'POST', url: `/admin/documents/${retried}/retry` });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('DOCUMENT_NOT_RETRYABLE');
  });

  it('paragon PDF klienta: jedno zadanie, ponowne użycie gotowego pliku, cudzy paragon 404', async () => {
    const customer = ctx.customer(anna.token);
    const first = await customer({ method: 'POST', url: `/me/receipts/${saleId}/pdf` });
    expect(first.statusCode).toBe(202);
    const id = first.json<shared.CustomerDocumentView>().id;
    const second = await customer({ method: 'POST', url: `/me/receipts/${saleId}/pdf` });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id, status: 'QUEUED', file: null });
    await ctx.runDocumentJobs();
    expect(ctx.ready).toHaveBeenLastCalledWith({ staffId: null, userId: anna.id }, expect.objectContaining({ id }));
    const ready = await customer({ method: 'POST', url: `/me/receipts/${saleId}/pdf` });
    expect(ready.statusCode).toBe(200);
    const view = ready.json<shared.CustomerDocumentView>();
    expect(view).toMatchObject({
      id,
      status: 'SUCCEEDED',
      file: { fileName: expect.stringMatching(/^PAR-\d{4}-\d{6}\.pdf$/) },
    });
    const pdf = await ctx.app.inject({ method: 'GET', url: view.file!.url });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('inline; filename="PAR-');
    // Wydruk klienta ma w stopce „aplikacja” i nie ma linii podpisu.
    const doc = (
      await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${id}` })
    ).json<shared.GeneratedDocumentView>();
    expect(doc.requestedBy).toEqual({ kind: 'customer' });
    const footer = docxText(await ctx.download(doc.files.docx!.url), 'word/footer1.xml');
    expect(footer).toContain('aplikacja');
    expect(docxText(await ctx.download(doc.files.docx!.url))).not.toContain('Podpis');
    expect((await customer({ method: 'GET', url: `/me/documents/${id}` })).json()).toMatchObject({
      id,
      status: 'SUCCEEDED',
    });

    const other = await ctx.register('+48500700200', 'Bogdan Obcy');
    expect((await ctx.customer(other.token)({ method: 'POST', url: `/me/receipts/${saleId}/pdf` })).statusCode).toBe(
      404,
    );
    expect((await ctx.customer(other.token)({ method: 'GET', url: `/me/documents/${id}` })).statusCode).toBe(404);
  });

  it('retencja: po 30 dniach pliki znikają z magazynu, wiersz zostaje (DELETED), a paragon klienta powstaje od nowa', async () => {
    const docs = (
      await ctx.pool.query<{ id: string; docx_file_id: string | null }>(
        `UPDATE generated_documents SET finished_at = now() - interval '31 days', started_at = now() - interval '31 days',
                created_at = now() - interval '31 days'
         WHERE status = 'SUCCEEDED' RETURNING id, docx_file_id`,
      )
    ).rows;
    const storage = ctx.app.get<MemoryFileStorage>(FILE_STORAGE);
    const objects = storage.objects.size;
    await ctx.jobs().run(JOBS.documentsRetention);
    const rows = (
      await ctx.pool.query<{ files_deleted_at: Date | null; status: string }>(
        `SELECT g.files_deleted_at, f.status::text AS status FROM generated_documents g
         JOIN files f ON f.id = g.docx_file_id WHERE g.id = ANY($1::uuid[])`,
        [docs.map((d) => d.id)],
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.files_deleted_at !== null && r.status === 'DELETED')).toBe(true);
    expect(storage.objects.size).toBeLessThan(objects);
    const deleted = (
      await ctx.staff.dispatcher({ method: 'GET', url: '/admin/generated-documents?state=DELETED' })
    ).json<shared.ListResponse<shared.GeneratedDocumentListItem>>();
    expect(deleted.total).toBe(docs.length);
    const one = (await ctx.staff.dispatcher({ method: 'GET', url: `/admin/documents/${docs[0]!.id}` })).json();
    expect(one).toMatchObject({ state: 'DELETED', files: { docx: null, pdf: null } });

    const fresh = await ctx.customer(anna.token)({ method: 'POST', url: `/me/receipts/${saleId}/pdf` });
    expect(fresh.statusCode).toBe(202);
    // „Wygeneruj ponownie” wydruku z usuniętymi plikami: nowy wiersz z bieżących danych.
    const regen = await ctx.staff.dispatcher({ method: 'POST', url: `/admin/documents/${docs[0]!.id}/retry` });
    expect(regen.statusCode).toBe(202);
    expect(regen.json()).toMatchObject({ retryOf: docs[0]!.id });
  });
});
