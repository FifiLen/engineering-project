import type { Permission } from '../access/permissions.js';

/**
 * Katalog raportów (ADR 0071): jedyne źródło prawdy o raportach. Kod, uprawnienie `reports.<kod>`, formaty, orientacja
 * PDF, parametry (granulacja, porównanie, filtry), sekcje (kafelki, wykresy, tabele) i kolumny z etykietą po polsku
 * i rodzajem wartości. Etykiety są tu, a nie w plikach tłumaczeń panelu, bo plik PDF i XLSX powstaje w API (wyjątek
 * opisany w ADR 0071, jak teksty wyliczeń wydruków). Nazwa i opis raportu w `report_definitions` zmienia Administrator;
 * `defaultName` i `defaultDescription` wstawia tylko seed przy pierwszym utworzeniu definicji (D3).
 *
 * Schemat parametrów w Zod (walidacja kształtu w API i panelu, JSON Schema w `report_definitions.parameters`) jest
 * w packages/shared (`reportParamsSchema`), a reguły (zakres, granulacja, porównanie) w `params.ts`.
 */
export const REPORT_CODES = ['revenue', 'fleet_usage', 'rides_by_zone', 'reliability', 'users', 'wallet'] as const;
export type ReportCode = (typeof REPORT_CODES)[number];

export const isReportCode = (code: string): code is ReportCode => (REPORT_CODES as readonly string[]).includes(code);

/** Formaty plików raportu; `CSV` z typu `report_format` zostaje dla eksportu list (pytanie 4). */
export const REPORT_FORMATS = ['PDF', 'XLSX'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type ReportOrientation = 'portrait' | 'landscape';

/** Filtry raportu w parametrach (`zoneId` to strefa końca przejazdu). */
export const REPORT_FILTERS = ['zoneId', 'modelId', 'scooterId'] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];

/**
 * Rodzaj wartości kolumny, kafelka i wykresu: kwota w groszach (`money`), liczba (`number`, z `decimals`), czas
 * trwania w sekundach (`duration`), dystans w metrach (`distance`), udział jako ułamek 0–1 (`percent`), data polska
 * `RRRR-MM-DD` (`date`; miesiąc kohorty to pierwszy dzień miesiąca), tekst (`text`, gotowy do wyświetlenia).
 */
export const REPORT_VALUE_KINDS = ['money', 'number', 'duration', 'distance', 'percent', 'date', 'text'] as const;
export type ReportValueKind = (typeof REPORT_VALUE_KINDS)[number];

export interface ReportColumnSpec {
  key: string;
  label: string;
  kind: ReportValueKind;
  /** Miejsca po przecinku liczby i udziału (domyślnie 0 dla liczby, 1 dla udziału). */
  decimals?: number;
}

export interface ReportTileSpec {
  key: string;
  label: string;
  kind: ReportValueKind;
  decimals?: number;
  /** Kafelek ma wartość poprzedniego okresu i zmianę procentową (przy włączonym porównaniu). */
  compare: boolean;
}

export const REPORT_CHART_TYPES = ['bar', 'heatmap', 'share'] as const;
export type ReportChartType = (typeof REPORT_CHART_TYPES)[number];

export interface ReportChartSpec {
  key: string;
  title: string;
  type: ReportChartType;
  /** Rodzaj wartości słupka, komórki albo udziału (dymek, oś, tabela). */
  kind: ReportValueKind;
  decimals?: number;
  /** Tabela z tymi samymi danymi („Pokaż jako tabelę”, arkusz XLSX). */
  tableKey: string;
}

export interface ReportTableSpec {
  key: string;
  title: string;
  description?: string;
  /** Nazwa arkusza XLSX (najwyżej 31 znaków, bez `[]:*?/\`). */
  sheetName: string;
  columns: readonly ReportColumnSpec[];
}

export interface ReportParamsSpec {
  /** Szereg czasowy z granulacją dzień, tydzień, miesiąc (raport stref, awaryjności i portfela go nie ma). */
  granularity: boolean;
  /** Porównanie z poprzednim okresem. */
  compare: boolean;
  filters: readonly ReportFilter[];
}

