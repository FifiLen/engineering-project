import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runMigrations, seedDatabase, type PlacesFile } from '@hulajnogi/db';
import type * as shared from '@hulajnogi/shared';
import { scooterTopicId, topics, type Command, type CustomerSession } from '@hulajnogi/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { InjectOptions } from 'fastify';
import { Pool } from 'pg';
import { expect } from 'vitest';
import { LoggingSmsGateway } from '../src/auth/sms.gateway.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { CommandsService } from '../src/fleet/commands.service.js';
import { JobsService } from '../src/jobs/jobs.service.js';
import { MqttService } from '../src/mqtt/mqtt.service.js';
import { TelemetryService } from '../src/telemetry/telemetry.service.js';
import { asStaff, fundWallet, staffToken } from './helpers.js';

// Syntetyczne współrzędne testowe: jedna strefa parkowania; 50,01 leży poza nią, w obszarze działania.
const places: PlacesFile = {
  city: 'Test',
  note: '',
  serviceArea: { code: 'AREA-TEST', name: 'Obszar testowy', centerPlace: 'P-01', radiusM: 5000 },
  places: [
    { code: 'P-01', name: 'Centrum', query: '', type: 'PARKING', radiusM: 100, capacity: 20, lat: 50.0, lon: 18.5 },
  ],
};

export type Staff = 'admin' | 'dispatcher' | 'technician';
type Request = Pick<InjectOptions, 'method' | 'url' | 'payload' | 'query'>;

/**
 * Wspólne przygotowanie testów modułu Operacje (ADR 0055): osobna baza z danymi startowymi, operatorzy trzech ról,
 * klienci z saldem i hulajnogi online z baterią 80% (numery nieparzyste w strefie P-01, parzyste poza strefą).
 */
