/**
 * „Pobierz moje dane” (ADR 0069): plik JSON z danymi klienta generowany zadaniem, ważny 7 dni, najwyżej jedno
 * zlecenie na dobę. Schemat pliku jest ścisły (`strictObject`): pole spoza schematu (np. token albo notatka
 * operatora z portu eksportu) zatrzymuje zapis pliku w API, zamiast trafić do klienta. Plik składa core
 * (`buildDataExport`), a API sprawdza go tym schematem przed zapisem.
 */
import { z } from 'zod';
import type { JobStatus } from './documents.js';

/** Kod `429` drugiego zlecenia w ciągu 24 h (`details.nextAllowedAt`). */
export const DATA_EXPORT_LIMIT = 'DATA_EXPORT_LIMIT';
/** Kopie z core (`DATA_EXPORT_INTERVAL_MS`, `DATA_EXPORT_TTL_MS`) dla tekstów w aplikacji. */
export const DATA_EXPORT_INTERVAL_MS = 24 * 60 * 60_000;
export const DATA_EXPORT_TTL_MS = 7 * 24 * 60 * 60_000;
/** Bez połączenia Socket.IO aplikacja pyta `GET /me/data-exports/latest` co 5 s. */
export const DATA_EXPORT_POLL_INTERVAL_MS = 5000;

/** Stan na ekranie: `EXPIRED` po `expiresAt` albo po usunięciu pliku przez `data-exports.purge`. */
export const DATA_EXPORT_STATES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED'] as const;
export type DataExportState = (typeof DATA_EXPORT_STATES)[number];

export interface DataExportView {
  id: string;
  status: JobStatus;
  state: DataExportState;
  sizeBytes: number | null;
  requestedAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  errorCode: string | null;
  /** Gotowy i ważny plik: adres z podpisem na 10 min i nazwa `dane-RRRR-MM-DD.json`. */
  file: { url: string; urlExpiresAt: string; fileName: string } | null;
}

/** `GET /me/data-exports/latest`: ostatnie zlecenie i czas, od którego można zlecić następne. */
export interface DataExportLatest {
  export: DataExportView | null;
  /** `null`: można zlecić od razu. */
  nextAllowedAt: string | null;
}

export interface DataExportLimitDetails {
  nextAllowedAt: string;
}

// --- Plik eksportu (`schemaVersion: 1`) ----------------------------------------------------------

/** Czas w UTC (ISO 8601 z `Z`). */
const at = z.iso.datetime();
const optionalAt = at.nullable();
/** Kwota w groszach z walutą. */
export const dataExportMoneySchema = z.strictObject({ grosze: z.number().int(), currency: z.literal('PLN') });
const money = dataExportMoneySchema;
const about = z.string().min(1);
const point = z.strictObject({ lat: z.number(), lon: z.number() });
const place = z.strictObject({ lat: z.number(), lon: z.number(), zone: z.string().nullable() });

const profileSection = z.strictObject({
  about,
  phone: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  registeredAt: at,
  /** Blokada konta z powodem widocznym dla klienta (bez notatek operatorów). */
  block: z.strictObject({ blocked: z.boolean(), reason: z.string().nullable(), since: optionalAt }),
  notificationPreferences: z.strictObject({
    reservationEnd: z.boolean(),
    receipts: z.boolean(),
    marketing: z.boolean(),
  }),
  devices: z.array(z.strictObject({ platform: z.string(), createdAt: at, lastUsedAt: optionalAt })),
  sessions: z.array(
    z.strictObject({ client: z.string().nullable(), createdAt: at, lastUsedAt: optionalAt, endedAt: optionalAt }),
  ),
});

const consentsSection = z.strictObject({
  about,
  items: z.array(
    z.strictObject({
      type: z.string(),
      document: z.string(),
      versionNo: z.number().int().nullable(),
      acceptedAt: at,
      withdrawnAt: optionalAt,
    }),
  ),
});

const priceItem = z.strictObject({
  code: z.string(),
  quantity: z.number(),
  unitPrice: money,
  vatRate: z.number().nullable(),
  amount: money,
});

const rentalsSection = z.strictObject({
  about,
  items: z.array(
    z.strictObject({
      number: z.string(),
      state: z.string(),
      reservedAt: optionalAt,
      startedAt: optionalAt,
      endedAt: optionalAt,
      scooterNumber: z.string(),
      model: z.string().nullable(),
      start: place.nullable(),
      end: place.nullable(),
      distanceM: z.number().nullable(),
      endMode: z.string().nullable(),
      tariffVersion: z.number().int().nullable(),
      total: money.nullable(),
      items: z.array(priceItem),
      /** Trasa z telemetrii (uproszczona); `null` po 90 dniach (opis w `about`). */
      route: z.array(point.extend({ at })).nullable(),
    }),
  ),
});

const walletSection = z.strictObject({
  about,
  balance: money,
  entries: z.array(
    z.strictObject({ at, kind: z.string(), amount: money, balanceAfter: money, reference: z.string().nullable() }),
  ),
});

const paymentsSection = z.strictObject({
  about,
  items: z.array(
    z.strictObject({
      id: z.string(),
      createdAt: at,
      kind: z.string(),
      status: z.string(),
      amount: money,
      card: z.strictObject({ brand: z.string().nullable(), last4: z.string().nullable() }).nullable(),
    }),
  ),
});

const refundsSection = z.strictObject({
  about,
  items: z.array(
    z.strictObject({
      id: z.string(),
      createdAt: at,
      status: z.string(),
      amount: money,
      reason: z.string().nullable(),
    }),
  ),
});

const receiptsSection = z.strictObject({
  about,
  items: z.array(
    z.strictObject({
      number: z.string(),
      kind: z.string(),
      issuedAt: at,
      corrects: z.string().nullable(),
      total: money,
      items: z.array(priceItem),
      vatGroups: z.array(z.strictObject({ vatRate: z.number().nullable(), gross: money, vat: money })),
    }),
  ),
});

const ticketsSection = z.strictObject({
  about,
  items: z.array(
    z.strictObject({
      number: z.string(),
      createdAt: at,
      categories: z.array(z.string()),
      description: z.string().nullable(),
      status: z.string(),
      reply: z.string().nullable(),
      resolvedAt: optionalAt,
      scooterNumber: z.string().nullable(),
      rentalNumber: z.string().nullable(),
    }),
  ),
});

const photosSection = z.strictObject({
  about,
  /** Tylko metadane, bez obrazów i adresów (ADR 0069). */
  items: z.array(
    z.strictObject({
      id: z.string(),
      purpose: z.string(),
      createdAt: at,
      rentalNumber: z.string().nullable(),
      ticketNumber: z.string().nullable(),
      status: z.string(),
      deletedAt: optionalAt,
    }),
  ),
});

const notificationsSection = z.strictObject({
  about,
  items: z.array(
    z.strictObject({
      code: z.string(),
      title: z.string().nullable(),
      body: z.string(),
      sentAt: optionalAt,
      readAt: optionalAt,
    }),
  ),
});

export const DATA_EXPORT_SECTIONS = [
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
] as const;
export type DataExportSection = (typeof DATA_EXPORT_SECTIONS)[number];

export const dataExportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: at,
  about,
  profile: profileSection,
  consents: consentsSection,
  rentals: rentalsSection,
  wallet: walletSection,
  payments: paymentsSection,
  refunds: refundsSection,
  receipts: receiptsSection,
  tickets: ticketsSection,
  photos: photosSection,
  notifications: notificationsSection,
});
export type DataExportFile = z.infer<typeof dataExportSchema>;