export interface ReportSpec {
  code: ReportCode;
  permission: Permission;
  /** Nazwa i opis wstawiane przy pierwszym utworzeniu definicji; potem zmienia je Administrator (`reports.manage`). */
  defaultName: string;
  defaultDescription: string;
  sortOrder: number;
  formats: readonly ReportFormat[];
  /** A4 pionowo dla kafelków i wykresów w czasie, poziomo dla szerokich tabel (pytanie 15). */
  orientation: ReportOrientation;
  params: ReportParamsSpec;
  tiles: readonly ReportTileSpec[];
  charts: readonly ReportChartSpec[];
  tables: readonly ReportTableSpec[];
}

/** Limity (ADR 0071, plansze `32-panel-raporty`). */
export const REPORT_LIMITS = {
  /** Najdłuższy okres raportu w dobach (`REPORT_RANGE_TOO_LONG`). */
  maxDays: 366,
  /** Wiersze tabeli w odpowiedzi podglądu (reszta w liczbie wszystkich). */
  previewRows: 200,
  /** Wiersze tabeli w PDF; dalej dopisek o pełnych danych w XLSX. */
  pdfRows: 50,
  /** Limit czasu zapytań podglądu (`statement_timeout`, `REPORT_TIMEOUT`). */
  previewTimeoutMs: 15_000,
  /** Limit czasu zapytań zadania `report.generate` (dłuższy niż podgląd, plansza `raport-stany`). */
  jobQueryTimeoutMs: 60_000,
  /** Limit renderu PDF w Gotenbergu (`REPORT_RENDER_TIMEOUT`). */
  renderTimeoutMs: 60_000,
  /** Limit wykonania zadania `report.generate` w pg-boss. */
  jobExpireMs: 120_000,
  /** Wiersze `QUEUED` i `RUNNING` starsze niż ten czas kończy `reports.sweep`. */
  abandonedMs: 15 * 60_000,
  /** Pliki raportów usuwa `reports.retention` po 30 dniach; wiersz zostaje na zawsze (pytanie 6). */
  fileRetentionMs: 30 * 24 * 60 * 60_000,
  /** Partia `reports.retention`. */
  retentionBatch: 200,
} as const;

/**
 * Progi mapy ciepła (średnia przejazdów na dzień, ADR 0072): stałe, żeby ta sama barwa znaczyła to samo w różnych
 * okresach. Pięć stopni: poniżej 3, 3–6, 6–10, 10–15, od 15.
 */
export const HEATMAP_THRESHOLDS = [3, 6, 10, 15] as const;

// --- Kolumny wspólne ---------------------------------------------------------------------------------

const col = (key: string, label: string, kind: ReportValueKind, decimals?: number): ReportColumnSpec =>
  decimals === undefined ? { key, label, kind } : { key, label, kind, decimals };
const tile = (key: string, label: string, kind: ReportValueKind, compare = true, decimals?: number): ReportTileSpec =>
  decimals === undefined ? { key, label, kind, compare } : { key, label, kind, compare, decimals };

const bucketColumn = col('bucket', 'Okres', 'date');
const scooterColumns = [col('scooter', 'Hulajnoga', 'text'), col('model', 'Model', 'text')];
const timeColumns = [
  col('inRideSeconds', 'Przejazd', 'duration'),
  col('reservedSeconds', 'Rezerwacja', 'duration'),
  col('availableSeconds', 'Dostępna', 'duration'),
  col('serviceSeconds', 'Serwis', 'duration'),
  col('offlineSeconds', 'Bez łączności', 'duration'),
  col('utilization', 'Wykorzystanie', 'percent'),
  col('availability', 'Dostępność', 'percent'),
];
const reliabilityColumns = [
  col('tickets', 'Zgłoszenia', 'number'),
  col('userTickets', 'Od klientów', 'number'),
  col('autoTickets', 'Automatyczne', 'number'),
  col('staffTickets', 'Od operatorów', 'number'),
  col('offlineTickets', 'Bez łączności (OFFLINE)', 'number'),
  col('urgentTickets', 'Pilne', 'number'),
  col('failures', 'Awarie', 'number'),
  col('tasksCreated', 'Zadania utworzone', 'number'),
  col('tasksDone', 'Zadania zakończone', 'number'),
  col('avgRepairSeconds', 'Średni czas naprawy', 'duration'),
  col('partsCost', 'Koszt części', 'money'),
  col('serviceSeconds', 'Czas w serwisie', 'duration'),
  col('inRideSeconds', 'Czas w przejeździe', 'duration'),
  col('mtbfHours', 'MTBF, h', 'number', 1),
];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

