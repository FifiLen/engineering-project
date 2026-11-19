/**
 * Testy integracyjne migracji 0011 (iteracja 7: treści i wydruki, ADR 0062–0069) na prawdziwym PostgreSQL:
 * dane startowe z grafikami i szablonami w magazynie w pamięci, reguły bloków, FAQ, aktualności, mediów i danych
 * firmy, aktywacja wersji szablonu, wygenerowane dokumenty z ponownym użyciem paragonu PDF, limit eksportu danych,
 * publiczne odczyty i widoki danych wydruków. Każde uruchomienie tworzy tymczasową bazę i usuwa ją na końcu.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedHref } from '@hulajnogi/shared';
import { createDb } from './client.js';
import { runMigrations } from './migrator.js';
import type { PlacesFile } from './places.js';
import { rethrowDatabaseRule } from './repositories/errors.js';
import { DrizzleMediaRepository } from './repositories/media.repository.js';
import { DEV_MEDIA, loadSeedMedia, loadStarterTemplates, type SeedFileStorage } from './seed-assets.js';
import { DEV_CONTENT_SECTIONS, DEV_FAQ, DEV_NEWS } from './seed-content.js';
import { seedDatabase } from './seed.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_content_${randomUUID().slice(0, 8)}`;

// Syntetyczne współrzędne testowe (nie są to prawdziwe miejsca w Rybniku).
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 3000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.0, lon: 18.5 },
    { code: 'P-02', name: 'Północ', query: '', type: 'PARKING', radiusM: 50, capacity: 20, lat: 50.01, lon: 18.5 },
  ],
};

/** Magazyn plików w pamięci zamiast SeaweedFS (jak `FILE_STORAGE=memory` w testach API). */
class MemoryStorage implements SeedFileStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }
}

/** Kod błędu domeny po `rethrowDatabaseRule` (jak w API) albo `null`, gdy zapytanie się udało. */
async function domainCode(query: Promise<unknown>) {
  try {
    await query;
  } catch (error) {
    try {
      rethrowDatabaseRule(error);
    } catch (mapped) {
      return { code: (mapped as { code?: string }).code, details: (mapped as { details?: unknown }).details };
    }
  }
  return null;
}

