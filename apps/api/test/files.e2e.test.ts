import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import * as shared from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { CommandsService } from '../src/fleet/commands.service.js';
import { FILE_STORAGE, MemoryFileStorage, S3FileStorage } from '../src/files/file-storage.js';
import { FilesService } from '../src/files/files.service.js';
import { JOBS, JobsService } from '../src/jobs/jobs.service.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { asStaff, fundWallet, staffToken } from './helpers.js';

const adminUrl = process.env.DATABASE_URL;
const dbName = `hulajnogi_files_api_${randomUUID().slice(0, 8)}`;

const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 5000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.0, lon: 18.5 },
  ],
};

// Najmniejsze nagłówki obrazów: API rozpoznaje typ po sygnaturze, reszta pliku nie ma znaczenia.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(512, 1)]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');

/** Treść `multipart/form-data` dla `app.inject` (pole `purpose` i jedno pole `file`). */
function multipart(fields: Record<string, string>, file?: { data: Buffer; filename?: string; type?: string }) {
  const boundary = `----hulajnogi${randomUUID()}`;
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
  );
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename ?? 'zdjecie.jpg'}"\r\n` +
          `Content-Type: ${file.type ?? 'image/jpeg'}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe.skipIf(!adminUrl)('API: pliki (ADR 0057)', () => {
  let admin: Pool;
  let pool: Pool;
  let app: NestFastifyApplication;
  const customers: Record<'anna' | 'bartek', { id: string; token: string }> = {} as never;
  const staff: Record<'admin' | 'service', string> = {} as never;
  let rentalId: string;

  const storage = () => app.get<MemoryFileStorage>(FILE_STORAGE);
  const upload = (token: string, purpose: string, file?: Parameters<typeof multipart>[1]) => {
    const body = multipart({ purpose }, file);
    return app.inject({
      method: 'POST',
      url: '/files',
      headers: { ...body.headers, authorization: `Bearer ${token}` },
      payload: body.payload,
    });
  };
  const as = (who: keyof typeof customers) => (options: { method: 'GET' | 'POST'; url: string; payload?: object }) =>
    app.inject({ ...options, headers: { authorization: `Bearer ${customers[who].token}` } });
  const lastCommand = () =>
    app
      .get(MqttService)
      .published.filter((p) => p.topic === shared.topics.command(shared.scooterTopicId(1)))
      .at(-1)!.payload as shared.Command;
  const ack = () =>
    app
      .get(CommandsService)
      .handleAck(
        Buffer.from(JSON.stringify({ commandId: lastCommand().commandId, ok: true, ts: new Date().toISOString() })),
      );

  async function register(phone: string, name: string): Promise<{ id: string; token: string }> {
    await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
    const code = /(\d{6})/.exec(
      app
        .get(LoggingSmsGateway)
        .sent.filter((m) => m.phone === phone)
        .at(-1)!.text,
    )![1]!;
    const session = (
      await app.inject({ method: 'POST', url: '/auth/otp/verify', payload: { phone, code } })
    ).json<shared.CustomerSession>();
    await app.inject({
      method: 'POST',
      url: '/me/registration',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { name, ageConfirmed: true, acceptedVersionIds: session.me.pendingDocuments.map((d) => d.versionId) },
    });
    await fundWallet(pool, session.me.id);
    return { id: session.me.id, token: session.accessToken };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.toString() });
    pool.on('error', () => undefined);
    await runMigrations(pool);
    await seedDatabase(pool, {
      places,
      fleetSize: 1,
      admin: { email: 'a@test.local', name: 'A', passwordHash: 'x' },
      staff: [{ email: 's@test.local', name: 'S', role: 'Serwisant', passwordHash: 'x' }],
      documents: [
        { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Treść' },
        { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Treść' },
      ],
    });
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 80, position = ST_SetSRID(ST_MakePoint(18.5, 50.0), 4326)`,
    );
    app = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url.toString(),
        MQTT_ENABLED: 'false',
        JOBS_ENABLED: 'false',
        FILE_STORAGE: 'memory',
        OSRM_URL: 'http://127.0.0.1:9',
      }),
      { logger: false },
    );
    await app.init();
    customers.anna = await register('+48500300100', 'Anna');
    customers.bartek = await register('+48500300200', 'Bartek');
    const { rows } = await pool.query<{ id: string; email: string }>(`SELECT id, email FROM staff`);
    staff.admin = staffToken(app, rows.find((r) => r.email === 'a@test.local')!.id);
    staff.service = staffToken(app, rows.find((r) => r.email === 's@test.local')!.id);

    // Zakończony przejazd Anny w strefie P-01.
    const start = await as('anna')({
      method: 'POST',
      url: '/rentals',
      payload: { scooterId: (await pool.query(`SELECT id FROM scooters`)).rows[0].id },
    });
    rentalId = start.json<shared.RentalView>().id;
    await ack();
    await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    await ack();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('wysyłka: typ po sygnaturze, SHA-256, klucz z celu i miesiąca, adres podpisany na 10 min', async () => {
    const res = await upload(customers.anna.token, 'PARKING_PHOTO', {
      data: JPEG,
      filename: 'x.png',
      type: 'image/png',
    });
    expect(res.statusCode).toBe(201);
    const file = res.json<shared.FileView>();
    expect(file).toMatchObject({
      purpose: 'PARKING_PHOTO',
      contentType: 'image/jpeg',
      sizeBytes: JPEG.length,
      status: 'READY',
      url: expect.stringMatching(new RegExp(`^/files/${file.id}\\?exp=\\d+&sig=[\\w-]+$`)),
    });
    expect(new Date(file.urlExpiresAt!).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    const { rows } = await pool.query(
      `SELECT storage_key, sha256, uploaded_by, original_name FROM files WHERE id = $1`,
      [file.id],
    );
    const month = new Date().toISOString().slice(0, 7).replace('-', '/');
    expect(rows[0]).toMatchObject({
      storage_key: `parking-photo/${month}/${file.id}.jpg`,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      uploaded_by: customers.anna.id,
      original_name: 'x.png',
    });
    expect(storage().objects.get(rows[0].storage_key)?.body.equals(JPEG)).toBe(true);

    const read = await app.inject({ method: 'GET', url: file.url! });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toBe('image/jpeg');
    expect(read.headers['cache-control']).toBe('private, max-age=600');
    expect(read.rawPayload.equals(JPEG)).toBe(true);
  });

  it('wysyłka: zły typ, za duży plik, brak pliku i brak logowania', async () => {
    const pdf = await upload(customers.anna.token, 'PARKING_PHOTO', { data: PDF, filename: 'a.jpg' });
    expect(pdf.statusCode).toBe(415);
    expect(pdf.json().code).toBe('FILE_TYPE_NOT_ALLOWED');
    const big = await upload(customers.anna.token, 'PARKING_PHOTO', {
      data: Buffer.concat([JPEG, Buffer.alloc(shared.FILE_MAX_BYTES)]),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('FILE_TOO_LARGE');
    expect((await upload(customers.anna.token, 'PARKING_PHOTO')).statusCode).toBe(400);
    expect((await upload(customers.anna.token, 'MEDIA', { data: JPEG })).statusCode).toBe(400);
    const anonymous = multipart({ purpose: 'PARKING_PHOTO' }, { data: JPEG });
    expect((await app.inject({ method: 'POST', url: '/files', ...anonymous })).statusCode).toBe(401);
  });

  it('operator wysyła zdjęcie z uprawnieniem do celu', async () => {
    const ticket = await upload(staff.admin, 'TICKET_PHOTO', { data: PNG, type: 'image/png' });
    expect(ticket.statusCode).toBe(201);
    expect(ticket.json<shared.FileView>().contentType).toBe('image/png');
    const { rows } = await pool.query(`SELECT uploaded_by, uploaded_by_staff FROM files WHERE id = $1`, [
      ticket.json<shared.FileView>().id,
    ]);
    expect(rows[0]).toMatchObject({ uploaded_by: null, uploaded_by_staff: expect.any(String) });
    // Serwisant ma zgłoszenia, ale nie zarządza przejazdami.
    expect((await upload(staff.service, 'TICKET_PHOTO', { data: JPEG })).statusCode).toBe(201);
    const parking = await upload(staff.service, 'PARKING_PHOTO', { data: JPEG });
    expect(parking.statusCode).toBe(403);
  });

  it('odczyt: zmieniony podpis, wygasły adres, nieznany plik', async () => {
    const file = (await upload(customers.anna.token, 'PARKING_PHOTO', { data: JPEG })).json<shared.FileView>();
    const tampered = file.url!.replace(/sig=([\w-])/, (_m, c: string) => `sig=${c === 'A' ? 'B' : 'A'}`);
    const bad = await app.inject({ method: 'GET', url: tampered });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().code).toBe('FILE_SIGNATURE_INVALID');
    const expired = app.get(FilesService).sign(file.id, new Date(Date.now() - 11 * 60_000));
    const old = await app.inject({ method: 'GET', url: expired.url });
    expect(old.statusCode).toBe(403);
    expect(old.json().code).toBe('FILE_URL_EXPIRED');
    const unknown = app.get(FilesService).sign(randomUUID());
    expect((await app.inject({ method: 'GET', url: unknown.url })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/files/${file.id}` })).statusCode).toBe(400);
  });

  it('zdjęcie parkowania: własny plik raz, cudzy plik i cudzy przejazd to 404, zły cel 422', async () => {
    const mine = (await upload(customers.anna.token, 'PARKING_PHOTO', { data: JPEG })).json<shared.FileView>();
    const ticketPhoto = (await upload(customers.anna.token, 'TICKET_PHOTO', { data: JPEG })).json<shared.FileView>();
    const foreign = (await upload(customers.bartek.token, 'PARKING_PHOTO', { data: JPEG })).json<shared.FileView>();
    const attach = (who: keyof typeof customers, fileId: string) =>
      as(who)({ method: 'POST', url: `/rentals/${rentalId}/parking-photo`, payload: { fileId } });

    expect((await attach('bartek', foreign.id)).statusCode).toBe(404);
    const other = await attach('anna', foreign.id);
    expect(other.statusCode).toBe(404);
    expect(other.json()).toMatchObject({ code: 'NOT_FOUND', details: { entity: 'file' } });
    const wrong = await attach('anna', ticketPhoto.id);
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().code).toBe('FILE_PURPOSE_MISMATCH');

    const ok = await attach('anna', mine.id);
    expect(ok.statusCode).toBe(201);
    const rental = ok.json<shared.RentalView>();
    expect(rental).toMatchObject({ parkingPhotoRequired: false, parkingPhoto: { id: mine.id, status: 'READY' } });
    expect((await app.inject({ method: 'GET', url: rental.parkingPhoto!.url! })).statusCode).toBe(200);
    expect((await attach('anna', mine.id)).json().code).toBe('PARKING_PHOTO_EXISTS');

    const panel = (
      await asStaff(app, staff.admin)({ method: 'GET', url: `/admin/rentals/${rentalId}` })
    ).json<shared.RentalAdminDetails>();
    expect(panel.parkingPhoto).toMatchObject({ id: mine.id, url: expect.stringContaining(`/files/${mine.id}?`) });
  });

  it('retencja: zdjęcie parkowania po 30 dniach DELETED, nieprzypięte po 24 h usunięte, reszta zostaje', async () => {
    const view = (await as('anna')({ method: 'GET', url: `/rentals/${rentalId}` })).json<shared.RentalView>();
    const photoId = view.parkingPhoto!.id;
    const fresh = (await upload(customers.anna.token, 'PARKING_PHOTO', { data: JPEG })).json<shared.FileView>();
    const abandoned = (await upload(customers.anna.token, 'TICKET_PHOTO', { data: JPEG })).json<shared.FileView>();
    await pool.query(`UPDATE files SET created_at = now() - interval '31 days' WHERE id = $1`, [photoId]);
    await pool.query(`UPDATE files SET created_at = now() - interval '25 hours' WHERE id = $1`, [abandoned.id]);
    const keyOf = async (id: string) =>
      (await pool.query<{ storage_key: string }>(`SELECT storage_key FROM files WHERE id = $1`, [id])).rows[0]!
        .storage_key;

    await app.get(JobsService).run(JOBS.filesRetention);
    await app.get(JobsService).run(JOBS.filesCleanup);
    const status = async (id: string) =>
      (await pool.query(`SELECT status, deleted_at FROM files WHERE id = $1`, [id])).rows[0];
    expect(await status(photoId)).toMatchObject({ status: 'DELETED', deleted_at: expect.any(Date) });
    expect(await status(abandoned.id)).toMatchObject({ status: 'DELETED' });
    expect(await status(fresh.id)).toMatchObject({ status: 'READY', deleted_at: null });
    expect(storage().objects.has(await keyOf(photoId))).toBe(false);
    expect(storage().objects.has(await keyOf(fresh.id))).toBe(true);

    const after = (await as('anna')({ method: 'GET', url: `/rentals/${rentalId}` })).json<shared.RentalView>();
    expect(after.parkingPhoto).toMatchObject({ id: photoId, status: 'DELETED', url: null });
    const gone = await app.inject({ method: 'GET', url: view.parkingPhoto!.url! });
    expect(gone.statusCode).toBe(410);
    expect(gone.json().code).toBe('FILE_DELETED');
  });

  it('retencja pomija zdjęcie parkowania przejazdu ze zgłoszeniem (dowód w sprawie)', async () => {
    const scooterId = (await pool.query(`SELECT id FROM scooters`)).rows[0].id as string;
    const start = await as('anna')({ method: 'POST', url: '/rentals', payload: { scooterId } });
    const disputed = start.json<shared.RentalView>().id;
    await ack();
    await as('anna')({ method: 'POST', url: '/rentals/current/end' });
    await ack();
    const photo = (await upload(customers.anna.token, 'PARKING_PHOTO', { data: JPEG })).json<shared.FileView>();
    const attached = await as('anna')({
      method: 'POST',
      url: `/rentals/${disputed}/parking-photo`,
      payload: { fileId: photo.id },
    });
    expect(attached.statusCode).toBe(201);
    const complaint = await as('anna')({
      method: 'POST',
      url: '/tickets',
      payload: { scooterId, rentalId: disputed, categories: ['BILLING'], description: 'Naliczono za dużo' },
    });
    expect(complaint.statusCode).toBe(201);
    await pool.query(`UPDATE files SET created_at = now() - interval '31 days' WHERE id = $1`, [photo.id]);
    await app.get(JobsService).run(JOBS.filesRetention);
    const { rows } = await pool.query(`SELECT status::text, storage_key FROM files WHERE id = $1`, [photo.id]);
    expect(rows[0].status).toBe('READY');
    expect(storage().objects.has(rows[0].storage_key)).toBe(true);
  });

  it('usunięcie z panelu i przypięcie tego samego pliku naraz: plik przypięty nigdy nie traci obiektu', async () => {
    const scooterId = (await pool.query(`SELECT id FROM scooters`)).rows[0].id as string;
    for (let round = 0; round < 3; round++) {
      const photo = (await upload(customers.bartek.token, 'TICKET_PHOTO', { data: JPEG })).json<shared.FileView>();
      const [removed, ticket] = await Promise.all([
        asStaff(app, staff.admin)({ method: 'DELETE', url: `/admin/files/${photo.id}` }),
        as('bartek')({
          method: 'POST',
          url: '/tickets',
          payload: { scooterId, categories: ['LIGHTS'], photoIds: [photo.id] },
        }),
      ]);
      const { rows } = await pool.query(
        `SELECT f.status::text, f.storage_key, EXISTS (SELECT 1 FROM ticket_photos p WHERE p.file_id = f.id) AS attached
         FROM files f WHERE f.id = $1`,
        [photo.id],
      );
      const file = rows[0] as { status: string; storage_key: string; attached: boolean };
      if (ticket.statusCode === 201) {
        // Przypięcie wygrało: usunięcie odrzucone, obiekt zostaje.
        expect(removed.statusCode).toBe(409);
        expect(file).toMatchObject({ status: 'READY', attached: true });
        expect(storage().objects.has(file.storage_key)).toBe(true);
      } else {
        // Usunięcie wygrało: przypięcie widzi DELETED.
        expect(removed.statusCode).toBe(204);
        expect(ticket.json().code).toBe('FILE_DELETED');
        expect(file).toMatchObject({ status: 'DELETED', attached: false });
        expect(storage().objects.has(file.storage_key)).toBe(false);
      }
    }
  });
});

/** Magazyn SeaweedFS z `infra/` (ADR 0024): test działa tylko, gdy brama S3 odpowiada pod `S3_ENDPOINT`. */
const s3Config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const s3Available = await fetch(s3Config.S3_ENDPOINT, { signal: AbortSignal.timeout(1000) })
  .then(() => true)
  .catch(() => false);

describe.skipIf(!s3Available)('magazyn plików S3 (SeaweedFS)', () => {
  it('zapis, odczyt strumieniem i usunięcie obiektu', async () => {
    const storage = new S3FileStorage({
      endpoint: s3Config.S3_ENDPOINT,
      region: s3Config.S3_REGION,
      bucket: s3Config.S3_BUCKET,
      accessKeyId: s3Config.S3_ACCESS_KEY,
      secretAccessKey: s3Config.S3_SECRET_KEY,
    });
    const key = `test/${randomUUID()}.jpg`;
    try {
      await storage.put(key, JPEG, 'image/jpeg');
      const object = await storage.get(key);
      expect(object?.sizeBytes).toBe(JPEG.length);
      const chunks: Buffer[] = [];
      for await (const chunk of object!.body) chunks.push(Buffer.from(chunk as Uint8Array));
      expect(Buffer.concat(chunks).equals(JPEG)).toBe(true);
    } finally {
      await storage.delete(key);
      expect(await storage.get(key)).toBeNull();
      storage.close();
    }
  });
});