// --- Raporty ------------------------------------------------------------------------------------------

const revenue: ReportSpec = {
  code: 'revenue',
  permission: 'reports.revenue',
  defaultName: 'Przychody',
  defaultDescription:
    'Sprzedaż z paragonów i wpływy z płatności w wybranym okresie, z porównaniem do poprzedniego okresu',
  sortOrder: 10,
  formats: ['PDF', 'XLSX'],
  orientation: 'portrait',
  params: { granularity: true, compare: true, filters: [] },
  tiles: [
    tile('salesGross', 'Sprzedaż brutto', 'money'),
    tile('salesNet', 'Sprzedaż netto', 'money'),
    tile('vat', 'VAT należny', 'money'),
    tile('rides', 'Przejazdy', 'number'),
    tile('avgRideValue', 'Średnio za przejazd', 'money'),
    tile('inflows', 'Wpływy', 'money'),
  ],
  charts: [{ key: 'salesSeries', title: 'Sprzedaż brutto', type: 'bar', kind: 'money', tableKey: 'salesSeries' }],
  tables: [
    {
      key: 'salesByVat',
      title: 'Sprzedaż według stawek VAT',
      description: 'Z paragonów; korekty z datą korekty jako wartości ujemne, odholowanie poza VAT (kara umowna)',
      sheetName: 'Sprzedaż według VAT',
      columns: [
        col('item', 'Pozycja', 'text'),
        col('vatRate', 'Stawka', 'text'),
        col('receipts', 'Paragony', 'number'),
        col('net', 'Netto', 'money'),
        col('vat', 'VAT', 'money'),
        col('gross', 'Brutto', 'money'),
      ],
    },
    {
      key: 'inflowsByMethod',
      title: 'Wpływy według metody',
      description: 'Udane płatności u operatora płatności minus zwroty na kartę',
      sheetName: 'Wpływy',
      columns: [
        col('method', 'Metoda', 'text'),
        col('operations', 'Operacje', 'number'),
        col('amount', 'Kwota', 'money'),
      ],
    },
    {
      key: 'refunds',
      title: 'Zwroty według źródła i powodu',
      description: 'Zwroty zakończone sukcesem; zwrot do portfela nie jest wypływem pieniędzy',
      sheetName: 'Zwroty',
      columns: [
        col('source', 'Źródło', 'text'),
        col('reason', 'Powód', 'text'),
        col('refunds', 'Zwroty', 'number'),
        col('amount', 'Kwota', 'money'),
      ],
    },
    {
      key: 'salesByZone',
      title: 'Sprzedaż według strefy końca przejazdu',
      description: 'Brutto po korektach z paragonów przejazdów, z opłatą za odholowanie',
      sheetName: 'Sprzedaż według stref',
      columns: [
        col('zone', 'Strefa końca', 'text'),
        col('rides', 'Przejazdy', 'number'),
        col('share', 'Udział', 'percent'),
        col('gross', 'Brutto', 'money'),
        col('net', 'Netto', 'money'),
        col('vat', 'VAT', 'money'),
        col('outsideVatGross', 'Poza VAT', 'money'),
        col('correctionsGross', 'Korekty', 'money'),
        col('perRide', 'Za przejazd', 'money'),
      ],
    },
    {
      key: 'salesSeries',
      title: 'Sprzedaż według okresów',
      sheetName: 'Sprzedaż w czasie',
      columns: [
        bucketColumn,
        col('gross', 'Brutto', 'money'),
        col('previousGross', 'Brutto, poprzedni okres', 'money'),
        col('salesGross', 'Sprzedaż', 'money'),
        col('correctionsGross', 'Korekty', 'money'),
        col('net', 'Netto', 'money'),
        col('vat', 'VAT', 'money'),
        col('outsideVatGross', 'Poza VAT', 'money'),
        col('saleReceipts', 'Paragony', 'number'),
        col('correctionReceipts', 'Korekty, liczba', 'number'),
        col('rides', 'Przejazdy', 'number'),
      ],
    },
  ],
};

