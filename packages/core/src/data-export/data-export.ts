import { documentDateStamp } from '../documents/format.js';
import { isJobClaimable, type BackgroundJobRow } from '../documents/prints.js';
import { DomainError } from '../errors.js';
import { receiptTotals, receiptVatGroups, type ReceiptItem } from '../payments/receipts.js';

/**
 * Eksport danych klienta (ADR 0069, RODO art. 15 i 20): plik JSON zbierany z portów eksportu modułów
 * (`exportForUser(userId)` w Kontach, Wypożyczeniach, Płatnościach, Operacjach i Powiadomieniach), ważny 7 dni,
 * najwyżej jedno zlecenie na dobę (nieudane się nie liczy). Builder wybiera pola jawnie, więc dodatkowe pola
 * z portów (tokeny, notatki operatorów) nie trafiają do pliku; API sprawdza wynik ścisłym schematem z shared.
 */
export const DATA_EXPORT_INTERVAL_MS = 24 * 60 * 60_000;
export const DATA_EXPORT_TTL_MS = 7 * 24 * 60 * 60_000;
/** Telemetria (trasy) żyje 90 dni (ADR 0037): starszy przejazd ma `route: null`. */
export const DATA_EXPORT_ROUTE_RETENTION_MS = 90 * 24 * 60 * 60_000;

/**
 * Limit czasu zadania `data-export.generate` w pg-boss (`expireInSeconds` kolejki, 300 s): ponowienie po restarcie API
 * przejmuje wiersz `RUNNING` starszy niż limit.
 */
export const DATA_EXPORT_JOB_EXPIRE_MS = 300_000;
/**
 * Zlecenie w toku albo w kolejce dłużej niż 30 min nie ma już zadania: `data-exports.sweep` kończy je jako `FAILED`
 * z `DATA_EXPORT_FAILED`, więc indeks „jedno zlecenie w toku” nie blokuje klienta, a nieudane nie liczy się do limitu.
 */
export const DATA_EXPORT_JOB_ABANDONED_MS = 30 * 60_000;

/** Zadanie `data-export.generate`: zlecenie `QUEUED` albo porzucone `RUNNING` (po `DATA_EXPORT_JOB_EXPIRE_MS`). */
export const shouldRunDataExportJob = (row: Pick<BackgroundJobRow, 'status' | 'startedAt'>, now: Date): boolean =>
  isJobClaimable(row, now, DATA_EXPORT_JOB_EXPIRE_MS);

export interface DataExportRequest {
  requestedAt: Date;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
}

/**
 * Czas, od którego klient może zlecić kolejny eksport: 24 h od ostatniego zlecenia innego niż `FAILED` (także
 * w toku); `null`, gdy może od razu. Ta sama reguła jest w `sp_data_export_request` (test zgodności w API).
 */
export function dataExportNextAllowedAt(requests: readonly DataExportRequest[], now: Date): Date | null {
  const last = requests
    .filter((request) => request.status !== 'FAILED')
    .reduce<Date | null>(
      (latest, request) => (!latest || request.requestedAt > latest ? request.requestedAt : latest),
      null,
    );
  if (!last) return null;
  const next = new Date(last.getTime() + DATA_EXPORT_INTERVAL_MS);
  return next.getTime() > now.getTime() ? next : null;
}

/** Drugie zlecenie w ciągu doby: `429 DATA_EXPORT_LIMIT` z `details.nextAllowedAt`. */
export function ensureDataExportAllowed(requests: readonly DataExportRequest[], now: Date): void {
  const next = dataExportNextAllowedAt(requests, now);
  if (next) throw new DomainError('DATA_EXPORT_LIMIT', { nextAllowedAt: next.toISOString() });
}

/** Ważność pliku: 7 dni od zakończenia zadania. */
export const dataExportExpiresAt = (finishedAt: Date): Date => new Date(finishedAt.getTime() + DATA_EXPORT_TTL_MS);

