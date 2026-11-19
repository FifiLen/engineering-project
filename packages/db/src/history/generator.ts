import { randomUUID } from 'node:crypto';
import {
  COMMAND_ACK_TIMEOUT_MS,
  DomainError,
  RESET_ZONE_CONTROL,
  RIDE_CHARGE_RETRY_MS,
  TOPUP_MAX,
  TOPUP_MIN,
  TOPUP_PRESETS,
  autoTicket,
  companyAddress,
  correctionItems,
  decideRefund,
  decideTowing,
  desiredZoneControl,
  detectZoneChanges,
  distanceM,
  ensureAdjustment,
  ensureCanPay,
  ensureCanPayDebt,
  ensurePartUse,
  ensureTopupAmount,
  evaluatePosition,
  isBelowMinimum,
  needsBatteryCriticalTicket,
  priceRental,
  rentalCounters,
  rideReceiptItems,
  rideWalletEntries,
  shouldRetryRideCharge,
  suggestTaskType,
  taskPriorityForTicket,
  validateTicket,
  zoneControlCommands,
  shouldOpenOfflineTicket,
  canAutoCloseOfflineTicket,
  OFFLINE_TICKET_AFTER_MS,
  type AdjustmentReason,
  type AppliedZoneControl,
  type GeoPoint,
  type ReceiptItem,
  type RefundReason,
  type RentalPrice,
  type RentalState,
  type SavedCard,
  type TicketCategory,
  type TimelineEvent,
  type Zone,
  type ZonePresence,
} from '@hulajnogi/core';
import type { Pool, PoolClient } from 'pg';
import {
  distanceToBoundaryM,
  insidePolygons,
  lineWkt,
  offset,
  parsePolygons,
  pathLengthM,
  pointAlong,
  pointWkt,
  randomAround,
  type Polygon,
} from './geometry.js';
import { Random } from './random.js';
import { BatchWriter, type Row } from './writer.js';

/**
 * Generator danych historycznych do demonstracji (ADR 0075): `days` dób przed dniem danych startowych, ok.
 * `ridesPerDay` przejazdów na dobę z rytmem dobowym i tygodniowym, trasy między strefami parkowania, płatności,
 * paragony, zwroty, korekty, zaległości, zgłoszenia, zadania z częściami i historia stanów hulajnóg.
 *
 * Wiersze mają jawne czasy, a wartości liczy `packages/core` (liczniki z osi czasu, wycena, pozycje paragonu z VAT
 * „w stu”, wpisy księgi, przejścia stref i komendy stref, walidacja zgłoszeń, reguły płatności i zwrotów). Zapis idzie
 * przez te same wyzwalacze co zapis z API. Symulacja to kolejka zdarzeń w kolejności czasu: wpisy księgi, paragony
 * (numery z sekwencji) i ruchy magazynowe powstają w chwili zdarzenia, więc kolejność identyfikatorów i numerów
 * zgadza się z kolejnością czasu. Jedna transakcja na dobę symulacji.
 */

export interface HistoryOptions {
  days: number;
  ridesPerDay: number;
  seed: number;
  /** `process.env.NODE_ENV`; `production` kończy się błędem. */
  nodeEnv?: string;
  /** Postęp po każdej dobie (CLI). */
  onDay?: (info: { day: string; index: number; total: number; rides: number }) => void;
}

export interface HistorySummary {
  windowFrom: Date;
  windowTo: Date;
  days: number;
  /** Wstawione wiersze według tabeli. */
  rows: Record<string, number>;
  /** Przejazdy według stanu końcowego, utracony popyt i inne liczby symulacji. */
  stats: Record<string, number>;
  /** Przesunięcie najstarszej wersji cennika na początek okna (ADR 0075). */
  tariff: { version: number; validFrom: Date; previousValidFrom: Date } | null;
  elapsedMs: number;
}

/** Odmowa uruchomienia (produkcja, baza z danymi spoza danych startowych); komunikat dla terminala. */
export class HistoryRefusedError extends Error {}

/**
 * Numery klientów generatora: +48 100 xxx xxx. W planie numeracji krajowej (Dz.U. 2023 poz. 145, § 6) cyfry AB = 10
 * to prefiks wyboru dostawcy usług (10XX), a nie numer abonenta, więc taki numer nie należy do żadnej osoby.
 */
export const HISTORY_PHONE_PREFIX = '+48100';

// --- Parametry symulacji (wartości deweloperskie do demonstracji, nie decyzje biznesowe) ----------------------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Klienci na jeden przejazd dobowy; 35% zarejestrowało się przed oknem (w ciągu 120 dni). */
const CUSTOMERS_PER_DAILY_RIDE = 6;
const PRE_WINDOW_SHARE = 0.35;
/** Rytm dobowy (godzina czasu polskiego): dni robocze ze szczytem rano i po 15:00, weekend z późniejszym szczytem. */
const WEEKDAY_HOURS = [
  0.3, 0.15, 0.1, 0.05, 0.05, 0.2, 0.8, 2.2, 3, 1.8, 1.2, 1.3, 1.6, 1.6, 1.8, 2.6, 3.2, 3.4, 2.8, 2.2, 1.6, 1.1, 0.8,
  0.5,
];
const WEEKEND_HOURS = [
  0.7, 0.5, 0.3, 0.15, 0.1, 0.1, 0.2, 0.4, 0.8, 1.3, 1.8, 2.3, 2.6, 2.8, 3, 3.1, 3.2, 3, 2.7, 2.3, 1.8, 1.4, 1.1, 0.9,
];
/** Dzień tygodnia ISO (1 = poniedziałek). */
const WEEKDAY_FACTOR = [0, 0.95, 0.97, 1, 1.02, 1.1, 1.08, 0.88];
const RESERVATION_SHARE = 0.3;
const RESERVATION_EXPIRED = 0.05;
const RESERVATION_CANCELLED = 0.04;
const UNLOCK_FAILED = 0.005;
const PAUSE_SHARE = 0.12;
const NO_RIDE_PASS = 0.015;
/** Kilka promili przejazdów kończy się poza strefą parkowania zdalnym zakończeniem z odholowaniem (ADR 0060). */
const TOWED_SHARE = 0.004;
const CARD_DECLINED = 0.025;
const CARD_RETRY_SUCCEEDS = 0.55;
const DEBT_PAID_LATER = 0.7;
const TOPUP_DECLINED = 0.04;
const CUSTOMER_TICKET = 0.011;
const SCOOTER_FAILURE_REFUND = 0.4;
const BILLING_REFUND = 0.65;
const BLOCKED_CUSTOMERS = 0.005;
const MARKETING_CONSENT = 0.4;
const MARKETING_REVOKED = 0.08;
const OFFLINE_EVERY_DAYS = 21;
const BATTERY_SWAP_BELOW = 40;

const CUSTOMER_CATEGORIES: ReadonlyArray<readonly [TicketCategory, number]> = [
  ['BRAKES', 18],
  ['LIGHTS', 16],
  ['WHEEL', 7],
  ['HANDLEBAR', 5],
  ['QR_CODE', 10],
  ['BATTERY', 8],
  ['OTHER', 9],
  ['BILLING', 27],
];

const TICKET_TEXT: Record<TicketCategory, string[]> = {
  BRAKES: ['Tylny hamulec słabo hamuje.', 'Hamulec piszczy przy hamowaniu.', 'Klamka hamulca chodzi bardzo luźno.'],
  LIGHTS: ['Nie świeci tylna lampa.', 'Przednie światło miga.', 'Nie działa oświetlenie.'],
  WHEEL: ['Przednie koło bije na boki.', 'Opona wygląda na uszkodzoną.'],
  HANDLEBAR: ['Kierownica ma luz.', 'Manetka się obraca.'],
  QR_CODE: ['Kod QR jest zdarty i nie da się go zeskanować.', 'Naklejka z kodem jest nieczytelna.'],
  BATTERY: ['Bateria szybko się rozładowuje.', 'Wskaźnik baterii pokazuje złe wartości.'],
  OTHER: ['Hulajnoga dziwnie stuka przy jeździe.', 'Podest jest pęknięty.', 'Dzwonek nie działa.'],
  BILLING: [
    'Naliczono mi więcej minut, niż jechałem.',
    'Nie mogłem zakończyć przejazdu w strefie, licznik dalej szedł.',
    'Opłata za pauzę jest za wysoka, hulajnoga nie chciała się odblokować.',
  ],
  CONNECTION: ['Brak łączności z hulajnogą.'],
  OUT_OF_ZONE: ['Hulajnoga poza strefą parkowania.'],
};

/** Części do naprawy według kategorii zgłoszenia (SKU z danych startowych) z prawdopodobieństwem użycia. */
const REPAIR_PARTS: Partial<Record<TicketCategory, ReadonlyArray<readonly [string, number]>>> = {
  BRAKES: [
    ['BRK-PAD-R', 1],
    ['BRK-CBL-R', 0.4],
  ],
  LIGHTS: [
    ['LGT-R', 0.6],
    ['LGT-F', 0.4],
  ],
  WHEEL: [['TIRE-10', 1]],
  HANDLEBAR: [['GRIP-P', 1]],
  QR_CODE: [['QR-LBL', 1]],
  BATTERY: [['BAT-36V', 0.25]],
};

const REPAIR_NOTE: Partial<Record<TicketCategory, string>> = {
  BRAKES: 'Wymieniono klocki hamulcowe i wyregulowano hamulec.',
  LIGHTS: 'Wymieniono lampę i sprawdzono przewody.',
  WHEEL: 'Wymieniono oponę i sprawdzono piastę.',
  HANDLEBAR: 'Dokręcono kierownicę i wymieniono manetki.',
  QR_CODE: 'Naklejono nowy kod QR.',
  BATTERY: 'Sprawdzono akumulator i złącza.',
  OTHER: 'Sprawdzono hulajnogę, usunięto usterkę.',
};

const FIRST_NAMES_F = [
  'Anna',
  'Maria',
  'Katarzyna',
  'Małgorzata',
  'Agnieszka',
  'Barbara',
  'Ewa',
  'Magdalena',
  'Joanna',
  'Aleksandra',
  'Zofia',
  'Natalia',
  'Julia',
  'Monika',
  'Karolina',
  'Paulina',
  'Weronika',
  'Martyna',
];
const FIRST_NAMES_M = [
  'Piotr',
  'Krzysztof',
  'Tomasz',
  'Paweł',
  'Michał',
  'Marcin',
  'Jakub',
  'Adam',
  'Łukasz',
  'Mateusz',
  'Kamil',
  'Bartosz',
  'Szymon',
  'Dawid',
  'Jan',
  'Wojciech',
  'Filip',
  'Damian',
];
const SURNAMES: ReadonlyArray<readonly [string, string]> = [
  ['Nowak', 'Nowak'],
  ['Kowalski', 'Kowalska'],
  ['Wiśniewski', 'Wiśniewska'],
  ['Wójcik', 'Wójcik'],
  ['Kamiński', 'Kamińska'],
  ['Lewandowski', 'Lewandowska'],
  ['Zieliński', 'Zielińska'],
  ['Szymański', 'Szymańska'],
  ['Woźniak', 'Woźniak'],
  ['Dąbrowski', 'Dąbrowska'],
  ['Kozłowski', 'Kozłowska'],
  ['Mazur', 'Mazur'],
  ['Krawczyk', 'Krawczyk'],
  ['Piotrowski', 'Piotrowska'],
  ['Grabowski', 'Grabowska'],
  ['Michalski', 'Michalska'],
  ['Król', 'Król'],
  ['Wieczorek', 'Wieczorek'],
  ['Jabłoński', 'Jabłońska'],
  ['Wróbel', 'Wróbel'],
  ['Majewski', 'Majewska'],
  ['Stępień', 'Stępień'],
  ['Malinowski', 'Malinowska'],
  ['Adamczyk', 'Adamczyk'],
  ['Pietrzyk', 'Pietrzyk'],
  ['Kubica', 'Kubica'],
  ['Musiał', 'Musiał'],
  ['Gawlik', 'Gawlik'],
  ['Pyka', 'Pyka'],
  ['Kocur', 'Kocur'],
  ['Szołtysek', 'Szołtysek'],
  ['Kowol', 'Kowol'],
  ['Porwoł', 'Porwoł'],
  ['Pawlas', 'Pawlas'],
];