describe.skipIf(!adminUrl)('treści i wydruki w bazie (0011)', () => {
  let admin: Pool;
  let pool: Pool;
  const storage = new MemoryStorage();
  const media = loadSeedMedia();
  const templates = loadStarterTemplates();
  const seed = (starterTemplates = templates) =>
    seedDatabase(pool, {
      places,
      fleetSize: 12,
      sampleRentals: 3,
      sampleOperations: true,
      admin: { email: 'a@test.local', name: 'Piotr Mazur', passwordHash: 'x' },
      staff: [{ email: 'r@test.local', name: 'Joanna Lis', role: 'Redaktor', passwordHash: 'x' }],
      contentFiles: { storage, media, templates: starterTemplates },
    });
  const staffId = async (email = 'a@test.local') =>
    (await pool.query<{ id: string }>(`SELECT id FROM staff WHERE email = $1`, [email])).rows[0]!.id;
  const userId = async (phone: string) =>
    (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
        [phone],
      )
    ).rows[0]!.id;
  const revision = () =>
    pool.query<{ r: string }>(`SELECT fn_content_revision() AS r`).then((r) => Number(r.rows[0]!.r));

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await seed();
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('dane startowe: sekcje, FAQ, aktualności, grafiki i szablony w magazynie, wpisy systemu, idempotentnie', async () => {
    const counts = async () =>
      (
        await pool.query(
          `SELECT (SELECT count(*)::int FROM content_blocks) AS blocks, (SELECT count(*)::int FROM faq_items) AS faq,
                  (SELECT count(*)::int FROM faq_categories) AS categories, (SELECT count(*)::int FROM news) AS news,
                  (SELECT count(*)::int FROM media_assets) AS media, (SELECT count(*)::int FROM document_templates) AS templates,
                  (SELECT count(*)::int FROM audit_log WHERE data->>'source' = 'seed') AS audit`,
        )
      ).rows[0];
    const before = await counts();
    const objects = storage.objects.size;
    await seed();
    expect(await counts()).toEqual(before);
    expect(storage.objects.size).toBe(objects);

    const blocks = DEV_CONTENT_SECTIONS.reduce((n, s) => n + 1 + (s.items?.length ?? 0), 0);
    expect(before).toEqual({
      blocks,
      faq: DEV_FAQ.reduce((n, c) => n + c.items.length, 0),
      categories: DEV_FAQ.length,
      news: DEV_NEWS.length,
      media: DEV_MEDIA.length,
      templates: 4,
      // Wpis systemu przy każdym bloku, pytaniu, aktualności, grafice, szablonie i danych firmy.
      audit: blocks + before.faq + DEV_NEWS.length + DEV_MEDIA.length + 4 + 1,
    });
    // Grafiki i szablony leżą w magazynie pod kluczami z `files` (cel MEDIA z wymiarami, DOCUMENT_TEMPLATE).
    const files = await pool.query<{ storage_key: string; purpose: string; size_bytes: number; width: number | null }>(
      `SELECT storage_key, purpose::text AS purpose, size_bytes, width FROM files WHERE purpose IN ('MEDIA', 'DOCUMENT_TEMPLATE')`,
    );
    expect(files.rows).toHaveLength(DEV_MEDIA.length + 4);
    for (const file of files.rows) {
      expect(storage.objects.get(file.storage_key)?.body.length).toBe(file.size_bytes);
      expect(file.storage_key).toMatch(
        file.purpose === 'MEDIA' ? /^media\/\d{4}\/\d{2}\/.+\.png$/ : /^document-template\/.+\.docx$/,
      );
      expect(file.width === null).toBe(file.purpose === 'DOCUMENT_TEMPLATE');
    }
    const system = await pool.query<{ key: string }>(`SELECT key FROM media_assets WHERE is_system ORDER BY key`);
    expect(system.rows.map((r) => r.key)).toEqual([
      'scooter.beton.trzy',
      'scooter.grafit.bok',
      'scooter.grafit.trzy',
      'scooter.kobalt.trzy',
    ]);
    const model = await pool.query(
      `SELECT photo_alt_text FROM v_public_scooters WHERE model_code = 'BASE' AND photo_path LIKE '/media/%.png' LIMIT 1`,
    );
    expect(model.rows[0]).toEqual({ photo_alt_text: DEV_MEDIA[0].altText });

    // Każdy rodzaj z szablonem startowym ma szablon domyślny z aktywną wersją z danych startowych (bez autora)
    // z plikiem i znacznikami z manifestu.
    const defaults = await pool.query<{
      document_type: string;
      active_version_no: number;
      fields: string[];
      uploaded_by: string | null;
      sha256: string;
      size_bytes: number;
    }>(
      `SELECT t.document_type::text AS document_type, t.active_version_no, v.fields, v.uploaded_by, f.sha256, v.size_bytes
       FROM v_document_templates t JOIN document_template_versions v ON v.id = t.active_version_id
       JOIN files f ON f.id = v.file_id
       WHERE t.is_default ORDER BY 1`,
    );
    expect(defaults.rows.map((r) => r.document_type)).toEqual([
      'RECEIPT',
      'RENTAL_CONFIRMATION',
      'SCOOTER_CARD',
      'SERVICE_PROTOCOL',
    ]);
    for (const row of defaults.rows) {
      const starter = templates.find((t) => t.documentType === row.document_type)!;
      expect(row.active_version_no).toBeGreaterThanOrEqual(1);
      expect(row).toMatchObject({
        fields: starter.fields,
        uploaded_by: null,
        sha256: starter.sha256,
        size_bytes: starter.sizeBytes,
      });
    }
    const history = await pool.query(
      `SELECT action, data->'version' AS version FROM v_audit_log
       WHERE actor = 'SYSTEM' AND entity_type = 'content_block' AND data->'after'->>'key' = 'web.hero'`,
    );
    expect(history.rows).toEqual([{ action: 'content_block.created', version: [null, 1] }]);
  });

  it('szablony startowe DOCX: archiwa ZIP z dokumentem Worda, stopką i znacznikami wspólnymi', () => {
    expect(templates.map((t) => t.file)).toEqual([
      'paragon.docx',
      'potwierdzenie-przejazdu.docx',
      'protokol-serwisowy.docx',
      'karta-hulajnogi.docx',
      'lista-pol.docx',
    ]);
    for (const template of templates) {
      expect([...template.bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
      const names = template.bytes.toString('latin1');
      for (const part of ['[Content_Types].xml', 'word/document.xml', 'word/footer1.xml', 'word/media/logo.png']) {
        expect(names).toContain(part);
      }
      expect(names).not.toContain('vbaProject.bin');
      expect(template.uncompressedBytes / template.sizeBytes).toBeLessThan(200);
      // Ścieżki jak `usedFields` inspekcji API: pole pętli jako `parts[].sku` (poprawka D7).
      for (const tag of template.fields) expect(tag).toMatch(/^[a-z][a-zA-Z0-9]*(\[\])?(\.[a-z][a-zA-Z0-9]*)*$/);
      expect([...template.fields].sort()).toEqual(template.fields);
      expect(template.fields).toContain('company.name');
    }
    for (const template of templates.filter((t) => t.documentType)) {
      expect(template.fields).toEqual(expect.arrayContaining(['document.footer', 'staff.present', 'staff.name']));
    }
  });

  it('szablon startowy: zmieniony plik to nowa aktywna wersja z seeda, wersji operatora seed nie zastępuje', async () => {
    const type = 'RENTAL_CONFIRMATION';
    const state = async () =>
      (
        await pool.query<{
          id: string;
          versions: number;
          active_version_no: number;
          note: string | null;
          uploaded_by: string | null;
          sha256: string | null;
        }>(
          `SELECT t.id, t.versions, t.active_version_no, v.note, v.uploaded_by, f.sha256
           FROM v_document_templates t JOIN document_template_versions v ON v.id = t.active_version_id
           JOIN files f ON f.id = v.file_id
           WHERE t.document_type = $1 AND t.is_default`,
          [type],
        )
      ).rows[0]!;
    const before = await state();
    // Nowy plik szablonu startowego w repozytorium (inna suma SHA-256 niż plik aktywnej wersji z seeda).
    const starter = templates.find((t) => t.documentType === type)!;
    const bytes = Buffer.concat([starter.bytes, Buffer.from('\n')]);
    const changed = templates.map((t) =>
      t === starter
        ? { ...t, bytes, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
        : t,
    );
    await seed(changed);
    const updated = await state();
    expect(updated).toMatchObject({
      id: before.id,
      versions: before.versions + 1,
      active_version_no: before.active_version_no + 1,
      note: 'Szablon startowy zaktualizowany',
      uploaded_by: null,
      sha256: changed.find((t) => t.documentType === type)!.sha256,
    });
    const version = await pool.query(
      `SELECT v.fields, v.size_bytes, v.activated_by, f.storage_key FROM document_template_versions v
       JOIN files f ON f.id = v.file_id WHERE v.template_id = $1 AND v.is_active`,
      [before.id],
    );
    expect(version.rows[0]).toMatchObject({ fields: starter.fields, size_bytes: bytes.length, activated_by: null });
    expect(version.rows[0].storage_key).toMatch(/^document-template\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.docx$/);
    expect(storage.objects.get(version.rows[0].storage_key)?.body).toEqual(bytes);
    const audit = await pool.query(
      `SELECT data->>'versionNo' AS no FROM audit_log WHERE action = 'document_template.starter_updated' AND entity_id = $1`,
      [before.id],
    );
    expect(audit.rows).toEqual([{ no: String(before.active_version_no + 1) }]);
    // Ten sam plik drugi raz: bez nowej wersji.
    await seed(changed);
    expect(await state()).toEqual(updated);

    // Aktywna wersja wgrana przez operatora: seed z innym plikiem startowym niczego nie zmienia.
    const operator = await staffId();
    const file = await pool.query<{ id: string }>(
      `INSERT INTO files (storage_key, purpose, content_type, size_bytes) VALUES ('document-template/test/' || gen_random_uuid(),
         'DOCUMENT_TEMPLATE', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100) RETURNING id`,
    );
    const own = await pool.query<{ id: string }>(
      `INSERT INTO document_template_versions (template_id, version_no, file_id, size_bytes, uncompressed_bytes, uploaded_by)
       VALUES ($1, $2, $3, 100, 100, $4) RETURNING id`,
      [before.id, updated.versions + 1, file.rows[0]!.id, operator],
    );
    await pool.query(`CALL sp_document_template_activate($1, $2)`, [own.rows[0]!.id, operator]);
    const withOperator = await state();
    await seed(templates);
    expect(await state()).toEqual(withOperator);
    expect(withOperator).toMatchObject({ versions: updated.versions + 1, uploaded_by: operator });
  });

  it('bloki: pozycja w sekcji unikalna przy zatwierdzeniu, klucz zgodny z klientem, ikony i adres przycisku z listy', async () => {
    const insert = (values: string) =>
      pool.query(
        `INSERT INTO content_blocks (key, client, position, title, icon, cta_label, cta_url) VALUES ${values}`,
      );
    await insert(`('web.test', 'WEB', 0, 'Nagłówek', NULL, NULL, NULL), ('web.test', 'WEB', 1, 'A', NULL, NULL, NULL),
                  ('web.test', 'WEB', 2, 'B', NULL, NULL, NULL)`);
    // Zmiana kolejności w jednej transakcji: pozycje chwilowo się powtarzają, a sprawdzenie jest przy COMMIT.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE content_blocks SET position = 2 WHERE key = 'web.test' AND title = 'A'`);
      await client.query(`UPDATE content_blocks SET position = 1 WHERE key = 'web.test' AND title = 'B'`);
      await client.query('COMMIT');
      await client.query('BEGIN');
      await client.query(`UPDATE content_blocks SET position = 1 WHERE key = 'web.test' AND title = 'A'`);
      expect(await domainCode(client.query('COMMIT'))).toEqual({ code: 'CONTENT_POSITION_TAKEN', details: undefined });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    const order = await pool.query(`SELECT title FROM content_blocks WHERE key = 'web.test' ORDER BY position`);
    expect(order.rows.map((r) => r.title)).toEqual(['Nagłówek', 'B', 'A']);

    expect(await domainCode(insert(`('mobile.test', 'WEB', 3, 'X', NULL, NULL, NULL)`))).toEqual({
      code: 'VALIDATION_FAILED',
      details: undefined,
    });
    expect((await domainCode(insert(`('web.test', 'WEB', 3, 'X', 'unicorn', NULL, NULL)`)))?.code).toBe(
      'CONTENT_ICON_UNKNOWN',
    );
    expect((await domainCode(insert(`('web.test2', 'WEB', 0, 'X', 'parking', NULL, NULL)`)))?.code).toBe(
      'VALIDATION_FAILED',
    );
    await insert(`('web.test', 'WEB', 3, 'X', 'zone-no-ride', NULL, NULL)`);
    // Pusty może być tylko nagłówek (pozycja 0); element listy ma treść.
    await insert(`('web.empty', 'WEB', 0, NULL, NULL, NULL, NULL)`);
    expect((await domainCode(insert(`('web.empty', 'WEB', 1, NULL, NULL, NULL, NULL)`)))?.code).toBe(
      'VALIDATION_FAILED',
    );

    let position = 10;
    const button = (url: string) => insert(`('web.test', 'WEB', ${position++}, 'X', NULL, 'Przycisk', '${url}')`);
    for (const url of [
      'https://example.org/a',
      'mailto:pomoc@example.org',
      'tel:+48500000000',
      '/aktualnosci',
      '/',
      '#strefy',
    ]) {
      expect(await domainCode(button(url))).toBeNull();
    }
    for (const url of [
      'http://example.org',
      'javascript:alert(1)',
      '//evil.example',
      'data:text/html,x',
      'ftp://x',
      '/a b',
    ]) {
      expect((await domainCode(button(url)))?.code).toBe('CONTENT_LINK_SCHEME');
    }
    expect((await domainCode(insert(`('web.test', 'WEB', 99, 'X', NULL, 'Bez adresu', NULL)`)))?.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('statusy treści: opublikowanego wpisu nie da się usunąć, szkic i archiwum tak; publiczne widoki tylko opublikowane', async () => {
    const block = (
      await pool.query<{ id: string }>(
        `INSERT INTO content_blocks (key, client, position, title, status) VALUES ('web.status', 'WEB', 0, 'X', 'PUBLISHED') RETURNING id`,
      )
    ).rows[0]!.id;
    expect(await domainCode(pool.query(`DELETE FROM content_blocks WHERE id = $1`, [block]))).toEqual({
      code: 'CONTENT_DELETE_PUBLISHED',
      details: undefined,
    });
    await pool.query(`UPDATE content_blocks SET status = 'ARCHIVED', version = version + 1 WHERE id = $1`, [block]);
    await pool.query(`UPDATE content_blocks SET status = 'DRAFT', version = version + 1 WHERE id = $1`, [block]);
    await pool.query(`DELETE FROM content_blocks WHERE id = $1`, [block]);

    // Element listy jest publiczny tylko z opublikowanym nagłówkiem; szkic „Jedź trzeźwo” i archiwalny komunikat nie.
    const rules = await pool.query(
      `SELECT position, title, icon FROM v_public_content_blocks WHERE key = 'mobile.rules' ORDER BY position`,
    );
    expect(rules.rows.map((r) => r.icon)).toEqual([null, 'rider-single', 'bike-lane', 'parking', 'helmet']);
    expect((await pool.query(`SELECT 1 FROM v_public_content_blocks WHERE key = 'web.notice'`)).rowCount).toBe(0);
    await pool.query(`UPDATE content_blocks SET status = 'DRAFT' WHERE key = 'web.zones' AND position = 0`);
    expect((await pool.query(`SELECT 1 FROM v_public_content_blocks WHERE key = 'web.zones'`)).rowCount).toBe(0);
    await pool.query(`UPDATE content_blocks SET status = 'PUBLISHED' WHERE key = 'web.zones' AND position = 0`);
    const hero = await pool.query(
      `SELECT media_key, media_width, media_path LIKE '/media/%/' || f.sha256 || '.png' AS path_ok
       FROM v_public_content_blocks b JOIN media_assets m ON m.id = b.media_id JOIN files f ON f.id = m.file_id
       WHERE b.key = 'web.hero'`,
    );
    expect(hero.rows).toEqual([{ media_key: 'scooter.grafit.trzy', media_width: 857, path_ok: true }]);
    const list = await pool.query(
      `SELECT is_header, section_items, section_items_published, section_drafts FROM v_content_blocks
       WHERE key = 'mobile.rules' AND position = 0`,
    );
    expect(list.rows[0]).toEqual({ is_header: true, section_items: 5, section_items_published: 4, section_drafts: 1 });

    // Licznik treści obejmuje kategorie FAQ, dane firmy i modele; zadanie granicy aktualności zwiększa go procedurą.
    let last = await revision();
    for (const sql of [
      `UPDATE faq_categories SET sort_order = sort_order WHERE false`,
      `UPDATE company_profile SET support_hours = support_hours`,
      `UPDATE scooter_models SET updated_at = now() WHERE code = 'BASE'`,
      `CALL sp_content_bump_revision()`,
    ]) {
      await pool.query(sql);
      const next = await revision();
      expect(next).toBeGreaterThan(last);
      last = next;
    }
  });

  it('FAQ: kategorie bez względu na wielkość liter, widoczność na stronie albo w aplikacji, kategoria z pytaniami zostaje', async () => {
    expect(
      (await domainCode(pool.query(`INSERT INTO faq_categories (name, sort_order) VALUES ('PRZEJAZD', 9)`)))?.details,
    ).toEqual({ field: 'name' });
    const category = (
      await pool.query<{ id: string }>(
        `INSERT INTO faq_categories (name, sort_order) VALUES ('Testowa', 9) RETURNING id`,
      )
    ).rows[0]!.id;
    const item = (visibleWeb: boolean, visibleApp: boolean) =>
      pool.query<{ id: string }>(
        `INSERT INTO faq_items (category_id, question, answer_md, status, show_on_web, show_in_app)
         VALUES ($1, 'Pytanie?', 'Odpowiedź.', 'PUBLISHED', $2, $3) RETURNING id`,
        [category, visibleWeb, visibleApp],
      );
    expect((await domainCode(item(false, false)))?.code).toBe('FAQ_NOT_VISIBLE');
    const appOnly = (await item(false, true)).rows[0]!.id;
    expect((await domainCode(pool.query(`DELETE FROM faq_categories WHERE id = $1`, [category])))?.code).toBe(
      'FAQ_CATEGORY_NOT_EMPTY',
    );
    expect((await domainCode(pool.query(`DELETE FROM faq_items WHERE id = $1`, [appOnly])))?.code).toBe(
      'CONTENT_DELETE_PUBLISHED',
    );

    // Publiczne FAQ: tylko opublikowane, kolejność kategorii z tabeli; wersja web bez pytań tylko z aplikacji.
    const web = await pool.query<{ category_name: string; question: string }>(
      `SELECT category_name, question FROM v_public_faq WHERE show_on_web ORDER BY category_sort_order, sort_order`,
    );
    const expected = DEV_FAQ.flatMap((c) =>
      c.items
        .filter((i) => (i.status ?? 'PUBLISHED') === 'PUBLISHED' && (i.web ?? true))
        .map((i) => ({ category_name: c.category, question: i.question })),
    );
    expect(web.rows).toEqual(expected);
    const counts = await pool.query(
      `SELECT name, items, items_published FROM v_faq_categories WHERE name = 'Przejazd'`,
    );
    expect(counts.rows[0]).toEqual({ name: 'Przejazd', items: 6, items_published: 5 });
  });

  it('aktualności: wymagana zajawka do 280 znaków, stan z dat, adres stały po pierwszej publikacji', async () => {
    const insert = (slug: string, lead: string | null, status = 'DRAFT', from: string | null = null) =>
      pool.query<{ id: string }>(
        `INSERT INTO news (slug, title, lead, body_md, status, publish_from) VALUES ($1, 'Tytuł', $2, 'Treść', $3, $4::timestamptz)
         RETURNING id`,
        [slug, lead, status, from],
      );
    await expect(insert('bez-zajawki', null)).rejects.toThrow(/null value in column "lead"/);
    expect((await domainCode(insert('za-dluga', 'x'.repeat(281))))?.code).toBe('VALIDATION_FAILED');
    const draft = (await insert('szkic', 'Zajawka')).rows[0]!.id;
    await pool.query(`UPDATE news SET slug = 'szkic-2' WHERE id = $1`, [draft]);
    await pool.query(`UPDATE news SET status = 'PUBLISHED', publish_from = now() - interval '1 hour' WHERE id = $1`, [
      draft,
    ]);
    expect(await domainCode(pool.query(`UPDATE news SET slug = 'inny' WHERE id = $1`, [draft]))).toEqual({
      code: 'NEWS_SLUG_LOCKED',
      details: { slug: 'szkic-2' },
    });
    // Archiwum i powrót do szkicu nie odblokowują adresu.
    await pool.query(`UPDATE news SET status = 'ARCHIVED' WHERE id = $1`, [draft]);
    await pool.query(`UPDATE news SET status = 'DRAFT', first_published_at = NULL WHERE id = $1`, [draft]);
    expect((await domainCode(pool.query(`UPDATE news SET slug = 'inny' WHERE id = $1`, [draft])))?.code).toBe(
      'NEWS_SLUG_LOCKED',
    );

    const state = async (status: string, from: string | null, to: string | null) =>
      (
        await pool.query<{ s: string }>(
          `SELECT fn_news_state($1::content_status, $2::timestamptz, $3::timestamptz, '2026-11-18T12:00:00Z') AS s`,
          [status, from, to],
        )
      ).rows[0]!.s;
    expect(await state('DRAFT', '2026-11-01T00:00:00Z', null)).toBe('DRAFT');
    expect(await state('ARCHIVED', '2026-11-01T00:00:00Z', null)).toBe('ARCHIVED');
    expect(await state('PUBLISHED', '2026-11-19T00:00:00Z', null)).toBe('SCHEDULED');
    expect(await state('PUBLISHED', '2026-11-01T00:00:00Z', '2026-11-18T12:00:00Z')).toBe('EXPIRED');
    expect(await state('PUBLISHED', '2026-11-18T12:00:00Z', '2026-11-18T12:00:01Z')).toBe('PUBLISHED');

    const seeded = await pool.query<{ slug: string; state: string }>(
      `SELECT slug, state FROM v_news_list WHERE slug = ANY ($1) ORDER BY publish_from`,
      [DEV_NEWS.map((n) => n.slug)],
    );
    expect(seeded.rows.map((r) => r.state)).toEqual(['PUBLISHED', 'PUBLISHED', 'SCHEDULED']);
    const published = await pool.query<{ slug: string }>(
      `SELECT slug FROM v_published_news WHERE slug = ANY ($1) ORDER BY publish_from DESC`,
      [DEV_NEWS.map((n) => n.slug)],
    );
    expect(published.rows.map((r) => r.slug)).toEqual(['park-sarkandra-bez-hulajnog', 'ruszamy-w-rybniku']);
  });

  it('media: plik celu MEDIA z wymiarami, klucz niezmienny, systemowa i używana grafika nie znika, miejsca użycia', async () => {
    const file = (purpose: string, width: number | null) =>
      pool.query<{ id: string }>(
        `INSERT INTO files (storage_key, purpose, content_type, size_bytes, sha256, width, height)
         VALUES ('media/test/' || gen_random_uuid(), $1, 'image/png', 10, repeat('b', 64), $2, $2) RETURNING id`,
        [purpose, width],
      );
    const asset = (key: string, fileId: string, alt = 'Tekst alternatywny') =>
      pool.query<{ id: string }>(
        `INSERT INTO media_assets (key, name, file_id, alt_text, is_system) VALUES ($1, $1, $2, $3, $1 LIKE 'scooter.%') RETURNING id`,
        [key, fileId, alt],
      );
    await expect(
      pool.query(
        `INSERT INTO files (storage_key, purpose, content_type, width) VALUES ('x/1', 'MEDIA', 'image/png', 10)`,
      ),
    ).rejects.toThrow(/files_dimensions/);
    expect((await domainCode(asset('bez-wymiarow', (await file('MEDIA', null)).rows[0]!.id)))?.code).toBe(
      'MEDIA_FILE_INVALID',
    );
    expect((await domainCode(asset('zly-cel', (await file('TICKET_PHOTO', 100)).rows[0]!.id)))?.code).toBe(
      'MEDIA_FILE_INVALID',
    );
    expect((await domainCode(asset('alt', (await file('MEDIA', 100)).rows[0]!.id, 'ab')))?.code).toBe(
      'VALIDATION_FAILED',
    );
    const grafika = (await asset('aktualnosc-test', (await file('MEDIA', 1920)).rows[0]!.id)).rows[0]!.id;
    expect(await domainCode(pool.query(`UPDATE media_assets SET key = 'inny' WHERE id = $1`, [grafika]))).toEqual({
      code: 'MEDIA_KEY_IMMUTABLE',
      details: { key: 'aktualnosc-test' },
    });

    // Zastąpienie pliku zachowuje identyfikator i zmienia adres (suma SHA-256 nowego pliku).
    const replacement = (await file('MEDIA', 2000)).rows[0]!.id;
    await pool.query(`UPDATE files SET sha256 = repeat('c', 64) WHERE id = $1`, [replacement]);
    await pool.query(`UPDATE media_assets SET file_id = $2, version = version + 1 WHERE id = $1`, [
      grafika,
      replacement,
    ]);
    const listed = await pool.query(`SELECT path, width, usages FROM v_media_list WHERE id = $1`, [grafika]);
    expect(listed.rows[0]).toEqual({ path: `/media/${grafika}/${'c'.repeat(64)}.png`, width: 2000, usages: 0 });

    const system = await pool.query<{ id: string }>(`SELECT id FROM media_assets WHERE key = 'scooter.grafit.trzy'`);
    expect(await domainCode(pool.query(`DELETE FROM media_assets WHERE id = $1`, [system.rows[0]!.id]))).toEqual({
      code: 'MEDIA_SYSTEM',
      details: { key: 'scooter.grafit.trzy' },
    });
    const usages = await pool.query<{ kind: string; ref: string }>(
      `SELECT kind, ref FROM v_media_usages WHERE media_id = $1 ORDER BY kind, ref`,
      [system.rows[0]!.id],
    );
    expect(usages.rows).toEqual([
      { kind: 'CONTENT_BLOCK', ref: 'mobile.start' },
      { kind: 'CONTENT_BLOCK', ref: 'web.hero' },
      { kind: 'SCOOTER_MODEL', ref: 'BASE' },
    ]);
    // Klucz systemowy tylko dla `scooter.*`.
    await expect(
      pool.query(`INSERT INTO media_assets (key, name, file_id, alt_text) VALUES ('scooter.nowy', 'x', $1, 'Tekst')`, [
        (await file('MEDIA', 100)).rows[0]!.id,
      ]),
    ).rejects.toThrow(/media_assets_system_key/);

    await pool.query(`UPDATE news SET media_id = $1 WHERE slug = 'jezdzimy-do-pierwszego-sniegu'`, [grafika]);
    expect((await domainCode(pool.query(`DELETE FROM media_assets WHERE id = $1`, [grafika])))?.code).toBe(
      'MEDIA_IN_USE',
    );
    await pool.query(`UPDATE news SET media_id = NULL WHERE slug = 'jezdzimy-do-pierwszego-sniegu'`);
    await pool.query(`DELETE FROM media_assets WHERE id = $1`, [grafika]);
  });

  it('dane firmy: jeden wiersz, formaty NIP i kodu pocztowego, adres cały albo pusty, opcjonalne dane rejestrowe', async () => {
    expect((await pool.query(`SELECT name, address, tax_id, support_email FROM v_company_public`)).rows).toEqual([
      { name: '[dane sprzedawcy]', address: null, tax_id: null, support_email: '[e-mail pomocy]' },
    ]);
    await expect(
      pool.query(`INSERT INTO company_profile (id, name, support_email, support_phone) VALUES (true, 'X', 'e', 't')`),
    ).rejects.toThrow(/company_profile_pkey/);
    await expect(
      pool.query(`INSERT INTO company_profile (id, name, support_email, support_phone) VALUES (false, 'X', 'e', 't')`),
    ).rejects.toThrow(/company_profile_id_check/);
    expect((await domainCode(pool.query(`DELETE FROM company_profile`)))?.code).toBe('COMPANY_PROFILE_REQUIRED');
    for (const sql of [
      `UPDATE company_profile SET tax_id = '123-456-78-90'`,
      `UPDATE company_profile SET street = 'ul. Testowa 1', postal_code = '12345', city = 'Miasto'`,
      `UPDATE company_profile SET street = 'ul. Testowa 1'`,
      `UPDATE company_profile SET regon = '1234'`,
      `UPDATE company_profile SET support_hours = repeat('x', 61)`,
    ]) {
      expect((await domainCode(pool.query(sql)))?.code).toBe('VALIDATION_FAILED');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE company_profile SET street = 'ul. Testowa 1', postal_code = '00-000', city = 'Miasto', tax_id = '0000000000',
                krs = '0000000000', registry_court = 'Sąd Rejonowy', share_capital_grosze = 500000, version = version + 1`,
      );
      const row = await client.query(`SELECT address, krs FROM v_company_public`);
      expect(row.rows[0]).toEqual({ address: 'ul. Testowa 1, 00-000 Miasto', krs: '0000000000' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('szablony: wersja do aktywacji, aktywacja i przywrócenie z jedną aktywną, usunięcie tylko PENDING, domyślny z aktywną wersją', async () => {
    const admin = await staffId();
    const template = (
      await pool.query<{ id: string }>(`SELECT id FROM document_templates WHERE document_type = 'SERVICE_PROTOCOL'`)
    ).rows[0]!.id;
    const version = async (no: number) => {
      const file = await pool.query<{ id: string }>(
        `INSERT INTO files (storage_key, purpose, content_type, size_bytes) VALUES ('document-template/test/' || gen_random_uuid(),
           'DOCUMENT_TEMPLATE', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100) RETURNING id`,
      );
      return (
        await pool.query<{ id: string }>(
          `INSERT INTO document_template_versions (template_id, version_no, file_id, fields, size_bytes, uncompressed_bytes, uploaded_by, warnings)
           VALUES ($1, $2, $3, '{task.number}', 100, 400, $4, '[{"code":"TEMPLATE_UNUSED_FIELD","tag":"task.priority"}]') RETURNING id`,
          [template, no, file.rows[0]!.id, admin],
        )
      ).rows[0]!.id;
    };
    const states = async () =>
      (
        await pool.query<{ version_no: number; state: string }>(
          `SELECT version_no, state FROM v_document_template_versions WHERE template_id = $1 ORDER BY version_no`,
          [template],
        )
      ).rows.map((r) => `${r.version_no}:${r.state}`);
    const v2 = await version(2);
    const v3 = await version(3);
    expect(await states()).toEqual(['1:ACTIVE', '2:PENDING', '3:PENDING']);
    await pool.query(`CALL sp_document_template_activate($1, $2)`, [v2, admin]);
    expect(await states()).toEqual(['1:ARCHIVED', '2:ACTIVE', '3:PENDING']);
    // Przywrócenie wersji 1 bez kopiowania pliku; ponowna aktywacja aktywnej niczego nie zmienia.
    const v1 = (
      await pool.query<{ id: string }>(
        `SELECT id FROM document_template_versions WHERE template_id = $1 AND version_no = 1`,
        [template],
      )
    ).rows[0]!.id;
    await pool.query(`CALL sp_document_template_activate($1, $2)`, [v1, admin]);
    await pool.query(`CALL sp_document_template_activate($1, $2)`, [v1, admin]);
    expect(await states()).toEqual(['1:ACTIVE', '2:ARCHIVED', '3:PENDING']);
    const activated = await pool.query(
      `SELECT activated_by_name, documents FROM v_document_template_versions WHERE id = $1`,
      [v1],
    );
    expect(activated.rows[0]).toEqual({ activated_by_name: 'Piotr Mazur', documents: 0 });
    // Równoległa aktywacja: blokada szablonu szereguje, więc zostaje jedna aktywna wersja.
    await Promise.all([
      pool.query(`CALL sp_document_template_activate($1, $2)`, [v2, admin]),
      pool.query(`CALL sp_document_template_activate($1, $2)`, [v3, admin]),
    ]);
    const active = await pool.query(
      `SELECT count(*)::int AS n FROM document_template_versions WHERE template_id = $1 AND is_active`,
      [template],
    );
    expect(active.rows[0]).toEqual({ n: 1 });

    expect((await domainCode(pool.query(`DELETE FROM document_template_versions WHERE id = $1`, [v1])))?.code).toBe(
      'TEMPLATE_VERSION_NOT_PENDING',
    );
    expect(
      (await domainCode(pool.query(`UPDATE document_template_versions SET fields = '{x}' WHERE id = $1`, [v1])))?.code,
    ).toBe('TEMPLATE_VERSION_IMMUTABLE');
    const v4 = await version(4);
    await pool.query(`DELETE FROM document_template_versions WHERE id = $1`, [v4]);
    expect(
      (await domainCode(pool.query(`CALL sp_document_template_activate(gen_random_uuid(), NULL)`)))?.details,
    ).toEqual({
      entity: 'document_template_version',
    });

    // Drugi szablon rodzaju: domyślny wymaga aktywnej wersji, a zmiana domyślnego zostawia jeden domyślny.
    const other = (
      await pool.query<{ id: string }>(
        `INSERT INTO document_templates (document_type, name) VALUES ('SERVICE_PROTOCOL', 'Protokół skrócony') RETURNING id`,
      )
    ).rows[0]!.id;
    expect((await domainCode(pool.query(`CALL sp_document_template_set_default($1)`, [other])))?.code).toBe(
      'TEMPLATE_NO_ACTIVE_VERSION',
    );
    const file = await pool.query<{ id: string }>(
      `INSERT INTO files (storage_key, purpose, content_type) VALUES ('document-template/test/' || gen_random_uuid(), 'DOCUMENT_TEMPLATE', 'x') RETURNING id`,
    );
    const otherVersion = (
      await pool.query<{ id: string }>(
        `INSERT INTO document_template_versions (template_id, version_no, file_id, size_bytes, uncompressed_bytes) VALUES ($1, 1, $2, 1, 1) RETURNING id`,
        [other, file.rows[0]!.id],
      )
    ).rows[0]!.id;
    await pool.query(`CALL sp_document_template_activate($1, NULL)`, [otherVersion]);
    await pool.query(`CALL sp_document_template_set_default($1)`, [other]);
    const defaults = await pool.query(
      `SELECT name FROM document_templates WHERE document_type = 'SERVICE_PROTOCOL' AND is_default`,
    );
    expect(defaults.rows).toEqual([{ name: 'Protokół skrócony' }]);
    await pool.query(`CALL sp_document_template_set_default($1)`, [template]);

    // Plik wersji musi być szablonem; naklejka z kodem QR nie ma szablonu.
    const photo = await pool.query<{ id: string }>(
      `INSERT INTO files (storage_key, purpose, content_type) VALUES ('ticket/' || gen_random_uuid(), 'TICKET_PHOTO', 'image/jpeg') RETURNING id`,
    );
    expect(
      (
        await domainCode(
          pool.query(
            `INSERT INTO document_template_versions (template_id, version_no, file_id, size_bytes, uncompressed_bytes) VALUES ($1, 9, $2, 1, 1)`,
            [template, photo.rows[0]!.id],
          ),
        )
      )?.code,
    ).toBe('TEMPLATE_FILE_INVALID');
    await expect(
      pool.query(`INSERT INTO document_templates (document_type, name) VALUES ('SCOOTER_LABEL', 'Naklejka')`),
    ).rejects.toThrow(/document_templates_not_built_in/);
  });

  it('wygenerowane dokumenty: wersja szablonu tylko poza naklejką, plik w żądanym formacie, kod błędu, ponowne użycie paragonu PDF', async () => {
    const admin = await staffId();
    const customer = (await pool.query<{ id: string }>(`SELECT user_id AS id FROM receipts ORDER BY issued_at LIMIT 1`))
      .rows[0]!.id;
    const receipt = (
      await pool.query<{ id: string }>(`SELECT id FROM receipts WHERE user_id = $1 ORDER BY issued_at LIMIT 1`, [
        customer,
      ])
    ).rows[0]!.id;
    const receiptVersion = (
      await pool.query<{ id: string }>(
        `SELECT active_version_id AS id FROM v_document_templates WHERE document_type = 'RECEIPT' AND is_default`,
      )
    ).rows[0]!.id;
    const pdf = (
      await pool.query<{ id: string }>(
        `INSERT INTO files (storage_key, purpose, content_type) VALUES ('generated-document/' || gen_random_uuid(), 'GENERATED_DOCUMENT', 'application/pdf') RETURNING id`,
      )
    ).rows[0]!.id;
    const insert = (columns: Record<string, unknown>) => {
      const values = {
        document_type: 'SERVICE_PROTOCOL',
        template_version_id: null,
        entity_ref: randomUUID(),
        entity_label: 'S-1037',
        format: 'PDF',
        status: 'QUEUED',
        requested_by_staff: admin,
        ...columns,
      };
      const keys = Object.keys(values);
      return pool.query<{ id: string }>(
        `INSERT INTO generated_documents (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(values),
      );
    };
    await expect(insert({})).rejects.toThrow(/generated_documents_template_version/);
    await expect(insert({ document_type: 'SCOOTER_LABEL', template_version_id: receiptVersion })).rejects.toThrow(
      /generated_documents_template_version/,
    );
    const label = await insert({
      document_type: 'SCOOTER_LABEL',
      entity_label: '#0007',
      params: '{"layout":"single"}',
    });
    await expect(insert({ document_type: 'SCOOTER_LABEL', format: 'DOCX' })).rejects.toThrow(
      /generated_documents_label_pdf/,
    );
    await expect(
      pool.query(`UPDATE generated_documents SET status = 'SUCCEEDED', finished_at = now() WHERE id = $1`, [
        label.rows[0]!.id,
      ]),
    ).rejects.toThrow(/generated_documents_succeeded_file/);
    await expect(
      pool.query(`UPDATE generated_documents SET status = 'FAILED', finished_at = now() WHERE id = $1`, [
        label.rows[0]!.id,
      ]),
    ).rejects.toThrow(/generated_documents_failed_code/);
    await expect(
      pool.query(`UPDATE generated_documents SET status = 'SUCCEEDED', pdf_file_id = $2 WHERE id = $1`, [
        label.rows[0]!.id,
        pdf,
      ]),
    ).rejects.toThrow(/generated_documents_finished/);
    await pool.query(
      `UPDATE generated_documents SET status = 'FAILED', error_code = 'RENDER_TIMEOUT', started_at = now() - interval '30 seconds', finished_at = now()
       WHERE id = $1`,
      [label.rows[0]!.id],
    );
    await expect(insert({ document_type: 'SCOOTER_LABEL', error_code: 'zły kod' })).rejects.toThrow(
      /generated_documents_error_code/,
    );
    const listed = await pool.query(
      `SELECT state, built_in, requester_kind, staff_name, template_name, duration_ms >= 29000 AS long FROM v_generated_documents WHERE id = $1`,
      [label.rows[0]!.id],
    );
    expect(listed.rows[0]).toEqual({
      state: 'FAILED',
      built_in: true,
      requester_kind: 'STAFF',
      staff_name: 'Piotr Mazur',
      template_name: null,
      long: true,
    });

    // Paragon PDF klienta: drugie zlecenie tej samej wersji trafia na indeks częściowy i nic nie wstawia.
    const requestPdf = () =>
      pool.query<{ id: string }>(
        `INSERT INTO generated_documents (document_type, template_version_id, entity_ref, entity_label, format, requested_by_user)
         VALUES ('RECEIPT', $1, $2, 'PAR/2026/000001', 'PDF', $3)
         ON CONFLICT (entity_ref, template_version_id)
           WHERE document_type = 'RECEIPT' AND format = 'PDF' AND requested_by_user IS NOT NULL
             AND status <> 'FAILED' AND files_deleted_at IS NULL
         DO NOTHING RETURNING id`,
        [receiptVersion, receipt, customer],
      );
    const first = await requestPdf();
    expect(first.rows).toHaveLength(1);
    expect((await requestPdf()).rows).toHaveLength(0);
    // Gotowy plik po retencji nie blokuje nowego wydruku, a wydruk operatora nie podlega indeksowi.
    await pool.query(
      `UPDATE generated_documents SET status = 'SUCCEEDED', pdf_file_id = $2, started_at = now(), finished_at = now(), files_deleted_at = now()
       WHERE id = $1`,
      [first.rows[0]!.id, pdf],
    );
    const second = await requestPdf();
    expect(second.rows).toHaveLength(1);
    await pool.query(
      `UPDATE generated_documents SET status = 'FAILED', error_code = 'RENDERER_UNAVAILABLE', finished_at = now() WHERE id = $1`,
      [second.rows[0]!.id],
    );
    expect((await requestPdf()).rows).toHaveLength(1);
    await insert({ document_type: 'RECEIPT', template_version_id: receiptVersion, entity_ref: receipt });
    await insert({ document_type: 'RECEIPT', template_version_id: receiptVersion, entity_ref: receipt });
    const deleted = await pool.query(`SELECT state, requester_kind FROM v_generated_documents WHERE id = $1`, [
      first.rows[0]!.id,
    ]);
    expect(deleted.rows[0]).toEqual({ state: 'DELETED', requester_kind: 'CUSTOMER' });
    expect(
      (await pool.query(`SELECT documents FROM v_document_template_versions WHERE id = $1`, [receiptVersion])).rows[0],
    ).toEqual({ documents: 5 });
  });

  it('eksport danych: jedno zlecenie na dobę z blokadą, nieudane się nie liczą, jedno w toku, anulowanie przy usunięciu konta', async () => {
    const user = await userId('+48500000771');
    const request = () => pool.query<{ export_id: string }>(`CALL sp_data_export_request($1, NULL)`, [user]);
    const nextAllowed = async () =>
      (await pool.query<{ at: Date | null }>(`SELECT fn_data_export_next_allowed_at($1) AS at`, [user])).rows[0]!.at;
    expect(await nextAllowed()).toBeNull();
    const first = (await request()).rows[0]!.export_id;
    const limit = await domainCode(request());
    expect(limit?.code).toBe('DATA_EXPORT_LIMIT');
    const at = (
      await pool.query<{ at: Date }>(
        `SELECT requested_at + interval '24 hours' AS at FROM data_exports WHERE id = $1`,
        [first],
      )
    ).rows[0]!.at;
    expect(limit?.details).toEqual({ nextAllowedAt: at.toISOString() });
    expect((await nextAllowed())?.toISOString()).toBe(at.toISOString());

    // Nieudane zlecenie się nie liczy; drugie w toku blokuje indeks częściowy, a nie limit.
    await pool.query(
      `UPDATE data_exports SET status = 'FAILED', error_code = 'EXPORT_FAILED', finished_at = now() WHERE id = $1`,
      [first],
    );
    const retry = (await request()).rows[0]!.export_id;
    await expect(pool.query(`INSERT INTO data_exports (user_id) VALUES ($1)`, [user])).rejects.toThrow(
      /data_exports_one_open/,
    );
    await expect(
      pool.query(`UPDATE data_exports SET status = 'SUCCEEDED', finished_at = now() WHERE id = $1`, [retry]),
    ).rejects.toThrow(/data_exports_succeeded_file/);
    const file = await pool.query<{ id: string }>(
      `INSERT INTO files (storage_key, purpose, content_type, size_bytes) VALUES ('data-export/' || gen_random_uuid(), 'DATA_EXPORT', 'application/json', 2048) RETURNING id`,
    );
    await pool.query(
      `UPDATE data_exports SET status = 'SUCCEEDED', file_id = $2, size_bytes = 2048, started_at = now(), finished_at = now(),
              expires_at = now() + interval '7 days' WHERE id = $1`,
      [retry, file.rows[0]!.id],
    );
    expect((await domainCode(request()))?.code).toBe('DATA_EXPORT_LIMIT');
    // Zlecenie sprzed ponad doby nie blokuje.
    await pool.query(`UPDATE data_exports SET requested_at = now() - interval '25 hours' WHERE id = $1`, [retry]);
    const third = (await request()).rows[0]!.export_id;
    const states = await pool.query(`SELECT state FROM v_data_exports WHERE user_id = $1 ORDER BY requested_at`, [
      user,
    ]);
    expect(states.rows.map((r) => r.state)).toEqual(['SUCCEEDED', 'FAILED', 'QUEUED']);

    await pool.query(`CALL sp_anonymize_user($1)`, [user]);
    const cancelled = await pool.query(`SELECT status, error_code FROM data_exports WHERE id = $1`, [third]);
    expect(cancelled.rows[0]).toEqual({ status: 'FAILED', error_code: 'ACCOUNT_DELETED' });
    expect((await domainCode(request()))?.details).toEqual({ entity: 'user' });
  });

  it('publiczne odczyty: hulajnoga po numerze bez stanu floty, wersje dokumentów bez roboczych', async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'v_public_scooters' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      'number',
      'model_code',
      'model_name',
      'photo_media_id',
      'photo_path',
      'photo_alt_text',
      'photo_width',
      'photo_height',
    ]);
    const scooter = await pool.query(`SELECT number, model_code FROM v_public_scooters WHERE number = 1`);
    expect(scooter.rows).toEqual([{ number: 1, model_code: 'BASE' }]);
    await pool.query(`UPDATE scooters SET status = 'RETIRED', status_reason = 'END_OF_LIFE' WHERE number = 2`);
    expect((await pool.query(`SELECT 1 FROM v_public_scooters WHERE number = 2`)).rowCount).toBe(0);

    const page = (
      await pool.query<{ id: string }>(
        `INSERT INTO content_pages (slug, name) VALUES ('polityka-cookies', 'Polityka cookies') RETURNING id`,
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO content_page_versions (page_id, version_no, title, body_md, status, published_at, change_summary) VALUES
         ($1, 1, 'Polityka cookies', 'v1', 'ARCHIVED', '2026-11-01T08:00:00Z', NULL),
         ($1, 2, 'Polityka cookies', 'v2', 'PUBLISHED', '2026-11-18T08:00:00Z', 'Nowy punkt'),
         ($1, 3, 'Polityka cookies', 'v3', 'DRAFT', NULL, NULL)`,
      [page],
    );
    const versions = await pool.query(
      `SELECT version_no, body_md, is_current, valid_to FROM v_public_document_versions WHERE slug = 'polityka-cookies' ORDER BY version_no`,
    );
    expect(versions.rows).toEqual([
      { version_no: 1, body_md: 'v1', is_current: false, valid_to: new Date('2026-11-18T08:00:00Z') },
      { version_no: 2, body_md: 'v2', is_current: true, valid_to: null },
    ]);
    // Wersja robocza ma blokadę optymistyczną (dług z iteracji 2).
    const draft = await pool.query(`SELECT version FROM content_page_versions WHERE page_id = $1 AND version_no = 3`, [
      page,
    ]);
    expect(draft.rows[0]).toEqual({ version: 1 });
  });

  it('role: Redaktor z treściami, podglądem szablonów i pulpitem; dane firmy zmienia tylko Administrator', async () => {
    const grants = async (role: string) =>
      (
        await pool.query<{ code: string }>(
          `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = $1 ORDER BY 1`,
          [role],
        )
      ).rows.map((r) => r.code);
    expect(await grants('Redaktor')).toEqual(['content.read', 'content.write', 'dashboard.read', 'templates.read']);
    const company = await pool.query(
      `SELECT r.name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'company.write'`,
    );
    expect(company.rows).toEqual([{ name: 'Administrator' }]);
    const editor = await staffId('r@test.local');
    const can = async (code: string) =>
      (await pool.query<{ ok: boolean }>(`SELECT fn_staff_has_permission($1, $2) AS ok`, [editor, code])).rows[0]!.ok;
    expect(await can('content.write')).toBe(true);
    expect(await can('templates.write')).toBe(false);
    expect(await can('company.write')).toBe(false);
    expect(await can('documents.generate')).toBe(false);
  });

  it('widoki danych wydruków: paragon z grupami VAT, przejazd z osią czasu, protokół z częściami, karta, zgłoszenie, korekta salda', async () => {
    const receipt = await pool.query(
      `SELECT r.number, r.is_correction, r.seller_name, jsonb_array_length(r.items) AS items, r.vat_groups, r.has_outside_vat,
              r.total_amount = (SELECT sum((g->>'gross')::bigint) FROM jsonb_array_elements(r.vat_groups) g) AS totals_match
       FROM v_doc_receipt r ORDER BY r.issued_at LIMIT 1`,
    );
    expect(receipt.rows[0]).toMatchObject({
      is_correction: false,
      seller_name: '[dane sprzedawcy]',
      has_outside_vat: false,
      totals_match: true,
    });
    expect(receipt.rows[0].items).toBeGreaterThan(0);
    expect(receipt.rows[0].vat_groups).toEqual([expect.objectContaining({ vatRate: 23 })]);

    const rental = await pool.query(
      `SELECT number, receipt_number IS NOT NULL AS has_receipt, start_zone_code, end_zone_code IS NOT NULL AS has_end,
              (SELECT array_agg(t->>'kind' ORDER BY ord) FROM jsonb_array_elements(timeline) WITH ORDINALITY x(t, ord)) AS kinds
       FROM v_doc_rental WHERE state = 'ENDED' ORDER BY number LIMIT 1`,
    );
    expect(rental.rows[0]).toMatchObject({ has_receipt: true, has_end: true });
    expect(rental.rows[0].start_zone_code).toMatch(/^P-0[12]$/);
    expect(rental.rows[0].kinds).toEqual(expect.arrayContaining(['EVENT', 'COMMAND']));

    const task = await pool.query(
      `SELECT parts, parts_cost, result_note IS NOT NULL AS has_note, scooter_status FROM v_doc_service_task WHERE status = 'DONE' LIMIT 1`,
    );
    expect(task.rows[0].parts.map((p: { sku: string }) => p.sku)).toEqual(['BRK-CBL-R', 'BRK-PAD-R']);
    expect(task.rows[0]).toMatchObject({ parts_cost: '3650', has_note: true });

    const card = await pool.query(
      `SELECT number, model_code, jsonb_array_length(service_tasks) AS tasks, jsonb_array_length(tickets) AS tickets
       FROM v_doc_scooter WHERE jsonb_array_length(service_tasks) > 0 ORDER BY number LIMIT 1`,
    );
    expect(card.rows[0]).toMatchObject({ model_code: 'BASE' });
    expect(card.rows[0].tickets).toBeGreaterThan(0);

    const ticket = await pool.query(
      `SELECT number, jsonb_array_length(timeline) > 0 AS has_timeline, photo_list FROM v_doc_ticket WHERE source = 'USER' ORDER BY number LIMIT 1`,
    );
    expect(ticket.rows[0]).toMatchObject({ has_timeline: true, photo_list: [] });

    const user = (await pool.query<{ id: string }>(`SELECT user_id AS id FROM wallets ORDER BY balance DESC LIMIT 1`))
      .rows[0]!.id;
    await pool.query(
      `CALL sp_wallet_post($1, 'ADJUSTMENT', 500, NULL, NULL, NULL, $2, 'GOODWILL', 'Przeprosiny', NULL, NULL)`,
      [user, await staffId()],
    );
    const adjustment = await pool.query(
      `SELECT amount, balance_after - balance_before AS delta, staff_name, reason FROM v_doc_wallet_adjustment
       WHERE user_id = $1 ORDER BY entry_id DESC LIMIT 1`,
      [user],
    );
    expect(adjustment.rows[0]).toEqual({ amount: '500', delta: '500', staff_name: 'Piotr Mazur', reason: 'GOODWILL' });
  });

  it('poprawki 0012: adres przycisku jak isAllowedHref, wydruk pamięta dane klienta, szerokość grafiki z blokadą', async () => {
    // Adres przycisku: CHECK bazy daje ten sam wynik co `isAllowedHref` z shared (także `/\\host` i znaki sterujące).
    const urls = [
      'https://example.org/a',
      'mailto:pomoc@example.org',
      'tel:+48500000000',
      '/aktualnosci',
      '/',
      '#strefy',
      '/#aplikacja',
      'http://example.org',
      'javascript:alert(1)',
      '//evil.example',
      '/\\evil.example',
      '/a\\b',
      'https://\\evil.example',
      'https:///evil.example',
      'https://',
      'data:text/html,x',
      'tel:abc',
      'mailto:',
      '/a b',
      '/a\u0007b',
      '#a\tb',
      `/${'a'.repeat(2000)}`,
    ];
    let position = 200;
    for (const url of urls) {
      const result = await domainCode(
        pool.query(
          `INSERT INTO content_blocks (key, client, position, title, cta_label, cta_url)
           VALUES ('web.href', 'WEB', $1, 'X', 'Przycisk', $2)`,
          [position++, url],
        ),
      );
      expect(result === null, url).toBe(isAllowedHref(url));
      if (result) expect(result.code, url).toBe('CONTENT_LINK_SCHEME');
    }

    // Wydruk: flaga danych klienta w wierszu i w widoku listy (domyślnie bez danych, zapisuje ją wypełnienie).
    const columns = await pool.query<{ table_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT table_name, is_nullable, column_default FROM information_schema.columns
       WHERE column_name = 'customer_data_visible' ORDER BY table_name`,
    );
    expect(columns.rows).toEqual([
      { table_name: 'generated_documents', is_nullable: 'NO', column_default: 'false' },
      { table_name: 'v_generated_documents', is_nullable: 'YES', column_default: null },
    ]);

    // „Zastąp plik” (FOR UPDATE) czeka na zapis sekcji, który odczytał szerokość grafiki (FOR SHARE).
    const fileId = (
      await pool.query<{ id: string }>(
        `INSERT INTO files (storage_key, purpose, content_type, size_bytes, sha256, width, height)
         VALUES ('media/test/' || gen_random_uuid(), 'MEDIA', 'image/png', 10, repeat('c', 64), 1600, 900) RETURNING id`,
      )
    ).rows[0]!.id;
    const mediaId = (
      await pool.query<{ id: string }>(
        `INSERT INTO media_assets (key, name, file_id, alt_text) VALUES ('blokada-szerokosci', 'x', $1, 'Tekst alternatywny')
         RETURNING id`,
        [fileId],
      )
    ).rows[0]!.id;
    const section = await pool.connect();
    const replace = await pool.connect();
    try {
      await section.query('BEGIN');
      const widths = await new DrizzleMediaRepository(createDb(section as unknown as Pool)).widths([mediaId]);
      expect(widths.get(mediaId)).toBe(1600);
      await replace.query('BEGIN');
      await expect(
        replace.query(`SELECT 1 FROM media_assets WHERE id = $1 FOR UPDATE NOWAIT`, [mediaId]),
      ).rejects.toThrow(/could not obtain lock/);
    } finally {
      await replace.query('ROLLBACK').catch(() => undefined);
      await section.query('ROLLBACK').catch(() => undefined);
      replace.release();
      section.release();
    }
  });
});
