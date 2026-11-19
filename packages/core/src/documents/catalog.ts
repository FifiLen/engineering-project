import type { Permission } from '../access/permissions.js';
import { companyAddress, type CompanyProfile } from '../content/company.js';
import { DomainError } from '../errors.js';
import { receiptTotals, receiptVatGroups } from '../payments/receipts.js';
import { partsCost } from '../service/spare-parts.js';
import type { DocumentFormatters } from './format.js';
import type { TemplateData } from './renderer.js';
import type { DocumentFieldSpec, DocumentLoopSpec, TemplateFieldCatalog } from './tags.js';

/**
 * Katalog rodzajów dokumentów (ADR 0067, ADR 0068): pola i pętle dla autora szablonu, parametry, uprawnienie
 * odczytu, funkcja budująca dane szablonu z danych widoku `v_doc_*` i dane przykładowe do podglądu. Jedyne źródło
 * opisu pól: walidacja wgranej wersji, podgląd PDF, „Lista pól” w panelu (`GET /admin/document-types/{type}/fields`)
 * i lista pól w DOCX. Typy `…DocumentSource` są kontraktem repozytoriów widoków danych do wydruków (migracja 0011);
 * teksty wyliczeń (`…Label`) dostarcza API, a kwoty i daty formatuje core.
 */
