import { createHash, randomUUID } from 'node:crypto';
import * as shared from '@hulajnogi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FILE_STORAGE, type MemoryFileStorage } from '../src/files/file-storage.js';
import { FilesService } from '../src/files/files.service.js';
import { JOBS } from '../src/jobs/jobs.service.js';
import { MEDIA_CACHE_CONTROL, MEDIA_REDIRECT_CACHE_CONTROL } from '../src/content/public-content.controller.js';
import { contentContext, png, type ContentContext } from './content-helpers.js';

const adminUrl = process.env.DATABASE_URL;

const SVG = Buffer.from(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64, 1)]);

describe.skipIf(!adminUrl)('API: biblioteka mediów (ADR 0064)', () => {
  let ctx: ContentContext;
  let storage: MemoryFileStorage;

  beforeAll(async () => {
    ctx = await contentContext('media');
    storage = ctx.app.get<MemoryFileStorage>(FILE_STORAGE);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /** Wysyłka grafiki przez Redaktora i grafika w bibliotece. */
  async function media(key: string, width = 1600, height = 900): Promise<shared.MediaDetails> {
    const file = (
      await ctx.upload(ctx.editor)('MEDIA', { data: png(width, height), filename: `${key}.png` })
    ).json<shared.FileView>();
    const created = await ctx.editor({
      method: 'POST',
      url: '/admin/media',
      payload: { fileId: file.id, key, altText: `Grafika ${key}` },
    });
    expect(created.statusCode).toBe(201);
    return created.json<shared.MediaDetails>();
  }

  it('wysyłka: typ po sygnaturze, 5 MB, wymiary z nagłówka i ostrzeżenie, uprawnienie content.write', async () => {
    const upload = ctx.upload(ctx.editor);
    const ok = await upload('MEDIA', { data: png(3000, 1500) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<shared.FileView>()).toMatchObject({
      purpose: 'MEDIA',
      contentType: 'image/png',
      width: 3000,
      height: 1500,
      warnings: ['IMAGE_LARGE_DIMENSIONS'],
    });
    const svg = await upload('MEDIA', { data: SVG, type: 'image/svg+xml' });
    expect(svg.statusCode).toBe(415);
    expect(svg.json()).toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED', details: { detected: 'image/svg+xml' } });
    expect((await upload('MEDIA', { data: GIF, type: 'image/gif' })).json()).toMatchObject({
      details: { detected: 'image/gif' },
    });
    const huge = await upload('MEDIA', { data: png(9000, 400) });
    expect(huge.statusCode).toBe(422);
    expect(huge.json()).toMatchObject({ code: 'IMAGE_DIMENSIONS_TOO_LARGE', details: { maxDimension: 8000 } });
    const broken = Buffer.from(png(10, 10));
    broken.write('XXXX', 12, 'ascii');
    expect((await upload('MEDIA', { data: broken })).json()).toMatchObject({ code: 'IMAGE_UNREADABLE' });
    const tooBig = await upload('MEDIA', { data: png(1000, 1000, 5 * 1024 * 1024) });
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json()).toMatchObject({ code: 'FILE_TOO_LARGE', details: { maxBytes: shared.MEDIA_MAX_BYTES } });

    // Serwisant bez content.write, klient nie zna celu MEDIA.
    expect((await ctx.upload(ctx.staff.technician)('MEDIA', { data: png(10, 10) })).json()).toMatchObject({
      code: 'FORBIDDEN',
      details: { permission: 'content.write' },
    });
    const anna = await ctx.register('+48512800001', 'Anna Media');
    const body = (await import('./content-helpers.js')).multipart({ purpose: 'MEDIA' }, { data: png(10, 10) });
    const customer = await ctx.app.inject({
      method: 'POST',
      url: '/files',
      headers: { ...body.headers, authorization: `Bearer ${anna.token}` },
      payload: body.payload,
    });
    expect(customer.statusCode).toBe(400);
  });

  it('grafika: klucz, tekst alternatywny, publiczny odczyt z cache i 308 po zastąpieniu pliku', async () => {
    const upload = ctx.upload(ctx.editor);
    const file = (
      await upload('MEDIA', { data: png(1600, 900), filename: 'Aktualność kampus.png' })
    ).json<shared.FileView>();
    const create = (payload: Record<string, unknown>) => ctx.editor({ method: 'POST', url: '/admin/media', payload });
    expect((await create({ fileId: file.id, key: 'kampus', altText: 'ab' })).statusCode).toBe(400);
    expect((await create({ fileId: file.id, key: 'scooter.inny', altText: 'Hulajnoga' })).json()).toMatchObject({
      code: 'MEDIA_KEY_RESERVED',
    });
    expect((await create({ fileId: randomUUID(), key: 'kampus', altText: 'Kampus' })).statusCode).toBe(404);
    const created = await create({ fileId: file.id, key: 'kampus', altText: 'Kampus politechniki', caption: 'Rybnik' });
    expect(created.statusCode).toBe(201);
    const kampus = created.json<shared.MediaDetails>();
    expect(kampus).toMatchObject({
      key: 'kampus',
      name: 'Aktualność kampus.png',
      width: 1600,
      height: 900,
      isSystem: false,
      usageCount: 0,
      usages: [],
      version: 1,
    });
    expect(kampus.url).toMatch(new RegExp(`^/media/${kampus.id}/[0-9a-f]{64}\\.png$`));
    // Ten sam plik drugi raz i zajęty klucz.
    expect((await create({ fileId: file.id, key: 'kampus-2', altText: 'Kampus' })).json()).toMatchObject({
      code: 'FILE_ALREADY_ATTACHED',
    });
    const other = (await upload('MEDIA', { data: png(800, 600) })).json<shared.FileView>();
    expect((await create({ fileId: other.id, key: 'kampus', altText: 'Kampus' })).json()).toMatchObject({
      code: 'MEDIA_KEY_TAKEN',
    });

    const read = await ctx.app.inject({ method: 'GET', url: kampus.url });
    expect(read.statusCode).toBe(200);
    expect(read.headers).toMatchObject({
      'cache-control': MEDIA_CACHE_CONTROL,
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    });
    expect(read.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(read.rawPayload.length).toBe(Number(read.headers['content-length']));
    const sha = kampus.url.split('/').at(-1)!.split('.')[0]!;
    expect(read.headers.etag).toBe(`"${sha}"`);
    const cached = await ctx.app.inject({ method: 'GET', url: kampus.url, headers: { 'if-none-match': `"${sha}"` } });
    expect(cached.statusCode).toBe(304);
    expect((await ctx.app.inject({ method: 'GET', url: `/media/${randomUUID()}/${sha}.png` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/media/${kampus.id}/nie-suma.png` })).statusCode).toBe(404);

    // Nazwa, tekst alternatywny i podpis.
    const updated = await ctx.editor({
      method: 'PATCH',
      url: `/admin/media/${kampus.id}`,
      payload: { version: 1, name: 'Kampus', altText: 'Kampus z lotu ptaka', caption: null },
    });
    expect(updated.json<shared.MediaDetails>()).toMatchObject({
      version: 2,
      altText: 'Kampus z lotu ptaka',
      caption: null,
    });

    // „Zastąp plik”: ten sam identyfikator, nowy adres; stary adres prowadzi na bieżący (308).
    const next = (await upload('MEDIA', { data: png(1700, 900) })).json<shared.FileView>();
    const replaced = await ctx.editor({
      method: 'POST',
      url: `/admin/media/${kampus.id}/file`,
      payload: { fileId: next.id, version: 2 },
    });
    expect(replaced.statusCode).toBe(200);
    const after = replaced.json<shared.MediaDetails>();
    expect(after).toMatchObject({ id: kampus.id, key: 'kampus', width: 1700, version: 3 });
    expect(after.url).not.toBe(kampus.url);
    const redirect = await ctx.app.inject({ method: 'GET', url: kampus.url });
    expect(redirect.statusCode).toBe(308);
    expect(redirect.headers).toMatchObject({ location: after.url, 'cache-control': MEDIA_REDIRECT_CACHE_CONTROL });
    expect((await ctx.app.inject({ method: 'GET', url: after.url })).statusCode).toBe(200);

    // Stary plik nie jest już niczym wskazywany: `files.cleanup` usuwa go po 24 h, nowego nie rusza.
    const later = new Date(Date.now() + 25 * 3600_000);
    await ctx.app.get(FilesService).cleanup(later);
    const status = async (id: string) =>
      (await ctx.pool.query<{ status: string }>(`SELECT status::text FROM files WHERE id = $1`, [id])).rows[0]!.status;
    expect(await status(file.id)).toBe('DELETED');
    expect(await status(next.id)).toBe('READY');

    const history = (await ctx.editor({ method: 'GET', url: `/admin/media/${kampus.id}/history` })).json<
      shared.ContentHistoryEntry[]
    >();
    expect(history.map((h) => h.action)).toEqual([
      'media_asset.file_replaced',
      'media_asset.updated',
      'media_asset.created',
    ]);
    const list = (
      await ctx.editor({ method: 'GET', url: '/admin/media', query: { q: 'kampus', 'usages.lte': '0' } })
    ).json<shared.ListResponse<shared.MediaListItem>>();
    expect(list.items).toEqual([expect.objectContaining({ id: kampus.id, url: after.url, usages: 0 })]);
  });

  it('użycia: minimalna szerokość sekcji, blokada usunięcia, grafika systemowa i usunięcie nieużytej', async () => {
    const narrow = await media('waska', 700, 600);
    const wide = await media('szeroka', 1400, 700);
    const url = '/admin/content-sections/web.hero';
    const hero = (await ctx.editor({ method: 'GET', url })).json<shared.ContentSectionView>();
    const save = (mediaId: string) =>
      ctx.editor({
        method: 'PUT',
        url,
        payload: {
          version: hero.header.version,
          header: {
            title: hero.header.title,
            bodyMd: hero.header.bodyMd,
            mediaId,
            buttonLabel: hero.header.buttonLabel,
            buttonHref: hero.header.buttonHref,
            icon: null,
            status: 'PUBLISHED',
          },
        },
      });
    const tooNarrow = await save(narrow.id);
    expect(tooNarrow.statusCode).toBe(422);
    expect(tooNarrow.json()).toMatchObject({
      details: {
        issues: [{ field: 'mediaId', code: 'MEDIA_TOO_NARROW', minWidth: shared.HERO_MIN_WIDTH, width: 700 }],
      },
    });
    const missing = await save(randomUUID());
    expect(missing.json()).toMatchObject({ details: { issues: [{ field: 'mediaId', code: 'MEDIA_NOT_FOUND' }] } });
    expect((await save(wide.id)).statusCode).toBe(200);

    const used = (await ctx.editor({ method: 'GET', url: `/admin/media/${wide.id}` })).json<shared.MediaDetails>();
    expect(used.usages).toEqual([
      { kind: 'CONTENT_BLOCK', id: hero.header.id, label: 'web.hero', sectionKey: 'web.hero' },
    ]);
    const blocked = await ctx.editor({
      method: 'DELETE',
      url: `/admin/media/${wide.id}`,
      query: { version: String(used.version) },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      code: 'MEDIA_IN_USE',
      details: { usages: [{ kind: 'CONTENT_BLOCK', label: 'web.hero' }] },
    });
    // Zastąpienie pliku użytej grafiki węższym plikiem łamie wymaganie sekcji.
    const small = (await ctx.upload(ctx.editor)('MEDIA', { data: png(700, 500) })).json<shared.FileView>();
    const replace = await ctx.editor({
      method: 'POST',
      url: `/admin/media/${wide.id}/file`,
      payload: { fileId: small.id, version: used.version },
    });
    expect(replace.json()).toMatchObject({
      code: 'MEDIA_TOO_NARROW',
      details: { section: 'web.hero', minWidth: shared.HERO_MIN_WIDTH },
    });

    // Strona widzi grafikę hero z wymiarami i adresem.
    const web = (await ctx.app.inject({ method: 'GET', url: '/content/web' })).json<shared.PublicContent>();
    expect(web.sections['web.hero']!.media).toEqual({
      id: wide.id,
      key: 'szeroka',
      url: used.url,
      altText: 'Grafika szeroka',
      caption: null,
      width: 1400,
      height: 700,
    });

    // Grafika systemowa (`scooter.*`) jest tylko z danych startowych i nie da się jej usunąć.
    const systemFile = randomUUID();
    await ctx.pool.query(
      `INSERT INTO files (id, storage_key, purpose, content_type, size_bytes, sha256, width, height)
       VALUES ($1, $2, 'MEDIA', 'image/png', 100, $3, 900, 900)`,
      [systemFile, `media/test/${systemFile}.png`, 'a'.repeat(64)],
    );
    const system = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO media_assets (key, name, file_id, alt_text, is_system)
         VALUES ('scooter.grafit.trzy', 'render', $1, 'Hulajnoga grafitowa', true) RETURNING id`,
        [systemFile],
      )
    ).rows[0]!.id;
    const systemDelete = await ctx.editor({ method: 'DELETE', url: `/admin/media/${system}`, query: { version: '1' } });
    expect(systemDelete.statusCode).toBe(409);
    expect(systemDelete.json()).toMatchObject({ code: 'MEDIA_SYSTEM' });
    const mobile = (await ctx.app.inject({ method: 'GET', url: '/content/mobile' })).json<shared.PublicContent>();
    expect(mobile.systemMedia['scooter.grafit.trzy']).toMatchObject({ id: system, width: 900 });

    // Nieużyta grafika znika razem z obiektem w magazynie; plik zostaje jako `DELETED`.
    const key = (
      await ctx.pool.query<{ storage_key: string; file_id: string }>(
        `SELECT f.storage_key, f.id AS file_id FROM media_assets m JOIN files f ON f.id = m.file_id WHERE m.id = $1`,
        [narrow.id],
      )
    ).rows[0]!;
    expect(storage.objects.has(key.storage_key)).toBe(true);
    expect(
      (await ctx.editor({ method: 'DELETE', url: `/admin/media/${narrow.id}`, query: { version: '1' } })).statusCode,
    ).toBe(204);
    expect(storage.objects.has(key.storage_key)).toBe(false);
    const file = await ctx.pool.query<{ status: string }>(`SELECT status::text FROM files WHERE id = $1`, [
      key.file_id,
    ]);
    expect(file.rows[0]!.status).toBe('DELETED');
    expect((await ctx.app.inject({ method: 'GET', url: narrow.url })).statusCode).toBe(404);
    expect(
      (await ctx.staff.dispatcher({ method: 'DELETE', url: `/admin/media/${wide.id}`, query: { version: '1' } }))
        .statusCode,
    ).toBe(403);
  });

  it('zdjęcie modelu z biblioteki: strona /h/{numer} i parametry modelu na stronie', async () => {
    const photo = await media('model-bok', 1200, 800);
    const models = (await ctx.staff.admin({ method: 'GET', url: '/admin/scooter-models' })).json<
      shared.ListResponse<shared.ScooterModelListItem>
    >().items;
    const base = models.find((m) => m.code === 'BASE')!;
    const updated = await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/scooter-models/${base.id}`,
      payload: { version: base.version, photoMediaId: photo.id },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<shared.ScooterModelDetails>()).toMatchObject({
      photoMediaId: photo.id,
      photo: { url: photo.url },
    });
    const scooter = (
      await ctx.app.inject({ method: 'GET', url: '/public/scooters/1' })
    ).json<shared.PublicScooterView>();
    expect(scooter.model.photo).toMatchObject({ id: photo.id, altText: 'Grafika model-bok', width: 1200 });
    const web = (await ctx.app.inject({ method: 'GET', url: '/content/web' })).json<shared.PublicContent>();
    expect(web.models![0]!.photo).toMatchObject({ id: photo.id });
    const usage = (await ctx.editor({ method: 'GET', url: `/admin/media/${photo.id}` })).json<shared.MediaDetails>();
    expect(usage.usages).toEqual([{ kind: 'SCOOTER_MODEL', id: base.id, label: base.name, sectionKey: null }]);
    const missing = await ctx.staff.admin({
      method: 'PATCH',
      url: `/admin/scooter-models/${base.id}`,
      payload: { version: base.version + 1, photoMediaId: randomUUID() },
    });
    expect(missing.statusCode).toBe(422);

    // Zmiana grafiki użytej przez model odświeża też strony /h/{numer} (tag `scooters`), nie tylko `content`.
    const tags = () =>
      ctx
        .jobs()
        .sent.filter((job) => job.name === JOBS.siteRevalidate)
        .map((job) => job.data.tag);
    const before = tags().length;
    const edited = await ctx.editor({
      method: 'PATCH',
      url: `/admin/media/${photo.id}`,
      payload: { version: usage.version, name: usage.name, altText: 'Model z boku', caption: null },
    });
    expect(edited.statusCode).toBe(200);
    expect(tags().slice(before)).toEqual(expect.arrayContaining(['content', 'scooters']));
    const next = (
      await ctx.upload(ctx.editor)('MEDIA', { data: png(1300, 800), filename: 'model-bok-2.png' })
    ).json<shared.FileView>();
    const afterEdit = tags().length;
    const replaced = await ctx.editor({
      method: 'POST',
      url: `/admin/media/${photo.id}/file`,
      payload: { version: edited.json<shared.MediaDetails>().version, fileId: next.id },
    });
    expect(replaced.statusCode).toBe(200);
    expect(tags().slice(afterEdit)).toEqual(expect.arrayContaining(['content', 'scooters']));
  });

  it('JPEG ze zdjęcia telefonu trafia do biblioteki bez EXIF (GPS), z orientacją i sumą oczyszczonego pliku', async () => {
    const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
    const segment = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
    const ascii = (text: string) => [...Buffer.from(text, 'latin1')];
    // EXIF: IFD0 z orientacją 6 (obrót o 90°), a za nim „GPS” z położeniem (dane testowe).
    const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
    const jpeg = Buffer.from([
      0xff,
      0xd8,
      ...segment(0xe1, [...ascii('Exif\0\0'), ...tiff, ...ascii('GPS 50.0919N 18.5417E')]),
      ...segment(0xed, ascii('Photoshop 3.0 8BIM Rybnik')),
      ...segment(
        0xdb,
        Array.from({ length: 65 }, () => 1),
      ),
      ...segment(0xc0, [8, ...be16(1080), ...be16(1920), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
      ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
      0x12,
      0x34,
      0xff,
      0xd9,
    ]);
    const res = await ctx.upload(ctx.editor)('MEDIA', { data: jpeg, filename: 'telefon.jpg', type: 'image/jpeg' });
    expect(res.statusCode).toBe(201);
    const file = res.json<shared.FileView>();
    expect(file).toMatchObject({ contentType: 'image/jpeg', width: 1080, height: 1920 });
    const row = (
      await ctx.pool.query<{ storage_key: string; sha256: string; size_bytes: number }>(
        'SELECT storage_key, sha256, size_bytes FROM files WHERE id = $1',
        [file.id],
      )
    ).rows[0]!;
    const stored = storage.objects.get(row.storage_key)!.body;
    expect(stored.includes(Buffer.from('GPS'))).toBe(false);
    expect(stored.includes(Buffer.from('Photoshop'))).toBe(false);
    expect(stored.includes(Buffer.from('Exif'))).toBe(true);
    expect(row.size_bytes).toBe(stored.length);
    expect(row.sha256).toBe(createHash('sha256').update(stored).digest('hex'));
    expect(file.sizeBytes).toBe(stored.length);
  });
});