// --- Model w pamięci -------------------------------------------------------------------------------------------

interface ZoneInfo extends Zone {
  polygons: Polygon[];
  center: GeoPoint;
  radiusM: number;
  /** Ramka powiększona o 15 m: szybkie odrzucenie stref daleko od punktu. */
  near: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

interface Tariff {
  id: string;
  version: number;
  validFrom: number;
  unlockFee: number;
  minuteRate: number;
  pauseMinuteRate: number;
  outOfZoneFee: number;
  freeReservationMinutes: number;
  minWalletBalance: number;
  minBatteryPct: number;
  vatRate: number;
}

interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  createdAt: number;
  weight: number;
  card: SavedCard | null;
  prefersCard: boolean;
  balance: number;
  busyUntil: number;
  unpaid: Set<string>;
  blocked: boolean;
  rides: number;
  row: Row;
}

interface ScooterSim {
  id: string;
  number: number;
  parking: number;
  pos: GeoPoint;
  battery: number;
  busyUntil: number;
  /** Od tej chwili hulajnoga nie bierze udziału w symulacji (zgłoszenia z danych startowych, wycofana). */
  excludedFrom: number;
  status: 'AVAILABLE' | 'RESERVED' | 'IN_USE' | 'MAINTENANCE';
  online: boolean;
  curFrom: number;
  historyEnd: number;
  /** `valid_from` otwartego przedziału z bazy z mikrosekundami (Date w JS ma tylko milisekundy). */
  historyEndText: string;
  odometer: number;
}

interface Ride {
  id: string;
  user: Customer;
  scooter: ScooterSim;
  tariff: Tariff;
  price: RentalPrice;
  towingFee: number | null;
  source: 'WALLET' | 'CARD';
  endedAt: number;
  row: Row;
  paidBy: 'WALLET' | 'CARD' | null;
  cardPaymentId: string | null;
  cardPayment: Row | null;
  refunded: number;
  sale: { id: string; items: ReceiptItem[]; corrections: ReceiptItem[] } | null;
}

interface PartInfo {
  id: string;
  sku: string;
  unitCost: number;
  minStock: number;
  active: boolean;
  stock: number;
  deliveryPlanned: boolean;
}

interface PendingTicket {
  row: Row;
  ride: Ride | null;
}

interface QueuedEvent {
  at: number;
  seq: number;
  run: () => void;
}

/** Kolejka priorytetowa zdarzeń (kopiec binarny) według czasu i kolejności dodania. */
class EventQueue {
  private readonly heap: QueuedEvent[] = [];
  private seq = 0;