export async function operationsContext(prefix: string, fleetSize: number, env: Record<string, string> = {}) {
  const adminUrl = process.env.DATABASE_URL!;
  const dbName = `hulajnogi_${prefix}_${randomUUID().slice(0, 8)}`;
  const admin = new Pool({ connectionString: adminUrl });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const pool = new Pool({ connectionString: url.toString() });
  pool.on('error', () => undefined);
  await runMigrations(pool);
  await seedDatabase(pool, {
    places,
    fleetSize,
    admin: { email: 'a@test.local', name: 'Admin Testowy', passwordHash: 'x' },
    staff: [
      { email: 'd@test.local', name: 'Dyspozytor Testowy', role: 'Dyspozytor', passwordHash: 'x' },
      { email: 's@test.local', name: 'Serwisant Testowy', role: 'Serwisant', passwordHash: 'x' },
    ],
    documents: [
      { slug: 'regulamin', name: 'Regulamin', consentType: 'TERMS', title: 'Regulamin', bodyMd: 'Treść' },
      { slug: 'polityka-prywatnosci', name: 'Polityka', consentType: 'PRIVACY', title: 'Polityka', bodyMd: 'Treść' },
    ],
  });
  for (let number = 1; number <= fleetSize; number++) {
    await pool.query(
      `UPDATE scooters SET online = true, battery_pct = 80, last_seen_at = now() - interval '10 seconds',
              position = ST_SetSRID(ST_MakePoint(18.5, $2), 4326) WHERE number = $1`,
      [number, number % 2 === 1 ? 50.0 : 50.01],
    );
  }
  const app: NestFastifyApplication = await createApp(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      MQTT_ENABLED: 'false',
      JOBS_ENABLED: 'false',
      TELEMETRY_FLUSH_MS: '10000',
      FAKE_WEBHOOK_DELIVERY: 'manual',
      FILE_STORAGE: 'memory',
      OSRM_URL: 'http://127.0.0.1:9',
      ...env,
    }),
    { logger: false },
  );
  await app.init();

  const staffIds = {} as Record<Staff, string>;
  for (const [who, email] of [
    ['admin', 'a@test.local'],
    ['dispatcher', 'd@test.local'],
    ['technician', 's@test.local'],
  ] as const) {
    staffIds[who] = (await pool.query<{ id: string }>(`SELECT id FROM staff WHERE email = $1`, [email])).rows[0]!.id;
  }
  const staffAs = Object.fromEntries(
    (Object.keys(staffIds) as Staff[]).map((who) => [who, asStaff(app, staffToken(app, staffIds[who]))]),
  ) as Record<Staff, (options: InjectOptions) => ReturnType<NestFastifyApplication['inject']>>;

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
    ).json<CustomerSession>();
    await app.inject({
      method: 'POST',
      url: '/me/registration',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { name, ageConfirmed: true, acceptedVersionIds: session.me.pendingDocuments.map((d) => d.versionId) },
    });
    await fundWallet(pool, session.me.id, 50_000);
    return { id: session.me.id, token: session.accessToken };
  }

  const customer = (token: string) => (options: Request) =>
    app.inject({ ...options, headers: { authorization: `Bearer ${token}` } } as InjectOptions);
  const idOf = async (number: number) =>
    (await pool.query<{ id: string }>('SELECT id FROM scooters WHERE number = $1', [number])).rows[0]!.id;
  const scooterRow = async (number: number) =>
    (
      await pool.query<{ status: string; status_reason: string | null; version: number; battery_pct: number }>(
        `SELECT status::text, status_reason::text, version, battery_pct FROM scooters WHERE number = $1`,
        [number],
      )
    ).rows[0]!;
  const commands = (number: number) =>
    app
      .get(MqttService)
      .published.filter((p) => p.topic === topics.command(scooterTopicId(number)))
      .map((p) => p.payload as Command);
  const ack = (command: Command, ok = true) =>
    app
      .get(CommandsService)
      .handleAck(Buffer.from(JSON.stringify({ commandId: command.commandId, ok, ts: new Date().toISOString() })));
  const status = (number: number, online: boolean) =>
    app.get(TelemetryService).handleStatus(number, { online, since: new Date().toISOString() });
  /** Odczyt telemetrii w pozycji z danych testowych i zapis partii (okno zapisu w teście jest ręczne). */
  async function telemetry(
    number: number,
    reading: { bat: number; locked?: boolean; buffered?: boolean; at?: Date },
  ): Promise<void> {
    app.get(TelemetryService).accept(number, {
      ts: (reading.at ?? new Date()).toISOString(),
      lat: number % 2 === 1 ? 50.0 : 50.01,
      lon: 18.5,
      bat: reading.bat,
      v: 0,
      locked: reading.locked ?? true,
      buffered: reading.buffered ?? false,
    });
    await app.get(TelemetryService).flush();
  }
  /** Start z potwierdzonym odblokowaniem. */
  async function ride(token: string, number: number): Promise<string> {
    const start = await customer(token)({
      method: 'POST',
      url: '/rentals',
      payload: { scooterId: await idOf(number) },
    });
    expect(start.statusCode).toBe(202);
    await ack(commands(number).at(-1)!);
    return start.json<shared.RentalView>().id;
  }
  /** Zakończenie w strefie z potwierdzoną blokadą. */
  async function endRide(token: string, number: number): Promise<void> {
    const end = await customer(token)({ method: 'POST', url: '/rentals/current/end' });
    expect(end.statusCode).toBe(202);
    await ack(commands(number).at(-1)!);
  }
  /** Zdjęcie zgłoszenia jak po `POST /files` (wiersz pliku; magazyn nie jest potrzebny do widoku). */
  async function photo(owner: { userId?: string; staffId?: string }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO files (id, storage_key, purpose, content_type, size_bytes, uploaded_by, uploaded_by_staff)
       VALUES ($1, $2, 'TICKET_PHOTO', 'image/jpeg', 1000, $3, $4)`,
      [id, `ticket-photo/test/${id}.jpg`, owner.userId ?? null, owner.staffId ?? null],
    );
    return id;
  }
  const auditOf = async (entityId: string, action: string) =>
    (
      await pool.query<{ actor: string; staff_id: string | null; data: Record<string, unknown> }>(
        `SELECT actor::text, staff_id, data FROM audit_log WHERE entity_id = $1 AND action = $2 ORDER BY id`,
        [entityId, action],
      )
    ).rows;
  const jobs = () => app.get(JobsService);

  async function close(): Promise<void> {
    await app?.close();
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  }

  return {
    app,
    pool,
    databaseUrl: url.toString(),
    staffIds,
    staff: staffAs,
    register,
    customer,
    idOf,
    scooterRow,
    commands,
    ack,
    status,
    telemetry,
    ride,
    endRide,
    photo,
    auditOf,
    jobs,
    close,
  };
}

export type OperationsContext = Awaited<ReturnType<typeof operationsContext>>;