export type DataExportState = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';

/** Stan na ekranie: gotowy plik po `expiresAt` albo usunięty przez `data-exports.purge` jest `EXPIRED`. */
export function dataExportState(
  exp: { status: DataExportRequest['status']; expiresAt: Date | null; deletedAt: Date | null },
  now: Date,
): DataExportState {
  if (exp.status !== 'SUCCEEDED') return exp.status;
  if (exp.deletedAt || (exp.expiresAt && exp.expiresAt.getTime() <= now.getTime())) return 'EXPIRED';
  return 'SUCCEEDED';
}

/** Nazwa pliku `dane-RRRR-MM-DD.json` z datą zlecenia w czasie polskim. */
export const dataExportFileName = (at: Date): string => `dane-${documentDateStamp(at)}.json`;

// --- Dane z portów modułów -----------------------------------------------------------------------

export interface DataExportProfile {
  phone: string;
  name: string | null;
  email: string | null;
  registeredAt: Date;
  blocked: boolean;
  /** Powód blokady widoczny dla klienta (bez notatki operatora). */
  blockReason: string | null;
  blockedAt: Date | null;
  preferences: { reservationEnd: boolean; receipts: boolean; marketing: boolean };
  devices: Array<{ platform: string; createdAt: Date; lastUsedAt: Date | null }>;
  sessions: Array<{ client: string | null; createdAt: Date; lastUsedAt: Date | null; endedAt: Date | null }>;
}

export interface DataExportPlace {
  lat: number;
  lon: number;
  zone: string | null;
}

export interface DataExportRental {
  number: string;
  state: string;
  reservedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  scooterNumber: string;
  model: string | null;
  start: DataExportPlace | null;
  end: DataExportPlace | null;
  distanceM: number | null;
  endMode: string | null;
  tariffVersion: number | null;
  total: number | null;
  items: ReceiptItem[];
  /** Punkty trasy z telemetrii (uproszczone `ST_Simplify`); `null`: brak telemetrii. */
  route: Array<{ lat: number; lon: number; at: Date }> | null;
}

export interface DataExportSources {
  profile: DataExportProfile;
  consents: Array<{
    type: string;
    document: string;
    versionNo: number | null;
    acceptedAt: Date;
    withdrawnAt: Date | null;
  }>;
  rentals: DataExportRental[];
  wallet: {
    balance: number;
    entries: Array<{ at: Date; kind: string; amount: number; balanceAfter: number; reference: string | null }>;
  };
  payments: Array<{
    id: string;
    createdAt: Date;
    kind: string;
    status: string;
    amount: number;
    card: { brand: string | null; last4: string | null } | null;
  }>;
  refunds: Array<{ id: string; createdAt: Date; status: string; amount: number; reason: string | null }>;
  receipts: Array<{ number: string; kind: string; issuedAt: Date; corrects: string | null; items: ReceiptItem[] }>;
  tickets: Array<{
    number: string;
    createdAt: Date;
    categories: string[];
    description: string | null;
    status: string;
    reply: string | null;
    resolvedAt: Date | null;
    scooterNumber: string | null;
    rentalNumber: string | null;
  }>;
  photos: Array<{
    id: string;
    purpose: string;
    createdAt: Date;
    rentalNumber: string | null;
    ticketNumber: string | null;
    status: string;
    deletedAt: Date | null;
  }>;
  notifications: Array<{ code: string; title: string | null; body: string; sentAt: Date | null; readAt: Date | null }>;
}

/** Część danych oddawana przez port eksportu modułu (moduł nie czyta cudzych tabel, ADR 0003). */
export interface DataExportContributor<K extends keyof DataExportSources = keyof DataExportSources> {
  exportForUser(userId: string): Promise<Pick<DataExportSources, K>>;
}