  push(at: number, run: () => void): void {
    const item = { at, seq: this.seq++, run };
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  peek(): QueuedEvent | undefined {
    return this.heap[0];
  }

  get size(): number {
    return this.heap.length;
  }

  pop(): QueuedEvent | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length && last) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && less(h[l]!, h[m]!)) m = l;
        if (r < h.length && less(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}

const less = (a: QueuedEvent, b: QueuedEvent) => a.at < b.at || (a.at === b.at && a.seq < b.seq);

const iso = (ms: number) => new Date(ms);
const warsawYear = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric' });

interface Day {
  date: string;
  isodow: number;
  start: number;
  end: number;
}

// --- Generator -------------------------------------------------------------------------------------------------

export async function generateHistory(pool: Pool, options: HistoryOptions): Promise<HistorySummary> {
  const started = Date.now();
  if (options.nodeEnv === 'production') {
    throw new HistoryRefusedError('Generator danych historycznych nie działa w produkcji (NODE_ENV=production).');
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 732) {
    throw new HistoryRefusedError('Liczba dób (--days) musi być liczbą całkowitą od 1 do 732.');
  }
  if (!(options.ridesPerDay > 0) || options.ridesPerDay > 20_000) {
    throw new HistoryRefusedError('Liczba przejazdów na dobę (--rides-per-day) musi być dodatnia (najwyżej 20 000).');
  }
  const client = await pool.connect();
  try {
    const generator = new HistoryGenerator(client, options);
    await generator.prepare();
    await generator.run();
    return generator.summary(Date.now() - started);
  } finally {
    client.release();
  }
}

class HistoryGenerator {
  private readonly random: Random;
  private readonly writer = new BatchWriter();
  private readonly queue = new EventQueue();
  private readonly stats: Record<string, number> = {};

  private days: Day[] = [];
  private windowStart = 0;
  private windowEnd = 0;
  /** Ostatnia chwila zakończenia zadań i przestojów (godzina przed końcem okna). */
  private lastService = 0;
  private tariffs: Tariff[] = [];
  private tariffShift: HistorySummary['tariff'] = null;
  private zones: ZoneInfo[] = [];
  private parking: ZoneInfo[] = [];
  private noRide: ZoneInfo[] = [];
  private serviceArea: ZoneInfo[] = [];
  private scooters: ScooterSim[] = [];
  private customers: Customer[] = [];
  private registered: Customer[] = [];
  private parts = new Map<string, PartInfo>();
  private staff = { admin: '', dispatcher: '', technician: '' };
  private documents: Array<{ type: 'TERMS' | 'PRIVACY'; versionId: string; versionNo: number }> = [];
  private seller: { name: string; address: string | null; taxId: string | null } = {
    name: '',
    address: null,
    taxId: null,
  };
  private dayReceipts: Row[] = [];
  private pendingTickets = new Map<string, PendingTicket>();
  private paymentSeq = 0;
  private refundSeq = 0;
  private deliverySeq = 0;
  private dayRides = 0;

  constructor(
    private readonly client: PoolClient,
    private readonly options: HistoryOptions,
  ) {
    this.random = new Random(options.seed);
  }

  private count(key: string, by = 1) {
    this.stats[key] = (this.stats[key] ?? 0) + by;
  }

  // --- Przygotowanie ---------------------------------------------------------------------------------------

  async prepare(): Promise<void> {
    const q = <T extends Row>(sql: string, params: unknown[] = []) =>
      this.client.query<T>(sql, params).then((r) => r.rows);

    const [existing] = await q<{ rentals: string; receipts: string; generated: string }>(
      `SELECT (SELECT count(*) FROM rentals) AS rentals, (SELECT count(*) FROM receipts) AS receipts,
              (SELECT count(*) FROM users WHERE phone LIKE $1) AS generated`,
      [`${HISTORY_PHONE_PREFIX}%`],
    );
    if (Number(existing!.generated) > 0) {
      throw new HistoryRefusedError(
        'Baza ma już dane z generatora historii. Usunięcie danych to nowa baza: migracje, dane startowe i generator od zera (ADR 0075).',
      );
    }
    if (Number(existing!.rentals) > 0 || Number(existing!.receipts) > 0) {
      throw new HistoryRefusedError(
        `Baza ma przejazdy (${existing!.rentals}) albo paragony (${existing!.receipts}). Generator działa tylko na świeżej ` +
          'bazie, bo numery paragonów muszą rosnąć z datą wystawienia: utwórz nową bazę, wykonaj `pnpm db:migrate` i ' +
          '`SEED_SAMPLE_RENTALS=0 pnpm db:seed`, a potem `pnpm db:history` (ADR 0075).',
      );
    }

    // Okno: pełne doby czasu polskiego przed dniem, w którym zaczyna się historia stanów (seed albo migracja 0013).
    const [origin] = await q<{ t0: Date | null }>('SELECT min(valid_from) AS t0 FROM scooter_status_history');
    if (!origin?.t0) {
      throw new HistoryRefusedError(
        'Brak hulajnóg z historią stanów. Uruchom najpierw `pnpm db:migrate` i `pnpm db:seed`.',
      );
    }
    const days = await q<{ date: string; isodow: number; start: Date; end: Date }>(
      `SELECT d::date::text AS date, extract(isodow FROM d)::int AS isodow,
              d AT TIME ZONE 'Europe/Warsaw' AS start, (d + interval '1 day') AT TIME ZONE 'Europe/Warsaw' AS end
       FROM generate_series(((($1::timestamptz AT TIME ZONE 'Europe/Warsaw')::date - $2::int))::timestamp,
                            ((($1::timestamptz AT TIME ZONE 'Europe/Warsaw')::date - 1))::timestamp,
                            interval '1 day') d`,
      [origin.t0, this.options.days],
    );
    this.days = days.map((d) => ({ date: d.date, isodow: d.isodow, start: d.start.getTime(), end: d.end.getTime() }));
    this.windowStart = this.days[0]!.start;
    this.windowEnd = this.days[this.days.length - 1]!.end;
    this.lastService = this.windowEnd - HOUR;

    await this.prepareTariffs(q);
    await this.loadZones(q);
    await this.loadScooters(q);

    const staff = await q<{ id: string; role: string }>(
      `SELECT s.id, r.name AS role FROM staff s JOIN staff_roles sr ON sr.staff_id = s.id JOIN roles r ON r.id = sr.role_id
       WHERE s.active ORDER BY s.created_at, s.email`,
    );
    const byRole = (role: string) => staff.find((s) => s.role === role)?.id;
    const admin = byRole('Administrator') ?? staff[0]?.id;
    if (!admin) throw new HistoryRefusedError('Brak aktywnych operatorów. Uruchom najpierw `pnpm db:seed`.');
    this.staff = { admin, dispatcher: byRole('Dyspozytor') ?? admin, technician: byRole('Serwisant') ?? admin };

    for (const p of await q<{ id: string; sku: string; unit_cost: string; min_stock_qty: number; active: boolean }>(
      'SELECT id, sku, unit_cost, min_stock_qty, active FROM spare_parts ORDER BY sku',
    )) {
      this.parts.set(p.sku, {
        id: p.id,
        sku: p.sku,
        unitCost: Number(p.unit_cost),
        minStock: p.min_stock_qty,
        active: p.active,
        stock: 0,
        deliveryPlanned: false,
      });
    }
    this.documents = (
      await q<{ consent_type: 'TERMS' | 'PRIVACY'; version_id: string; version_no: number }>(
        `SELECT consent_type, version_id, version_no FROM v_current_documents
         WHERE consent_type IN ('TERMS', 'PRIVACY') ORDER BY consent_type`,
      )
    ).map((d) => ({ type: d.consent_type, versionId: d.version_id, versionNo: d.version_no }));
    const [company] = await q<{
      name: string;
      street: string | null;
      postal_code: string | null;
      city: string | null;
      tax_id: string | null;
    }>('SELECT name, street, postal_code, city, tax_id FROM company_profile LIMIT 1');
    if (company) {
      this.seller = {
        name: company.name,
        address: company.street
          ? companyAddress({ street: company.street, postalCode: company.postal_code ?? '', city: company.city ?? '' })
          : null,
        taxId: company.tax_id || null,
      };
    }
    this.createCustomers();
  }

  /**
   * Cennik (ADR 0075): przejazd musi mieć wersję obowiązującą w chwili startu. Najstarsza wersja bez przejazdów
   * dostaje `valid_from` z początku okna. Wyzwalacz `tariffs_rules` (0007) odrzuca każdą aktualizację wersji
   * (`TARIFF_IMMUTABLE`), więc „przesunięcie” to usunięcie i ponowne wstawienie tego samego wiersza (ten sam
   * identyfikator, numer, wartości, autor i `created_at`) z wcześniejszym `valid_from`; wyzwalacza nie wyłączamy,
   * a wstawienie przechodzi jego regułę (brak wersji zaplanowanej). Wersja z przejazdami kończy się błędem.
   */
  private async prepareTariffs(q: <T extends Row>(sql: string, params?: unknown[]) => Promise<T[]>) {
    const rows = await q<Row & { id: string; version: number; valid_from: Date; rentals: string }>(
      `SELECT t.*, t.created_at::text AS created_at_text, (SELECT count(*) FROM rentals r WHERE r.tariff_id = t.id) AS rentals
       FROM tariffs t ORDER BY t.version`,
    );
    const oldest = rows[0];
    if (!oldest) throw new HistoryRefusedError('Brak cennika. Uruchom najpierw `pnpm db:seed`.');
    if (oldest.valid_from.getTime() > this.windowStart) {
      if (Number(oldest.rentals) > 0) {
        throw new HistoryRefusedError(
          `Najstarsza wersja cennika (${oldest.version}) obowiązuje od ${oldest.valid_from.toISOString()} i ma przejazdy, ` +
            'więc nie można przesunąć jej na początek okna. Użyj świeżej bazy (ADR 0075).',
        );
      }
      await this.client.query('BEGIN');
      try {
        await this.client.query('DELETE FROM tariffs WHERE id = $1', [oldest.id]);
        await this.client.query(
          `INSERT INTO tariffs (id, version, unlock_fee, minute_rate, pause_minute_rate, out_of_zone_fee,
             free_reservation_minutes, min_wallet_balance, min_battery_pct, min_user_age, valid_from, created_by,
             created_at, vat_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            oldest.id,
            oldest.version,
            oldest.unlock_fee,
            oldest.minute_rate,
            oldest.pause_minute_rate,
            oldest.out_of_zone_fee,
            oldest.free_reservation_minutes,
            oldest.min_wallet_balance,
            oldest.min_battery_pct,
            oldest.min_user_age,
            iso(this.windowStart),
            oldest.created_by,
            oldest.created_at_text,
            oldest.vat_rate,
          ],
        );
        await this.client.query('COMMIT');
      } catch (error) {
        await this.client.query('ROLLBACK');
        throw error;
      }
      this.tariffShift = {
        version: oldest.version,
        validFrom: iso(this.windowStart),
        previousValidFrom: oldest.valid_from,
      };
      oldest.valid_from = iso(this.windowStart);
    }
    this.tariffs = rows.map((t) => ({
      id: t.id,
      version: t.version,
      validFrom: t.valid_from.getTime(),
      unlockFee: Number(t.unlock_fee),
      minuteRate: Number(t.minute_rate),
      pauseMinuteRate: Number(t.pause_minute_rate),
      outOfZoneFee: Number(t.out_of_zone_fee),
      freeReservationMinutes: Number(t.free_reservation_minutes),
      minWalletBalance: Number(t.min_wallet_balance),
      minBatteryPct: Number(t.min_battery_pct),
      vatRate: Number(t.vat_rate),
    }));
  }

  private async loadZones(q: <T extends Row>(sql: string, params?: unknown[]) => Promise<T[]>) {
    const rows = await q<{
      id: string;
      code: string;
      name: string;
      type: Zone['type'];
      speed_limit_kmh: number | null;
      geojson: string;
      lon: number;
      lat: number;
      radius: number;
    }>(
      `SELECT id, code, name, type, speed_limit_kmh, ST_AsGeoJSON(geom) AS geojson,
              ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
              sqrt(ST_Area(geom::geography) / pi()) AS radius
       FROM zones WHERE active ORDER BY code`,
    );
    this.zones = rows.map((z) => {
      const polygons = parsePolygons(z.geojson);
      const pad = 15 / 111_320;
      return {
        id: z.id,
        code: z.code,
        name: z.name,
        type: z.type,
        speedLimitKmh: z.speed_limit_kmh,
        polygons,
        center: { lat: z.lat, lon: z.lon },
        radiusM: z.radius,
        near: {
          minLon: Math.min(...polygons.map((p) => p.bbox.minLon)) - pad * 1.6,
          minLat: Math.min(...polygons.map((p) => p.bbox.minLat)) - pad,
          maxLon: Math.max(...polygons.map((p) => p.bbox.maxLon)) + pad * 1.6,
          maxLat: Math.max(...polygons.map((p) => p.bbox.maxLat)) + pad,
        },
      };
    });
    this.parking = this.zones.filter((z) => z.type === 'PARKING');
    this.noRide = this.zones.filter((z) => z.type === 'NO_RIDE');
    this.serviceArea = this.zones.filter((z) => z.type === 'SERVICE_AREA');
    if (this.parking.length < 2 || !this.serviceArea.length) {
      throw new HistoryRefusedError(
        'Generator potrzebuje obszaru działania i co najmniej dwóch stref parkowania (pnpm db:seed).',
      );
    }
  }

  private async loadScooters(q: <T extends Row>(sql: string, params?: unknown[]) => Promise<T[]>) {
    const rows = await q<{
      id: string;
      number: number;
      status: string;
      battery_pct: number | null;
      lon: number | null;
      lat: number | null;
      history_from: Date;
      history_from_text: string;
      busy_from: Date | null;
      open_task: boolean;
    }>(
      `SELECT s.id, s.number, s.status, s.battery_pct, ST_X(s.position) AS lon, ST_Y(s.position) AS lat,
              (SELECT min(h.valid_from) FROM scooter_status_history h WHERE h.scooter_id = s.id) AS history_from,
              (SELECT min(h.valid_from) FROM scooter_status_history h WHERE h.scooter_id = s.id)::text AS history_from_text,
              LEAST((SELECT min(t.created_at) FROM tickets t WHERE t.scooter_id = s.id),
                    (SELECT min(t.created_at) FROM service_tasks t WHERE t.scooter_id = s.id)) AS busy_from,
              EXISTS (SELECT 1 FROM service_tasks t WHERE t.scooter_id = s.id AND t.status IN ('OPEN', 'IN_PROGRESS'))
                AS open_task
       FROM scooters s ORDER BY s.number`,
    );
    for (const s of rows) {
      if (!s.history_from) continue;
      const pos = s.lat === null || s.lon === null ? null : { lat: s.lat, lon: s.lon };
      const parking = pos ? this.nearestParking(pos) : s.number % this.parking.length;
      this.scooters.push({
        id: s.id,
        number: s.number,
        parking,
        pos: this.pointInZone(this.parking[parking]!),
        battery: Math.max(s.battery_pct ?? 80, 20),
        busyUntil: this.windowStart,
        // Hulajnoga wycofana albo z otwartym zadaniem (indeks „jedno otwarte zadanie danego rodzaju” nie pozwoli
        // wstawić zadania historycznego, które przechodzi przez `OPEN`) stoi poza symulacją; z innymi zgłoszeniami
        // z danych startowych odpada od chwili pierwszego z nich.
        excludedFrom:
          s.status === 'RETIRED' || s.open_task
            ? this.windowStart
            : Math.min(s.busy_from?.getTime() ?? Infinity, this.windowEnd),
        status: 'AVAILABLE',
        online: true,
        curFrom: this.windowStart,
        historyEnd: s.history_from.getTime(),
        historyEndText: s.history_from_text,
        odometer: 0,
      });
    }
    if (!this.scooters.length) throw new HistoryRefusedError('Brak hulajnóg. Uruchom najpierw `pnpm db:seed`.');
  }

  private nearestParking(p: GeoPoint): number {
    let best = 0;
    for (let i = 1; i < this.parking.length; i++) {
      if (distanceM(p, this.parking[i]!.center) < distanceM(p, this.parking[best]!.center)) best = i;
    }
    return best;
  }

  private pointInZone(zone: ZoneInfo): GeoPoint {
    for (let i = 0; i < 30; i++) {
      const p = randomAround(this.random, zone.center, zone.radiusM * 0.6);
      if (insidePolygons(zone.polygons, p) && distanceToBoundaryM(zone.polygons, p) > 3) return p;
    }
    return zone.center;
  }

  /** Klienci z numerami +48 100 …, rejestracje rozłożone w oknie (kohorty) i część klientów sprzed okna. */
  private createCustomers() {
    const total = Math.max(20, Math.ceil(this.options.ridesPerDay * CUSTOMERS_PER_DAILY_RIDE));
    const span = this.windowEnd - this.windowStart;
    const year = new Date(this.windowEnd).getUTCFullYear();
    const created: number[] = [];
    for (let i = 0; i < total; i++) {
      created.push(
        this.random.chance(PRE_WINDOW_SHARE)
          ? this.windowStart - this.random.next() * 120 * DAY
          : this.windowStart + Math.pow(this.random.next(), 0.85) * (span - 2 * HOUR),
      );
    }
    created.sort((a, b) => a - b);
    created.forEach((at, i) => {
      const female = this.random.chance(0.5);
      const first = this.random.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
      const last = this.random.pick(SURNAMES)[female ? 1 : 0];
      const hasCard = this.random.chance(0.55);
      const id = randomUUID();
      const customer: Customer = {
        id,
        phone: `${HISTORY_PHONE_PREFIX}${String(i + 1).padStart(6, '0')}`,
        name: `${first} ${last}`,
        email: this.random.chance(0.6) ? `klient${String(i + 1).padStart(6, '0')}@example.test` : null,
        createdAt: Math.floor(at),
        weight: Math.min(8, this.random.logNormal(1, 0.9)),
        card: hasCard
          ? {
              id: randomUUID(),
              expMonth: this.random.int(1, 12),
              expYear: year + this.random.int(1, 4),
              removedAt: null,
            }
          : null,
        prefersCard: hasCard && this.random.chance(0.45),
        balance: 0,
        busyUntil: 0,
        unpaid: new Set(),
        blocked: false,
        rides: 0,
        row: {},
      };
      this.customers.push(customer);
      this.queue.push(customer.createdAt, () => this.register(customer));
    });
  }

  // --- Przebieg --------------------------------------------------------------------------------------------

  async run(): Promise<void> {
    this.scheduleWindowEvents();
    for (const [index, day] of this.days.entries()) {
      this.scheduleDay(day, index);
      this.dayRides = 0;
      await this.client.query('BEGIN');
      try {
        while (this.queue.size && this.queue.peek()!.at < day.end) this.queue.pop()!.run();
        if (index === this.days.length - 1) this.finish();
        await this.assignReceiptNumbers();
        await this.writer.flush(this.client);
        await this.client.query('COMMIT');
      } catch (error) {
        await this.client.query('ROLLBACK');
        throw error;
      }
      this.options.onDay?.({ day: day.date, index, total: this.days.length, rides: this.dayRides });
    }
    this.count('discardedEvents', this.queue.size);
    await this.client.query('BEGIN');
    try {
      // Pamięć podręczna sald z księgi i przebieg hulajnóg (stan bieżący poza historią).
      await this.client.query('CALL sp_rebuild_wallet_balances(NULL)');
      await this.client.query(
        `UPDATE scooters s SET odometer_m = s.odometer_m + u.add
         FROM unnest($1::uuid[], $2::int8[]) AS u(id, add) WHERE s.id = u.id`,
        [this.scooters.map((s) => s.id), this.scooters.map((s) => Math.round(s.odometer))],
      );
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  summary(elapsedMs: number): HistorySummary {
    return {
      windowFrom: iso(this.windowStart),
      windowTo: iso(this.windowEnd),
      days: this.days.length,
      rows: { ...this.writer.inserted },
      stats: { ...this.stats },
      tariff: this.tariffShift,
      elapsedMs,
    };
  }

  private scheduleWindowEvents() {
    // Dostawa początkowa magazynu: stan zapasu trzy razy większy od minimum.
    for (const part of this.parts.values()) {
      if (!part.active) continue;
      this.queue.push(this.windowStart + 8 * HOUR, () => this.receiveParts(part, Math.max(3 * part.minStock, 10)));
    }
    for (const scooter of this.scooters) this.scheduleOffline(scooter, this.windowStart);
    // Inwentaryzacja przed przyjęciem dostawy startowej z `pnpm db:seed` (ruch `RECEIPT` od stanu 0 w chwili seeda).
    this.queue.push(this.windowEnd - 30 * MINUTE, () => this.stocktake());
  }

  private localTime(day: Day, hours: number): number {
    const shift = day.end - day.start - DAY;
    return day.start + hours * HOUR + (hours >= 3 ? shift : 0);
  }

  private scheduleDay(day: Day, index: number) {
    const weekend = day.isodow >= 6;
    const profile = weekend ? WEEKEND_HOURS : WEEKDAY_HOURS;
    const trend = 0.9 + (0.2 * index) / Math.max(1, this.days.length - 1);
    const weather = this.random.chance(0.08) ? 0.55 : this.random.logNormal(1, 0.1);
    const expected = this.options.ridesPerDay * WEEKDAY_FACTOR[day.isodow]! * trend * weather * 1.08;
    const requests = Math.max(0, Math.round(this.random.normal(expected, Math.sqrt(expected))));
    // Ostatnia doba bez wieczornych przejazdów: przejazd, serwis po nim i rozliczenie mieszczą się przed końcem okna.
    const last = index === this.days.length - 1 ? day.end - 6 * HOUR : day.end;
    for (let i = 0; i < requests; i++) {
      const hour = this.random.weightedIndex(profile) + this.random.next();
      const at = Math.floor(this.localTime(day, hour));
      if (at < last) this.queue.push(at, () => this.request(at, hour));
    }
    for (const hour of [6.5, 12.5, 18]) {
      const at = this.localTime(day, hour + this.random.next() / 4);
      if (at < this.lastService - 3 * HOUR) this.queue.push(at, () => this.swapRound(at));
    }
    const inspection = this.localTime(day, 9 + this.random.next());
    if (!weekend && inspection < this.lastService - 4 * HOUR) {
      this.queue.push(inspection, () => this.inspection(inspection));
    }
    const adjustments = Math.round(this.random.exponential(this.options.ridesPerDay / 150));
    for (let i = 0; i < adjustments; i++) {
      const at = this.localTime(day, 9 + this.random.next() * 9);
      this.queue.push(at, () => this.adjustment(at));
    }
  }

  /** Ostatnia doba: zgłoszenia bez zadania zostają otwarte (`NEW`), przedziały historii kończą się przed otwartym. */
  private finish() {
    for (const [, pending] of this.pendingTickets) this.writer.add('tickets', pending.row);
    this.count('openTickets', this.pendingTickets.size);
    this.pendingTickets.clear();
    for (const s of this.scooters) {
      if (s.curFrom > s.historyEnd) throw new Error(`Historia hulajnogi ${s.number} wychodzi poza otwarty przedział`);
      if (s.historyEnd > s.curFrom) {
        this.writer.add('scooter_status_history', {
          scooter_id: s.id,
          status: s.status,
          online: s.online,
          valid_from: iso(s.curFrom),
          valid_to: s.historyEndText,
        });
      }
    }
  }

  // --- Hulajnogi: historia stanów (ADR 0074) -------------------------------------------------------------

  private setScooter(s: ScooterSim, at: number, status: ScooterSim['status'], online = s.online) {
    if (status === s.status && online === s.online) return;
    if (at < s.curFrom) throw new Error(`Zmiana stanu hulajnogi ${s.number} wstecz w czasie`);
    if (at > s.curFrom) {
      this.writer.add('scooter_status_history', {
        scooter_id: s.id,
        status: s.status,
        online: s.online,
        valid_from: iso(s.curFrom),
        valid_to: iso(at),
      });
      s.curFrom = at;
    }
    s.status = status;
    s.online = online;
  }

  private rentable(s: ScooterSim, at: number, tariff: Tariff): boolean {
    return (
      s.busyUntil <= at &&
      at < s.excludedFrom &&
      s.status === 'AVAILABLE' &&
      s.online &&
      s.battery >= tariff.minBatteryPct
    );
  }

  private free(s: ScooterSim, at: number): boolean {
    return s.busyUntil <= at && at < s.excludedFrom && s.status === 'AVAILABLE' && s.online;
  }

  private tariffAt(at: number): Tariff {
    let current = this.tariffs[0]!;
    for (const t of this.tariffs) if (t.validFrom <= at) current = t;
    return current;
  }

  // --- Klienci ---------------------------------------------------------------------------------------------

  private register(c: Customer) {
    const at = c.createdAt;
    c.row = this.writer.add('users', {
      id: c.id,
      phone: c.phone,
      email: c.email,
      name: c.name,
      status: 'ACTIVE',
      created_at: iso(at),
      updated_at: iso(at),
      notify_reservation_end: true,
      notify_receipts: this.random.chance(0.9),
    });
    const consentAt = at + 20 * SECOND;
    for (const doc of this.documents) {
      this.writer.add('consents', {
        user_id: c.id,
        type: doc.type,
        document_version: String(doc.versionNo),
        accepted_at: iso(consentAt),
        page_version_id: doc.versionId,
        source: 'REGISTRATION',
      });
    }
    this.writer.add('consents', {
      user_id: c.id,
      type: 'AGE',
      document_version: '1',
      accepted_at: iso(consentAt),
      source: 'REGISTRATION',
    });
    if (this.random.chance(MARKETING_CONSENT)) {
      const revokedAt = this.random.chance(MARKETING_REVOKED)
        ? Math.max(at, this.windowStart) + this.random.next() * (this.windowEnd - Math.max(at, this.windowStart))
        : null;
      this.writer.add('consents', {
        user_id: c.id,
        type: 'MARKETING',
        document_version: '1',
        accepted_at: iso(consentAt),
        revoked_at: revokedAt === null ? null : iso(revokedAt),
        source: 'REGISTRATION',
      });
    }
    if (c.card) {
      const cardAt = at + this.random.int(2, 30) * MINUTE;
      this.writer.add('payment_customers', {
        user_id: c.id,
        provider: 'fake',
        provider_customer_id: `cus_hist_${c.phone.slice(-6)}`,
        created_at: iso(cardAt),
      });
      this.writer.add('payment_methods', {
        id: c.card.id,
        user_id: c.id,
        provider_ref: `pm_hist_${c.phone.slice(-6)}`,
        brand: this.random.chance(0.6) ? 'visa' : 'mastercard',
        last4: String(this.random.int(0, 9999)).padStart(4, '0'),
        exp_month: c.card.expMonth,
        exp_year: c.card.expYear,
        is_default: true,
        created_at: iso(cardAt),
        provider: 'fake',
      });
    }
    this.registered.push(c);
    if (this.random.chance(BLOCKED_CUSTOMERS)) {
      const from = Math.max(at, this.windowStart) + 3 * DAY;
      if (from < this.windowEnd - DAY) {
        const blockAt = from + this.random.next() * (this.windowEnd - DAY - from);
        this.queue.push(blockAt, () => this.block(c, blockAt));
      }
    }
  }

  private block(c: Customer, at: number) {
    if (c.busyUntil > at) {
      const later = c.busyUntil + 2 * HOUR;
      this.queue.push(later, () => this.block(c, later));
      return;
    }
    const reason = this.random.chance(0.6) ? 'TERMS_VIOLATION' : 'SUSPECTED_ABUSE';
    c.blocked = true;
    this.writer.patch('users', c.row, {
      status: 'BLOCKED',
      blocked_at: iso(at),
      blocked_reason: reason,
      updated_at: iso(at),
    });
    this.audit(at, this.staff.admin, 'user.blocked', 'user', c.id, { reason });
    this.count('blockedCustomers');
  }

  private pickCustomer(at: number): Customer | null {
    if (!this.registered.length) return null;
    for (let i = 0; i < 80; i++) {
      const c = this.random.pick(this.registered);
      if (c.createdAt + 10 * MINUTE > at || c.blocked || c.busyUntil > at || c.unpaid.size) continue;
      if (this.random.next() * 8 > c.weight) continue;
      return c;
    }
    return null;
  }

  // --- Pieniądze -------------------------------------------------------------------------------------------

  private ledger(c: Customer, at: number, type: string, amount: number, refs: Row = {}) {
    c.balance += amount;
    this.writer.add('wallet_ledger', {
      user_id: c.id,
      type,
      amount,
      balance_after: c.balance,
      created_at: iso(at),
      ...refs,
    });
  }

  private paymentRef() {
    this.paymentSeq++;
    return String(this.paymentSeq).padStart(7, '0');
  }

  /** Doładowanie kartą albo BLIK-iem (ADR 0050); czasem pierwsza próba kartą zostaje odrzucona. */
  private topUp(c: Customer, at: number, needed: number) {
    const preset =
      TOPUP_PRESETS.find((p) => p >= needed && this.random.chance(0.6)) ?? TOPUP_PRESETS.find((p) => p >= needed);
    const amount = preset ?? Math.min(TOPUP_MAX, Math.max(TOPUP_MIN, Math.ceil(needed / 1000) * 1000));
    ensureTopupAmount(amount);
    let method: 'CARD' | 'BLIK' = c.card && this.random.chance(0.7) ? 'CARD' : 'BLIK';
    if (method === 'CARD' && this.random.chance(TOPUP_DECLINED)) {
      const ref = this.paymentRef();
      const code = this.random.chance(0.6) ? 'card_declined' : 'insufficient_funds';
      this.writer.add('payments', {
        id: randomUUID(),
        user_id: c.id,
        purpose: 'TOPUP',
        method: 'CARD',
        payment_method_id: c.card!.id,
        amount,
        status: 'FAILED',
        provider: 'fake',
        provider_payment_id: `pi_hist_${ref}`,
        idempotency_key: `hist-${ref}`,
        failure_code: code,
        failure_reason: `Atrapa: ${code}`,
        created_at: iso(at),
        updated_at: iso(at + 2 * SECOND),
      });
      this.count('topupsDeclined');
      method = 'BLIK';
    }
    const ref = this.paymentRef();
    const paymentId = randomUUID();
    this.writer.add('payments', {
      id: paymentId,
      user_id: c.id,
      purpose: 'TOPUP',
      method,
      payment_method_id: method === 'CARD' ? c.card!.id : null,
      amount,
      status: 'SUCCEEDED',
      provider: 'fake',
      provider_payment_id: `pi_hist_${ref}`,
      idempotency_key: `hist-${ref}`,
      created_at: iso(at),
      updated_at: iso(at),
    });
    this.ledger(c, at, 'TOPUP', amount, { payment_id: paymentId });
    this.count(`topups${method}`);
  }

  /** Reguła startu z core (`ensureCanPay`): brak środków to doładowanie przed rezerwacją. */
  private ensurePayment(c: Customer, at: number, source: 'WALLET' | 'CARD', tariff: Tariff) {
    const check = () =>
      ensureCanPay({
        source,
        balance: c.balance,
        minWalletBalance: tariff.minWalletBalance,
        overdueRentalIds: [...c.unpaid],
        card: c.card,
        now: iso(at),
      });
    try {
      check();
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'INSUFFICIENT_BALANCE') throw error;
      this.topUp(c, at, source === 'WALLET' ? tariff.minWalletBalance - c.balance : -c.balance);
      check();
    }
  }

  private nextReceipt(row: Row, items: readonly ReceiptItem[]) {
    this.dayReceipts.push(row);
    this.writer.add('receipts', row);
    items.forEach((item, i) =>
      this.writer.add('receipt_items', {
        receipt_id: row.id,
        line_no: i + 1,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        vat_rate: item.vatRate,
        amount: item.amount,
      }),
    );
  }

  private saleReceipt(ride: Ride, at: number, source: 'WALLET' | 'CARD', paymentId: string | null) {
    const items = rideReceiptItems(ride.price, ride.tariff, ride.tariff.vatRate);
    const id = randomUUID();
    this.nextReceipt(
      this.receiptRow(id, ride.user, 'SALE', at, ride.price.total, {
        rental_id: ride.id,
        payment_id: paymentId,
        payment_source: source,
      }),
      items,
    );
    ride.sale = { id, items, corrections: [] };
  }

  private receiptRow(id: string, c: Customer, kind: string, at: number, total: number, refs: Row): Row {
    return {
      id,
      user_id: c.id,
      kind,
      seller: this.seller,
      buyer_name: c.name,
      buyer_email: c.email,
      buyer_phone: c.phone,
      total_amount: total,
      issued_at: iso(at),
      ...refs,
    };
  }

  /** Numery `PAR/{rok}/{nnnnnn}` z sekwencji `receipt_number_seq` w kolejności wystawienia (ADR 0052). */
  private async assignReceiptNumbers() {
    if (!this.dayReceipts.length) return;
    const { rows } = await this.client.query<{ n: string }>(
      "SELECT nextval('receipt_number_seq') AS n FROM generate_series(1, $1::int)",
      [this.dayReceipts.length],
    );
    const numbers = rows.map((r) => Number(r.n)).sort((a, b) => a - b);
    this.dayReceipts.forEach((row, i) => {
      row.number = `PAR/${warsawYear.format(row.issued_at as Date)}/${String(numbers[i]).padStart(6, '0')}`;
    });
    this.dayReceipts = [];
  }

  private settleWallet(ride: Ride, at: number) {
    for (const entry of rideWalletEntries(ride.price.total, ride.towingFee)) {
      this.ledger(ride.user, at, entry.type, -entry.amount, { rental_id: ride.id });
    }
    ride.paidBy = 'WALLET';
    this.saleReceipt(ride, at, 'WALLET', null);
  }

  private cardPayment(ride: Ride, createdAt: number, settledAt: number, ok: boolean): Row {
    const ref = this.paymentRef();
    const id = randomUUID();
    const code = ok ? null : this.random.chance(0.6) ? 'card_declined' : 'insufficient_funds';
    return this.writer.add('payments', {
      id,
      user_id: ride.user.id,
      purpose: 'RIDE',
      rental_id: ride.id,
      method: 'CARD',
      payment_method_id: ride.user.card!.id,
      amount: ride.price.total,
      status: ok ? 'SUCCEEDED' : 'FAILED',
      provider: 'fake',
      provider_payment_id: `pi_hist_${ref}`,
      idempotency_key: `hist-${ref}`,
      failure_code: code,
      failure_reason: code ? `Atrapa: ${code}` : null,
      created_at: iso(createdAt),
      updated_at: iso(settledAt),
    });
  }

  private rentalEvent(ride: { id: string }, at: number, type: string, fields: Row = {}) {
    this.writer.add('rental_events', { rental_id: ride.id, type, data: {}, created_at: iso(at), ...fields });
  }

  /** Wynik obciążenia karty po `ENDED` (ADR 0049): sukces z paragonem albo odmowa i `UNPAID` z ponowieniem po dobie. */
  private cardResult(ride: Ride, at: number) {
    const ok = !this.random.chance(CARD_DECLINED);
    const payment = this.cardPayment(ride, ride.endedAt + SECOND, at, ok);
    const paymentId = payment.id as string;
    if (ok) {
      ride.paidBy = 'CARD';
      ride.cardPaymentId = paymentId;
      ride.cardPayment = payment;
      this.saleReceipt(ride, at, 'CARD', paymentId);
      return;
    }
    this.setRentalState(ride, at, 'UNPAID', { action: 'DECLINE_PAYMENT', paymentId, failureCode: 'card_declined' });
    ride.user.unpaid.add(ride.id);
    this.count('ridesDeclined');
    if (shouldRetryRideCharge(1)) {
      const retryAt = at + RIDE_CHARGE_RETRY_MS;
      this.queue.push(retryAt, () => this.cardRetry(ride, retryAt));
    }
  }

  private setRentalState(ride: Ride, at: number, to: RentalState, data: Row) {
    const from = ride.row.state as RentalState;
    this.writer.patch('rentals', ride.row, { state: to, updated_at: iso(at) });
    this.rentalEvent(ride, at, 'STATE_CHANGED', { from_state: from, to_state: to, data });
  }

  private cardRetry(ride: Ride, at: number) {
    const ok = this.random.chance(CARD_RETRY_SUCCEEDS);
    const settledAt = at + 3 * SECOND;
    const payment = this.cardPayment(ride, at, settledAt, ok);
    const paymentId = payment.id as string;
    if (ok) {
      this.settleDebt(ride, settledAt, { source: 'CARD', paymentId });
      ride.paidBy = 'CARD';
      ride.cardPaymentId = paymentId;
      ride.cardPayment = payment;
      this.saleReceipt(ride, settledAt, 'CARD', paymentId);
      return;
    }
    if (this.random.chance(DEBT_PAID_LATER)) {
      const payAt = at + this.random.between(1, 6) * DAY;
      this.queue.push(payAt, () => this.payDebt(ride, payAt));
    }
  }

  private settleDebt(ride: Ride, at: number, data: Row) {
    this.setRentalState(ride, at, 'ENDED', { action: 'SETTLE_DEBT', ...data });
    ride.user.unpaid.delete(ride.id);
    this.count('debtsSettled');
  }

  /** Spłata zaległości z portfela w aplikacji (`ensureCanPayDebt`), z doładowaniem BLIK-iem, gdy brakuje środków. */
  private payDebt(ride: Ride, at: number) {
    const c = ride.user;
    if (c.balance < ride.price.total) this.topUp(c, at, ride.price.total - c.balance);
    ensureCanPayDebt({
      source: 'WALLET',
      amount: ride.price.total,
      balance: c.balance,
      card: c.card,
      paymentPending: false,
      now: iso(at),
    });
    for (const entry of rideWalletEntries(ride.price.total, ride.towingFee)) {
      this.ledger(c, at, entry.type, -entry.amount, { rental_id: ride.id });
    }
    this.settleDebt(ride, at, { source: 'WALLET' });
    ride.paidBy = 'WALLET';
    this.saleReceipt(ride, at, 'WALLET', null);
  }

  /** Zwrot za przejazd (ADR 0054) według `decideRefund`: z portfela od razu z korektą, na kartę po wyniku operatora. */
  private refund(ride: Ride, at: number, reason: RefundReason, requested: number, ticketId: string | null) {
    const settlement = ride.paidBy === 'WALLET' ? 'WALLET_PAID' : ride.paidBy === 'CARD' ? 'CARD_PAID' : 'NONE';
    const remaining = ride.price.total - ride.refunded;
    const amount = Math.min(requested, remaining);
    if (amount <= 0 || settlement === 'NONE') return;
    const { source } = decideRefund({
      settlement,
      paid: ride.price.total,
      refunded: ride.refunded,
      amount,
      reason,
      note: null,
    });
    ride.refunded += amount;
    const id = randomUUID();
    this.refundSeq++;
    const doneAt = source === 'WALLET' ? at : at + 90 * SECOND;
    this.writer.add('refunds', {
      id,
      user_id: ride.user.id,
      rental_id: ride.id,
      payment_id: source === 'CARD' ? ride.cardPaymentId : null,
      ticket_id: ticketId,
      source,
      amount,
      reason,
      staff_id: this.staff.dispatcher,
      status: 'SUCCEEDED',
      provider_refund_id: source === 'CARD' ? `re_hist_${String(this.refundSeq).padStart(6, '0')}` : null,
      created_at: iso(at),
      updated_at: iso(doneAt),
    });
    this.audit(at, this.staff.dispatcher, 'rental.refunded', 'rental', ride.id, {
      refundId: id,
      amount,
      source,
      reason,
      ...(ticketId ? { ticketId } : {}),
    });
    this.count(`refunds${source}`);
    if (source === 'WALLET') {
      this.ledger(ride.user, at, 'REFUND', amount, {
        rental_id: ride.id,
        refund_id: id,
        staff_id: this.staff.dispatcher,
      });
      this.correction(ride, at, id, amount, 'WALLET');
    } else {
      this.queue.push(doneAt, () => {
        this.correction(ride, doneAt, id, amount, 'CARD');
        // Zwrot całości: płatność `REFUNDED` (`nextPaymentStatus`).
        if (ride.refunded >= ride.price.total && ride.cardPayment) {
          this.writer.patch('payments', ride.cardPayment, { status: 'REFUNDED', updated_at: iso(doneAt) });
        }
      });
    }
  }

  private correction(ride: Ride, at: number, refundId: string, amount: number, source: 'WALLET' | 'CARD') {
    if (!ride.sale) return;
    const items = correctionItems(amount, ride.sale.items, ride.sale.corrections);
    ride.sale.corrections.push(...items);
    this.nextReceipt(
      this.receiptRow(randomUUID(), ride.user, 'CORRECTION', at, -amount, {
        rental_id: ride.id,
        refund_id: refundId,
        corrects_receipt_id: ride.sale.id,
        payment_source: source,
      }),
      items,
    );
  }

  /** Korekta salda przez operatora (ADR 0054, `ensureAdjustment`). */
  private adjustment(at: number) {
    const candidates = this.registered.filter((c) => c.rides > 0 && !c.blocked);
    if (!candidates.length) return;
    const c = this.random.pick(candidates);
    const reason: AdjustmentReason = this.random.weighted([
      ['GOODWILL', 5],
      ['COMPLAINT', 3],
      ['SYSTEM_ERROR', 1.5],
      ['OTHER', 0.5],
    ]);
    const amount = reason === 'OTHER' ? -this.random.int(3, 10) * 100 : this.random.int(3, 20) * 100;
    const note =
      reason === 'OTHER'
        ? 'Korekta podwójnie zaksięgowanego doładowania.'
        : reason === 'GOODWILL'
          ? 'Gest dobrej woli po reklamacji.'
          : null;
    ensureAdjustment({ amount, reason, note });
    this.ledger(c, at, 'ADJUSTMENT', amount, { staff_id: this.staff.admin, reason, note });
    this.audit(at, this.staff.admin, 'wallet.adjusted', 'user', c.id, {
      amount,
      reason,
      ...(note ? { note } : {}),
      balanceAfter: c.balance,
    });
    this.count('adjustments');
  }

  private audit(at: number, staffId: string | null, action: string, entityType: string, entityId: string, data: Row) {
    this.writer.add('audit_log', {
      actor: staffId ? 'STAFF' : 'SYSTEM',
      staff_id: staffId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      data,
      created_at: iso(at),
    });
  }

  // --- Przejazdy -------------------------------------------------------------------------------------------

  private zonesNear(p: GeoPoint): Array<{ zone: ZoneInfo; inside: boolean }> {
    const out: Array<{ zone: ZoneInfo; inside: boolean }> = [];
    for (const zone of this.zones) {
      const b = zone.near;
      if (p.lon < b.minLon || p.lon > b.maxLon || p.lat < b.minLat || p.lat > b.maxLat) continue;
      const inside = insidePolygons(zone.polygons, p);
      if (inside || distanceToBoundaryM(zone.polygons, p) <= 10) out.push({ zone, inside });
    }
    return out;
  }

  private canPark(p: GeoPoint): boolean {
    return evaluatePosition(
      this.zonesNear(p)
        .filter((n) => n.inside)
        .map((n) => n.zone),
    ).canPark;
  }

  private originZone(hour: number): number {
    // Rano więcej startów przy dworcu i kampusie, po południu przy centrach handlowych (prosty rytm stref).
    return this.random.weightedIndex(
      this.parking.map((z) => {
        if (z.code === 'P-02') return hour < 10 ? 1.8 : 1;
        if (z.code === 'P-03') return hour < 12 ? 1.5 : 0.9;
        if (z.code === 'P-04' || z.code === 'P-05') return hour >= 13 ? 1.3 : 0.8;
        return 1.2;
      }),
    );
  }

  private pickScooter(at: number, zone: number, tariff: Tariff): ScooterSim | null {
    const order = this.parking
      .map((z, i) => ({ i, d: distanceM(z.center, this.parking[zone]!.center) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { i } of order) {
      const free = this.scooters.filter((s) => s.parking === i && this.rentable(s, at, tariff));
      if (free.length) return this.random.pick(free);
    }
    return null;
  }

  private command(scooter: ScooterSim, rentalId: string | null, type: string, sentAt: number, fields: Row = {}) {
    const ackAt = sentAt + this.random.int(300, 1500);
    this.writer.add('scooter_commands', {
      scooter_id: scooter.id,
      rental_id: rentalId,
      type,
      payload: {},
      status: 'ACKED',
      sent_at: iso(sentAt),
      acked_at: iso(ackAt),
      expires_at: iso(sentAt + COMMAND_ACK_TIMEOUT_MS),
      source: 'RENTAL',
      ...fields,
    });
    return ackAt;
  }

  private request(at: number, hour: number) {
    const tariff = this.tariffAt(at);
    const scooter = this.pickScooter(at, this.originZone(hour), tariff);
    if (!scooter) return this.count('lostNoScooter');
    const user = this.pickCustomer(at);
    if (!user) return this.count('lostNoCustomer');
    const source = user.prefersCard && user.card ? 'CARD' : 'WALLET';
    this.ensurePayment(user, at, source, tariff);
    this.ride(at, user, scooter, tariff, source);
  }

  private ride(at: number, user: Customer, scooter: ScooterSim, tariff: Tariff, source: 'WALLET' | 'CARD') {
    const id = randomUUID();
    const r = this.random;
    const reserved = r.chance(RESERVATION_SHARE);
    const expiresAt = at + tariff.freeReservationMinutes * MINUTE;
    const base: Row = {
      id,
      user_id: user.id,
      scooter_id: scooter.id,
      tariff_id: tariff.id,
      payment_source: source,
      payment_method_id: source === 'CARD' ? user.card!.id : null,
      reserved_at: reserved ? iso(at) : null,
      reservation_expires_at: reserved ? iso(expiresAt) : null,
      created_at: iso(at),
      start_position: pointWkt(scooter.pos),
      ride_seconds: 0,
      pause_seconds: 0,
      distance_m: 0,
    };
    const ref = { id };
    if (reserved) {
      this.rentalEvent(ref, at, 'STATE_CHANGED', { to_state: 'RESERVED' });
      this.setScooter(scooter, at, 'RESERVED');
      const outcome = r.next();
      if (outcome < RESERVATION_EXPIRED + RESERVATION_CANCELLED) {
        const cancelled = outcome >= RESERVATION_EXPIRED;
        const endAt = cancelled
          ? at + r.between(1, tariff.freeReservationMinutes - 1) * MINUTE
          : expiresAt + r.int(1, 20) * SECOND;
        this.rentalEvent(ref, endAt, 'STATE_CHANGED', {
          from_state: 'RESERVED',
          to_state: 'EXPIRED',
          data: cancelled
            ? { action: 'CANCEL_RESERVATION' }
            : { action: 'EXPIRE_RESERVATION', reason: 'reservation_timeout' },
        });
        this.writer.add('rentals', { ...base, state: 'EXPIRED', updated_at: iso(endAt) });
        this.setScooter(scooter, endAt, 'AVAILABLE');
        scooter.busyUntil = endAt;
        user.busyUntil = endAt;
        return this.count(cancelled ? 'reservationsCancelled' : 'reservationsExpired');
      }
    }
    const tStart = reserved
      ? at + r.between(0.5, Math.max(1, tariff.freeReservationMinutes - 1)) * MINUTE
      : at + r.int(5, 40) * SECOND;
    this.rentalEvent(ref, tStart, 'STATE_CHANGED', {
      from_state: reserved ? 'RESERVED' : null,
      to_state: 'UNLOCKING',
      data: { action: 'START' },
    });
    this.setScooter(scooter, tStart, 'IN_USE');
    if (r.chance(UNLOCK_FAILED)) {
      const failAt = tStart + COMMAND_ACK_TIMEOUT_MS + r.int(100, 900);
      this.writer.add('scooter_commands', {
        scooter_id: scooter.id,
        rental_id: id,
        type: 'UNLOCK',
        payload: {},
        status: 'TIMEOUT',
        sent_at: iso(tStart),
        expires_at: iso(tStart + COMMAND_ACK_TIMEOUT_MS),
        source: 'RENTAL',
      });
      this.rentalEvent(ref, failAt, 'STATE_CHANGED', {
        from_state: 'UNLOCKING',
        to_state: 'UNLOCK_FAILED',
        data: { action: 'UNLOCK_TIMEOUT' },
      });
      this.writer.add('rentals', { ...base, state: 'UNLOCK_FAILED', updated_at: iso(failAt) });
      this.setScooter(scooter, failAt, 'AVAILABLE');
      scooter.busyUntil = failAt;
      user.busyUntil = failAt;
      return this.count('unlockFailed');
    }
    const tActive = this.command(scooter, id, 'UNLOCK', tStart);
    const events: TimelineEvent[] = [{ type: 'STATE_CHANGED', toState: 'UNLOCKING', at: iso(tStart) }];
    const state = (at2: number, from: RentalState, to: RentalState, data: Row, extra: Row = {}) => {
      this.rentalEvent(ref, at2, 'STATE_CHANGED', { from_state: from, to_state: to, data, ...extra });
      events.push({ type: 'STATE_CHANGED', toState: to, at: iso(at2) });
    };
    state(tActive, 'UNLOCKING', 'ACTIVE', { action: 'CONFIRM_UNLOCK' });

    // Trasa: łamana od pozycji hulajnogi przez punkty pośrednie do strefy końca (albo poza strefę przy odholowaniu).
    const towed = r.chance(TOWED_SHARE);
    const from = scooter.parking;
    const to = r.chance(0.15) ? from : (from + 1 + r.int(0, this.parking.length - 2)) % this.parking.length;
    const end = towed ? this.outsideParking(this.parking[to]!.center) : this.pointInZone(this.parking[to]!);
    const points: GeoPoint[] = [scooter.pos];
    // Objazdy: przejazdy w Rybniku są dłuższe niż odległość między strefami (mediana ok. 2 km, część rekreacyjnych).
    const legs = r.int(2, 4) + (from === to ? 1 : 0);
    const detour = r.chance(0.15) ? r.between(900, 1800) : r.between(250, 1000);
    for (let i = 1; i <= legs; i++) {
      const f = i / (legs + 1);
      const mid = {
        lat: scooter.pos.lat + (end.lat - scooter.pos.lat) * f,
        lon: scooter.pos.lon + (end.lon - scooter.pos.lon) * f,
      };
      points.push(offset(mid, r.between(-detour, detour), r.between(-detour, detour)));
    }
    if (this.noRide.length && r.chance(NO_RIDE_PASS)) {
      points.splice(1 + r.int(0, legs - 1), 0, this.pointInZone(this.random.pick(this.noRide)));
    }
    points.push(end);
    const length = pathLengthM(points);
    const speed = r.between(10, 16) / 3.6;
    const moving = length / speed;
    const pause = r.chance(PAUSE_SHARE) ? { at: moving * r.between(0.3, 0.7), seconds: r.between(1, 10) * 60 } : null;

    let pauseShift = 0;
    const wall = (tau: number) => tActive + (tau + (pause && tau > pause.at ? pauseShift : 0)) * SECOND;
    if (pause) {
      const lockSent = tActive + pause.at * SECOND;
      const paused = this.command(scooter, id, 'LOCK', lockSent);
      state(paused, 'ACTIVE', 'PAUSED', { action: 'PAUSE' });
      const resumeSent = paused + pause.seconds * SECOND;
      const pauseEnd = this.command(scooter, id, 'UNLOCK', resumeSent);
      state(pauseEnd, 'PAUSED', 'ACTIVE', { action: 'RESUME' });
      pauseShift = (pauseEnd - lockSent) / SECOND;
    }

    // Odczyty co 10 s jazdy: przejścia stref z core (histereza wyjazdu) i komendy stref (ADR 0043, 0044).
    let presence: ZonePresence[] | null = null;
    let applied: AppliedZoneControl = { ...RESET_ZONE_CONTROL };
    let resetAfterPause = false;
    let reconcile = true;
    for (let tau = 0; ; tau = Math.min(moving, tau + 10)) {
      const now = wall(tau);
      if (pause && !resetAfterPause && tau > pause.at) {
        // `lock` pauzy kasuje limit i zatrzymanie, po wznowieniu stan stref uzgadnia się od nowa.
        applied = { ...RESET_ZONE_CONTROL };
        resetAfterPause = true;
        reconcile = true;
      }
      const p = pointAlong(points, (length * tau) / Math.max(moving, 1));
      const changes = detectZoneChanges(presence, { at: iso(now), near: this.zonesNear(p) });
      presence = changes.presence;
      for (const t of changes.transitions) {
        this.rentalEvent(ref, now, t.kind === 'ENTERED' ? 'ZONE_ENTERED' : 'ZONE_EXITED', {
          zone_id: t.zone.id,
          data: { code: t.zone.code, zoneType: t.zone.type, recordedAt: iso(now).toISOString() },
        });
      }
      if (reconcile || changes.transitions.length) {
        reconcile = false;
        const desired = desiredZoneControl(presence.map((x) => x.zone));
        const trigger = changes.transitions[0]?.zone.id ?? null;
        let sentAt = now + 300;
        for (const c of zoneControlCommands(applied, desired)) {
          this.command(scooter, id, c.type, sentAt, {
            source: 'ZONE',
            zone_id: trigger,
            payload: c.type === 'SPEED_LIMIT' && c.speedLimitKmh ? { kmh: c.speedLimitKmh } : {},
          });
          sentAt += 200;
          applied =
            c.type === 'SPEED_LIMIT'
              ? { ...applied, speedLimitKmh: c.speedLimitKmh ?? null, limitSynced: true }
              : { ...applied, stopped: c.type === 'STOP_GRADUALLY', stopSynced: true };
          this.count(`zoneCommands${c.type}`);
        }
      }
      if (tau >= moving) break;
    }
    const stopAt = wall(moving);

    // Zakończenie: przez klienta w strefie parkowania albo zdalnie przez dyspozytora poza strefą (ADR 0060).
    let te: number;
    let towingFee: number | null = null;
    let endMode: 'CUSTOMER' | 'REMOTE';
    if (towed) {
      te = stopAt + r.between(20, 70) * MINUTE;
      const towing = decideTowing({
        outsideParking: !this.canPark(end),
        collect: true,
        outOfZoneFee: tariff.outOfZoneFee,
      });
      towingFee = towing.towingFee;
      endMode = 'REMOTE';
      this.rentalEvent(ref, te, 'ENDED_REMOTELY', {
        data: { reason: 'CUSTOMER_REQUEST', staffId: this.staff.dispatcher, ...(towingFee ? { towingFee } : {}) },
      });
      events.push({ type: 'ENDED_REMOTELY', toState: null, at: iso(te) });
      state(te, 'ACTIVE', 'ENDED', { action: 'END_REMOTELY' });
      this.command(scooter, id, 'LOCK', te);
      this.audit(te, this.staff.dispatcher, 'rental.ended_remotely', 'rental', id, {
        reason: 'CUSTOMER_REQUEST',
        fromState: 'ACTIVE',
        outsideParking: towing.relocation,
        towingFee,
      });
    } else {
      const requestAt = stopAt + r.int(5, 40) * SECOND;
      const endZone = this.parking[to]!;
      this.rentalEvent(ref, requestAt, 'END_REQUESTED', { zone_id: endZone.id, data: { resumeState: 'ACTIVE' } });
      events.push({ type: 'END_REQUESTED', toState: null, at: iso(requestAt) });
      state(requestAt, 'ACTIVE', 'ENDING', { action: 'REQUEST_END' });
      te = this.command(scooter, id, 'LOCK', requestAt);
      state(te, 'ENDING', 'ENDED', { action: 'COMPLETE_END' });
      endMode = 'CUSTOMER';
    }
    const counters = rentalCounters(events, iso(te), { endMode });
    const price = priceRental(tariff, counters, { towingFee });
    const endZone = towed ? null : this.parking[to]!;
    const row = this.writer.add('rentals', {
      ...base,
      state: 'ENDED',
      started_at: iso(tActive),
      ended_at: iso(te),
      ride_seconds: counters.rideSeconds,
      pause_seconds: counters.pauseSeconds,
      distance_m: Math.round(length),
      end_position: pointWkt(end),
      end_zone_id: endZone?.id ?? null,
      route: lineWkt(points),
      total_amount: price.total,
      end_mode: endMode,
      towing_fee: towingFee,
      updated_at: iso(te),
    });
    const ride: Ride = {
      id,
      user,
      scooter,
      tariff,
      price,
      towingFee,
      source,
      endedAt: te,
      row,
      paidBy: null,
      cardPaymentId: null,
      cardPayment: null,
      refunded: 0,
      sale: null,
    };
    user.busyUntil = te;
    user.rides++;
    this.dayRides++;
    this.count('ridesEnded');
    if (towed) this.count('ridesTowed');
    scooter.pos = end;
    scooter.parking = towed ? this.nearestParking(end) : to;
    scooter.odometer += length;
    scooter.battery = Math.max(1, Math.round(scooter.battery - (length / 1000) * r.between(1.8, 2.8)));
    scooter.busyUntil = te;

    // Rozliczenie w chwili `ENDED`: portfel od razu, karta zadaniem po kilku sekundach (ADR 0049).
    if (source === 'WALLET') this.queue.push(te, () => this.settleWallet(ride, te));
    else {
      const resultAt = te + r.int(2, 6) * SECOND;
      this.queue.push(resultAt, () => this.cardResult(ride, resultAt));
    }

    // Hulajnoga po przejeździe: odholowanie albo krytyczna bateria to zgłoszenie automatyczne z zadaniem i serwis.
    if (towed) {
      this.setScooter(scooter, te, 'MAINTENANCE');
      this.autoTicketWithTask(scooter, ride, te, 'OUT_OF_ZONE');
    } else if (needsBatteryCriticalTicket(scooter.battery)) {
      this.setScooter(scooter, te, 'MAINTENANCE');
      this.autoTicketWithTask(scooter, ride, te, 'BATTERY_CRITICAL');
    } else {
      this.setScooter(scooter, te, 'AVAILABLE');
      if (r.chance(CUSTOMER_TICKET)) this.customerTicket(ride, te + r.between(1, 10) * MINUTE);
    }
  }

  private outsideParking(near: GeoPoint): GeoPoint {
    for (let i = 0; i < 50; i++) {
      const p = randomAround(this.random, near, 350);
      const zones = this.zonesNear(p)
        .filter((n) => n.inside)
        .map((n) => n.zone);
      const rules = evaluatePosition(zones);
      if (!rules.canPark && rules.canRide && this.zonesNear(p).every((n) => n.zone.type !== 'PARKING')) return p;
    }
    return offset(near, 400, 0);
  }

  // --- Zgłoszenia i serwis (ADR 0055) ----------------------------------------------------------------------

  /** Czasy zadania dopasowane do okna: zadanie kończy się przed `lastService`. */
  private fit(start: number, durations: number[]): number[] {
    const total = durations.reduce((s, d) => s + d, 0);
    const room = this.lastService - start;
    if (room <= 0) throw new Error('Zadanie serwisowe poza oknem generatora');
    const scale = total > room ? room / total : 1;
    let t = start;
    return durations.map((d) => (t += d * scale));
  }

  private ticketRow(fields: Row): Row {
    return { id: randomUUID(), status: 'NEW', urgent: false, ...fields };
  }

  /**
   * Zadanie serwisowe z pełnym przebiegiem: wstawienie `OPEN`, `IN_PROGRESS` ze startem i `DONE` z notatką; części
   * z magazynu w chwili użycia (zdarzenie), hulajnoga w serwisie od utworzenia do zakończenia, potem wolna.
   */
  private task(
    scooter: ScooterSim,
    createdAt: number,
    spec: {
      type: 'REPAIR' | 'BATTERY_SWAP' | 'INSPECTION' | 'RELOCATION';
      priority: 'LOW' | 'NORMAL' | 'HIGH';
      ticketId: string | null;
      createdBy: string | null;
      description?: string | null;
      waitMinutes: [number, number];
      workMinutes: [number, number];
      resultNote: string;
      parts?: ReadonlyArray<readonly [string, number]>;
      targetZone?: ZoneInfo;
    },
  ): { id: string; startedAt: number; doneAt: number } {
    const r = this.random;
    const [startedAt, doneAt] = this.fit(createdAt, [
      r.between(...spec.waitMinutes) * MINUTE,
      r.between(...spec.workMinutes) * MINUTE,
    ]) as [number, number];
    const id = randomUUID();
    this.writer.addTask(
      {
        id,
        scooter_id: scooter.id,
        ticket_id: spec.ticketId,
        type: spec.type,
        status: 'OPEN',
        priority: spec.priority,
        description: spec.description ?? null,
        assignee_id: this.staff.technician,
        created_by: spec.createdBy,
        target_zone_id: spec.targetZone?.id ?? null,
        created_at: iso(createdAt),
        updated_at: iso(createdAt),
      },
      [
        { status: 'IN_PROGRESS', started_at: iso(startedAt), updated_at: iso(startedAt) },
        { status: 'DONE', completed_at: iso(doneAt), result_note: spec.resultNote, updated_at: iso(doneAt) },
      ],
    );
    if (!spec.createdBy) {
      this.audit(createdAt, null, 'service_task.created', 'service_task', id, {
        type: spec.type,
        scooterId: scooter.id,
        ticketId: spec.ticketId,
      });
    }
    for (const [sku, probability] of spec.parts ?? []) {
      const part = this.parts.get(sku);
      if (!part?.active || !r.chance(probability)) continue;
      const useAt = startedAt + (doneAt - startedAt) * r.between(0.2, 0.8);
      this.queue.push(useAt, () => this.usePart(part, id, useAt));
    }
    this.setScooter(scooter, createdAt, 'MAINTENANCE');
    this.setScooter(scooter, doneAt, 'AVAILABLE');
    scooter.busyUntil = doneAt;
    this.count(`tasks${spec.type}`);
    return { id, startedAt, doneAt };
  }

  /** Zgłoszenie automatyczne z core (`autoTicket`) z zadaniem `BATTERY_SWAP` albo `RELOCATION` (ADR 0055, 0060). */
  private autoTicketWithTask(scooter: ScooterSim, ride: Ride, at: number, kind: 'BATTERY_CRITICAL' | 'OUT_OF_ZONE') {
    const spec = autoTicket(kind);
    const ticketId = randomUUID();
    const target = kind === 'OUT_OF_ZONE' ? this.parking[this.nearestParking(scooter.pos)]! : undefined;
    const task = this.task(scooter, at, {
      type: spec.taskType!,
      priority: taskPriorityForTicket(spec.urgent),
      ticketId,
      createdBy: null,
      waitMinutes: kind === 'OUT_OF_ZONE' ? [30, 240] : [20, 180],
      workMinutes: kind === 'OUT_OF_ZONE' ? [15, 45] : [5, 15],
      resultNote:
        kind === 'OUT_OF_ZONE'
          ? `Hulajnoga przewieziona do strefy ${target!.code}.`
          : 'Wymieniono akumulator na naładowany.',
      targetZone: target,
    });
    this.writer.add('tickets', {
      id: ticketId,
      scooter_id: scooter.id,
      rental_id: ride.id,
      source: 'AUTO',
      auto_kind: kind,
      categories: `{${spec.categories.join(',')}}`,
      status: 'RESOLVED',
      urgent: spec.urgent,
      assignee_id: this.staff.dispatcher,
      resolution_note: 'Zadanie serwisowe zakończone.',
      resolved_at: iso(task.doneAt),
      created_at: iso(at),
      updated_at: iso(task.doneAt),
    });
    this.audit(at, null, 'ticket.created', 'ticket', ticketId, {
      autoKind: kind,
      scooterId: scooter.id,
      rentalId: ride.id,
    });
    if (kind === 'OUT_OF_ZONE' && target) {
      scooter.parking = this.parking.indexOf(target);
      scooter.pos = this.pointInZone(target);
    } else {
      scooter.battery = this.random.int(95, 100);
    }
    this.count(`autoTickets${kind}`);
  }

  /** Zgłoszenie klienta po przejeździe (`validateTicket`): pilne od razu do serwisu, zwykłe czeka na dyspozytora. */
  private customerTicket(ride: Ride, at: number) {
    const r = this.random;
    const first = r.weighted(CUSTOMER_CATEGORIES);
    const categories: TicketCategory[] = [first];
    if (first !== 'BILLING' && r.chance(0.1)) {
      const second = r.weighted(CUSTOMER_CATEGORIES.filter(([c]) => c !== 'BILLING' && c !== first));
      categories.push(second);
    }
    const needsText = categories.some((c) => c === 'BILLING' || c === 'OTHER') || r.chance(0.6);
    const valid = validateTicket({
      source: 'USER',
      categories,
      description: needsText ? r.pick(TICKET_TEXT[first]) : null,
      photoCount: r.int(0, 2),
      hasRental: true,
    });
    const scooter = ride.scooter;
    const row = this.ticketRow({
      scooter_id: scooter.id,
      rental_id: ride.id,
      reported_by: ride.user.id,
      source: 'USER',
      categories: `{${valid.categories.join(',')}}`,
      description: valid.description,
      urgent: valid.urgent,
      created_at: iso(at),
      updated_at: iso(at),
    });
    this.count(
      `customerTickets${valid.categories.includes('BILLING') ? 'Billing' : valid.urgent ? 'Urgent' : 'Normal'}`,
    );
    const taskType = suggestTaskType(valid.categories);
    if (valid.urgent) {
      // Pilne: hulajnoga od razu w serwisie (`URGENT_TICKET`), zadanie naprawy od dyspozytora.
      scooter.busyUntil = Math.max(scooter.busyUntil, at);
      this.setScooter(scooter, at, 'MAINTENANCE');
      const taskAt = Math.max(at, Math.min(at + r.between(10, 120) * MINUTE, this.lastService - HOUR));
      this.resolveWithTask(row, scooter, taskAt, valid.categories, 'HIGH', taskType ?? 'REPAIR');
      this.writer.add('tickets', row);
      if (r.chance(SCOOTER_FAILURE_REFUND)) {
        const refundAt = at + r.between(1, 20) * HOUR;
        const amount = Math.round(ride.price.total * r.between(0.5, 1));
        this.queue.push(refundAt, () => this.refund(ride, refundAt, 'SCOOTER_FAILURE', amount, row.id as string));
      }
      return;
    }
    scooter.busyUntil = Math.max(scooter.busyUntil, at);
    if (!taskType) {
      // Sama reklamacja: dyspozytor odpowiada i część reklamacji kończy się zwrotem.
      this.pendingTickets.set(row.id as string, { row, ride });
      const handleAt = at + r.between(2, 30) * HOUR;
      this.queue.push(handleAt, () => this.resolveBilling(row.id as string, handleAt));
      return;
    }
    this.pendingTickets.set(row.id as string, { row, ride });
    const openAt = at + Math.min(36, r.logNormal(6, 0.7)) * HOUR;
    this.queue.push(openAt, () => this.openTicketTask(row.id as string, openAt, valid.categories, taskType));
  }

  private resolveBilling(ticketId: string, at: number) {
    const pending = this.pendingTickets.get(ticketId);
    if (!pending || at > this.lastService) return;
    this.pendingTickets.delete(ticketId);
    const { row, ride } = pending;
    const refunded = ride && ride.paidBy && this.random.chance(BILLING_REFUND);
    Object.assign(row, {
      status: 'RESOLVED',
      assignee_id: this.staff.dispatcher,
      customer_reply: refunded
        ? 'Sprawdziliśmy przejazd i zwróciliśmy część opłaty.'
        : 'Sprawdziliśmy przejazd, naliczenie jest zgodne z cennikiem.',
      customer_reply_at: iso(at),
      resolution_note: refunded ? 'Zwrot za przejazd.' : 'Naliczenie poprawne.',
      resolved_at: iso(at),
      updated_at: iso(at),
    });
    this.writer.add('tickets', row);
    if (refunded && ride) {
      const reason: RefundReason = this.random.chance(0.4) ? 'BILLING_ERROR' : 'CUSTOMER_COMPLAINT';
      const amount =
        ride.price.pauseAmount > 0
          ? ride.price.pauseAmount
          : Math.max(100, Math.round(ride.price.total * this.random.between(0.2, 1)));
      this.refund(ride, at, reason, amount, ticketId);
    }
  }

  private openTicketTask(
    ticketId: string,
    at: number,
    categories: TicketCategory[],
    type: 'REPAIR' | 'BATTERY_SWAP' | 'RELOCATION',
  ) {
    const pending = this.pendingTickets.get(ticketId);
    if (!pending) return;
    const scooter = this.scooters.find((s) => s.id === pending.row.scooter_id)!;
    if (at > this.lastService - 8 * HOUR || at >= scooter.excludedFrom) return; // zostaje NEW
    if (!this.free(scooter, at)) {
      const next = Math.max(scooter.busyUntil, at) + this.random.between(5, 60) * MINUTE;
      this.queue.push(next, () => this.openTicketTask(ticketId, next, categories, type));
      return;
    }
    this.pendingTickets.delete(ticketId);
    this.resolveWithTask(pending.row, scooter, at, categories, 'NORMAL', type);
    this.writer.add('tickets', pending.row);
  }

  /** Zadanie ze zgłoszenia: zgłoszenie `AT_SERVICE`, po zakończeniu zadania `RESOLVED` z odpowiedzią dla klienta. */
  private resolveWithTask(
    row: Row,
    scooter: ScooterSim,
    taskAt: number,
    categories: readonly TicketCategory[],
    priority: 'NORMAL' | 'HIGH',
    type: 'REPAIR' | 'BATTERY_SWAP' | 'RELOCATION',
  ) {
    const main = categories.find((c) => c !== 'BILLING') ?? 'OTHER';
    const task = this.task(scooter, taskAt, {
      type: type === 'RELOCATION' ? 'REPAIR' : type,
      priority,
      ticketId: row.id as string,
      createdBy: this.staff.dispatcher,
      description: `Zgłoszenie: ${categories.join(', ')}.`,
      waitMinutes: priority === 'HIGH' ? [30, 300] : [20, 240],
      workMinutes: [20, 90],
      resultNote:
        type === 'BATTERY_SWAP' ? 'Wymieniono akumulator na naładowany.' : (REPAIR_NOTE[main] ?? 'Usunięto usterkę.'),
      parts: categories.flatMap((c) => REPAIR_PARTS[c] ?? []),
    });
    if (type === 'BATTERY_SWAP' || scooter.battery < 30) scooter.battery = this.random.int(95, 100);
    Object.assign(row, {
      status: 'RESOLVED',
      assignee_id: this.staff.dispatcher,
      resolution_note: 'Naprawa w zadaniu serwisowym.',
      resolved_at: iso(task.doneAt),
      updated_at: iso(task.doneAt),
      ...(row.source === 'USER'
        ? { customer_reply: 'Naprawiliśmy usterkę. Dziękujemy za zgłoszenie.', customer_reply_at: iso(task.doneAt) }
        : {}),
    });
  }

  /** Objazd wymiany baterii (rano, w południe i wieczorem): hulajnogi z baterią poniżej progu objazdu. */
  private swapRound(at: number) {
    let t = at;
    for (const s of this.scooters) {
      if (!this.free(s, at) || s.battery >= BATTERY_SWAP_BELOW) continue;
      this.task(s, at, {
        type: 'BATTERY_SWAP',
        priority: s.battery < 15 ? 'HIGH' : 'NORMAL',
        ticketId: null,
        createdBy: this.staff.dispatcher,
        waitMinutes: [Math.max(1, (t - at) / MINUTE), Math.max(2, (t - at) / MINUTE + 10)],
        workMinutes: [4, 10],
        resultNote: 'Wymieniono akumulator na naładowany.',
      });
      s.battery = this.random.int(95, 100);
      t += this.random.between(8, 20) * MINUTE;
    }
  }

  /** Przegląd okresowy w dni robocze; czasem z usterką: zgłoszenie operatora i naprawa w tym samym zadaniu. */
  private inspection(at: number) {
    const candidates = this.scooters.filter((s) => this.free(s, at)).sort((a, b) => b.odometer - a.odometer);
    const count = this.random.int(1, 2);
    for (const s of candidates
      .slice(0, count * 3)
      .filter(() => this.random.chance(0.4))
      .slice(0, count)) {
      const finding = this.random.chance(0.2)
        ? this.random.pick<TicketCategory>(['LIGHTS', 'QR_CODE', 'WHEEL', 'BRAKES'])
        : null;
      if (!finding) {
        this.task(s, at, {
          type: 'INSPECTION',
          priority: 'LOW',
          ticketId: null,
          createdBy: this.staff.dispatcher,
          description: 'Przegląd okresowy.',
          waitMinutes: [15, 120],
          workMinutes: [20, 50],
          resultNote: 'Przegląd bez uwag.',
        });
        continue;
      }
      const valid = validateTicket({
        source: 'STAFF',
        categories: [finding],
        description: 'Wykryto podczas przeglądu okresowego.',
        photoCount: 0,
        hasRental: false,
      });
      const row = this.ticketRow({
        scooter_id: s.id,
        source: 'STAFF',
        categories: `{${valid.categories.join(',')}}`,
        description: valid.description,
        urgent: valid.urgent,
        created_at: iso(at),
        updated_at: iso(at),
      });
      this.task(s, at, {
        type: 'INSPECTION',
        priority: 'LOW',
        ticketId: null,
        createdBy: this.staff.dispatcher,
        description: 'Przegląd okresowy.',
        waitMinutes: [5, 30],
        workMinutes: [20, 40],
        resultNote: 'Przegląd: wykryto usterkę, założono zgłoszenie.',
      });
      this.resolveWithTask(row, s, s.busyUntil, valid.categories, valid.urgent ? 'HIGH' : 'NORMAL', 'REPAIR');
      this.writer.add('tickets', row);
      this.count('staffTickets');
    }
  }

  /** Utrata łączności hulajnogi wolnej: zgłoszenie `OFFLINE` po 5 min, zamknięte samo po powrocie łączności. */
  private scheduleOffline(s: ScooterSim, from: number) {
    const at = from + this.random.exponential(OFFLINE_EVERY_DAYS * DAY);
    if (at < this.lastService) this.queue.push(at, () => this.offlineEpisode(s, at));
  }

  private offlineEpisode(s: ScooterSim, at: number) {
    if (at >= s.excludedFrom) return;
    if (!this.free(s, at)) {
      const later = Math.max(s.busyUntil, at) + this.random.between(30, 180) * MINUTE;
      if (later < this.lastService) this.queue.push(later, () => this.offlineEpisode(s, later));
      return;
    }
    const duration = Math.min(9 * HOUR, Math.max(2 * MINUTE, this.random.logNormal(35 * MINUTE, 1.1)));
    const end = at + duration;
    if (end > this.lastService) return;
    this.setScooter(s, at, 'AVAILABLE', false);
    this.setScooter(s, end, 'AVAILABLE', true);
    s.busyUntil = end;
    this.count('offlineEpisodes');
    const checkAt = at + OFFLINE_TICKET_AFTER_MS;
    if (checkAt < end && shouldOpenOfflineTicket({ online: false, offlineSince: iso(at), now: iso(checkAt) })) {
      const spec = autoTicket('OFFLINE');
      const id = randomUUID();
      const closes = canAutoCloseOfflineTicket({ autoKind: 'OFFLINE', status: 'NEW', hasTasks: false });
      this.writer.add('tickets', {
        id,
        scooter_id: s.id,
        source: 'AUTO',
        auto_kind: 'OFFLINE',
        categories: `{${spec.categories.join(',')}}`,
        status: closes ? 'RESOLVED' : 'NEW',
        urgent: spec.urgent,
        resolution_note: closes ? 'Łączność wróciła.' : null,
        resolved_at: closes ? iso(end) : null,
        created_at: iso(checkAt),
        updated_at: iso(closes ? end : checkAt),
      });
      this.audit(checkAt, null, 'ticket.created', 'ticket', id, { autoKind: 'OFFLINE', scooterId: s.id });
      this.count('autoTicketsOFFLINE');
    }
    this.scheduleOffline(s, end);
  }

  // --- Magazyn ---------------------------------------------------------------------------------------------

  private movement(part: PartInfo, at: number, kind: string, delta: number, fields: Row = {}) {
    part.stock += delta;
    this.writer.add('spare_part_movements', {
      part_id: part.id,
      kind,
      delta,
      stock_after: part.stock,
      unit_cost: part.unitCost,
      created_at: iso(at),
      ...fields,
    });
  }

  private receiveParts(part: PartInfo, quantity: number, at = this.windowStart + 8 * HOUR) {
    this.deliverySeq++;
    const year = warsawYear.format(new Date(at));
    this.movement(part, at, 'RECEIPT', quantity, {
      staff_id: this.staff.technician,
      document: `WZ/${year}/${String(this.deliverySeq).padStart(4, '0')}`,
    });
    part.deliveryPlanned = false;
    this.count('partDeliveries');
  }

  /** Użycie części w zadaniu (`ensurePartUse`); brak na stanie to zadanie bez tej części. */
  private usePart(part: PartInfo, taskId: string, at: number) {
    try {
      ensurePartUse({ stockQty: part.stock, quantity: 1, active: part.active });
    } catch {
      return this.count('partsMissing');
    }
    this.writer.add('service_task_parts', { task_id: taskId, part_id: part.id, quantity: 1, unit_cost: part.unitCost });
    this.movement(part, at, 'USE', -1, { task_id: taskId, staff_id: this.staff.technician });
    if (isBelowMinimum({ stockQty: part.stock, minStockQty: part.minStock }) && !part.deliveryPlanned) {
      const day = this.days.find((d) => d.end > at + DAY);
      if (!day) return;
      const deliveryAt = this.localTime(day, 10);
      if (deliveryAt >= this.windowEnd - 2 * HOUR) return;
      part.deliveryPlanned = true;
      const quantity = Math.max(3 * part.minStock - part.stock, 5);
      this.queue.push(deliveryAt, () => this.receiveParts(part, quantity, deliveryAt));
    }
  }

  private stocktake() {
    const at = this.windowEnd - 30 * MINUTE;
    for (const part of this.parts.values()) {
      if (part.stock === 0) continue;
      this.movement(part, at, 'ADJUSTMENT', -part.stock, {
        staff_id: this.staff.technician,
        reason: 'STOCKTAKE',
        note: 'Inwentaryzacja przed przyjęciem dostawy startowej (dane historyczne generatora).',
      });
    }
  }
}
