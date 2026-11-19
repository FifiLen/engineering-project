import { describe, expect, it } from 'vitest';
import {
  buildDataExport,
  DATA_EXPORT_INTERVAL_MS,
  dataExportExpiresAt,
  dataExportFileName,
  dataExportNextAllowedAt,
  dataExportState,
  ensureDataExportAllowed,
  DATA_EXPORT_JOB_EXPIRE_MS,
  shouldRunDataExportJob,
  type DataExportSources,
} from './data-export.js';

const now = new Date('2026-11-18T13:32:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60_000);
const daysAgo = (days: number) => hoursAgo(days * 24);

describe('eksport danych: limit raz na dobę (ADR 0069)', () => {
  it('24 h od ostatniego zlecenia innego niż nieudane, także w toku', () => {
    expect(dataExportNextAllowedAt([], now)).toBeNull();
    expect(dataExportNextAllowedAt([{ requestedAt: hoursAgo(2), status: 'SUCCEEDED' }], now)).toEqual(
      new Date(hoursAgo(2).getTime() + DATA_EXPORT_INTERVAL_MS),
    );
    expect(dataExportNextAllowedAt([{ requestedAt: hoursAgo(1), status: 'RUNNING' }], now)).not.toBeNull();
    expect(dataExportNextAllowedAt([{ requestedAt: hoursAgo(1), status: 'FAILED' }], now)).toBeNull();
    expect(dataExportNextAllowedAt([{ requestedAt: hoursAgo(24), status: 'SUCCEEDED' }], now)).toBeNull();
    expect(
      dataExportNextAllowedAt(
        [
          { requestedAt: hoursAgo(30), status: 'SUCCEEDED' },
          { requestedAt: hoursAgo(3), status: 'SUCCEEDED' },
          { requestedAt: hoursAgo(1), status: 'FAILED' },
        ],
        now,
      ),
    ).toEqual(new Date('2026-11-19T10:32:00Z'));
  });

  it('drugie zlecenie daje `DATA_EXPORT_LIMIT` z czasem następnego', () => {
    expect(() => ensureDataExportAllowed([{ requestedAt: hoursAgo(2), status: 'SUCCEEDED' }], now)).toThrow(
      expect.objectContaining({ code: 'DATA_EXPORT_LIMIT', details: { nextAllowedAt: '2026-11-19T11:32:00.000Z' } }),
    );
    expect(() => ensureDataExportAllowed([{ requestedAt: hoursAgo(2), status: 'FAILED' }], now)).not.toThrow();
  });

  it('ważność 7 dni, stan po wygaśnięciu i nazwa pliku z datą polską', () => {
    expect(dataExportExpiresAt(now)).toEqual(new Date('2026-11-25T13:32:00Z'));
    expect(
      dataExportState({ status: 'SUCCEEDED', expiresAt: dataExportExpiresAt(daysAgo(8)), deletedAt: null }, now),
    ).toBe('EXPIRED');
    expect(
      dataExportState({ status: 'SUCCEEDED', expiresAt: dataExportExpiresAt(daysAgo(1)), deletedAt: null }, now),
    ).toBe('SUCCEEDED');
    expect(
      dataExportState({ status: 'SUCCEEDED', expiresAt: dataExportExpiresAt(daysAgo(1)), deletedAt: now }, now),
    ).toBe('EXPIRED');
    expect(dataExportState({ status: 'RUNNING', expiresAt: null, deletedAt: null }, now)).toBe('RUNNING');
    expect(dataExportFileName(now)).toBe('dane-2026-11-18.json');
    expect(dataExportFileName(new Date('2026-11-18T23:30:00Z'))).toBe('dane-2026-11-19.json');
  });
});

describe('eksport danych: plik z sekcji modułów', () => {
  const rental = (startedAt: Date) => ({
    number: 'R-1234',
    state: 'ENDED',
    reservedAt: startedAt,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 25 * 60_000),
    scooterNumber: '0007',
    model: '[MODEL]',
    start: { lat: 50.09721, lon: 18.54183, zone: 'P-01' },
    end: null,
    distanceM: 4200,
    endMode: 'CUSTOMER',
    tariffVersion: 3,
    total: 1250,
    items: [{ description: 'UNLOCK' as const, quantity: 1, unitPrice: 300, vatRate: 23, amount: 300 }],
    route: [{ lat: 50.1, lon: 18.5, at: startedAt }],
  });

  const sources: DataExportSources = {
    profile: Object.assign(
      {
        phone: '+48500100200',
        name: 'Anna Kowalska',
        email: null,
        registeredAt: daysAgo(100),
        blocked: false,
        blockReason: 'nieaktualny powód',
        blockedAt: daysAgo(50),
        preferences: { reservationEnd: true, receipts: false, marketing: false },
        devices: [{ platform: 'IOS', createdAt: daysAgo(10), lastUsedAt: null }],
        sessions: [{ client: 'ios', createdAt: daysAgo(10), lastUsedAt: hoursAgo(1), endedAt: null }],
      },
      // Pola spoza kontraktu z portu nie trafiają do pliku.
      { refreshTokenHash: 'sekret', staffNote: 'notatka operatora' },
    ),
    consents: [{ type: 'TERMS', document: 'regulamin', versionNo: 1, acceptedAt: daysAgo(100), withdrawnAt: null }],
    rentals: [rental(daysAgo(10)), rental(daysAgo(120))],
    wallet: {
      balance: 4250,
      entries: [{ at: daysAgo(5), kind: 'TOPUP', amount: 5000, balanceAfter: 5000, reference: null }],
    },
    payments: [
      {
        id: 'p1',
        createdAt: daysAgo(5),
        kind: 'TOPUP',
        status: 'SUCCEEDED',
        amount: 5000,
        card: { brand: 'visa', last4: '4242' },
      },
    ],
    refunds: [],
    receipts: [
      {
        number: 'PAR/2026/000126',
        kind: 'SALE',
        issuedAt: daysAgo(10),
        corrects: null,
        items: [
          { description: 'UNLOCK', quantity: 1, unitPrice: 300, vatRate: 23, amount: 300 },
          { description: 'TOWING_FEE', quantity: 1, unitPrice: 5000, vatRate: null, amount: 5000 },
        ],
      },
    ],
    tickets: [],
    photos: [
      {
        id: 'f1',
        purpose: 'PARKING_PHOTO',
        createdAt: daysAgo(40),
        rentalNumber: 'R-1',
        ticketNumber: null,
        status: 'DELETED',
        deletedAt: daysAgo(10),
      },
    ],
    notifications: [
      { code: 'ride_ended', title: 'Koniec przejazdu', body: 'R-1234: 12,50 zł', sentAt: daysAgo(10), readAt: null },
    ],
  };

  it('sekcje w stałej kolejności z opisem, czasy w UTC i kwoty w groszach z walutą', () => {
    const file = buildDataExport(sources, now);
    expect(Object.keys(file)).toEqual([
      'schemaVersion',
      'generatedAt',
      'about',
      'profile',
      'consents',
      'rentals',
      'wallet',
      'payments',
      'refunds',
      'receipts',
      'tickets',
      'photos',
      'notifications',
    ]);
    expect(file.schemaVersion).toBe(1);
    expect(file.generatedAt).toBe('2026-11-18T13:32:00.000Z');
    for (const section of [
      'profile',
      'consents',
      'rentals',
      'wallet',
      'payments',
      'refunds',
      'receipts',
      'tickets',
      'photos',
      'notifications',
    ] as const) {
      expect(file[section].about.length).toBeGreaterThan(10);
    }
    expect(file.wallet.balance).toEqual({ grosze: 4250, currency: 'PLN' });
    expect(file.receipts.items[0]).toMatchObject({
      total: { grosze: 5300, currency: 'PLN' },
      vatGroups: [
        { vatRate: 23, gross: { grosze: 300, currency: 'PLN' }, vat: { grosze: 56, currency: 'PLN' } },
        { vatRate: null, gross: { grosze: 5000, currency: 'PLN' }, vat: { grosze: 0, currency: 'PLN' } },
      ],
    });
    expect(file.payments.items[0]!.card).toEqual({ brand: 'visa', last4: '4242' });
  });

  it('bez tokenów i notatek z portu; powód blokady tylko przy aktywnej blokadzie', () => {
    const file = buildDataExport(sources, now);
    const text = JSON.stringify(file);
    expect(text).not.toContain('sekret');
    expect(text).not.toContain('notatka operatora');
    expect(file.profile.block).toEqual({ blocked: false, reason: null, since: null });
    const blocked = buildDataExport({ ...sources, profile: { ...sources.profile, blocked: true } }, now);
    expect(blocked.profile.block).toEqual({
      blocked: true,
      reason: 'nieaktualny powód',
      since: daysAgo(50).toISOString(),
    });
  });

  it('trasa tylko dla przejazdów z ostatnich 90 dni; zdjęcia tylko jako metadane', () => {
    const file = buildDataExport(sources, now);
    expect(file.rentals.items[0]!.route).toEqual([{ lat: 50.1, lon: 18.5, at: daysAgo(10).toISOString() }]);
    expect(file.rentals.items[1]!.route).toBeNull();
    expect(file.photos.items[0]).toEqual({
      id: 'f1',
      purpose: 'PARKING_PHOTO',
      createdAt: daysAgo(40).toISOString(),
      rentalNumber: 'R-1',
      ticketNumber: null,
      status: 'DELETED',
      deletedAt: daysAgo(10).toISOString(),
    });
  });
});

describe('eksport danych: zadanie po restarcie API (ADR 0069)', () => {
  it('ponowienie przejmuje RUNNING dopiero po limicie czasu zadania pg-boss', () => {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(shouldRunDataExportJob({ status: 'QUEUED', startedAt: null }, now)).toBe(true);
    expect(shouldRunDataExportJob({ status: 'RUNNING', startedAt: ago(60_000) }, now)).toBe(false);
    expect(shouldRunDataExportJob({ status: 'RUNNING', startedAt: ago(DATA_EXPORT_JOB_EXPIRE_MS) }, now)).toBe(true);
    expect(shouldRunDataExportJob({ status: 'SUCCEEDED', startedAt: ago(DATA_EXPORT_JOB_EXPIRE_MS * 2) }, now)).toBe(
      false,
    );
  });
});