/** Opisy sekcji w pliku (`about`), żeby plik był zrozumiały bez dokumentacji. */
export const DATA_EXPORT_ABOUT = {
  file: 'Twoje dane z wypożyczalni hulajnóg (prawo dostępu i przenoszenia danych, RODO art. 15 i 20). Czasy w UTC (ISO 8601), kwoty w groszach z walutą.',
  profile:
    'Dane konta, blokada, preferencje powiadomień, urządzenia z powiadomieniami i sesje logowania (bez tokenów).',
  consents: 'Zaakceptowane dokumenty z wersją i datą oraz wycofane zgody.',
  rentals:
    'Przejazdy z czasami, hulajnogą, strefami i współrzędnymi początku i końca, dystansem i wyceną. Trasa jest dostępna przez 90 dni od przejazdu, potem „route” ma wartość null.',
  wallet: 'Saldo portfela i wpisy księgi (doładowania, opłaty, zwroty, korekty).',
  payments: 'Płatności z kwotą i stanem oraz marką i końcówką karty, jeśli są zapisane.',
  refunds: 'Zwroty z kwotą, stanem i powodem.',
  receipts: 'Paragony i korekty z pozycjami i grupami stawek VAT.',
  tickets: 'Twoje zgłoszenia z opisem, stanem i odpowiedzią (bez notatek wewnętrznych).',
  photos: 'Metadane zdjęć parkowania i zgłoszeń, bez samych obrazów; zdjęcia są usuwane po 30 dniach.',
  notifications: 'Wysłane powiadomienia z treścią i czasem wysłania oraz odczytu.',
} as const;

const iso = (at: Date): string => at.toISOString();
const isoOrNull = (at: Date | null): string | null => (at ? at.toISOString() : null);
const money = (grosze: number) => ({ grosze, currency: 'PLN' as const });
const priceItems = (items: readonly ReceiptItem[]) =>
  items.map((item) => ({
    code: item.description,
    quantity: item.quantity,
    unitPrice: money(item.unitPrice),
    vatRate: item.vatRate,
    amount: money(item.amount),
  }));

/**
 * Plik eksportu (`schemaVersion: 1`, schemat `dataExportSchema` w shared): sekcje w stałej kolejności z opisem,
 * czasy w UTC, kwoty w groszach z walutą. Trasa przejazdu starszego niż 90 dni to `null`.
 */