const fleetUsage: ReportSpec = {
  code: 'fleet_usage',
  permission: 'reports.fleet_usage',
  defaultName: 'Wykorzystanie floty',
  defaultDescription:
    'Czas w przejeździe, rezerwacji, dostępności, serwisie i bez łączności według hulajnogi i modelu, z wykorzystaniem i dostępnością',
  sortOrder: 20,
  formats: ['PDF', 'XLSX'],
  orientation: 'landscape',
  params: { granularity: true, compare: true, filters: ['modelId', 'scooterId'] },
  tiles: [
    tile('utilization', 'Wykorzystanie', 'percent'),
    tile('availability', 'Dostępność', 'percent'),
    tile('rides', 'Przejazdy', 'number'),
    tile('inRideSeconds', 'Czas w przejeździe', 'duration'),
    tile('serviceSeconds', 'Czas w serwisie', 'duration'),
    tile('offlineSeconds', 'Bez łączności', 'duration'),
  ],
  charts: [
    { key: 'timeShare', title: 'Czas floty według stanu', type: 'share', kind: 'duration', tableKey: 'byModel' },
    { key: 'utilizationSeries', title: 'Wykorzystanie', type: 'bar', kind: 'percent', tableKey: 'series' },
  ],
  tables: [
    {
      key: 'byScooter',
      title: 'Wykorzystanie według hulajnogi',
      description:
        'Wykorzystanie = czas w przejeździe ÷ czas okresu; dostępność = (dostępna + rezerwacja + przejazd) ÷ czas okresu',
      sheetName: 'Według hulajnogi',
      columns: [
        ...scooterColumns,
        ...timeColumns,
        col('rides', 'Przejazdy', 'number'),
        col('revenueGross', 'Przychód', 'money'),
        col('distance', 'Dystans', 'distance'),
        col('odometer', 'Przebieg', 'distance'),
      ],
    },
    {
      key: 'byModel',
      title: 'Wykorzystanie według modelu',
      sheetName: 'Według modelu',
      columns: [
        col('model', 'Model', 'text'),
        col('scooters', 'Hulajnogi', 'number'),
        ...timeColumns,
        col('rides', 'Przejazdy', 'number'),
        col('revenueGross', 'Przychód', 'money'),
        col('distance', 'Dystans', 'distance'),
      ],
    },
    {
      key: 'series',
      title: 'Wykorzystanie według okresów',
      sheetName: 'Wykorzystanie w czasie',
      columns: [
        bucketColumn,
        col('scooters', 'Hulajnogi', 'number'),
        ...timeColumns,
        col('previousUtilization', 'Wykorzystanie, poprzedni okres', 'percent'),
        col('rides', 'Przejazdy', 'number'),
      ],
    },
  ],
};