export const DOCUMENT_TYPES = [
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'SCOOTER_CARD',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
  'RECEIPT',
  'SCOOTER_LABEL',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const TEMPLATE_DOCUMENT_TYPES = [
  'RENTAL_CONFIRMATION',
  'SERVICE_PROTOCOL',
  'SCOOTER_CARD',
  'INCIDENT_REPORT',
  'WALLET_ADJUSTMENT',
  'RECEIPT',
] as const satisfies readonly DocumentType[];
export type TemplateDocumentType = (typeof TEMPLATE_DOCUMENT_TYPES)[number];

export const isTemplateDocumentType = (type: string): type is TemplateDocumentType =>
  (TEMPLATE_DOCUMENT_TYPES as readonly string[]).includes(type);

export const DOCUMENT_FORMATS = ['DOCX', 'PDF'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export interface DocumentParamSpec {
  name: string;
  label: string;
  type: 'boolean' | 'select';
  options?: readonly (string | number)[];
  default: string | number | boolean;
}

export type DocumentParams = Record<string, string | number | boolean>;

/**
 * Stałe teksty dokumentu (stopka, ukrycie klienta, VAT „np.”). Kopia polska jest domyślna; API może podać własne,
 * bo etykiety interfejsu są w plikach tłumaczeń klientów (ADR 0032), a nie w API.
 */
export interface DocumentTexts {
  print: string;
  app: string;
  preview: string;
  notADocument: string;
  /** Zamiast danych klienta bez `users.read` (ADR 0068), jak w listach zgłoszeń. */
  customerHidden: string;
  /** Pozycja poza VAT na paragonie (ADR 0061). */
  outsideVat: string;
}

export const DOCUMENT_TEXTS_PL: DocumentTexts = {
  print: 'Wydruk',
  app: 'aplikacja',
  preview: 'Podgląd na danych przykładowych',
  notADocument: 'nie jest dokumentem',
  customerHidden: 'Klient',
  outsideVat: 'np.',
};

export interface DocumentBuildContext {
  documentId: string;
  generatedAt: Date;
  /** `null` tylko dla naklejki (układ wbudowany). */
  template: { name: string; versionNo: number } | null;
  /** Operator, który zlecił wydruk; `null`: klient w aplikacji (stopka „aplikacja”, bez linii podpisu). */
  staff: { name: string } | null;
  /** Dane firmy z chwili generowania (paragon bierze sprzedawcę z chwili wystawienia). */
  company: CompanyProfile;
  /** Parametry po `resolveDocumentParams` (z wartościami domyślnymi). */
  params: DocumentParams;
  format: DocumentFormatters;
  texts: DocumentTexts;
  /** Podgląd PDF wersji szablonu: stopka „nie jest dokumentem”. */
  preview?: boolean;
}

// --- Pola wspólne ---------------------------------------------------------------------------------

const text = (
  path: string,
  label: string,
  example: string,
  extra: Partial<DocumentFieldSpec> = {},
): DocumentFieldSpec => ({
  path,
  label,
  type: 'text',
  example,
  ...extra,
});
const flag = (path: string, label: string, extra: Partial<DocumentFieldSpec> = {}): DocumentFieldSpec => ({
  path,
  label,
  type: 'boolean',
  example: 'true',
  ...extra,
});
const common = { common: true } as const;
const customer = { customer: true } as const;

export const COMMON_DOCUMENT_FIELDS: readonly DocumentFieldSpec[] = [
  text('company.name', 'Nazwa firmy', '[Nazwa spółki] sp. z o.o.', common),
  text('company.street', 'Ulica i numer', '[ulica i numer]', common),
  text('company.postalCode', 'Kod pocztowy', '44-200', common),
  text('company.city', 'Miejscowość', 'Rybnik', common),
  text('company.address', 'Adres jednym wierszem', '[ulica i numer], 44-200 Rybnik', common),
  text('company.taxId', 'NIP', '6422901846', common),
  text('company.supportEmail', 'E-mail pomocy', '[e-mail pomocy]', common),
  text('company.supportPhone', 'Telefon pomocy', '[telefon pomocy]', common),
  text('company.supportHours', 'Godziny pomocy', 'Codziennie 8:00–20:00', common),
  text('company.regon', 'REGON', '', common),
  text('company.krs', 'KRS', '', common),
  text('company.registryCourt', 'Sąd rejestrowy', '', common),
  text('company.shareCapital', 'Kapitał zakładowy', '', common),
  flag('company.hasRegistry', 'Firma ma wpis w KRS (warunek)', common),
  text('document.id', 'Identyfikator wydruku (8 znaków)', '7f3a2c91', common),
  text('document.generatedAt', 'Data wydruku', '18.11.2026, 14:22', common),
  text(
    'document.footer',
    'Stopka wydruku',
    'Wydruk 7f3a2c91 · Protokół serwisowy v2 · 18.11.2026, 14:22 · Tomasz Nowak',
    common,
  ),
  text('template.name', 'Nazwa szablonu', 'Protokół serwisowy', common),
  text('template.version', 'Wersja szablonu', '2', common),
  text('staff.name', 'Operator (linia „Podpis”)', 'Tomasz Nowak', common),
  flag('staff.present', 'Wydruk zlecił operator (warunek linii „Podpis”)', common),
];

/** Identyfikator wydruku w stopce i na liście: pierwsze 8 znaków UUID. */
export const shortDocumentId = (id: string): string => id.replace(/-/g, '').slice(0, 8).toLowerCase();

/**
 * Stopka (ADR 0068, pytanie 4): „Wydruk {id} · {szablon} v{n} · {dd.MM.yyyy, HH:mm} · {operator}”; dokument klienta
 * ma „aplikacja”, a podgląd „Podgląd na danych przykładowych · {szablon} v{n} · nie jest dokumentem”. Numer strony
 * („strona X z Y”) to pole Worda w szablonie.
 */
export function documentFooter(
  ctx: Pick<DocumentBuildContext, 'documentId' | 'generatedAt' | 'template' | 'staff' | 'format' | 'texts' | 'preview'>,
): string {
  const template = ctx.template ? `${ctx.template.name} v${ctx.template.versionNo}` : null;
  if (ctx.preview) return [ctx.texts.preview, template, ctx.texts.notADocument].filter(Boolean).join(' · ');
  return [
    `${ctx.texts.print} ${shortDocumentId(ctx.documentId)}`,
    template,
    ctx.format.dateTime(ctx.generatedAt),
    ctx.staff?.name ?? ctx.texts.app,
  ]
    .filter(Boolean)
    .join(' · ');
}

const orEmpty = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

function commonData(ctx: DocumentBuildContext): TemplateData {
  const c = ctx.company;
  return {
    company: {
      name: c.name,
      street: c.street,
      postalCode: c.postalCode,
      city: c.city,
      address: companyAddress(c),
      taxId: c.taxId,
      supportEmail: c.supportEmail,
      supportPhone: c.supportPhone,
      supportHours: c.supportHours,
      regon: orEmpty(c.regon),
      krs: orEmpty(c.krs),
      registryCourt: orEmpty(c.registryCourt),
      shareCapital: c.shareCapitalGrosze === null ? '' : ctx.format.money(c.shareCapitalGrosze),
      hasRegistry: Boolean(c.krs),
    },
    document: {
      id: shortDocumentId(ctx.documentId),
      generatedAt: ctx.format.dateTime(ctx.generatedAt),
      footer: documentFooter(ctx),
    },
    template: { name: ctx.template?.name ?? '', version: orEmpty(ctx.template?.versionNo) },
    staff: { name: ctx.staff?.name ?? '', present: ctx.staff !== null },
  };
}

// --- Źródła danych (kontrakt widoków `v_doc_*`) ------------------------------------------------------

export interface DocumentPartySource {
  name: string | null;
  phone: string | null;
}

export interface TimelineEntrySource {
  at: Date;
  /** Opis zdarzenia osi czasu (tekst z API). */
  label: string;
}

/** `v_doc_receipt`: paragon albo korekta z pozycjami; sprzedawca i nabywca z chwili wystawienia. */
export interface ReceiptDocumentSource {
  number: string;
  kind: 'SALE' | 'CORRECTION';
  issuedAt: Date;
  paymentSourceLabel: string;
  rentalNumber: string | null;
  seller: { name: string | null; address: string | null; taxId: string | null };
  buyer: DocumentPartySource;
  corrected: { number: string; issuedAt: Date } | null;
  correctionReasonLabel: string | null;
  items: Array<{ label: string; quantity: number; unitPrice: number; vatRate: number | null; amount: number }>;
}

export interface RentalPlaceSource {
  /** Adres z odwrotnego wyszukiwania Photon (limit 3 s); `null`: strefa i współrzędne. */
  address: string | null;
  zone: string | null;
  lat: number;
  lon: number;
}

/** `v_doc_rental`: przejazd z osią czasu i kwotami z wyceny. */
export interface RentalDocumentSource {
  number: string;
  stateLabel: string;
  reservedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  rideMinutes: number;
  pauseMinutes: number;
  distanceM: number | null;
  endModeLabel: string | null;
  tariffVersion: number | null;
  receiptNumber: string | null;
  scooter: { number: number; modelName: string };
  customer: DocumentPartySource;
  start: RentalPlaceSource | null;
  end: RentalPlaceSource | null;
  amounts: { unlockFee: number; ride: number; pause: number; towingFee: number; total: number };
  timeline: TimelineEntrySource[];
}

/** `v_doc_service_task`: zadanie z częściami z kosztem z chwili użycia. */
export interface ServiceTaskDocumentSource {
  number: string;
  typeLabel: string;
  statusLabel: string;
  priorityLabel: string;
  createdAt: Date;
  finishedAt: Date | null;
  dueAt: Date | null;
  assigneeName: string | null;
  note: string | null;
  /** Skutek dla hulajnogi (np. zostaje w serwisie z powodu baterii). */
  outcome: string | null;
  scooter: { number: number; modelName: string; odometerKm: number | null; batteryPct: number | null };
  ticket: { number: string; categoriesLabel: string; reporter: DocumentPartySource | null } | null;
  parts: Array<{ name: string; sku: string; quantity: number; unitCost: number }>;
  timeline: TimelineEntrySource[];
}

/** `v_doc_scooter`: hulajnoga z historią serwisu; okres wybiera parametr `historyDays`. */
export interface ScooterCardDocumentSource {
  number: number;
  serialNumber: string;
  statusLabel: string;
  variantLabel: string;
  model: { code: string; name: string };
  firmware: string | null;
  odometerM: number;
  batteryPct: number | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  /** Adres strony `/h/{numer}` (`scooterCodeUrl` z shared), tekstem zamiast kodu QR (D5). */
  pageUrl: string;
  tasks: Array<{ number: string; typeLabel: string; statusLabel: string; createdAt: Date; finishedAt: Date | null }>;
  tickets: Array<{ number: string; categoriesLabel: string; statusLabel: string; createdAt: Date }>;
}

/** `v_doc_ticket`: zgłoszenie z przebiegiem; zdjęcia tylko jako liczba i daty (bez obrazów zmiennych, D5). */
export interface TicketDocumentSource {
  number: string;
  sourceLabel: string;
  statusLabel: string;
  categoriesLabel: string;
  urgent: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
  description: string | null;
  reply: string | null;
  scooter: { number: number; modelName: string };
  rentalNumber: string | null;
  reporter: DocumentPartySource | null;
  photos: Date[];
  timeline: TimelineEntrySource[];
}

/** `v_doc_wallet_adjustment`: korekta salda klienta. */
export interface WalletAdjustmentDocumentSource {
  reference: string;
  createdAt: Date;
  amount: number;
  balanceAfter: number;
  reasonLabel: string;
  note: string | null;
  authorName: string | null;
  customer: DocumentPartySource;
}

export interface DocumentSources {
  RECEIPT: ReceiptDocumentSource;
  RENTAL_CONFIRMATION: RentalDocumentSource;
  SERVICE_PROTOCOL: ServiceTaskDocumentSource;
  SCOOTER_CARD: ScooterCardDocumentSource;
  INCIDENT_REPORT: TicketDocumentSource;
  WALLET_ADJUSTMENT: WalletAdjustmentDocumentSource;
}

export interface DocumentTypeDefinition<S> {
  readPermission: Permission;
  /** Szablon startowy w repozytorium (pytanie 1); pozostałe rodzaje drukują się po wgraniu szablonu. */
  starter: boolean;
  /** Część nazwy pliku wyniku (`S-1037-protokol-serwisowy`). */
  slug: string;
  fields: readonly DocumentFieldSpec[];
  loops: readonly DocumentLoopSpec[];
  params: readonly DocumentParamSpec[];
  build(source: S, ctx: DocumentBuildContext): TemplateData;
  entityLabel(source: S): string;
  sample: S;
}

// --- Pomocnicze ----------------------------------------------------------------------------------

const scooterLabel = (number: number): string => `#${String(number).padStart(4, '0')}`;
const dateOrEmpty = (at: Date | null, format: DocumentFormatters) => (at ? format.dateTime(at) : '');

function placeText(place: RentalPlaceSource | null, format: DocumentFormatters): string {
  if (!place) return '';
  if (place.address) return place.address;
  const coordinates = `${format.number(place.lat, 5)}, ${format.number(place.lon, 5)}`;
  return [place.zone, coordinates].filter(Boolean).join(' · ');
}

const party = (source: DocumentPartySource | null) => ({ name: orEmpty(source?.name), phone: orEmpty(source?.phone) });

const timeline = (
  entries: readonly TimelineEntrySource[],
  ctx: DocumentBuildContext,
  include = true,
): TemplateData[] =>
  include ? entries.map((entry) => ({ at: ctx.format.dateTime(entry.at), event: entry.label })) : [];

const timelineLoop: DocumentLoopSpec = {
  path: 'timeline',
  label: 'Oś czasu',
  fields: [text('at', 'Czas zdarzenia', '18.11.2026, 13:40'), text('event', 'Zdarzenie', 'Rozpoczęto przejazd')],
};

const includeTimelineParam: DocumentParamSpec = {
  name: 'includeTimeline',
  label: 'Dołącz oś czasu',
  type: 'boolean',
  default: true,
};

const customerFields = [
  text('customer.name', 'Klient: imię i nazwisko', 'Anna Kowalska', customer),
  text('customer.phone', 'Klient: telefon', '+48 500 100 200', customer),
];

const SAMPLE_AT = new Date('2026-11-18T13:05:00Z');
const minutesBefore = (minutes: number) => new Date(SAMPLE_AT.getTime() - minutes * 60_000);

// --- Paragon --------------------------------------------------------------------------------------

const receipt: DocumentTypeDefinition<ReceiptDocumentSource> = {
  readPermission: 'payments.read',
  starter: true,
  slug: 'paragon',
  fields: [
    text('receipt.number', 'Numer paragonu', 'PAR/2026/000126'),
    text('receipt.issuedAt', 'Data wystawienia', '18.11.2026, 14:05'),
    text('receipt.paymentSource', 'Forma płatności', 'Portfel'),
    text('receipt.rentalNumber', 'Numer przejazdu', 'R-1234'),
    flag('hasRental', 'Paragon dotyczy przejazdu (warunek)'),
    flag('isCorrection', 'Korekta (warunek wariantu korekty)'),
    text('corrected.number', 'Paragon korygowany', 'PAR/2026/000120'),
    text('corrected.issuedAt', 'Data paragonu korygowanego', '17.11.2026, 18:10'),
    text('correction.reason', 'Przyczyna korekty', 'Awaria hulajnogi'),
    text('seller.name', 'Sprzedawca: nazwa (z chwili wystawienia)', '[Nazwa spółki] sp. z o.o.'),
    text('seller.address', 'Sprzedawca: adres', '[ulica i numer], 44-200 Rybnik'),
    text('seller.taxId', 'Sprzedawca: NIP', '6422901846'),
    ...customerFields,
    text('totals.gross', 'Razem brutto', '12,50 zł'),
    text('totals.net', 'Razem netto', '10,16 zł'),
    text('totals.vat', 'Razem VAT', '2,34 zł'),
    flag('hasOutsideVat', 'Są pozycje poza VAT (warunek dopisku)'),
  ],
  loops: [
    {
      path: 'items',
      label: 'Pozycje',
      fields: [
        text('description', 'Opis pozycji', 'Minuty jazdy'),
        text('quantity', 'Ilość', '23'),
        text('unitPrice', 'Cena jednostkowa brutto', '0,50 zł'),
        text('vatRate', 'Stawka VAT („np.” poza VAT)', '23%'),
        text('amount', 'Kwota brutto', '11,50 zł'),
        flag('outsideVat', 'Pozycja poza VAT (warunek)'),
      ],
    },
    {
      path: 'vatGroups',
      label: 'Grupy stawek VAT',
      fields: [
        text('rate', 'Stawka', '23%'),
        text('gross', 'Brutto', '12,50 zł'),
        text('net', 'Netto', '10,16 zł'),
        text('vat', 'VAT', '2,34 zł'),
      ],
    },
  ],
  params: [],
  build(source, ctx) {
    const { money } = ctx.format;
    const rate = (vatRate: number | null) =>
      vatRate === null ? ctx.texts.outsideVat : `${ctx.format.number(vatRate)}%`;
    const totals = receiptTotals(source.items);
    return {
      receipt: {
        number: source.number,
        issuedAt: ctx.format.dateTime(source.issuedAt),
        paymentSource: source.paymentSourceLabel,
        rentalNumber: orEmpty(source.rentalNumber),
      },
      hasRental: source.rentalNumber !== null,
      isCorrection: source.kind === 'CORRECTION',
      corrected: {
        number: orEmpty(source.corrected?.number),
        issuedAt: dateOrEmpty(source.corrected?.issuedAt ?? null, ctx.format),
      },
      correction: { reason: orEmpty(source.correctionReasonLabel) },
      seller: {
        name: orEmpty(source.seller.name),
        address: orEmpty(source.seller.address),
        taxId: orEmpty(source.seller.taxId),
      },
      customer: party(source.buyer),
      totals: { gross: money(totals.gross), net: money(totals.net), vat: money(totals.vat) },
      hasOutsideVat: source.items.some((item) => item.vatRate === null),
      items: source.items.map((item) => ({
        description: item.label,
        quantity: ctx.format.number(item.quantity),
        unitPrice: money(item.unitPrice),
        vatRate: rate(item.vatRate),
        amount: money(item.amount),
        outsideVat: item.vatRate === null,
      })),
      vatGroups: receiptVatGroups(source.items).map((group) => ({
        rate: rate(group.vatRate),
        gross: money(group.gross),
        net: money(group.gross - group.vat),
        vat: money(group.vat),
      })),
    };
  },
  entityLabel: (source) => source.number,
  sample: {
    number: 'PAR/2026/000126',
    kind: 'SALE',
    issuedAt: SAMPLE_AT,
    paymentSourceLabel: 'Portfel',
    rentalNumber: 'R-1234',
    seller: { name: '[Nazwa spółki] sp. z o.o.', address: '[ulica i numer], 44-200 Rybnik', taxId: '6422901846' },
    buyer: { name: 'Anna Kowalska', phone: '+48 500 100 200' },
    corrected: null,
    correctionReasonLabel: null,
    items: [
      { label: 'Odblokowanie', quantity: 1, unitPrice: 300, vatRate: 23, amount: 300 },
      { label: 'Minuty jazdy', quantity: 19, unitPrice: 50, vatRate: 23, amount: 950 },
      { label: 'Opłata za odholowanie', quantity: 1, unitPrice: 5000, vatRate: null, amount: 5000 },
    ],
  },
};

// --- Potwierdzenie przejazdu ---------------------------------------------------------------------

const rental: DocumentTypeDefinition<RentalDocumentSource> = {
  readPermission: 'rentals.read',
  starter: true,
  slug: 'potwierdzenie-przejazdu',
  fields: [
    text('rental.number', 'Numer przejazdu', 'R-1234'),
    text('rental.state', 'Stan przejazdu', 'Zakończony'),
    text('rental.reservedAt', 'Rezerwacja', '18.11.2026, 13:38'),
    text('rental.startedAt', 'Początek jazdy', '18.11.2026, 13:40'),
    text('rental.endedAt', 'Koniec jazdy', '18.11.2026, 14:05'),
    text('rental.rideMinutes', 'Minuty jazdy', '23'),
    text('rental.pauseMinutes', 'Minuty pauzy', '2'),
    text('rental.distanceKm', 'Dystans w km', '4,2'),
    text('rental.endMode', 'Sposób zakończenia', 'Klient przy hulajnodze'),
    text('rental.tariffVersion', 'Wersja cennika', '3'),
    text('rental.receiptNumber', 'Numer paragonu', 'PAR/2026/000126'),
    flag('hasReceipt', 'Przejazd ma paragon (warunek)'),
    text('scooter.number', 'Numer hulajnogi', '#0007'),
    text('scooter.model', 'Model', '[MODEL]'),
    ...customerFields,
    text('start.place', 'Początek: adres albo strefa i współrzędne', 'Rynek, Rybnik'),
    text('start.zone', 'Początek: strefa', 'P-01 Rynek'),
    text('end.place', 'Koniec: adres albo strefa i współrzędne', 'ul. Kościuszki 15, Rybnik'),
    text('end.zone', 'Koniec: strefa', 'P-03 Kampus'),
    text('amounts.unlockFee', 'Odblokowanie', '3,00 zł'),
    text('amounts.ride', 'Jazda', '11,50 zł'),
    text('amounts.pause', 'Pauza', '0,40 zł'),
    text('amounts.towingFee', 'Opłata za odholowanie', '0,00 zł'),
    text('amounts.total', 'Razem', '14,90 zł'),
    flag('hasPause', 'Była pauza (warunek)'),
    flag('hasTowingFee', 'Pobrano opłatę za odholowanie (warunek)'),
    flag('includeTimeline', 'Parametr: dołącz oś czasu (warunek)'),
  ],
  loops: [timelineLoop],
  params: [includeTimelineParam],
  build(source, ctx) {
    const { money } = ctx.format;
    return {
      rental: {
        number: source.number,
        state: source.stateLabel,
        reservedAt: dateOrEmpty(source.reservedAt, ctx.format),
        startedAt: dateOrEmpty(source.startedAt, ctx.format),
        endedAt: dateOrEmpty(source.endedAt, ctx.format),
        rideMinutes: ctx.format.number(source.rideMinutes),
        pauseMinutes: ctx.format.number(source.pauseMinutes),
        distanceKm: source.distanceM === null ? '' : ctx.format.number(source.distanceM / 1000, 1),
        endMode: orEmpty(source.endModeLabel),
        tariffVersion: orEmpty(source.tariffVersion),
        receiptNumber: orEmpty(source.receiptNumber),
      },
      hasReceipt: source.receiptNumber !== null,
      scooter: { number: scooterLabel(source.scooter.number), model: source.scooter.modelName },
      customer: party(source.customer),
      start: { place: placeText(source.start, ctx.format), zone: orEmpty(source.start?.zone) },
      end: { place: placeText(source.end, ctx.format), zone: orEmpty(source.end?.zone) },
      amounts: {
        unlockFee: money(source.amounts.unlockFee),
        ride: money(source.amounts.ride),
        pause: money(source.amounts.pause),
        towingFee: money(source.amounts.towingFee),
        total: money(source.amounts.total),
      },
      hasPause: source.pauseMinutes > 0,
      hasTowingFee: source.amounts.towingFee > 0,
      includeTimeline: ctx.params.includeTimeline === true,
      timeline: timeline(source.timeline, ctx, ctx.params.includeTimeline === true),
    };
  },
  entityLabel: (source) => source.number,
  sample: {
    number: 'R-1234',
    stateLabel: 'Zakończony',
    reservedAt: minutesBefore(27),
    startedAt: minutesBefore(25),
    endedAt: SAMPLE_AT,
    rideMinutes: 23,
    pauseMinutes: 2,
    distanceM: 4200,
    endModeLabel: 'Klient przy hulajnodze',
    tariffVersion: 3,
    receiptNumber: 'PAR/2026/000126',
    scooter: { number: 7, modelName: '[MODEL]' },
    customer: { name: 'Anna Kowalska', phone: '+48 500 100 200' },
    start: { address: null, zone: 'P-01 Rynek', lat: 50.09721, lon: 18.54183 },
    end: { address: 'ul. Kościuszki 15, Rybnik', zone: 'P-03 Kampus', lat: 50.0905, lon: 18.5468 },
    amounts: { unlockFee: 300, ride: 1150, pause: 40, towingFee: 0, total: 1490 },
    timeline: [
      { at: minutesBefore(27), label: 'Rezerwacja' },
      { at: minutesBefore(25), label: 'Odblokowano hulajnogę' },
      { at: SAMPLE_AT, label: 'Zakończono przejazd w strefie P-03 Kampus' },
    ],
  },
};

// --- Protokół zadania serwisowego ---------------------------------------------------------------

const serviceProtocol: DocumentTypeDefinition<ServiceTaskDocumentSource> = {
  readPermission: 'service.read',
  starter: true,
  slug: 'protokol-serwisowy',
  fields: [
    text('task.number', 'Numer zadania', 'S-1037'),
    text('task.type', 'Rodzaj zadania', 'Naprawa'),
    text('task.status', 'Stan zadania', 'Zakończone'),
    text('task.priority', 'Priorytet', 'Wysoki'),
    text('task.createdAt', 'Utworzono', '18.11.2026, 9:12'),
    text('task.finishedAt', 'Zakończono', '18.11.2026, 14:05'),
    text('task.dueAt', 'Termin', '19.11.2026, 12:00'),
    text('task.assignee', 'Wykonawca', 'Tomasz Nowak'),
    text('task.note', 'Notatka z naprawy', 'Wymieniono klocki i linkę tylnego hamulca.'),
    text('task.outcome', 'Skutek dla hulajnogi', 'Wraca do floty.'),
    flag('hasNote', 'Jest notatka (warunek)'),
    flag('hasOutcome', 'Jest skutek dla hulajnogi (warunek)'),
    text('scooter.number', 'Numer hulajnogi', '#0203'),
    text('scooter.model', 'Model', '[MODEL]'),
    text('scooter.odometerKm', 'Przebieg w km', '2041'),
    text('scooter.batteryPct', 'Bateria w %', '12'),
    flag('hasTicket', 'Zadanie ze zgłoszenia (warunek)'),
    text('ticket.number', 'Numer zgłoszenia', 'Z-2311'),
    text('ticket.categories', 'Kategorie zgłoszenia', 'Hamulce'),
    text('customer.name', 'Zgłaszający: imię i nazwisko', 'Anna Kowalska', customer),
    text('customer.phone', 'Zgłaszający: telefon', '+48 500 100 200', customer),
    flag('hasParts', 'Użyto części (warunek tabeli)'),
    text('partsTotal', 'Koszt części razem', '36,50 zł'),
    flag('includeTimeline', 'Parametr: dołącz oś czasu (warunek)'),
  ],
  loops: [
    {
      path: 'parts',
      label: 'Części z magazynu',
      fields: [
        text('name', 'Nazwa części', 'Klocki hamulcowe tylne (para)'),
        text('sku', 'SKU', 'BRK-PAD-R'),
        text('quantity', 'Ilość', '1'),
        text('unitPrice', 'Koszt jednostkowy', '24,00 zł'),
        text('cost', 'Koszt', '24,00 zł'),
      ],
    },
    timelineLoop,
  ],
  params: [includeTimelineParam],
  build(source, ctx) {
    const { money } = ctx.format;
    const include = ctx.params.includeTimeline === true;
    return {
      task: {
        number: source.number,
        type: source.typeLabel,
        status: source.statusLabel,
        priority: source.priorityLabel,
        createdAt: ctx.format.dateTime(source.createdAt),
        finishedAt: dateOrEmpty(source.finishedAt, ctx.format),
        dueAt: dateOrEmpty(source.dueAt, ctx.format),
        assignee: orEmpty(source.assigneeName),
        note: orEmpty(source.note),
        outcome: orEmpty(source.outcome),
      },
      hasNote: Boolean(source.note?.trim()),
      hasOutcome: Boolean(source.outcome?.trim()),
      scooter: {
        number: scooterLabel(source.scooter.number),
        model: source.scooter.modelName,
        odometerKm: source.scooter.odometerKm === null ? '' : ctx.format.number(source.scooter.odometerKm),
        batteryPct: orEmpty(source.scooter.batteryPct),
      },
      hasTicket: source.ticket !== null,
      ticket: { number: orEmpty(source.ticket?.number), categories: orEmpty(source.ticket?.categoriesLabel) },
      customer: party(source.ticket?.reporter ?? null),
      hasParts: source.parts.length > 0,
      partsTotal: money(partsCost(source.parts)),
      parts: source.parts.map((part) => ({
        name: part.name,
        sku: part.sku,
        quantity: ctx.format.number(part.quantity),
        unitPrice: money(part.unitCost),
        cost: money(part.unitCost * part.quantity),
      })),
      includeTimeline: include,
      timeline: timeline(source.timeline, ctx, include),
    };
  },
  entityLabel: (source) => source.number,
  sample: {
    number: 'S-1037',
    typeLabel: 'Naprawa',
    statusLabel: 'Zakończone',
    priorityLabel: 'Wysoki',
    createdAt: minutesBefore(293),
    finishedAt: SAMPLE_AT,
    dueAt: null,
    assigneeName: 'Tomasz Nowak',
    note: 'Wymieniono klocki i linkę tylnego hamulca, wyregulowano. Test hamowania z 20 km/h poprawny.',
    outcome: 'Zostaje w serwisie: bateria 12%, poniżej progu [15]%. Utworzono zadanie S-1041 Wymiana baterii.',
    scooter: { number: 203, modelName: '[MODEL]', odometerKm: 2041, batteryPct: 12 },
    ticket: {
      number: 'Z-2311',
      categoriesLabel: 'Hamulce',
      reporter: { name: 'Anna Kowalska', phone: '+48 500 100 200' },
    },
    parts: [
      { name: 'Klocki hamulcowe tylne (para)', sku: 'BRK-PAD-R', quantity: 1, unitCost: 2400 },
      { name: 'Linka hamulca tylnego', sku: 'BRK-CBL-R', quantity: 1, unitCost: 1250 },
    ],
    timeline: [
      { at: minutesBefore(293), label: 'Utworzono zadanie ze zgłoszenia Z-2311' },
      { at: minutesBefore(120), label: 'Rozpoczęto' },
      { at: SAMPLE_AT, label: 'Zakończono' },
    ],
  },
};

// --- Karta hulajnogi ------------------------------------------------------------------------------

export const SCOOTER_CARD_HISTORY_DAYS = [30, 90, 365] as const;

const scooterCard: DocumentTypeDefinition<ScooterCardDocumentSource> = {
  readPermission: 'scooters.read',
  starter: true,
  slug: 'karta-hulajnogi',
  fields: [
    text('scooter.number', 'Numer hulajnogi', '#0007'),
    text('scooter.serial', 'Numer seryjny', 'SN-2026-0007'),
    text('scooter.status', 'Stan', 'Dostępna'),
    text('scooter.variant', 'Wariant', 'Grafit'),
    text('scooter.model', 'Model', '[MODEL]'),
    text('scooter.modelCode', 'Kod modelu', 'M1'),
    text('scooter.firmware', 'Oprogramowanie', '1.3.0'),
    text('scooter.odometerKm', 'Przebieg w km', '2041'),
    text('scooter.batteryPct', 'Bateria w %', '82'),
    text('scooter.lastSeenAt', 'Ostatnia łączność', '18.11.2026, 14:00'),
    text('scooter.inServiceSince', 'We flocie od', '01.11.2026'),
    text('scooter.url', 'Adres strony hulajnogi (kod QR)', 'https://[domena]/h/0007'),
    text('history.days', 'Okres historii w dniach', '90'),
    text('history.from', 'Historia od', '20.08.2026'),
    flag('hasTasks', 'Są zadania w okresie (warunek)'),
    flag('hasTickets', 'Są zgłoszenia w okresie (warunek)'),
  ],
  loops: [
    {
      path: 'tasks',
      label: 'Zadania serwisowe w okresie',
      fields: [
        text('number', 'Numer zadania', 'S-1037'),
        text('type', 'Rodzaj', 'Naprawa'),
        text('status', 'Stan', 'Zakończone'),
        text('createdAt', 'Utworzono', '18.11.2026, 9:12'),
        text('finishedAt', 'Zakończono', '18.11.2026, 14:05'),
      ],
    },
    {
      path: 'tickets',
      label: 'Zgłoszenia w okresie',
      fields: [
        text('number', 'Numer zgłoszenia', 'Z-2311'),
        text('categories', 'Kategorie', 'Hamulce'),
        text('status', 'Stan', 'Rozwiązane'),
        text('createdAt', 'Zgłoszono', '18.11.2026, 8:40'),
      ],
    },
  ],
  params: [
    { name: 'historyDays', label: 'Zakres historii', type: 'select', options: SCOOTER_CARD_HISTORY_DAYS, default: 90 },
  ],
  build(source, ctx) {
    const days = Number(ctx.params.historyDays);
    const from = new Date(ctx.generatedAt.getTime() - days * 24 * 60 * 60_000);
    const inPeriod = (at: Date) => at.getTime() >= from.getTime();
    const tasks = source.tasks.filter((task) => inPeriod(task.createdAt));
    const tickets = source.tickets.filter((ticket) => inPeriod(ticket.createdAt));
    return {
      scooter: {
        number: scooterLabel(source.number),
        serial: source.serialNumber,
        status: source.statusLabel,
        variant: source.variantLabel,
        model: source.model.name,
        modelCode: source.model.code,
        firmware: orEmpty(source.firmware),
        odometerKm: ctx.format.number(Math.floor(source.odometerM / 1000)),
        batteryPct: orEmpty(source.batteryPct),
        lastSeenAt: dateOrEmpty(source.lastSeenAt, ctx.format),
        inServiceSince: ctx.format.date(source.createdAt),
        url: source.pageUrl,
      },
      history: { days: String(days), from: ctx.format.date(from) },
      hasTasks: tasks.length > 0,
      hasTickets: tickets.length > 0,
      tasks: tasks.map((task) => ({
        number: task.number,
        type: task.typeLabel,
        status: task.statusLabel,
        createdAt: ctx.format.dateTime(task.createdAt),
        finishedAt: dateOrEmpty(task.finishedAt, ctx.format),
      })),
      tickets: tickets.map((ticket) => ({
        number: ticket.number,
        categories: ticket.categoriesLabel,
        status: ticket.statusLabel,
        createdAt: ctx.format.dateTime(ticket.createdAt),
      })),
    };
  },
  entityLabel: (source) => scooterLabel(source.number),
  sample: {
    number: 7,
    serialNumber: 'SN-2026-0007',
    statusLabel: 'Dostępna',
    variantLabel: 'Grafit',
    model: { code: 'M1', name: '[MODEL]' },
    firmware: '1.3.0',
    odometerM: 2_041_300,
    batteryPct: 82,
    lastSeenAt: SAMPLE_AT,
    createdAt: new Date('2026-11-01T08:00:00Z'),
    pageUrl: 'https://[domena]/h/0007',
    tasks: [
      {
        number: 'S-1037',
        typeLabel: 'Naprawa',
        statusLabel: 'Zakończone',
        createdAt: minutesBefore(293),
        finishedAt: SAMPLE_AT,
      },
      {
        number: 'S-0950',
        typeLabel: 'Przegląd',
        statusLabel: 'Zakończone',
        createdAt: new Date('2025-01-10T10:00:00Z'),
        finishedAt: new Date('2025-01-10T12:00:00Z'),
      },
    ],
    tickets: [
      { number: 'Z-2311', categoriesLabel: 'Hamulce', statusLabel: 'Rozwiązane', createdAt: minutesBefore(325) },
    ],
  },
};

// --- Raport zgłoszenia ----------------------------------------------------------------------------

const incidentReport: DocumentTypeDefinition<TicketDocumentSource> = {
  readPermission: 'tickets.read',
  starter: false,
  slug: 'raport-zgloszenia',
  fields: [
    text('ticket.number', 'Numer zgłoszenia', 'Z-2311'),
    text('ticket.source', 'Źródło', 'Klient'),
    text('ticket.status', 'Stan', 'Rozwiązane'),
    text('ticket.categories', 'Kategorie', 'Hamulce'),
    text('ticket.createdAt', 'Zgłoszono', '18.11.2026, 8:40'),
    text('ticket.resolvedAt', 'Rozwiązano', '18.11.2026, 14:05'),
    text('ticket.description', 'Opis', 'Tylny hamulec nie trzyma.'),
    text('ticket.reply', 'Odpowiedź dla klienta', 'Dziękujemy, hamulec został naprawiony.'),
    text('ticket.rentalNumber', 'Numer przejazdu', 'R-1230'),
    flag('isUrgent', 'Zgłoszenie pilne (warunek)'),
    flag('hasReply', 'Jest odpowiedź dla klienta (warunek)'),
    flag('hasRental', 'Zgłoszenie z przejazdu (warunek)'),
    text('scooter.number', 'Numer hulajnogi', '#0203'),
    text('scooter.model', 'Model', '[MODEL]'),
    ...customerFields,
    text('photos.count', 'Liczba zdjęć', '2'),
    text('photos.dates', 'Daty zdjęć', '18.11.2026, 8:39; 18.11.2026, 8:40'),
  ],
  loops: [timelineLoop],
  params: [],
  build(source, ctx) {
    return {
      ticket: {
        number: source.number,
        source: source.sourceLabel,
        status: source.statusLabel,
        categories: source.categoriesLabel,
        createdAt: ctx.format.dateTime(source.createdAt),
        resolvedAt: dateOrEmpty(source.resolvedAt, ctx.format),
        description: orEmpty(source.description),
        reply: orEmpty(source.reply),
        rentalNumber: orEmpty(source.rentalNumber),
      },
      isUrgent: source.urgent,
      hasReply: Boolean(source.reply?.trim()),
      hasRental: source.rentalNumber !== null,
      scooter: { number: scooterLabel(source.scooter.number), model: source.scooter.modelName },
      customer: party(source.reporter),
      photos: {
        count: String(source.photos.length),
        dates: source.photos.map((at) => ctx.format.dateTime(at)).join('; '),
      },
      timeline: timeline(source.timeline, ctx),
    };
  },
  entityLabel: (source) => source.number,
  sample: {
    number: 'Z-2311',
    sourceLabel: 'Klient',
    statusLabel: 'Rozwiązane',
    categoriesLabel: 'Hamulce',
    urgent: true,
    createdAt: minutesBefore(325),
    resolvedAt: SAMPLE_AT,
    description: 'Tylny hamulec nie trzyma.',
    reply: 'Dziękujemy, hamulec został naprawiony.',
    scooter: { number: 203, modelName: '[MODEL]' },
    rentalNumber: 'R-1230',
    reporter: { name: 'Anna Kowalska', phone: '+48 500 100 200' },
    photos: [minutesBefore(326), minutesBefore(325)],
    timeline: [
      { at: minutesBefore(325), label: 'Zgłoszono' },
      { at: minutesBefore(293), label: 'Utworzono zadanie S-1037' },
      { at: SAMPLE_AT, label: 'Rozwiązano' },
    ],
  },
};

// --- Potwierdzenie korekty salda ----------------------------------------------------------------

const walletAdjustment: DocumentTypeDefinition<WalletAdjustmentDocumentSource> = {
  readPermission: 'payments.read',
  starter: false,
  slug: 'korekta-salda',
  fields: [
    text('adjustment.reference', 'Numer korekty', 'K-000031'),
    text('adjustment.createdAt', 'Data korekty', '18.11.2026, 14:05'),
    text('adjustment.amount', 'Kwota korekty', '10,00 zł'),
    text('adjustment.balanceAfter', 'Saldo po korekcie', '42,50 zł'),
    text('adjustment.reason', 'Powód', 'Reklamacja'),
    text('adjustment.note', 'Notatka', 'Rekompensata za awarię.'),
    text('adjustment.author', 'Operator korekty', 'Piotr Mazur'),
    flag('isCredit', 'Uznanie salda (warunek; inaczej obciążenie)'),
    ...customerFields,
  ],
  loops: [],
  params: [],
  build(source, ctx) {
    return {
      adjustment: {
        reference: source.reference,
        createdAt: ctx.format.dateTime(source.createdAt),
        amount: ctx.format.money(source.amount),
        balanceAfter: ctx.format.money(source.balanceAfter),
        reason: source.reasonLabel,
        note: orEmpty(source.note),
        author: orEmpty(source.authorName),
      },
      isCredit: source.amount > 0,
      customer: party(source.customer),
    };
  },
  entityLabel: (source) => source.reference,
  sample: {
    reference: 'K-000031',
    createdAt: SAMPLE_AT,
    amount: 1000,
    balanceAfter: 4250,
    reasonLabel: 'Reklamacja',
    note: 'Rekompensata za awarię.',
    authorName: 'Piotr Mazur',
    customer: { name: 'Anna Kowalska', phone: '+48 500 100 200' },
  },
};

export const DOCUMENT_CATALOG: { [K in TemplateDocumentType]: DocumentTypeDefinition<DocumentSources[K]> } = {
  RENTAL_CONFIRMATION: rental,
  SERVICE_PROTOCOL: serviceProtocol,
  SCOOTER_CARD: scooterCard,
  INCIDENT_REPORT: incidentReport,
  WALLET_ADJUSTMENT: walletAdjustment,
  RECEIPT: receipt,
};

/** Uprawnienie odczytu rodzaju: „Drukuj” wymaga go obok `documents.generate` (ADR 0068). */
export const DOCUMENT_READ_PERMISSIONS: Record<DocumentType, Permission> = {
  RENTAL_CONFIRMATION: rental.readPermission,
  SERVICE_PROTOCOL: serviceProtocol.readPermission,
  SCOOTER_CARD: scooterCard.readPermission,
  INCIDENT_REPORT: incidentReport.readPermission,
  WALLET_ADJUSTMENT: walletAdjustment.readPermission,
  RECEIPT: receipt.readPermission,
  SCOOTER_LABEL: 'scooters.read',
};

/** Pola i pętle rodzaju dla walidacji szablonu i listy pól: pola wspólne, potem pola rodzaju. */
export function documentFieldCatalog(type: TemplateDocumentType): TemplateFieldCatalog {
  const definition = DOCUMENT_CATALOG[type];
  return { fields: [...COMMON_DOCUMENT_FIELDS, ...definition.fields], loops: definition.loops };
}

/** Parametry naklejki z kodem QR (`SCOOTER_LABEL`, układ wbudowany). */
export const SCOOTER_LABEL_PARAMS: readonly DocumentParamSpec[] = [
  { name: 'layout', label: 'Układ', type: 'select', options: ['single', 'a4x6'], default: 'single' },
];

export const documentParamSpecs = (type: DocumentType): readonly DocumentParamSpec[] =>
  type === 'SCOOTER_LABEL' ? SCOOTER_LABEL_PARAMS : DOCUMENT_CATALOG[type].params;

/**
 * Parametry zlecenia z wartościami domyślnymi z katalogu. Parametr spoza katalogu, zły typ albo wartość spoza
 * listy daje `DOCUMENT_PARAM_INVALID` z nazwą parametru.
 */
export function resolveDocumentParams(type: DocumentType, input: DocumentParams = {}): DocumentParams {
  const specs = documentParamSpecs(type);
  for (const name of Object.keys(input)) {
    if (!specs.some((spec) => spec.name === name)) throw new DomainError('DOCUMENT_PARAM_INVALID', { param: name });
  }
  const params: DocumentParams = {};
  for (const spec of specs) {
    const value = Object.hasOwn(input, spec.name) ? input[spec.name]! : spec.default;
    const valid =
      spec.type === 'boolean' ? typeof value === 'boolean' : spec.options?.includes(value as string | number);
    if (!valid) throw new DomainError('DOCUMENT_PARAM_INVALID', { param: spec.name, options: spec.options ?? null });
    params[spec.name] = value;
  }
  return params;
}

function setPath(data: TemplateData, path: string, value: string): void {
  const segments = path.split('.');
  let target: TemplateData = data;
  for (const segment of segments.slice(0, -1)) {
    const next = target[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    target = next;
  }
  const last = segments[segments.length - 1]!;
  if (Object.hasOwn(target, last)) target[last] = value;
}

/**
 * Dane klienta (pola `customer` katalogu) operator bez `users.read` dostaje jako „Klient” (ADR 0068): samo
 * `documents.generate` nie daje dostępu do danych osobowych.
 */
export function maskCustomerFields(
  data: TemplateData,
  catalog: TemplateFieldCatalog,
  placeholder: string,
): TemplateData {
  for (const field of catalog.fields) if (field.customer) setPath(data, field.path, placeholder);
  for (const loop of catalog.loops) {
    const items = data[loop.path];
    if (!Array.isArray(items)) continue;
    for (const item of items)
      for (const field of loop.fields) if (field.customer) setPath(item, field.path, placeholder);
  }
  return data;
}

/**
 * Dane szablonu wydruku: parametry z katalogu, pola wspólne i pola rodzaju, a bez `users.read` ukryte dane klienta.
 * Klient pobierający własny paragon widzi swoje dane (`canReadCustomers: true`).
 */
export function buildDocumentData<K extends TemplateDocumentType>(
  type: K,
  source: DocumentSources[K],
  ctx: Omit<DocumentBuildContext, 'params'> & { params?: DocumentParams; canReadCustomers: boolean },
): TemplateData {
  const params = resolveDocumentParams(type, ctx.params);
  const full: DocumentBuildContext = { ...ctx, params };
  const definition = DOCUMENT_CATALOG[type] as DocumentTypeDefinition<DocumentSources[K]>;
  const data: TemplateData = { ...commonData(full), ...definition.build(source, full) };
  return ctx.canReadCustomers ? data : maskCustomerFields(data, documentFieldCatalog(type), ctx.texts.customerHidden);
}

/** Dane przykładowe rodzaju: podgląd PDF wersji, próbne wypełnienie przy wgraniu i testy szablonów startowych. */
export function documentSampleData(
  type: TemplateDocumentType,
  ctx: Omit<DocumentBuildContext, 'params' | 'generatedAt' | 'company' | 'staff'> &
    Partial<Pick<DocumentBuildContext, 'generatedAt' | 'company' | 'staff'>>,
): TemplateData {
  return buildDocumentData(type, DOCUMENT_CATALOG[type].sample as never, {
    ...ctx,
    generatedAt: ctx.generatedAt ?? SAMPLE_AT,
    company: ctx.company ?? SAMPLE_COMPANY,
    staff: ctx.staff === undefined ? { name: 'Tomasz Nowak' } : ctx.staff,
    preview: ctx.preview ?? true,
    canReadCustomers: true,
  });
}

/** Dane firmy w podglądzie przed uzupełnieniem danych w panelu (wartości w nawiasach jak na makietach). */
export const SAMPLE_COMPANY: CompanyProfile = {
  name: '[Nazwa spółki] sp. z o.o.',
  street: '[ulica i numer]',
  postalCode: '44-200',
  city: 'Rybnik',
  taxId: '6422901846',
  supportEmail: '[e-mail pomocy]',
  supportPhone: '[telefon pomocy]',
  supportHours: 'Codziennie [8:00–20:00]',
  regon: null,
  krs: null,
  registryCourt: null,
  shareCapitalGrosze: null,
};

/** Numer obiektu z chwili zlecenia (`generated_documents.entity_label`). */
export const documentEntityLabel = <K extends TemplateDocumentType>(type: K, source: DocumentSources[K]): string =>
  (DOCUMENT_CATALOG[type] as DocumentTypeDefinition<DocumentSources[K]>).entityLabel(source);

const fileSafe = (label: string) => label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Nazwa pliku wyniku bez rozszerzenia: paragon to jego numer (`PAR-2026-000126`), pozostałe rodzaje numer obiektu
 * i rodzaj (`S-1037-protokol-serwisowy`, `0007-karta-hulajnogi`, `0007-naklejka`).
 */
export function documentFileName(type: DocumentType, entityLabel: string): string {
  if (type === 'RECEIPT') return fileSafe(entityLabel);
  const slug = type === 'SCOOTER_LABEL' ? 'naklejka' : DOCUMENT_CATALOG[type].slug;
  return [fileSafe(entityLabel), slug].filter(Boolean).join('-');
}
