/**
 * Rejestr sekcji treści (ADR 0062, D1). Kod strony, aplikacji i panelu renderuje znane miejsca, więc sekcje istnieją
 * tylko tutaj: panel zmienia treść bloków i elementy sekcji-list, ale nie tworzy ani nie usuwa sekcji. Baza trzyma
 * treść (`content_blocks`: klucz sekcji, pozycja 0 to blok pojedynczy albo nagłówek listy, od 1 elementy), a reguły
 * zapisu sprawdza core, który dostaje definicję sekcji jako argument. Test API porównuje rejestr z bazą.
 */
import type { MarkdownProfile } from '../markdown/markdown.js';

/** Klient treści (`content_blocks.client`); klucz sekcji zaczyna się od `web.`, `mobile.` albo `admin.`. */
export const CONTENT_CLIENTS = ['WEB', 'MOBILE', 'ADMIN'] as const;
export type ContentClient = (typeof CONTENT_CLIENTS)[number];

/** Klienci z publicznym `GET /content/{client}`. */
export const PUBLIC_CONTENT_CLIENTS = ['web', 'mobile'] as const;
export type PublicContentClient = (typeof PUBLIC_CONTENT_CLIENTS)[number];

/** Stan bloku, pytania FAQ i aktualności (`content_status`); przejścia w obie strony (ADR 0062). */
export const CONTENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * Ikony elementów sekcji-list (zasady przed jazdą, legenda stref) z zamkniętej listy: rysunek w obu klientach
 * i `CHECK` w bazie. Nowa ikona to rysunek w kliencie i migracja.
 */
export const CONTENT_ICONS = [
  'rider-single',
  'bike-lane',
  'parking',
  'helmet',
  'no-alcohol',
  'map',
  'scan',
  'wallet',
  'battery',
  'zone-slow',
  'zone-no-ride',
  'phone',
] as const;
export type ContentIcon = (typeof CONTENT_ICONS)[number];

export const isContentIcon = (value: string): value is ContentIcon =>
  (CONTENT_ICONS as readonly string[]).includes(value);

/**
 * Klucze grafik systemowych (ADR 0064): rendery wariantów hulajnogi, które aplikacja wybiera po kluczu. Są tylko do
 * odczytu w panelu, a wyzwalacz w bazie blokuje ich usunięcie. Aplikacja ma kopię w paczce na pierwsze
 * uruchomienie bez sieci (`apps/mobile/assets/images/rendery`).
 */
export const SYSTEM_MEDIA_KEYS = [
  'scooter.grafit.trzy',
  'scooter.kobalt.trzy',
  'scooter.beton.trzy',
  'scooter.grafit.bok',
] as const;
export type SystemMediaKey = (typeof SYSTEM_MEDIA_KEYS)[number];

/**
 * Grafika systemowa to każdy klucz z przedrostkiem `scooter.` (`CHECK media_assets_system_key` w migracji 0011);
 * `SYSTEM_MEDIA_KEYS` to klucze, których aplikacja szuka. Panel nie tworzy kluczy z tym przedrostkiem
 * (core `ensureMediaKeyAllowed`), więc grafiki systemowe pochodzą tylko z danych startowych.
 */
export const SYSTEM_MEDIA_KEY_PREFIX = 'scooter.';

export const isSystemMediaKey = (key: string): boolean => key.startsWith(SYSTEM_MEDIA_KEY_PREFIX);

/** Klucz grafiki: małe litery i cyfry z `-` albo `.` w środku (`aktualnosc-kampus-2`, `scooter.grafit.trzy`). */
export const MEDIA_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const MEDIA_KEY_MAX = 80;

/** Pole tekstowe bloku z limitem znaków źródła (punkty kodowe, licznik „168 / 240” w edytorze). */
export interface ContentTextField {
  max: number;
  required: boolean;
}

/** Treść w Markdown z profilem z ADR 0063. */
export interface ContentBodyField extends ContentTextField {
  profile: MarkdownProfile;
}

/** Grafika z biblioteki mediów; `minWidth` w pikselach (grafika węższa jest „za mała”, `MEDIA_TOO_NARROW`). */
export interface ContentMediaField {
  required: boolean;
  minWidth?: number;
}

/** Pola bloku dozwolone w sekcji; brak pola w definicji znaczy, że sekcja go nie ma (`CONTENT_FIELD_NOT_ALLOWED`). */
export interface ContentFieldsDefinition {
  title?: ContentTextField;
  body?: ContentBodyField;
  media?: ContentMediaField;
  /** Przycisk: etykieta i adres razem (adres z białej listy `isAllowedHref`). */
  button?: { required: boolean; labelMax: number };
  icon?: { required: boolean };
}

/** Dane dołączane do sekcji przez kod, a nie z bloków (opis w panelu: „ceny z cennika”, „parametry z modelu”). */
export const CONTENT_DATA_SOURCES = ['tariff', 'model', 'faq', 'company'] as const;
export type ContentDataSource = (typeof CONTENT_DATA_SOURCES)[number];

export interface ContentSectionDefinition {
  client: ContentClient;
  kind: 'single' | 'list';
  /** Sekcja zawsze opublikowana: nie schodzi do szkicu ani archiwum (`CONTENT_SECTION_REQUIRED`). */
  required: boolean;
  /** Blok pojedynczy albo nagłówek listy (pozycja 0). */
  header: ContentFieldsDefinition;
  /** Element sekcji-listy (pozycje od 1) z liczbą elementów: `max` wszystkich, `min` opublikowanych. */
  item?: ContentFieldsDefinition;
  items?: { min: number; max: number };
  sources?: readonly ContentDataSource[];
}