const ridesByZone: ReportSpec = {
  code: 'rides_by_zone',
  permission: 'reports.rides_by_zone',
  defaultName: 'Przejazdy według stref i godzin',
  defaultDescription:
    'Kiedy i gdzie jeżdżą klienci: godziny startu, strefy końca, wjazdy do strefy zakazu i odholowania',
  sortOrder: 30,
  formats: ['PDF', 'XLSX'],
  orientation: 'portrait',
  params: { granularity: false, compare: true, filters: ['zoneId'] },
  tiles: [
    tile('rides', 'Przejazdy', 'number'),
    tile('avgRideSeconds', 'Średni czas przejazdu', 'duration'),
    tile('avgDistance', 'Średni dystans', 'distance'),
    tile('noRideZoneRides', 'Wjazd do strefy zakazu', 'number'),
    tile('towedRides', 'Zakończenia z odholowaniem', 'number'),
  ],
  charts: [
    {
      key: 'heatmap',
      title: 'Godzina startu według dnia tygodnia',
      type: 'heatmap',
      kind: 'number',
      decimals: 1,
      tableKey: 'heatmap',
    },
  ],
  tables: [
    {
      key: 'byEndZone',
      title: 'Przejazdy według strefy końca',
      description: 'Strefa parkowania końca przejazdu; czas i dystans przejazdów zakończonych',
      sheetName: 'Strefy końca',
      columns: [
        col('zone', 'Strefa końca', 'text'),
        col('zoneType', 'Rodzaj', 'text'),
        col('rides', 'Przejazdy', 'number'),
        col('share', 'Udział', 'percent'),
        col('endedRides', 'Zakończone', 'number'),
        col('avgRideSeconds', 'Średni czas', 'duration'),
        col('avgDistance', 'Średni dystans', 'distance'),
        col('totalDistance', 'Dystans łącznie', 'distance'),
      ],
    },
    {
      key: 'zoneEntries',
      title: 'Strefy ze sterowaniem',
      description: 'Wjazdy do stref zakazu i wolnej jazdy w czasie przejazdu',
      sheetName: 'Wjazdy do stref',
      columns: [
        col('zone', 'Strefa', 'text'),
        col('zoneType', 'Rodzaj', 'text'),
        col('entries', 'Wjazdy', 'number'),
        col('rides', 'Przejazdy z wjazdem', 'number'),
        col('share', 'Udział w przejazdach', 'percent'),
        col('avgSecondsInZone', 'Średnio w strefie', 'duration'),
        col('totalSecondsInZone', 'Łącznie w strefie', 'duration'),
      ],
    },
    {
      key: 'endModes',
      title: 'Zakończenia według trybu',
      description: 'Przejazdy zakończone w okresie; odholowanie to zakończenie poza strefą parkowania z opłatą',
      sheetName: 'Zakończenia',
      columns: [
        col('endMode', 'Tryb zakończenia', 'text'),
        col('rides', 'Przejazdy', 'number'),
        col('towed', 'Z odholowaniem', 'number'),
        col('outsideParking', 'Poza strefą parkowania', 'number'),
      ],
    },
    {
      key: 'heatmap',
      title: 'Średnia liczba przejazdów na dzień według godziny startu',
      description: 'Liczba przejazdów ÷ liczba wystąpień dnia tygodnia w okresie',
      sheetName: 'Mapa ciepła',
      columns: [
        col('weekday', 'Dzień tygodnia', 'text'),
        col('days', 'Dni w okresie', 'number'),
        ...HOURS.map((hour) => col(`h${String(hour).padStart(2, '0')}`, `${hour}:00`, 'number', 1)),
        col('total', 'Przejazdy razem', 'number'),
      ],
    },
  ],
};