export function buildDataExport(sources: DataExportSources, now: Date) {
  const { profile } = sources;
  return {
    schemaVersion: 1 as const,
    generatedAt: iso(now),
    about: DATA_EXPORT_ABOUT.file,
    profile: {
      about: DATA_EXPORT_ABOUT.profile,
      phone: profile.phone,
      name: profile.name,
      email: profile.email,
      registeredAt: iso(profile.registeredAt),
      block: {
        blocked: profile.blocked,
        reason: profile.blocked ? profile.blockReason : null,
        since: profile.blocked ? isoOrNull(profile.blockedAt) : null,
      },
      notificationPreferences: {
        reservationEnd: profile.preferences.reservationEnd,
        receipts: profile.preferences.receipts,
        marketing: profile.preferences.marketing,
      },
      devices: profile.devices.map((d) => ({
        platform: d.platform,
        createdAt: iso(d.createdAt),
        lastUsedAt: isoOrNull(d.lastUsedAt),
      })),
      sessions: profile.sessions.map((s) => ({
        client: s.client,
        createdAt: iso(s.createdAt),
        lastUsedAt: isoOrNull(s.lastUsedAt),
        endedAt: isoOrNull(s.endedAt),
      })),
    },
    consents: {
      about: DATA_EXPORT_ABOUT.consents,
      items: sources.consents.map((c) => ({
        type: c.type,
        document: c.document,
        versionNo: c.versionNo,
        acceptedAt: iso(c.acceptedAt),
        withdrawnAt: isoOrNull(c.withdrawnAt),
      })),
    },
    rentals: {
      about: DATA_EXPORT_ABOUT.rentals,
      items: sources.rentals.map((r) => {
        const started = r.startedAt ?? r.reservedAt;
        const routeExpired = !started || now.getTime() - started.getTime() > DATA_EXPORT_ROUTE_RETENTION_MS;
        return {
          number: r.number,
          state: r.state,
          reservedAt: isoOrNull(r.reservedAt),
          startedAt: isoOrNull(r.startedAt),
          endedAt: isoOrNull(r.endedAt),
          scooterNumber: r.scooterNumber,
          model: r.model,
          start: r.start ? { lat: r.start.lat, lon: r.start.lon, zone: r.start.zone } : null,
          end: r.end ? { lat: r.end.lat, lon: r.end.lon, zone: r.end.zone } : null,
          distanceM: r.distanceM,
          endMode: r.endMode,
          tariffVersion: r.tariffVersion,
          total: r.total === null ? null : money(r.total),
          items: priceItems(r.items),
          route: routeExpired || !r.route ? null : r.route.map((p) => ({ lat: p.lat, lon: p.lon, at: iso(p.at) })),
        };
      }),
    },
    wallet: {
      about: DATA_EXPORT_ABOUT.wallet,
      balance: money(sources.wallet.balance),
      entries: sources.wallet.entries.map((e) => ({
        at: iso(e.at),
        kind: e.kind,
        amount: money(e.amount),
        balanceAfter: money(e.balanceAfter),
        reference: e.reference,
      })),
    },
    payments: {
      about: DATA_EXPORT_ABOUT.payments,
      items: sources.payments.map((p) => ({
        id: p.id,
        createdAt: iso(p.createdAt),
        kind: p.kind,
        status: p.status,
        amount: money(p.amount),
        card: p.card ? { brand: p.card.brand, last4: p.card.last4 } : null,
      })),
    },
    refunds: {
      about: DATA_EXPORT_ABOUT.refunds,
      items: sources.refunds.map((r) => ({
        id: r.id,
        createdAt: iso(r.createdAt),
        status: r.status,
        amount: money(r.amount),
        reason: r.reason,
      })),
    },
    receipts: {
      about: DATA_EXPORT_ABOUT.receipts,
      items: sources.receipts.map((r) => ({
        number: r.number,
        kind: r.kind,
        issuedAt: iso(r.issuedAt),
        corrects: r.corrects,
        total: money(receiptTotals(r.items).gross),
        items: priceItems(r.items),
        vatGroups: receiptVatGroups(r.items).map((g) => ({
          vatRate: g.vatRate,
          gross: money(g.gross),
          vat: money(g.vat),
        })),
      })),
    },
    tickets: {
      about: DATA_EXPORT_ABOUT.tickets,
      items: sources.tickets.map((t) => ({
        number: t.number,
        createdAt: iso(t.createdAt),
        categories: [...t.categories],
        description: t.description,
        status: t.status,
        reply: t.reply,
        resolvedAt: isoOrNull(t.resolvedAt),
        scooterNumber: t.scooterNumber,
        rentalNumber: t.rentalNumber,
      })),
    },
    photos: {
      about: DATA_EXPORT_ABOUT.photos,
      items: sources.photos.map((p) => ({
        id: p.id,
        purpose: p.purpose,
        createdAt: iso(p.createdAt),
        rentalNumber: p.rentalNumber,
        ticketNumber: p.ticketNumber,
        status: p.status,
        deletedAt: isoOrNull(p.deletedAt),
      })),
    },
    notifications: {
      about: DATA_EXPORT_ABOUT.notifications,
      items: sources.notifications.map((n) => ({
        code: n.code,
        title: n.title,
        body: n.body,
        sentAt: isoOrNull(n.sentAt),
        readAt: isoOrNull(n.readAt),
      })),
    },
  };
}

export type DataExportFile = ReturnType<typeof buildDataExport>;