const title = (max: number, required = true): ContentTextField => ({ max, required });
const body = (profile: MarkdownProfile, max: number, required = true): ContentBodyField => ({ profile, max, required });
const media = (required: boolean, minWidth?: number): ContentMediaField =>
  minWidth === undefined ? { required } : { required, minWidth };
const button = (required = false) => ({ required, labelMax: 40 });

/** Minimalna szerokość grafiki hero i Open Graph (ADR 0070; ADR 0064 zakładał 1200 px, rendery w repozytorium mają 767–922 px). */
export const HERO_MIN_WIDTH = 760;

/**
 * Rejestr startowy według plansz `tresci-bloki` i `tresci-sekcja-lista` (limity z liczników edytora). Kolejność
 * kluczy to kolejność sekcji w panelu i na stronie.
 */
export const CONTENT_SECTIONS = {
  'web.meta': {
    client: 'WEB',
    kind: 'single',
    required: false,
    header: { title: title(70), body: body('inline', 160), media: media(false, HERO_MIN_WIDTH) },
  },
  'web.notice': {
    client: 'WEB',
    kind: 'single',
    required: false,
    header: { body: body('inline', 140), button: button() },
  },
  'web.hero': {
    client: 'WEB',
    kind: 'single',
    required: true,
    header: { title: title(60), body: body('inline', 240), media: media(true, HERO_MIN_WIDTH), button: button() },
  },
  'web.steps': {
    client: 'WEB',
    kind: 'list',
    required: false,
    header: { title: title(60), body: body('inline', 240, false) },
    item: { title: title(40), body: body('inline', 140) },
    items: { min: 3, max: 4 },
  },
  'web.design': {
    client: 'WEB',
    kind: 'single',
    required: false,
    header: { title: title(60), body: body('inline', 240), media: media(false) },
    sources: ['model'],
  },
  'web.pricing': {
    client: 'WEB',
    kind: 'single',
    required: false,
    header: { title: title(60), body: body('inline', 240, false) },
    sources: ['tariff'],
  },
  'web.zones': {
    client: 'WEB',
    kind: 'list',
    required: false,
    header: { title: title(60), body: body('inline', 240, false), media: media(false) },
    item: { title: title(40), body: body('inline', 140), icon: { required: true } },
    items: { min: 3, max: 3 },
  },
  'web.app': {
    client: 'WEB',
    kind: 'single',
    required: false,
    header: { title: title(60), body: body('inline', 240), media: media(false) },
  },
  'web.stores': {
    client: 'WEB',
    kind: 'list',
    required: false,
    header: {},
    item: { title: title(40), button: button(true) },
    items: { min: 1, max: 2 },
  },
  'web.faq': {
    client: 'WEB',
    kind: 'single',
    required: false,
    header: { title: title(60), body: body('inline', 240, false) },
    sources: ['faq'],
  },
  'web.footer': {
    client: 'WEB',
    kind: 'single',
    required: false,
    header: { body: body('inline', 240) },
    sources: ['company'],
  },
  'mobile.start': {
    client: 'MOBILE',
    kind: 'single',
    required: true,
    header: { title: title(60), body: body('inline', 240), media: media(true) },
  },
  'mobile.rules': {
    client: 'MOBILE',
    kind: 'list',
    required: false,
    header: { title: title(60), body: body('inline', 240, false) },
    item: { title: title(40), body: body('inline', 140), icon: { required: true } },
    items: { min: 3, max: 6 },
  },
  'mobile.help': {
    client: 'MOBILE',
    kind: 'single',
    required: false,
    header: { title: title(60), body: body('faq', 1000, false) },
    sources: ['faq', 'company'],
  },
  'mobile.notice': {
    client: 'MOBILE',
    kind: 'single',
    required: false,
    header: { body: body('inline', 140), button: button() },
  },
  'admin.scooter-label': {
    client: 'ADMIN',
    kind: 'single',
    required: false,
    header: { title: title(60), body: body('inline', 140, false) },
  },
} as const satisfies Record<string, ContentSectionDefinition>;

export type ContentSectionKey = keyof typeof CONTENT_SECTIONS;
export const CONTENT_SECTION_KEYS = Object.keys(CONTENT_SECTIONS) as ContentSectionKey[];

/** Wzorzec klucza sekcji (parametr `PUT /admin/content-sections/{key}`). */
export const CONTENT_SECTION_KEY_PATTERN = /^(web|mobile|admin)\.[a-z]+(?:-[a-z]+)*$/;

export const isContentSectionKey = (key: string): key is ContentSectionKey => Object.hasOwn(CONTENT_SECTIONS, key);

/** Definicja sekcji jako typ ogólny (do przekazania regułom w core). */
export const contentSection = (key: ContentSectionKey): ContentSectionDefinition => CONTENT_SECTIONS[key];

/** Sekcje klienta w kolejności rejestru. */
export const contentSectionsOf = (client: ContentClient): ContentSectionKey[] =>
  CONTENT_SECTION_KEYS.filter((key) => CONTENT_SECTIONS[key].client === client);

/** Prefiks klucza sekcji zgodny z klientem (`CHECK` w bazie). */
export const contentClientPrefix = (client: ContentClient): string => `${client.toLowerCase()}.`;