const reliability: ReportSpec = {
  code: 'reliability',
  permission: 'reports.reliability',
  defaultName: 'Awaryjność',
  defaultDescription:
    'Zgłoszenia według kategorii i źródła, zadania serwisowe, czas naprawy, MTBF, koszt części i części poniżej minimum',
  sortOrder: 40,
  formats: ['PDF', 'XLSX'],
  orientation: 'landscape',
  params: { granularity: false, compare: true, filters: ['modelId', 'scooterId'] },
  tiles: [
    tile('tickets', 'Zgłoszenia', 'number'),
    tile('failures', 'Awarie', 'number'),
    tile('mtbfHours', 'MTBF, h', 'number', true, 1),
    tile('avgRepairSeconds', 'Średni czas naprawy', 'duration'),
    tile('partsCost', 'Koszt części', 'money'),
    tile('lowStockParts', 'Części poniżej minimum', 'number', false),
  ],
  charts: [
    { key: 'ticketSources', title: 'Zgłoszenia według źródła', type: 'share', kind: 'number', tableKey: 'tickets' },
  ],
  tables: [
    {
      key: 'tickets',
      title: 'Zgłoszenia według kategorii i źródła',
      description: 'Zgłoszenie z kilkoma kategoriami liczy się w każdej z nich',
      sheetName: 'Zgłoszenia',
      columns: [
        col('category', 'Kategoria', 'text'),
        col('source', 'Źródło', 'text'),
        col('tickets', 'Zgłoszenia', 'number'),
        col('urgent', 'Pilne', 'number'),
        col('resolved', 'Rozwiązane', 'number'),
        col('open', 'Otwarte', 'number'),
        col('avgResolutionSeconds', 'Średni czas rozwiązania', 'duration'),
      ],
    },
    {
      key: 'byScooter',
      title: 'Awaryjność według hulajnogi',
      description: 'MTBF = czas w przejeździe ÷ liczba awarii (bez krytycznej baterii, reklamacji i „poza strefą”)',
      sheetName: 'Według hulajnogi',
      columns: [...scooterColumns, ...reliabilityColumns],
    },
    {
      key: 'byModel',
      title: 'Awaryjność według modelu',
      sheetName: 'Według modelu',
      columns: [col('model', 'Model', 'text'), col('scooters', 'Hulajnogi', 'number'), ...reliabilityColumns],
    },
    {
      key: 'tasks',
      title: 'Zadania serwisowe według rodzaju',
      sheetName: 'Zadania',
      columns: [
        col('taskType', 'Rodzaj', 'text'),
        col('created', 'Utworzone', 'number'),
        col('done', 'Zakończone', 'number'),
        col('cancelled', 'Anulowane', 'number'),
        col('open', 'Otwarte', 'number'),
        col('avgWaitSeconds', 'Średni czas oczekiwania', 'duration'),
        col('avgRepairSeconds', 'Średni czas naprawy', 'duration'),
        col('partsCost', 'Koszt części', 'money'),
      ],
    },
    {
      key: 'parts',
      title: 'Części zużyte w naprawach',
      description: 'Zadania zakończone w okresie; koszt z chwili użycia',
      sheetName: 'Części zużyte',
      columns: [
        col('sku', 'Indeks', 'text'),
        col('name', 'Część', 'text'),
        col('quantity', 'Ilość', 'number'),
        col('cost', 'Koszt', 'money'),
        col('tasks', 'Zadania', 'number'),
        col('stock', 'Stan', 'number'),
        col('minStock', 'Minimum', 'number'),
        col('belowMinimum', 'Poniżej minimum', 'text'),
      ],
    },
    {
      key: 'lowStock',
      title: 'Części poniżej minimum',
      description: 'Stan bieżący magazynu, koszt uzupełnienia do minimum po bieżącej cenie',
      sheetName: 'Poniżej minimum',
      columns: [
        col('sku', 'Indeks', 'text'),
        col('name', 'Część', 'text'),
        col('stock', 'Stan', 'number'),
        col('minStock', 'Minimum', 'number'),
        col('shortage', 'Brakuje', 'number'),
        col('unitCost', 'Cena', 'money'),
        col('restockCost', 'Koszt uzupełnienia', 'money'),
      ],
    },
  ],
};

const users: ReportSpec = {
  code: 'users',
  permission: 'reports.users',
  defaultName: 'Użytkownicy',
  defaultDescription:
    'Rejestracje, klienci aktywni, nowi i powracający, kohorty miesięczne, blokady, usunięcia kont i zgody marketingowe',
  sortOrder: 50,
  formats: ['PDF', 'XLSX'],
  orientation: 'portrait',
  params: { granularity: true, compare: true, filters: [] },
  tiles: [
    tile('registrations', 'Rejestracje', 'number'),
    tile('activeUsers', 'Aktywni klienci', 'number'),
    tile('newUsers', 'Nowi', 'number'),
    tile('returningUsers', 'Powracający', 'number'),
    tile('blockedUsers', 'Blokady', 'number'),
    tile('marketingActiveAtEnd', 'Zgody marketingowe', 'number'),
  ],
  charts: [{ key: 'activeSeries', title: 'Aktywni klienci', type: 'bar', kind: 'number', tableKey: 'series' }],
  tables: [
    {
      key: 'series',
      title: 'Klienci według okresów',
      description:
        'Aktywny: przejazd ze startem w okresie; nowy: pierwszy przejazd w okresie; powracający: z przejazdem wcześniej',
      sheetName: 'Klienci w czasie',
      columns: [
        bucketColumn,
        col('registrations', 'Rejestracje', 'number'),
        col('activeUsers', 'Aktywni', 'number'),
        col('previousActiveUsers', 'Aktywni, poprzedni okres', 'number'),
        col('newUsers', 'Nowi', 'number'),
        col('returningUsers', 'Powracający', 'number'),
        col('blockedUsers', 'Blokady', 'number'),
        col('deletedUsers', 'Usunięte konta', 'number'),
        col('marketingGranted', 'Zgody udzielone', 'number'),
        col('marketingRevoked', 'Zgody wycofane', 'number'),
      ],
    },
    {
      key: 'cohorts',
      title: 'Kohorty miesięczne',
      description: 'Procent klientów zarejestrowanych w miesiącu, którzy jeździli w kolejnych miesiącach okresu',
      sheetName: 'Kohorty',
      // Kolumny miesięcy (`m0`, `m1`, …) dokłada funkcja budująca według długości okresu.
      columns: [col('cohortMonth', 'Miesiąc rejestracji', 'date'), col('cohortSize', 'Zarejestrowani', 'number')],
    },
    {
      key: 'summary',
      title: 'Podsumowanie okresu',
      sheetName: 'Podsumowanie',
      columns: [
        col('metric', 'Wskaźnik', 'text'),
        col('value', 'Wartość', 'number'),
        col('previous', 'Poprzedni okres', 'number'),
      ],
    },
  ],
};

