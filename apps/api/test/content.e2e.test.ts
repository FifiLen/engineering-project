import * as core from '@hulajnogi/core';
import type { Database } from '@hulajnogi/db';
import * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompanyService } from '../src/content/company.service.js';
import { ContentPublisher } from '../src/content/content-publisher.service.js';
import { DB } from '../src/database/database.module.js';
import { JOBS } from '../src/jobs/jobs.service.js';
import { contentContext, REVALIDATE_SECRET, type ContentContext } from './content-helpers.js';

const adminUrl = process.env.DATABASE_URL;

/** Blok sekcji w kształcie żądania zapisu (bez pól tylko do odczytu). */
const input = (block: shared.ContentBlockView): shared.ContentBlockInput & { id: string } => ({
  id: block.id,
  title: block.title,
  bodyMd: block.bodyMd,
  mediaId: block.media?.id ?? null,
  buttonLabel: block.buttonLabel,
  buttonHref: block.buttonHref,
  icon: block.icon,
  status: block.status,
});

describe('zgodność wyliczeń core, shared i bazy (iteracja 7)', () => {
  it.each([
    ['CONTENT_STATUSES', shared.CONTENT_STATUSES, core.CONTENT_STATUSES],
    ['NEWS_STATES', shared.NEWS_STATES, core.NEWS_STATES],
    ['DOCUMENT_TYPES', shared.DOCUMENT_TYPES, core.DOCUMENT_TYPES],
    ['TEMPLATE_DOCUMENT_TYPES', shared.TEMPLATE_DOCUMENT_TYPES, core.TEMPLATE_DOCUMENT_TYPES],
    ['DOCUMENT_FORMATS', shared.DOCUMENT_FORMATS, core.DOCUMENT_FORMATS],
    ['JOB_STATUSES', shared.JOB_STATUSES, core.JOB_STATUSES],
    ['GENERATED_DOCUMENT_STATES', shared.GENERATED_DOCUMENT_STATES, core.GENERATED_DOCUMENT_STATES],
    ['TEMPLATE_VERSION_STATES', shared.TEMPLATE_VERSION_STATES, core.TEMPLATE_VERSION_STATES],
    ['STAFF_UPLOAD_FILE_PURPOSES', shared.STAFF_UPLOAD_FILE_PURPOSES, core.STAFF_UPLOAD_FILE_PURPOSES],
  ])('%s', (_name, fromShared, fromCore) => {
    expect([...fromShared]).toEqual([...fromCore]);
  });

  it('limity mediów, aktualności i FAQ, przedrostek kluczy systemowych', () => {
    expect([shared.MEDIA_MAX_BYTES, shared.MEDIA_MAX_DIMENSION, shared.MEDIA_WARN_DIMENSION]).toEqual([
      core.MEDIA_MAX_BYTES,
      core.MEDIA_MAX_DIMENSION,
      core.MEDIA_WARN_DIMENSION,
    ]);
    expect(shared.MEDIA_KEY_PATTERN.source).toBe(core.MEDIA_KEY_PATTERN.source);
    expect(shared.SYSTEM_MEDIA_KEY_PREFIX).toBe(core.SYSTEM_MEDIA_KEY_PREFIX);
    expect(shared.SYSTEM_MEDIA_KEYS.every(shared.isSystemMediaKey)).toBe(true);
    expect([shared.NEWS_TITLE_MAX, shared.NEWS_LEAD_MAX, shared.NEWS_BODY_MAX]).toEqual([
      core.NEWS_LIMITS.title,
      core.NEWS_LIMITS.lead,
      core.NEWS_LIMITS.body,
    ]);
    expect([shared.FAQ_QUESTION_MAX, shared.FAQ_ANSWER_MAX, shared.FAQ_CATEGORY_MAX]).toEqual([
      core.FAQ_LIMITS.question,
      core.FAQ_LIMITS.answer,
      core.FAQ_LIMITS.category,
    ]);
  });

  it('plik eksportu danych z core przechodzi ścisły schemat z shared', () => {
    const at = new Date('2026-11-18T10:00:00Z');
    const file = core.buildDataExport(
      {
        profile: {
          phone: '+48500100200',
          name: 'Anna',
          email: null,
          registeredAt: at,
          blocked: false,
          blockReason: null,
          blockedAt: null,
          preferences: { reservationEnd: true, receipts: true, marketing: false },
          devices: [{ platform: 'ios', createdAt: at, lastUsedAt: null }],
          sessions: [{ client: 'ios', createdAt: at, lastUsedAt: at, endedAt: null }],
        },
        consents: [{ type: 'TERMS', document: 'regulamin', versionNo: 1, acceptedAt: at, withdrawnAt: null }],
        rentals: [],
        wallet: { balance: 1000, entries: [{ at, kind: 'TOPUP', amount: 1000, balanceAfter: 1000, reference: null }] },
        payments: [],
        refunds: [],
        receipts: [],
        tickets: [],
        photos: [],
        notifications: [{ code: 'battery_low', title: 'Bateria', body: 'Niski poziom', sentAt: at, readAt: null }],
      },
      at,
    );
    expect(() => shared.dataExportSchema.parse(file)).not.toThrow();
  });
});

