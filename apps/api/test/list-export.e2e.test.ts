import 'reflect-metadata';
import { warsawWallClock } from '@hulajnogi/core';
import type * as shared from '@hulajnogi/shared';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListExportService } from '../src/common/list-export/list-export.service.js';
import { asStaff, staffToken } from './helpers.js';
import { operationsContext, type OperationsContext } from './operations-helpers.js';

const adminUrl = process.env.DATABASE_URL;

const LEDGER_COLUMNS = [
  { field: 'id', label: 'Nr' },
  { field: 'createdAt', label: 'Data' },
  { field: 'userName', label: 'Klient' },
  { field: 'type', label: 'Operacja', values: { ADJUSTMENT: 'Korekta', TOPUP: 'Doładowanie' } },
  { field: 'amount', label: 'Kwota' },
  { field: 'note', label: 'Notatka' },
];

/** CSV z BOM, średnikiem i CRLF na wiersze pól (bez cudzysłowów w danych testu). */
function csvRows(body: string): string[][] {
  expect(body.startsWith('﻿')).toBe(true);
  expect(body.endsWith('\r\n')).toBe(true);
  return body
    .slice(1, -2)
    .split('\r\n')
    .map((line) => line.split(';'));
}

describe.skipIf(!adminUrl)('API: eksport list do XLSX i CSV (ADR 0073)', () => {
  let ctx: OperationsContext;
  let customer: { id: string; token: string };
  let accountantApi: ReturnType<typeof asStaff>;
  let accountantId: string;

  const exportList = (who: ReturnType<typeof asStaff>, resource: string, payload: Record<string, unknown>) =>
    who({ method: 'POST', url: `/admin/${resource}/export`, payload });

  const auditExports = async (staffId: string) =>
    (
      await ctx.pool.query<{ entity_type: string; data: Record<string, unknown> }>(
        `SELECT entity_type, data FROM audit_log WHERE action = 'list.exported' AND staff_id = $1 ORDER BY id`,
        [staffId],
      )
    ).rows;

  beforeAll(async () => {
    ctx = await operationsContext('list_export', 3);
    customer = await ctx.register('+48500100001', 'Anna Eksportowa');
    await ctx.register('+48500100002', '=2+3 Kowalski');
    await ctx.register('+48500100003', 'Celina Nowak');
    // Ujemna korekta z notatką jak formuła: liczba zostaje liczbą, tekst dostaje apostrof w CSV.
    await ctx.pool.query(
      `CALL sp_wallet_post($1, 'ADJUSTMENT', -1234, NULL, NULL, NULL, NULL, 'GOODWILL', '=SUM(A1:A9)', NULL, NULL)`,
      [customer.id],
    );
    // Rola bez `users.read` (płatności): maskowanie danych klienta w liście i w eksporcie.
    const role = await ctx.pool.query<{ id: string }>(
      `INSERT INTO roles (name, description) VALUES ('Księgowość', 'Płatności') RETURNING id`,
    );
    await ctx.pool.query(`INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'payments.read')`, [
      role.rows[0]!.id,
    ]);
    accountantId = (
      await ctx.pool.query<{ id: string }>(
        `INSERT INTO staff (email, name, password_hash) VALUES ('k@test.local', 'Księgowa Testowa', 'x') RETURNING id`,
      )
    ).rows[0]!.id;
    await ctx.pool.query(`INSERT INTO staff_roles (staff_id, role_id) VALUES ($1, $2)`, [
      accountantId,
      role.rows[0]!.id,
    ]);
    accountantApi = asStaff(ctx.app, staffToken(ctx.app, accountantId));
    await ctx.pool.query(
      `INSERT INTO payment_customers (user_id, provider, provider_customer_id) VALUES ($1, 'fake', 'cus_test_anna')`,
      [customer.id],
    );
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('XLSX: te same wiersze i kolejność co lista, kwota jako liczba w złotych z formatem, data jako data Excela', async () => {
    const query = { userId: customer.id, sort: '-id' };
    const list = (
      await ctx.staff.admin({ method: 'GET', url: `/admin/wallet-ledger?userId=${customer.id}&sort=-id` })
    ).json<shared.ListResponse<shared.WalletLedgerItem>>();
    expect(list.total).toBe(2);

    const res = await exportList(ctx.staff.admin, 'wallet-ledger', { query, format: 'xlsx', columns: LEDGER_COLUMNS });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="wallet-ledger-\d{4}-\d{2}-\d{2}-\d{4}\.xlsx"$/,
    );
    expect(res.headers['cache-control']).toBe('private, no-store');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('wallet-ledger')!;
    expect(sheet).toBeDefined();
    expect(sheet.getRow(1).values).toEqual([undefined, 'Nr', 'Data', 'Klient', 'Operacja', 'Kwota', 'Notatka']);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.rowCount).toBe(3);

    list.items.forEach((item, i) => {
      const row = sheet.getRow(i + 2);
      expect(row.getCell(1).value).toBe(item.id);
      // ExcelJS zapisuje datę jako numer seryjny z pól UTC, więc odczyt zwraca czas polski jako UTC.
      expect(row.getCell(2).value).toEqual(warsawWallClock(new Date(item.createdAt)));
      expect(row.getCell(2).numFmt).toBe('dd.mm.yyyy hh:mm');
      expect(row.getCell(3).value).toBe('Anna Eksportowa');
      expect(row.getCell(4).value).toBe('Korekta');
      expect(row.getCell(5).value).toBe(item.amount / 100);
      expect(row.getCell(5).numFmt).toBe('#,##0.00 "zł"');
    });
    // Najnowszy wpis (sortowanie -id) to ujemna korekta; tekst w XLSX nie jest formułą.
    expect(sheet.getRow(2).getCell(5).value).toBe(-12.34);
    expect(sheet.getRow(2).getCell(6).value).toBe('=SUM(A1:A9)');
    expect(sheet.getRow(2).getCell(6).type).toBe(ExcelJS.ValueType.String);
  });

  it('CSV: BOM, średnik, przecinek dziesiętny, data po polsku, ochrona przed formułami w tekście i etykietach', async () => {
    const res = await exportList(ctx.staff.admin, 'wallet-ledger', {
      query: { userId: customer.id, sort: '-id' },
      format: 'csv',
      columns: [...LEDGER_COLUMNS, { field: 'balanceAfter', label: '=Saldo' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/filename="wallet-ledger-.+\.csv"$/);
    const rows = csvRows(res.body);
    expect(rows[0]).toEqual(['Nr', 'Data', 'Klient', 'Operacja', 'Kwota', 'Notatka', "'=Saldo"]);
    expect(rows).toHaveLength(3);
    const [newest, oldest] = [rows[1]!, rows[2]!];
    expect(newest[1]).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    expect(newest.slice(2, 6)).toEqual(['Anna Eksportowa', 'Korekta', '-12,34', "'=SUM(A1:A9)"]);
    expect(newest[6]).toBe('487,66');
    expect(oldest.slice(4, 7)).toEqual(['500,00', '', '500,00']);
  });

  it('lista klientów: filtry, wyszukiwanie i sortowanie listy, tekst klienta jak formuła z apostrofem', async () => {
    const list = (await ctx.staff.admin({ method: 'GET', url: '/admin/users?sort=name&pageSize=100' })).json<
      shared.ListResponse<shared.UserListItem>
    >();
    const res = await exportList(ctx.staff.admin, 'users', {
      query: { sort: 'name', page: '3', pageSize: '10' },
      format: 'csv',
      columns: [
        { field: 'name', label: 'Imię i nazwisko' },
        { field: 'phone', label: 'Telefon' },
        { field: 'walletBalance', label: 'Saldo' },
      ],
    });
    const rows = csvRows(res.body).slice(1);
    // Stronicowanie z adresu jest pomijane: plik ma wszystkie wiersze w kolejności listy.
    // Telefon zaczyna się od `+`, więc w CSV też dostaje apostrof (reguła ADR 0073 dla każdego tekstu).
    expect(rows.map((r) => r[1])).toEqual(list.items.map((u) => `'${u.phone}`));
    expect(rows.find((r) => r[1] === "'+48500100002")![0]).toBe("'=2+3 Kowalski");

    const searched = await exportList(ctx.staff.admin, 'users', {
      query: { q: 'Nowak' },
      format: 'csv',
      columns: [{ field: 'name', label: 'Klient' }],
    });
    expect(csvRows(searched.body).slice(1)).toEqual([['Celina Nowak']]);
  });

  it('bez users.read dane klienta są zamaskowane jak w liście; filtr po nich to 403', async () => {
    const list = (await accountantApi({ method: 'GET', url: '/admin/payment-customers' })).json<
      shared.ListResponse<shared.PaymentCustomerListItem>
    >();
    expect(list.items).toEqual([expect.objectContaining({ providerCustomerId: 'cus_test_anna', userName: null })]);
    const res = await exportList(accountantApi, 'payment-customers', {
      query: {},
      format: 'csv',
      columns: [
        { field: 'userName', label: 'Klient' },
        { field: 'providerCustomerId', label: 'Identyfikator' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(csvRows(res.body)).toEqual([
      ['Klient', 'Identyfikator'],
      ['', 'cus_test_anna'],
    ]);
    const admin = await exportList(ctx.staff.admin, 'payment-customers', {
      query: {},
      format: 'csv',
      columns: [{ field: 'userName', label: 'Klient' }],
    });
    expect(csvRows(admin.body)[1]).toEqual(['Anna Eksportowa']);
    const sorted = await exportList(accountantApi, 'payment-customers', {
      query: { sort: 'userName' },
      format: 'xlsx',
      columns: [{ field: 'userName', label: 'Klient' }],
    });
    expect(sorted.statusCode).toBe(403);
    expect(sorted.json()).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'users.read' } });
    // Uprawnienie odczytu zasobu jak przy GET: bez `users.read` nie ma eksportu klientów.
    expect(
      (await exportList(accountantApi, 'users', { query: {}, format: 'csv', columns: [{ field: 'name', label: 'x' }] }))
        .statusCode,
    ).toBe(403);
  });

  it('kolumny spoza definicji i parametry spoza listy to 400; limit wierszy to 422 z liczbą', async () => {
    const unknown = await exportList(ctx.staff.admin, 'users', {
      query: {},
      format: 'csv',
      columns: [{ field: 'passwordHash', label: 'Hasło' }],
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { columns: [{ field: 'passwordHash', code: 'UNKNOWN_FIELD' }] },
    });
    const badValue = await exportList(ctx.staff.admin, 'wallet-ledger', {
      query: {},
      format: 'csv',
      columns: [{ field: 'type', label: 'Typ', values: { NOPE: 'x' } }],
    });
    expect(badValue.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    const badQuery = await exportList(ctx.staff.admin, 'users', {
      query: { sort: 'secret' },
      format: 'csv',
      columns: [{ field: 'name', label: 'Klient' }],
    });
    expect(badQuery.statusCode).toBe(400);
    expect(badQuery.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    const badFormat = await exportList(ctx.staff.admin, 'users', {
      query: {},
      format: 'pdf',
      columns: [{ field: 'name', label: 'Klient' }],
    });
    expect(badFormat.statusCode).toBe(400);

    const exporter = ctx.app.get(ListExportService);
    const before = (await auditExports(ctx.staffIds.admin)).length;
    exporter.limit = 2;
    try {
      const limited = await exportList(ctx.staff.admin, 'users', {
        query: {},
        format: 'xlsx',
        columns: [{ field: 'name', label: 'Klient' }],
      });
      expect(limited.statusCode).toBe(422);
      expect(limited.json()).toMatchObject({ code: 'LIST_EXPORT_LIMIT', details: { count: 3, limit: 2 } });
    } finally {
      exporter.limit = 50_000;
    }
    // Odrzucony eksport nie zostawia wpisu w dzienniku audytu.
    expect(await auditExports(ctx.staffIds.admin)).toHaveLength(before);
  });

  it('każdy eksport zapisuje list.exported z zasobem, filtrami, sortowaniem, kolumnami, formatem i liczbą wierszy', async () => {
    const res = await exportList(ctx.staff.dispatcher, 'scooters', {
      query: { status: 'AVAILABLE', sort: '-number', operator: 'x' },
      format: 'csv',
      columns: [{ field: 'number', label: 'Numer' }],
    });
    // Parametr spoza definicji zasobu (tu `operator`) jest błędem jak w GET listy.
    expect(res.statusCode).toBe(400);
    const ok = await exportList(ctx.staff.dispatcher, 'scooters', {
      query: { status: 'AVAILABLE', sort: '-number' },
      format: 'csv',
      columns: [
        { field: 'number', label: 'Numer' },
        { field: 'status', label: 'Stan' },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(
      csvRows(ok.body)
        .slice(1)
        .map((r) => r[0]),
    ).toEqual(['3', '2', '1']);
    const entries = await auditExports(ctx.staffIds.dispatcher);
    expect(entries.at(-1)).toEqual({
      entity_type: 'list',
      data: {
        resource: 'scooters',
        format: 'csv',
        q: null,
        filters: [{ field: 'status', op: 'eq', values: ['AVAILABLE'] }],
        sort: [{ field: 'number', desc: true }],
        columns: ['number', 'status'],
        rowCount: 3,
      },
    });
  });

  it('eksport działa dla każdego zasobu listy panelu z uprawnieniem odczytu (pusty plik z nagłówkiem)', async () => {
    const resources = [
      'scooters',
      'scooter-models',
      'staff',
      'roles',
      'users',
      'audit-log',
      'rentals',
      'zones',
      'tariffs',
      'payments',
      'wallet-ledger',
      'wallets',
      'receipts',
      'payment-methods',
      'payment-webhook-events',
      'refunds',
      'tickets',
      'service-tasks',
      'spare-parts',
      'spare-part-movements',
      'files',
      'notification-templates',
      'notifications',
      'push-tokens',
      'content-blocks',
      'faq-items',
      'faq-categories',
      'news',
      'media',
      'document-templates',
      'generated-documents',
      'data-exports',
      'consents',
      'sessions',
      'staff-sessions',
      'staff-invitations',
      'otp-codes',
      'scooter-commands',
      'rental-events',
      'zone-presence',
      'zone-control',
      'payment-customers',
      'permissions',
      'saved-places',
      'scooter-status-history',
    ];
    const { adminResource } = await import('@hulajnogi/shared');
    for (const name of resources) {
      const def = adminResource(name)!;
      const field = Object.keys(def.fields)[0]!;
      const res = await exportList(ctx.staff.admin, name, {
        query: {},
        format: 'csv',
        columns: [{ field, label: 'Kolumna' }],
      });
      expect({ name, status: res.statusCode }).toEqual({ name, status: 200 });
      expect(csvRows(res.body)[0]).toEqual(['Kolumna']);
    }
  });
});