const wallet: ReportSpec = {
  code: 'wallet',
  permission: 'reports.wallet',
  defaultName: 'Portfel',
  defaultDescription:
    'Saldo portfeli na początek i koniec okresu, obroty według typu operacji, korekty, przedziały sald i zaległości',
  sortOrder: 60,
  formats: ['PDF', 'XLSX'],
  orientation: 'portrait',
  params: { granularity: false, compare: true, filters: [] },
  tiles: [
    tile('openingBalance', 'Saldo na początek', 'money'),
    tile('closingBalance', 'Saldo na koniec', 'money'),
    tile('credits', 'Uznania', 'money'),
    tile('debits', 'Obciążenia', 'money'),
    tile('nonzeroWallets', 'Portfele z saldem', 'number'),
    tile('unpaidAmount', 'Zaległości teraz', 'money', false),
  ],
  charts: [
    {
      key: 'balanceRanges',
      title: 'Portfele według salda na koniec okresu',
      type: 'bar',
      kind: 'number',
      tableKey: 'balanceRanges',
    },
  ],
  tables: [
    {
      key: 'turnover',
      title: 'Obroty według typu operacji',
      sheetName: 'Obroty',
      columns: [
        col('entryType', 'Operacja', 'text'),
        col('entries', 'Wpisy', 'number'),
        col('credits', 'Uznania', 'money'),
        col('debits', 'Obciążenia', 'money'),
        col('net', 'Saldo zmian', 'money'),
      ],
    },
    {
      key: 'adjustments',
      title: 'Korekty salda według przyczyny',
      sheetName: 'Korekty',
      columns: [
        col('reason', 'Przyczyna', 'text'),
        col('entries', 'Wpisy', 'number'),
        col('credits', 'Uznania', 'money'),
        col('debits', 'Obciążenia', 'money'),
        col('net', 'Saldo zmian', 'money'),
      ],
    },
    {
      key: 'balanceRanges',
      title: 'Przedziały sald na koniec okresu',
      sheetName: 'Przedziały sald',
      columns: [
        col('range', 'Saldo', 'text'),
        col('wallets', 'Portfele', 'number'),
        col('share', 'Udział', 'percent'),
        col('total', 'Suma sald', 'money'),
      ],
    },
    {
      key: 'arrears',
      title: 'Zaległości',
      description: 'Przejazdy nieopłacone (UNPAID): teraz, powstałe w okresie i spłacone w okresie',
      sheetName: 'Zaległości',
      columns: [
        col('metric', 'Wskaźnik', 'text'),
        col('rentals', 'Przejazdy', 'number'),
        col('users', 'Klienci', 'number'),
        col('amount', 'Kwota', 'money'),
      ],
    },
  ],
};

export const REPORT_CATALOG: Readonly<Record<ReportCode, ReportSpec>> = {
  revenue,
  fleet_usage: fleetUsage,
  rides_by_zone: ridesByZone,
  reliability,
  users,
  wallet,
};

export const reportSpec = (code: ReportCode): ReportSpec => REPORT_CATALOG[code];