describe.skipIf(!adminUrl)('API: moduł Treści (ADR 0062, ADR 0063, ADR 0065)', () => {
  let ctx: ContentContext;

  beforeAll(async () => {
    ctx = await contentContext('content');
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const sentJobs = (name: string) => ctx.jobs().sent.filter((job) => job.name === name);

  it('rejestr sekcji, ikony, rodzaje dokumentów i stan aktualności są zgodne z bazą', async () => {
    const keys = await ctx.pool.query<{ key: string; client: string }>(
      `SELECT DISTINCT key, client::text AS client FROM content_blocks WHERE position = 0 ORDER BY key`,
    );
    // Każda sekcja rejestru ma nagłówek w danych startowych, a baza nie ma sekcji spoza rejestru.
    expect(keys.rows.map((r) => r.key).sort()).toEqual([...shared.CONTENT_SECTION_KEYS].sort());
    for (const row of keys.rows)
      expect(shared.contentSection(row.key as shared.ContentSectionKey).client).toBe(row.client);

    const icon = await ctx.pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'content_blocks_icon'`,
    );
    expect([...icon.rows[0]!.def.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])).toEqual([...shared.CONTENT_ICONS]);

    const enumValues = async (type: string) =>
      (
        await ctx.pool.query<{ v: string }>(
          `SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1
           ORDER BY e.enumsortorder`,
          [type],
        )
      ).rows.map((r) => r.v);
    expect(await enumValues('document_type')).toEqual([...shared.DOCUMENT_TYPES]);
    expect(await enumValues('document_format')).toEqual([...shared.DOCUMENT_FORMATS]);
    expect(await enumValues('file_purpose')).toEqual([...shared.FILE_PURPOSES]);
    expect(await enumValues('content_status')).toEqual([...shared.CONTENT_STATUSES]);

    const now = new Date('2026-11-18T12:00:00Z');
    const past = new Date('2026-11-01T00:00:00Z');
    const future = new Date('2026-12-01T00:00:00Z');
    const cases: Array<[core.ContentStatus, Date | null, Date | null]> = [
      ['DRAFT', null, null],
      ['ARCHIVED', past, future],
      ['PUBLISHED', null, null],
      ['PUBLISHED', past, null],
      ['PUBLISHED', future, null],
      ['PUBLISHED', past, future],
      ['PUBLISHED', past, now],
      ['PUBLISHED', now, null],
      ['PUBLISHED', past, past],
    ];
    for (const [status, from, to] of cases) {
      const { rows } = await ctx.pool.query<{ state: string }>(`SELECT fn_news_state($1, $2, $3, $4) AS state`, [
        status,
        from,
        to,
        now,
      ]);
      expect(rows[0]!.state).toBe(core.newsState({ status, publishFrom: from, publishTo: to }, now));
    }
  });

  it('limit eksportu danych w bazie jest ten sam co w core', async () => {
    const userId = (await ctx.register('+48512700001', 'Eksport Testowy')).id;
    const nextAllowed = async () =>
      (await ctx.pool.query<{ at: Date | null }>(`SELECT fn_data_export_next_allowed_at($1) AS at`, [userId])).rows[0]!
        .at;
    const requests = async () =>
      (
        await ctx.pool.query<{ requested_at: Date; status: core.DataExportRequest['status'] }>(
          `SELECT requested_at, status::text AS status FROM data_exports WHERE user_id = $1`,
          [userId],
        )
      ).rows.map((r) => ({ requestedAt: r.requested_at, status: r.status }));
    const now = async () => (await ctx.pool.query<{ now: Date }>('SELECT now() AS now')).rows[0]!.now;
    expect(await nextAllowed()).toBeNull();
    expect(core.dataExportNextAllowedAt(await requests(), await now())).toBeNull();

    await ctx.pool.query(
      `INSERT INTO data_exports (user_id, status, requested_at, finished_at, error_code)
       VALUES ($1, 'FAILED', now() - interval '1 hour', now(), 'RENDER_FAILED')`,
      [userId],
    );
    expect(await nextAllowed()).toBeNull();
    expect(core.dataExportNextAllowedAt(await requests(), await now())).toBeNull();

    await ctx.pool.query(`INSERT INTO data_exports (user_id, requested_at) VALUES ($1, now() - interval '2 hours')`, [
      userId,
    ]);
    const fromDb = await nextAllowed();
    const fromCore = core.dataExportNextAllowedAt(await requests(), await now());
    expect(fromDb).not.toBeNull();
    expect(fromCore?.toISOString()).toBe(fromDb!.toISOString());
    expect(fromDb!.getTime() - (await requests()).find((r) => r.status === 'QUEUED')!.requestedAt.getTime()).toBe(
      core.DATA_EXPORT_INTERVAL_MS,
    );
  });

  it('sekcje: lista z rejestru, edytor, kolejność, nowe i usunięte elementy, blokada wersji, historia', async () => {
    const list = (await ctx.editor({ method: 'GET', url: '/admin/content-sections' })).json<
      shared.ContentSectionSummary[]
    >();
    expect(list.map((s) => s.key)).toEqual([...shared.CONTENT_SECTION_KEYS]);
    expect(list.find((s) => s.key === 'mobile.rules')).toMatchObject({ kind: 'list', items: 5, itemsPublished: 4 });

    const url = '/admin/content-sections/mobile.rules';
    const section = (await ctx.editor({ method: 'GET', url })).json<shared.ContentSectionView>();
    expect(section.items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5]);
    const [first, second, third, fourth, draft] = section.items;

    ctx.events.mockClear();
    const revalidates = sentJobs(JOBS.siteRevalidate).length;
    // Zamiana kolejności, poprawka treści, nowy element i usunięty szkic jednym zapisem.
    const saved = await ctx.editor({
      method: 'PUT',
      url,
      payload: {
        version: section.header.version,
        header: input(section.header),
        items: [
          input(second!),
          { ...input(first!), title: 'Jedna osoba, zawsze' },
          input(third!),
          input(fourth!),
          { title: 'Telefon w uchwycie', bodyMd: 'Nie trzymaj telefonu w ręce.', icon: 'phone', status: 'DRAFT' },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    const after = saved.json<shared.ContentSectionView>();
    expect(after.header.version).toBe(section.header.version + 1);
    expect(after.items.map((i) => [i.position, i.title])).toEqual([
      [1, second!.title],
      [2, 'Jedna osoba, zawsze'],
      [3, third!.title],
      [4, fourth!.title],
      [5, 'Telefon w uchwycie'],
    ]);
    expect(after.items.some((i) => i.id === draft!.id)).toBe(false);
    // Zmiana aplikacji: `content.updated` po zatwierdzeniu, bez odświeżania strony.
    expect(ctx.events).toHaveBeenCalledWith(
      expect.objectContaining({ clients: ['MOBILE'], revision: expect.any(Number) }),
    );
    expect(sentJobs(JOBS.siteRevalidate)).toHaveLength(revalidates);

    // Ten sam stan nie tworzy wersji.
    const same = await ctx.editor({
      method: 'PUT',
      url,
      payload: { version: after.header.version, header: input(after.header), items: after.items.map(input) },
    });
    expect(same.json<shared.ContentSectionView>().header.version).toBe(after.header.version);

    const stale = await ctx.editor({
      method: 'PUT',
      url,
      payload: { version: section.header.version, header: input(after.header), items: after.items.map(input) },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT', details: { currentVersion: after.header.version } });

    // Opublikowanego elementu nie da się usunąć: trzeba go najpierw zarchiwizować.
    const removePublished = await ctx.editor({
      method: 'PUT',
      url,
      payload: { version: after.header.version, header: input(after.header), items: after.items.slice(1).map(input) },
    });
    expect(removePublished.statusCode).toBe(409);
    expect(removePublished.json()).toMatchObject({ code: 'CONTENT_DELETE_PUBLISHED' });

    // Limit elementów (3–6) i Markdown spoza profilu `inline` z wierszem i kolumną elementu.
    const extra = { title: 'X', bodyMd: 'Y', icon: 'map', status: 'DRAFT' };
    const tooMany = await ctx.editor({
      method: 'PUT',
      url,
      payload: {
        version: after.header.version,
        header: input(after.header),
        items: [...after.items.map(input), extra, extra],
      },
    });
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json()).toMatchObject({
      code: 'CONTENT_VALIDATION_FAILED',
      details: { issues: [{ item: null, field: 'items', code: 'CONTENT_ITEMS_LIMIT', max: 6, count: 7 }] },
    });
    const markdown = await ctx.editor({
      method: 'PUT',
      url,
      payload: {
        version: after.header.version,
        header: input(after.header),
        items: after.items.map((item, index) =>
          index === 2 ? { ...input(item), bodyMd: 'Pierwszy wiersz\n## Nagłówek', buttonLabel: 'Zobacz' } : input(item),
        ),
      },
    });
    expect(markdown.statusCode).toBe(422);
    expect(markdown.json<{ details: { issues: shared.ContentIssueView[] } }>().details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: 2,
          field: 'bodyMd',
          code: 'MD_NOT_ALLOWED',
          line: 2,
          column: 1,
          construct: 'heading',
        }),
        expect.objectContaining({ item: 2, field: 'button', code: 'CONTENT_FIELD_NOT_ALLOWED' }),
      ]),
    );

    // Historia: zapis sekcji z pełnym stanem i „Dane startowe” złożone z bloków seeda.
    const history = (await ctx.editor({ method: 'GET', url: `${url}/history` })).json<shared.ContentHistoryEntry[]>();
    expect(history[0]).toMatchObject({
      action: 'content_block.section_saved',
      staffName: 'Redaktor Testowy',
      versionFrom: section.header.version,
      versionTo: section.header.version + 1,
    });
    const seed = history.at(-1)!;
    expect(seed).toMatchObject({ system: true, action: 'content_block.created', versionFrom: null, versionTo: 1 });
    const seedState = seed.after as unknown as {
      header: { title: string };
      items: Array<{ id: string; title: string }>;
    };
    expect(seedState.items.map((i) => i.title)).toEqual(section.items.map((i) => i.title));

    // „Przywróć” dane startowe: elementy usunięte od tamtej pory wracają jako nowe (bez `id`).
    const current = new Set(after.items.map((i) => i.id));
    const restored = await ctx.editor({
      method: 'PUT',
      url,
      payload: {
        version: after.header.version,
        header: { ...input(after.header), title: seedState.header.title },
        items: seedState.items.map((item) => {
          // Pozycja ze stanu historii nie należy do żądania (kolejność to kolejność tablicy); schemat ją pomija.
          const { id, ...rest } = item as unknown as Record<string, unknown> & { id: string };
          return current.has(id) ? { id, ...rest } : rest;
        }),
        restoredFrom: seed.auditId,
      },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<shared.ContentSectionView>().items.map((i) => i.title)).toEqual(
      section.items.map((i) => i.title),
    );
    const restoredEntry = (await ctx.editor({ method: 'GET', url: `${url}/history` })).json<
      shared.ContentHistoryEntry[]
    >()[0]!;
    expect(restoredEntry).toMatchObject({ action: 'content_block.section_restored', restoredFrom: seed.auditId });
  });

  it('sekcja wymagana zostaje opublikowana, a zmiana strony planuje odświeżenie z sekretem', async () => {
    const start = (
      await ctx.editor({ method: 'GET', url: '/admin/content-sections/mobile.start' })
    ).json<shared.ContentSectionView>();
    const draft = await ctx.editor({
      method: 'PUT',
      url: '/admin/content-sections/mobile.start',
      payload: { version: start.header.version, header: { ...input(start.header), status: 'DRAFT' } },
    });
    expect(draft.statusCode).toBe(422);
    expect(draft.json()).toMatchObject({ code: 'CONTENT_SECTION_REQUIRED', details: { status: 'DRAFT' } });

    const url = '/admin/content-sections/web.pricing';
    const pricing = (await ctx.editor({ method: 'GET', url })).json<shared.ContentSectionView>();
    const before = sentJobs(JOBS.siteRevalidate).length;
    ctx.events.mockClear();
    const saved = await ctx.editor({
      method: 'PUT',
      url,
      payload: { version: pricing.header.version, header: { ...input(pricing.header), title: 'Płacisz za minuty.' } },
    });
    expect(saved.statusCode).toBe(200);
    const jobs = sentJobs(JOBS.siteRevalidate).slice(before);
    expect(jobs).toEqual([
      expect.objectContaining({
        data: { tag: 'content' },
        singletonKey: 'site:content',
        options: expect.objectContaining({ singletonSeconds: 5, retryLimit: 3 }),
      }),
    ]);
    expect(ctx.events).toHaveBeenCalledWith(expect.objectContaining({ clients: ['WEB'] }));

    // Zadanie woła Route Handler strony z sekretem i tagiem; błąd strony kończy zadanie błędem (ponowienie).
    await ctx.jobs().run(JOBS.siteRevalidate, { tag: 'content' });
    expect(ctx.site.calls.at(-1)).toEqual({
      authorization: `Bearer ${REVALIDATE_SECRET}`,
      body: { tags: ['content'] },
    });
    ctx.site.state.status = 503;
    await expect(ctx.app.get(ContentPublisher).revalidate('content')).rejects.toThrow('HTTP 503');
    ctx.site.state.status = 200;

    // Treść spoza schematów adresu przycisku daje 422 z polem.
    const steps = (
      await ctx.editor({ method: 'GET', url: '/admin/content-sections/web.notice' })
    ).json<shared.ContentSectionView>();
    const href = await ctx.editor({
      method: 'PUT',
      url: '/admin/content-sections/web.notice',
      payload: {
        version: steps.header.version,
        header: { ...input(steps.header), buttonLabel: 'Zobacz', buttonHref: 'javascript:alert(1)' },
      },
    });
    expect(href.statusCode).toBe(422);
    expect(href.json()).toMatchObject({
      details: { issues: [{ field: 'buttonHref', code: 'CONTENT_HREF_NOT_ALLOWED' }] },
    });
  });

  it('FAQ: nowa kategoria z pytania, przeniesienie, kolejność z wersjami, publikacja i usuwanie', async () => {
    const created = await ctx.editor({
      method: 'POST',
      url: '/admin/faq-items',
      payload: {
        category: 'Bezpieczeństwo',
        question: 'Czy muszę mieć kask?',
        answerMd: 'Nie, ale **warto**.',
        showInApp: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json<shared.FaqItemView>();
    expect(item).toMatchObject({
      categoryName: 'Bezpieczeństwo',
      status: 'DRAFT',
      sortOrder: 1,
      showOnWeb: true,
      showInApp: false,
    });
    const categories = (
      await ctx.editor({ method: 'GET', url: '/admin/faq-categories', query: { sort: 'sortOrder' } })
    ).json<shared.ListResponse<shared.FaqCategoryListItem>>().items;
    expect(categories.at(-1)).toMatchObject({ name: 'Bezpieczeństwo', items: 1 });

    // Ta sama nazwa inną wielkością liter trafia do istniejącej kategorii.
    const second = (
      await ctx.editor({
        method: 'POST',
        url: '/admin/faq-items',
        payload: {
          category: 'bezpieczeństwo',
          question: 'Czy mogę jechać nocą?',
          answerMd: 'Tak, z włączonym światłem.',
        },
      })
    ).json<shared.FaqItemView>();
    expect(second).toMatchObject({ categoryId: item.categoryId, sortOrder: 2 });

    // Odpowiedź z nagłówkiem (profil `faq`) i pytanie niewidoczne nigdzie.
    const heading = await ctx.editor({
      method: 'POST',
      url: '/admin/faq-items',
      payload: { category: 'Konto', question: 'Pytanie', answerMd: '## Tytuł' },
    });
    expect(heading.statusCode).toBe(422);
    expect(heading.json()).toMatchObject({
      details: { issues: [{ field: 'answerMd', code: 'MD_NOT_ALLOWED', line: 1 }] },
    });
    const hidden = await ctx.editor({
      method: 'POST',
      url: '/admin/faq-items',
      payload: { category: 'Konto', question: 'Pytanie', answerMd: 'Treść', showOnWeb: false, showInApp: false },
    });
    expect(hidden.statusCode).toBe(400);

    // Kolejność: brak pytania to ORDER_MISMATCH, stara wersja CONFLICT, poprawna zamienia pozycje.
    const order = (items: Array<{ id: string; version: number }>) =>
      ctx.editor({ method: 'PUT', url: '/admin/faq-items/order', payload: { categoryId: item.categoryId, items } });
    expect((await order([{ id: item.id, version: item.version }])).json()).toMatchObject({ code: 'ORDER_MISMATCH' });
    expect(
      (
        await order([
          { id: second.id, version: 99 },
          { id: item.id, version: item.version },
        ])
      ).statusCode,
    ).toBe(409);
    const reordered = (
      await order([
        { id: second.id, version: second.version },
        { id: item.id, version: item.version },
      ])
    ).json<shared.FaqItemView[]>();
    expect(reordered.map((i) => [i.id, i.sortOrder, i.version])).toEqual([
      [second.id, 1, second.version + 1],
      [item.id, 2, item.version + 1],
    ]);

    // Publikacja i przeniesienie do innej kategorii (na koniec).
    const konto = categories.find((c) => c.name === 'Konto')!;
    const published = await ctx.editor({
      method: 'PATCH',
      url: `/admin/faq-items/${item.id}`,
      payload: {
        version: item.version + 1,
        category: 'Konto',
        question: item.question,
        answerMd: item.answerMd,
        showOnWeb: true,
        showInApp: true,
        status: 'PUBLISHED',
      },
    });
    expect(published.json<shared.FaqItemView>()).toMatchObject({
      categoryId: konto.id,
      sortOrder: konto.items + 1,
      status: 'PUBLISHED',
    });
    const web = (await ctx.app.inject({ method: 'GET', url: '/content/web' })).json<shared.PublicContent>();
    expect(web.faq.find((c) => c.name === 'Konto')!.items.at(-1)).toMatchObject({ id: item.id });
    // Pytanie tylko z aplikacji nie trafia na stronę, a archiwalne i szkice nigdzie.
    const webQuestions = web.faq.flatMap((c) => c.items.map((i) => i.question));
    expect(webQuestions).not.toContain('Jak zarezerwować hulajnogę?');
    expect(webQuestions).not.toContain('Ile kosztuje rezerwacja?');
    const mobile = (await ctx.app.inject({ method: 'GET', url: '/content/mobile' })).json<shared.PublicContent>();
    expect(mobile.faq.flatMap((c) => c.items.map((i) => i.question))).toContain('Jak zarezerwować hulajnogę?');

    const removePublished = await ctx.editor({
      method: 'DELETE',
      url: `/admin/faq-items/${item.id}`,
      query: { version: String(item.version + 2) },
    });
    expect(removePublished.json()).toMatchObject({ code: 'CONTENT_DELETE_PUBLISHED' });

    // Kategoria z pytaniami zostaje, pusta znika; kolejność kategorii z wersjami.
    const bezpieczenstwo = (
      await ctx.editor({ method: 'GET', url: `/admin/faq-categories/${item.categoryId}` })
    ).json<shared.FaqCategoryView>();
    const notEmpty = await ctx.editor({
      method: 'DELETE',
      url: `/admin/faq-categories/${bezpieczenstwo.id}`,
      query: { version: String(bezpieczenstwo.version) },
    });
    expect(notEmpty.statusCode).toBe(409);
    expect(notEmpty.json()).toMatchObject({ code: 'FAQ_CATEGORY_NOT_EMPTY', details: { itemCount: 1 } });
    expect(
      (
        await ctx.editor({
          method: 'DELETE',
          url: `/admin/faq-items/${second.id}`,
          query: { version: String(second.version + 1) },
        })
      ).statusCode,
    ).toBe(204);
    const all = (await ctx.editor({ method: 'GET', url: '/admin/faq-categories' })).json<
      shared.ListResponse<shared.FaqCategoryListItem>
    >().items;
    const reversed = [...all].reverse().map((c) => ({ id: c.id, version: c.version }));
    const categoryOrder = (
      await ctx.editor({ method: 'PUT', url: '/admin/faq-categories/order', payload: { items: reversed } })
    ).json<shared.FaqCategoryView[]>();
    expect(categoryOrder.map((c) => c.id)).toEqual(reversed.map((c) => c.id));
    const empty = categoryOrder.find((c) => c.id === bezpieczenstwo.id)!;
    expect(
      (
        await ctx.editor({
          method: 'DELETE',
          url: `/admin/faq-categories/${empty.id}`,
          query: { version: String(empty.version) },
        })
      ).statusCode,
    ).toBe(204);
    const duplicate = await ctx.editor({ method: 'POST', url: '/admin/faq-categories', payload: { name: 'KONTO' } });
    expect(duplicate.json()).toMatchObject({ code: 'ALREADY_EXISTS' });

    const history = (await ctx.editor({ method: 'GET', url: `/admin/faq-items/${item.id}/history` })).json<
      shared.ContentHistoryEntry[]
    >();
    expect(history.map((h) => h.action)).toEqual(['faq_item.updated', 'faq_item.created']);
  });

  it('aktualności: slug z tytułu, publikacja teraz i o czasie z zadaniami granic, stały adres, usuwanie', async () => {
    const created = await ctx.editor({
      method: 'POST',
      url: '/admin/news',
      payload: { title: 'Zażółć gęślą jaźń', lead: 'Zajawka', bodyMd: '## Śródtytuł\n\nTreść artykułu.' },
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json<shared.NewsDetails>();
    expect(draft).toMatchObject({
      slug: 'zazolc-gesla-jazn',
      state: 'DRAFT',
      publishFrom: null,
      firstPublishedAt: null,
    });
    const twin = (
      await ctx.editor({
        method: 'POST',
        url: '/admin/news',
        payload: { title: 'Zażółć gęślą jaźń!', lead: 'Druga', bodyMd: 'Treść.' },
      })
    ).json<shared.NewsDetails>();
    expect(twin.slug).toBe('zazolc-gesla-jazn-2');

    const invalid = await ctx.editor({
      method: 'POST',
      url: '/admin/news',
      payload: {
        title: 'Daty',
        lead: 'Zajawka',
        bodyMd: 'Treść <b>',
        publishFrom: '2026-12-02T10:00:00Z',
        publishTo: '2026-12-01T10:00:00Z',
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(
      invalid.json<{ details: { issues: shared.ContentIssueView[] } }>().details.issues.map((i) => i.code),
    ).toEqual(expect.arrayContaining(['MD_HTML', 'NEWS_DATES_INVALID']));

    // Publikacja na przyszłość: stan „zaplanowana”, zadania granic od i do, strona jej nie pokazuje.
    const from = new Date(Date.now() + 2 * 3600_000);
    const to = new Date(Date.now() + 48 * 3600_000);
    const jobsBefore = sentJobs(JOBS.newsBoundary).length;
    const scheduled = (
      await ctx.editor({
        method: 'PATCH',
        url: `/admin/news/${draft.id}`,
        payload: {
          version: draft.version,
          title: draft.title,
          lead: draft.lead,
          bodyMd: draft.bodyMd,
          status: 'PUBLISHED',
          publishFrom: from.toISOString(),
          publishTo: to.toISOString(),
        },
      })
    ).json<shared.NewsDetails>();
    expect(scheduled).toMatchObject({
      state: 'SCHEDULED',
      slug: 'zazolc-gesla-jazn',
      firstPublishedAt: expect.any(String),
    });
    const boundaries = sentJobs(JOBS.newsBoundary).slice(jobsBefore);
    expect(boundaries.map((j) => [j.data.boundary, j.startAfter?.toISOString(), j.singletonKey])).toEqual([
      ['from', from.toISOString(), core.newsBoundaryKey(draft.id, 'from', from)],
      ['to', to.toISOString(), core.newsBoundaryKey(draft.id, 'to', to)],
    ]);
    // Kolejka `standard`: dubel odrzuca okno singletonu bez przesunięcia `startAfter` (poprawka C2).
    expect(boundaries.map((j) => [j.data.at, j.options?.singletonSeconds, j.options?.singletonNextSlot])).toEqual([
      [from.toISOString(), core.NEWS_BOUNDARY_SINGLETON_SECONDS, false],
      [to.toISOString(), core.NEWS_BOUNDARY_SINGLETON_SECONDS, false],
    ]);
    expect((await ctx.app.inject({ method: 'GET', url: '/news/zazolc-gesla-jazn' })).statusCode).toBe(404);
    const listed = (await ctx.editor({ method: 'GET', url: '/admin/news', query: { state: 'SCHEDULED' } })).json<
      shared.ListResponse<shared.NewsListItem>
    >();
    expect(listed.items.map((n) => n.slug)).toContain('zazolc-gesla-jazn');

    // Granica „od” mija: zadanie zwiększa licznik, odświeża stronę i wysyła `content.updated`.
    await ctx.pool.query(`UPDATE news SET publish_from = now() - interval '1 minute' WHERE id = $1`, [draft.id]);
    // Zadanie z dawną granicą (daty zmienione po zaplanowaniu) niczego nie robi.
    ctx.events.mockClear();
    await ctx.jobs().run(JOBS.newsBoundary, { newsId: draft.id, boundary: 'from', at: from.toISOString() });
    expect(ctx.events).not.toHaveBeenCalled();
    const revision = (await ctx.app.inject({ method: 'GET', url: '/content/web' })).json<shared.PublicContent>()
      .revision;
    ctx.events.mockClear();
    await ctx.jobs().run(JOBS.newsBoundary, { newsId: draft.id, boundary: 'from' });
    expect(ctx.events).toHaveBeenCalledWith(
      expect.objectContaining({ revision: expect.any(Number), clients: ['WEB'] }),
    );
    expect(ctx.events.mock.calls[0]![0].revision).toBeGreaterThan(revision);
    const article = await ctx.app.inject({ method: 'GET', url: '/news/zazolc-gesla-jazn' });
    expect(article.statusCode).toBe(200);
    expect(article.json<shared.PublicNewsArticle>()).toMatchObject({
      title: 'Zażółć gęślą jaźń',
      bodyMd: draft.bodyMd,
    });
    const page = (
      await ctx.app.inject({ method: 'GET', url: '/news', query: { pageSize: '2' } })
    ).json<shared.PublicNewsPage>();
    expect(page).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(page.items[0]!.slug).toBe('zazolc-gesla-jazn');
    // Zaplanowana z danych startowych (za 3 dni) nie jest publiczna.
    expect((await ctx.app.inject({ method: 'GET', url: '/news/jezdzimy-do-pierwszego-sniegu' })).statusCode).toBe(404);

    // Po pierwszej publikacji adres się nie zmienia, a opublikowanej nie da się usunąć.
    const current = (await ctx.editor({ method: 'GET', url: `/admin/news/${draft.id}` })).json<shared.NewsDetails>();
    expect(current.state).toBe('PUBLISHED');
    const locked = await ctx.editor({
      method: 'PATCH',
      url: `/admin/news/${draft.id}`,
      payload: { ...current, version: current.version, slug: 'nowy-adres', media: undefined, mediaId: null },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ code: 'NEWS_SLUG_LOCKED', details: { slug: 'zazolc-gesla-jazn' } });
    const remove = (version: number) =>
      ctx.editor({ method: 'DELETE', url: `/admin/news/${draft.id}`, query: { version: String(version) } });
    expect((await remove(current.version)).json()).toMatchObject({ code: 'CONTENT_DELETE_PUBLISHED' });
    const archived = (
      await ctx.editor({
        method: 'PATCH',
        url: `/admin/news/${draft.id}`,
        payload: {
          version: current.version,
          title: current.title,
          lead: current.lead,
          bodyMd: current.bodyMd,
          status: 'ARCHIVED',
          publishFrom: current.publishFrom,
          publishTo: current.publishTo,
        },
      })
    ).json<shared.NewsDetails>();
    expect(archived.state).toBe('ARCHIVED');
    expect((await remove(archived.version)).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/news/zazolc-gesla-jazn' })).statusCode).toBe(404);
  });

  it('dane firmy: company.write tylko Administrator, NIP z sumą, adres w całości, paragon z chwili wystawienia', async () => {
    const company = (
      await ctx.staff.dispatcher({ method: 'GET', url: '/admin/company' })
    ).json<shared.CompanyProfileView>();
    expect(company).toMatchObject({ name: '[dane sprzedawcy]', street: '', taxId: '', version: 1 });
    const patch = (who: typeof ctx.editor, payload: Record<string, unknown>) =>
      who({ method: 'PATCH', url: '/admin/company', payload });
    expect((await patch(ctx.editor, { version: 1, name: 'Hulajnogi sp. z o.o.' })).json()).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'company.write' },
    });
    expect((await patch(ctx.staff.dispatcher, { version: 1, name: 'X' })).statusCode).toBe(403);

    const badNip = await patch(ctx.staff.admin, { version: 1, taxId: '5260250275' });
    expect(badNip.statusCode).toBe(422);
    expect(badNip.json()).toMatchObject({ details: { issues: [{ field: 'taxId', code: 'COMPANY_TAX_ID_INVALID' }] } });
    const partial = await patch(ctx.staff.admin, { version: 1, street: 'ul. Rynek 1' });
    expect(partial.json()).toMatchObject({
      details: { issues: [{ field: 'postalCode', code: 'CONTENT_FIELD_REQUIRED' }, { field: 'city' }] },
    });

    // Paragon przejazdu sprzed zmiany: dane w nawiasach z migracji, bez adresu i NIP.
    const anna = await ctx.register('+48512700002', 'Anna Paragon');
    await ctx.ride(anna.token, 1);
    await ctx.endRide(anna.token, 1);
    const seller = async () =>
      (
        await ctx.pool.query<{ seller: shared.ReceiptParty }>(
          `SELECT seller FROM receipts WHERE user_id = $1 ORDER BY issued_at`,
          [anna.id],
        )
      ).rows.map((r) => r.seller);
    expect(await seller()).toEqual([{ name: '[dane sprzedawcy]', address: null, taxId: null }]);

    ctx.events.mockClear();
    const saved = await patch(ctx.staff.admin, {
      version: 1,
      name: 'Hulajnogi sp. z o.o.',
      street: 'ul. Rynek 1',
      postalCode: '44-200',
      city: 'Rybnik',
      taxId: '5260250274',
      krs: '0000123456',
      registryCourt: 'Sąd Rejonowy w Gliwicach',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<shared.CompanyProfileView>()).toMatchObject({
      version: 2,
      taxId: '5260250274',
      updatedByName: 'Admin Testowy',
    });
    expect(ctx.events).toHaveBeenCalled();
    expect(await ctx.app.get(CompanyService).seller(ctx.app.get<Database>(DB))).toEqual({
      name: 'Hulajnogi sp. z o.o.',
      address: 'ul. Rynek 1, 44-200 Rybnik',
      taxId: '5260250274',
    });
    // Stary paragon zostaje z danymi z chwili wystawienia, nowy dostaje nowe dane.
    await ctx.ride(anna.token, 1);
    await ctx.endRide(anna.token, 1);
    expect(await seller()).toEqual([
      { name: '[dane sprzedawcy]', address: null, taxId: null },
      { name: 'Hulajnogi sp. z o.o.', address: 'ul. Rynek 1, 44-200 Rybnik', taxId: '5260250274' },
    ]);
    const krsWithoutCourt = await patch(ctx.staff.admin, { version: 2, registryCourt: null });
    expect(krsWithoutCourt.json()).toMatchObject({
      details: { issues: [{ field: 'registryCourt', code: 'COMPANY_REGISTRY_INCOMPLETE' }] },
    });

    const history = (await ctx.editor({ method: 'GET', url: '/admin/company/history' })).json<
      shared.ContentHistoryEntry[]
    >();
    expect(history.map((h) => [h.action, h.versionFrom, h.versionTo])).toEqual([
      ['company_profile.updated', 1, 2],
      ['company_profile.created', null, 1],
    ]);
    expect(history[0]!.after).toMatchObject({ name: 'Hulajnogi sp. z o.o.', taxId: '5260250274' });

    const web = (await ctx.app.inject({ method: 'GET', url: '/content/web' })).json<shared.PublicContent>();
    expect(web.company).toMatchObject({ name: 'Hulajnogi sp. z o.o.', city: 'Rybnik', krs: '0000123456' });
  });

  it('publiczne treści: sekcje opublikowane, ETag i 304, modele tylko dla strony', async () => {
    const web = await ctx.app.inject({ method: 'GET', url: '/content/web' });
    expect(web.statusCode).toBe(200);
    const etag = web.headers.etag as string;
    expect(etag).toMatch(/^"content-[0-9a-f]{32}"$/);
    expect(web.headers['cache-control']).toBe('no-cache');
    const content = web.json<shared.PublicContent>();
    expect(content.client).toBe('web');
    expect(etag).toBe(`"content-${content.hash}"`);
    // Archiwalna sekcja (web.notice) i sekcje aplikacji nie trafiają do strony.
    expect(Object.keys(content.sections)).not.toContain('web.notice');
    expect(Object.keys(content.sections).every((key) => key.startsWith('web.'))).toBe(true);
    expect(content.sections['web.steps']!.items).toHaveLength(3);
    expect(content.sections['web.hero']).toMatchObject({ title: expect.any(String), buttonHref: expect.any(String) });
    expect(content.models).toEqual([expect.objectContaining({ code: 'BASE', photo: null })]);

    const notModified = await ctx.app.inject({
      method: 'GET',
      url: '/content/web',
      headers: { 'if-none-match': etag },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.body).toBe('');

    const mobile = (await ctx.app.inject({ method: 'GET', url: '/content/mobile' })).json<shared.PublicContent>();
    expect(mobile.models).toBeUndefined();
    expect(Object.keys(mobile.sections).sort()).toEqual(['mobile.help', 'mobile.rules', 'mobile.start']);
    expect(mobile.sections['mobile.rules']!.items.every((item) => item.icon !== null)).toBe(true);
    expect((await ctx.app.inject({ method: 'GET', url: '/content/admin' })).statusCode).toBe(400);

    // Zmiana treści zmienia ETag.
    const help = (
      await ctx.editor({ method: 'GET', url: '/admin/content-sections/mobile.help' })
    ).json<shared.ContentSectionView>();
    await ctx.editor({
      method: 'PUT',
      url: '/admin/content-sections/mobile.help',
      payload: { version: help.header.version, header: { ...input(help.header), title: 'Pomoc i kontakt' } },
    });
    const changed = await ctx.app.inject({ method: 'GET', url: '/content/mobile', headers: { 'if-none-match': etag } });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it('ETag ze skrótu treści: zmiana w niezatwierdzonej transakcji i sam licznik nie zmieniają ETag', async () => {
    const before = await ctx.app.inject({ method: 'GET', url: '/content/mobile' });
    const etag = before.headers.etag as string;
    const revision = before.json<shared.PublicContent>().revision;
    // Zapis w toku podbija sekwencję licznika (nextval w wyzwalaczu), ale dane są jeszcze stare: wcześniej odpowiedź
    // miała ETag „content-{N+1}” ze starą treścią, a `content.updated` z N+1 nie odświeżał już telefonu.
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE content_blocks SET title = 'Zmiana w toku' WHERE key = 'mobile.help' AND position = 0`,
      );
      const during = await ctx.app.inject({ method: 'GET', url: '/content/mobile' });
      expect(during.json<shared.PublicContent>().revision).toBeGreaterThan(revision);
      expect(during.headers.etag).toBe(etag);
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/content/mobile', headers: { 'if-none-match': etag } }))
          .statusCode,
      ).toBe(304);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // Licznik bez zmiany treści (granica aktualności) nie zmienia skrótu treści aplikacji.
    await ctx.pool.query('CALL sp_content_bump_revision()');
    const after = await ctx.app.inject({ method: 'GET', url: '/content/mobile' });
    expect(after.headers.etag).toBe(etag);
    expect(after.json<shared.PublicContent>().hash).toBe(before.json<shared.PublicContent>().hash);
  });

  it('publiczne wersje dokumentów prawnych: obowiązująca i archiwalne, bez roboczych', async () => {
    const docs = (await ctx.staff.admin({ method: 'GET', url: '/admin/legal-documents' })).json<
      shared.LegalDocumentSummary[]
    >();
    const terms = docs.find((d) => d.slug === 'regulamin')!;
    const draft = (
      await ctx.staff.admin({ method: 'POST', url: `/admin/legal-documents/${terms.id}/drafts` })
    ).json<shared.DocumentVersionDetails>();
    await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/legal-documents/versions/${draft.id}`,
      payload: { version: draft.version, bodyMd: '## Nowe zasady\n\nTreść.', changeSummary: 'Nowe zasady' },
    });
    expect((await ctx.app.inject({ method: 'GET', url: '/legal/regulamin/versions/2' })).statusCode).toBe(404);
    ctx.events.mockClear();
    await ctx.staff.admin({ method: 'POST', url: `/admin/legal-documents/versions/${draft.id}/publish` });
    expect(ctx.events).toHaveBeenCalledWith(expect.objectContaining({ clients: ['WEB', 'MOBILE'] }));

    const versions = (await ctx.app.inject({ method: 'GET', url: '/legal/regulamin/versions' })).json<
      shared.PublicLegalVersionItem[]
    >();
    expect(versions.map((v) => [v.versionNo, v.current, v.changeSummary])).toEqual([
      [2, true, 'Nowe zasady'],
      [1, false, null],
    ]);
    expect(versions[1]!.supersededAt).toBe(versions[0]!.publishedAt);
    expect(versions[0]!.supersededAt).toBeNull();
    const archived = (
      await ctx.app.inject({ method: 'GET', url: '/legal/regulamin/versions/1' })
    ).json<shared.PublicLegalVersionView>();
    expect(archived).toMatchObject({ slug: 'regulamin', versionNo: 1, bodyMd: 'Treść', current: false });
    expect((await ctx.app.inject({ method: 'GET', url: '/legal/nieznany/versions' })).statusCode).toBe(404);
  });

  it('publiczna hulajnoga: numer i model bez stanu floty, wycofana daje 404', async () => {
    const scooter = await ctx.app.inject({ method: 'GET', url: '/public/scooters/2' });
    expect(scooter.statusCode).toBe(200);
    const view = scooter.json<shared.PublicScooterView>();
    expect(view).toEqual({ number: 2, model: { code: 'BASE', name: expect.any(String), photo: null } });
    expect((await ctx.app.inject({ method: 'GET', url: '/public/scooters/0002' })).json()).toEqual(view);
    expect((await ctx.app.inject({ method: 'GET', url: '/public/scooters/12345' })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'GET', url: '/public/scooters/9999' })).statusCode).toBe(404);
    await ctx.pool.query(`UPDATE scooters SET status = 'RETIRED', status_reason = 'OTHER' WHERE number = 2`);
    expect((await ctx.app.inject({ method: 'GET', url: '/public/scooters/2' })).statusCode).toBe(404);
  });

  it('uprawnienia: Redaktor edytuje treści, ale nie dane firmy ani flotę; Dyspozytor tylko czyta', async () => {
    expect(
      (await ctx.editor({ method: 'GET', url: '/admin/content-blocks', query: { isHeader: 'true' } })).statusCode,
    ).toBe(200);
    expect((await ctx.editor({ method: 'GET', url: '/admin/scooters' })).statusCode).toBe(403);
    expect((await ctx.editor({ method: 'GET', url: '/admin/notification-templates' })).statusCode).toBe(200);
    expect((await ctx.staff.dispatcher({ method: 'GET', url: '/admin/faq-items' })).statusCode).toBe(200);
    expect(
      (
        await ctx.staff.dispatcher({
          method: 'POST',
          url: '/admin/news',
          payload: { title: 'X', lead: 'Y', bodyMd: 'Z' },
        })
      ).json(),
    ).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'content.write' } });
    expect((await ctx.staff.technician({ method: 'GET', url: '/admin/content-sections' })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: '/admin/content-sections' })).statusCode).toBe(401);
    const blocks = (
      await ctx.editor({ method: 'GET', url: '/admin/content-blocks', query: { key: 'web.zones', sort: 'position' } })
    ).json<shared.ListResponse<shared.ContentBlockListItem>>();
    expect(blocks.items.map((b) => [b.position, b.isHeader, b.icon])).toEqual([
      [0, true, null],
      [1, false, 'parking'],
      [2, false, 'zone-slow'],
      [3, false, 'zone-no-ride'],
    ]);
    expect(blocks.items[0]).toMatchObject({ sectionItems: 3, sectionItemsPublished: 3 });
  });
});