/** Uprawnienia raportów (`reports.<kod>`), np. do historii uruchomień wszystkich dostępnych raportów. */
export const REPORT_PERMISSIONS: Readonly<Record<ReportCode, Permission>> = Object.fromEntries(
  REPORT_CODES.map((code) => [code, REPORT_CATALOG[code].permission]),
) as Record<ReportCode, Permission>;

/** Opis sekcji do katalogu w panelu i do planszy definicji („kafelki · wykres · tabele”). */
export function reportSections(code: ReportCode): {
  tiles: string[];
  charts: Array<{ key: string; title: string; type: ReportChartType }>;
  tables: Array<{ key: string; title: string; sheetName: string }>;
} {
  const spec = REPORT_CATALOG[code];
  return {
    tiles: spec.tiles.map((t) => t.label),
    charts: spec.charts.map((c) => ({ key: c.key, title: c.title, type: c.type })),
    tables: spec.tables.map((t) => ({ key: t.key, title: t.title, sheetName: t.sheetName })),
  };
}

/** Teksty wartości wyliczeń w raportach (gotowe do PDF, XLSX i podglądu; raport nie ma danych osobowych). */
export const REPORT_VALUE_LABELS = {
  receiptKind: { SALE: 'Sprzedaż', CORRECTION: 'Korekta' },
  paymentPurpose: { TOPUP: 'Doładowania', RIDE: 'Przejazdy' },
  paymentMethod: { CARD: 'karta', BLIK: 'BLIK' },
  paymentSource: { WALLET: 'Portfel', CARD: 'Karta' },
  refundReason: {
    SCOOTER_FAILURE: 'Awaria hulajnogi',
    BILLING_ERROR: 'Błąd naliczenia',
    CUSTOMER_COMPLAINT: 'Reklamacja klienta',
    OTHER: 'Inny',
    BALANCE_PAYOUT: 'Zwrot salda portfela',
  },
  zoneType: { SERVICE_AREA: 'obszar działania', PARKING: 'parkowanie', SLOW: 'wolna jazda', NO_RIDE: 'zakaz jazdy' },
  endMode: {
    CUSTOMER: 'Klient w aplikacji',
    CUSTOMER_OFFLINE: 'Klient bez łączności hulajnogi',
    REMOTE: 'Zdalnie przez operatora',
    UNCONFIRMED: 'Bez potwierdzenia hulajnogi',
  },
  ticketCategory: {
    BRAKES: 'Hamulce',
    LIGHTS: 'Światła',
    WHEEL: 'Koło',
    HANDLEBAR: 'Kierownica',
    QR_CODE: 'Kod QR',
    BATTERY: 'Bateria',
    CONNECTION: 'Łączność',
    OTHER: 'Inne',
    BILLING: 'Opłata',
    OUT_OF_ZONE: 'Poza strefą',
  },
  ticketSource: { USER: 'Klient', AUTO: 'Automatyczne', STAFF: 'Operator' },
  taskType: { REPAIR: 'Naprawa', BATTERY_SWAP: 'Wymiana baterii', INSPECTION: 'Przegląd', RELOCATION: 'Przestawienie' },
  ledgerEntryType: {
    TOPUP: 'Doładowanie',
    RIDE_CHARGE: 'Przejazd',
    REFUND: 'Zwrot',
    ADJUSTMENT: 'Korekta',
    PAYOUT: 'Zwrot salda',
    TOWING_FEE: 'Opłata za odholowanie',
  },
  ledgerReason: { COMPLAINT: 'Reklamacja', SYSTEM_ERROR: 'Błąd systemu', GOODWILL: 'Gest dobrej woli', OTHER: 'Inna' },
  weekday: ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'],
  timeCategory: {
    IN_RIDE: 'W przejeździe',
    RESERVED: 'Rezerwacja',
    AVAILABLE: 'Dostępna',
    SERVICE: 'Serwis',
    OFFLINE: 'Bez łączności',
    RETIRED: 'Wyłączona z ruchu',
  },
  yes: 'tak',
  no: 'nie',
  missing: 'brak danych',
  outsideVat: 'poza VAT',
  outsideParking: 'Poza strefą parkowania',
  total: 'Razem',
} as const;
