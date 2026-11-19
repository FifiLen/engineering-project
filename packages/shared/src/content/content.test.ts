import { describe, expect, it } from 'vitest';
import { dataExportSchema, DATA_EXPORT_SECTIONS, type DataExportFile } from '../data-export.js';
import { DOCUMENT_TYPES, documentGenerateSchema, TEMPLATE_DOCUMENT_TYPES } from '../documents.js';
import { MARKDOWN_PROFILES, parseMarkdown } from '../markdown/index.js';
import { staffRoom, userRoom } from '../realtime.js';
import {
  companyProfileUpdateSchema,
  contentSectionKeyParamSchema,
  contentSectionSaveSchema,
  faqItemCreateSchema,
  mediaCreateSchema,
  newsCreateSchema,
  publicScooterNumberSchema,
} from './content.js';
import {
  CONTENT_ICONS,
  CONTENT_SECTION_KEY_PATTERN,
  CONTENT_SECTION_KEYS,
  CONTENT_SECTIONS,
  contentClientPrefix,
  contentSection,
  contentSectionsOf,
  isContentSectionKey,
  isSystemMediaKey,
  MEDIA_KEY_PATTERN,
  SYSTEM_MEDIA_KEYS,
  type ContentFieldsDefinition,
} from './sections.js';

describe('rejestr sekcji treści (ADR 0062, D1)', () => {
  it('ma sekcje strony, aplikacji i panelu z planszy `tresci-bloki` i ADR', () => {
    expect(contentSectionsOf('WEB')).toEqual([
      'web.meta',
      'web.notice',
      'web.hero',
      'web.steps',
      'web.design',
      'web.pricing',
      'web.zones',
      'web.app',
      'web.stores',
      'web.faq',
      'web.footer',
    ]);
    expect(contentSectionsOf('MOBILE')).toEqual(['mobile.start', 'mobile.rules', 'mobile.help', 'mobile.notice']);
    expect(contentSectionsOf('ADMIN')).toEqual(['admin.scooter-label']);
  });

  it('klucz zgadza się z klientem i wzorcem, a sekcja-lista ma limity i definicję elementu', () => {
    for (const key of CONTENT_SECTION_KEYS) {
      const section = contentSection(key);
      expect(key).toMatch(CONTENT_SECTION_KEY_PATTERN);
      expect(key.startsWith(contentClientPrefix(section.client))).toBe(true);
      if (section.kind === 'list') {
        expect(section.item).toBeDefined();
        expect(section.items!.min).toBeGreaterThanOrEqual(1);
        expect(section.items!.max).toBeGreaterThanOrEqual(section.items!.min);
      } else {
        expect(section.item).toBeUndefined();
        expect(section.items).toBeUndefined();
      }
      for (const fields of [section.header, section.item].filter(Boolean) as ContentFieldsDefinition[]) {
        if (fields.body) expect(MARKDOWN_PROFILES).toContain(fields.body.profile);
        if (fields.title) expect(fields.title.max).toBeGreaterThan(0);
      }
    }
  });

  it('sekcje wymagane, limity list i grafika hero z planszy', () => {
    expect(CONTENT_SECTION_KEYS.filter((key) => contentSection(key).required)).toEqual(['web.hero', 'mobile.start']);
    expect(CONTENT_SECTIONS['web.steps'].items).toEqual({ min: 3, max: 4 });
    expect(CONTENT_SECTIONS['web.zones'].items).toEqual({ min: 3, max: 3 });
    expect(CONTENT_SECTIONS['web.stores'].items).toEqual({ min: 1, max: 2 });
    expect(CONTENT_SECTIONS['mobile.rules'].items).toEqual({ min: 3, max: 6 });
    expect(CONTENT_SECTIONS['mobile.rules'].item.icon).toEqual({ required: true });
    expect(CONTENT_SECTIONS['web.hero'].header).toMatchObject({
      title: { max: 60 },
      body: { max: 240, profile: 'inline' },
      media: { required: true, minWidth: 760 },
    });
    expect(CONTENT_SECTIONS['mobile.rules'].item).toMatchObject({ title: { max: 40 }, body: { max: 140 } });
    expect(CONTENT_SECTIONS['mobile.help'].header.body.profile).toBe('faq');
    expect(isContentSectionKey('web.hero')).toBe(true);
    expect(isContentSectionKey('web.unknown')).toBe(false);
    expect(isContentSectionKey('toString')).toBe(false);
  });

  it('ikony i klucze systemowe: zamknięte listy bez powtórzeń', () => {
    expect(CONTENT_ICONS).toHaveLength(12);
    expect(new Set(CONTENT_ICONS).size).toBe(CONTENT_ICONS.length);
    for (const icon of CONTENT_ICONS) expect(icon).toMatch(/^[a-z]+(-[a-z]+)*$/);
    for (const key of SYSTEM_MEDIA_KEYS) {
      expect(key).toMatch(MEDIA_KEY_PATTERN);
      expect(key.startsWith('scooter.')).toBe(true);
      expect(isSystemMediaKey(key)).toBe(true);
    }
    expect(isSystemMediaKey('aktualnosc-kampus')).toBe(false);
    expect(isSystemMediaKey('scooter.kobalt.bok')).toBe(true);
  });
});

describe('schematy żądań treści', () => {
  const block = { status: 'PUBLISHED' as const };

  it('zapis sekcji: puste teksty jako `null`, kolejność elementów z tablicy, nieznana ikona odrzucona', () => {
    const parsed = contentSectionSaveSchema.parse({
      version: 3,
      header: { ...block, title: '  Zanim ruszysz ', bodyMd: '   ', buttonLabel: '' },
      items: [{ ...block, id: '00000000-0000-4000-8000-000000000001', title: 'Kask', icon: 'helmet' }, block],
    });
    expect(parsed.header).toEqual({
      title: 'Zanim ruszysz',
      bodyMd: null,
      mediaId: null,
      buttonLabel: null,
      buttonHref: null,
      icon: null,
      status: 'PUBLISHED',
    });
    expect(parsed.items.map((item) => item.id ?? null)).toEqual(['00000000-0000-4000-8000-000000000001', null]);
    expect(parsed.restoredFrom).toBeNull();
    expect(contentSectionSaveSchema.safeParse({ version: 1, header: { ...block, icon: 'rocket' } }).success).toBe(
      false,
    );
    expect(contentSectionSaveSchema.safeParse({ version: 0, header: block }).success).toBe(false);
    expect(contentSectionKeyParamSchema.safeParse('web.hero').success).toBe(true);
    expect(contentSectionKeyParamSchema.safeParse('web.Hero').success).toBe(false);
    expect(contentSectionKeyParamSchema.safeParse('panel.hero').success).toBe(false);
  });

  it('FAQ: pytanie widoczne co najmniej w jednym miejscu, odpowiedź niepusta', () => {
    const base = { category: 'Przejazd', question: 'Gdzie zostawić hulajnogę?', answerMd: 'W strefie.' };
    expect(faqItemCreateSchema.parse(base)).toMatchObject({ showOnWeb: true, showInApp: true, status: 'DRAFT' });
    expect(faqItemCreateSchema.safeParse({ ...base, showOnWeb: false, showInApp: false }).success).toBe(false);
    expect(faqItemCreateSchema.safeParse({ ...base, answerMd: '  ' }).success).toBe(false);
    expect(faqItemCreateSchema.safeParse({ ...base, question: 'x'.repeat(121) }).success).toBe(false);
  });

  it('aktualność: zajawka wymagana, daty z przesunięciem strefy, slug bez polskich znaków', () => {
    const base = { title: 'Ruszamy', lead: 'Od dziś w Rybniku.', bodyMd: '## Co nowego' };
    expect(newsCreateSchema.parse(base)).toMatchObject({ slug: null, publishFrom: null, status: 'DRAFT' });
    expect(newsCreateSchema.safeParse({ ...base, lead: '' }).success).toBe(false);
    expect(newsCreateSchema.safeParse({ ...base, lead: 'x'.repeat(281) }).success).toBe(false);
    expect(newsCreateSchema.safeParse({ ...base, publishFrom: '2026-11-20T08:00:00+01:00' }).success).toBe(true);
    expect(newsCreateSchema.safeParse({ ...base, publishFrom: '20.11.2026' }).success).toBe(false);
    expect(newsCreateSchema.safeParse({ ...base, slug: 'zmiany-w-cenniku' }).success).toBe(true);
    expect(newsCreateSchema.safeParse({ ...base, slug: 'zmiany-w-cenniku-łódź' }).success).toBe(false);
  });

  it('grafika: klucz z wzorca, tekst alternatywny 3–250 znaków', () => {
    const base = {
      fileId: '00000000-0000-4000-8000-000000000001',
      key: 'aktualnosc-kampus-2',
      altText: 'Trzy hulajnogi',
    };
    expect(mediaCreateSchema.parse(base).caption).toBeNull();
    expect(mediaCreateSchema.safeParse({ ...base, altText: 'ab' }).success).toBe(false);
    expect(mediaCreateSchema.safeParse({ ...base, key: 'Aktualność' }).success).toBe(false);
    expect(mediaCreateSchema.safeParse({ ...base, key: 'scooter.grafit.trzy' }).success).toBe(true);
  });

  it('dane firmy: kod pocztowy, NIP z 10 cyfr, REGON 9 albo 14 cyfr, KRS opcjonalny', () => {
    expect(
      companyProfileUpdateSchema.safeParse({ version: 1, postalCode: '44-200', taxId: '6422901846' }).success,
    ).toBe(true);
    expect(companyProfileUpdateSchema.safeParse({ version: 1, postalCode: '44200' }).success).toBe(false);
    expect(companyProfileUpdateSchema.safeParse({ version: 1, taxId: '642-290-18-30' }).success).toBe(false);
    expect(companyProfileUpdateSchema.safeParse({ version: 1, regon: '12345678' }).success).toBe(false);
    expect(companyProfileUpdateSchema.safeParse({ version: 1, regon: null, krs: null }).success).toBe(true);
    expect(companyProfileUpdateSchema.safeParse({ version: 1, supportHours: 'x'.repeat(61) }).success).toBe(false);
  });

  it('numer z adresu `/h/{numer}`', () => {
    expect(publicScooterNumberSchema.safeParse('7').success).toBe(true);
    expect(publicScooterNumberSchema.safeParse('0007').success).toBe(true);
    expect(publicScooterNumberSchema.safeParse('00007').success).toBe(false);
    expect(publicScooterNumberSchema.safeParse('7a').success).toBe(false);
  });

  it('teksty startowe zasad przed jazdą mieszczą się w profilu `inline`', () => {
    for (const body of [
      'Hulajnoga jest zaprojektowana dla jednej osoby.',
      'Na chodniku jedź tylko wtedy, gdy nie ma drogi dla rowerów, i ustępuj pieszym.',
      'Płacisz za **minuty**, parkujesz w [wyznaczonych strefach](/#strefy).',
    ]) {
      expect(parseMarkdown(body, CONTENT_SECTIONS['mobile.rules'].item.body.profile).issues).toEqual([]);
    }
  });
});

describe('wydruki i eksport danych', () => {
  it('rodzaje dokumentów: naklejka bez szablonu, zlecenie z domyślnym formatem PDF', () => {
    expect(DOCUMENT_TYPES).toContain('SCOOTER_LABEL');
    expect(TEMPLATE_DOCUMENT_TYPES).not.toContain('SCOOTER_LABEL');
    expect(
      documentGenerateSchema.parse({
        documentType: 'SERVICE_PROTOCOL',
        entityId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      documentType: 'SERVICE_PROTOCOL',
      entityId: '00000000-0000-4000-8000-000000000001',
      templateId: null,
      format: 'PDF',
      params: {},
    });
  });

  it('pokoje Socket.IO operatora i klienta', () => {
    expect(staffRoom('s1')).toBe('staff:s1');
    expect(userRoom('u1')).toBe('user:u1');
  });

  const money = (grosze: number) => ({ grosze, currency: 'PLN' as const });
  const minimal: DataExportFile = {
    schemaVersion: 1,
    generatedAt: '2026-11-18T13:32:00.000Z',
    about: 'Dane konta',
    profile: {
      about: 'Profil',
      phone: '+48500100200',
      name: null,
      email: null,
      registeredAt: '2026-11-01T08:00:00.000Z',
      block: { blocked: false, reason: null, since: null },
      notificationPreferences: { reservationEnd: true, receipts: true, marketing: false },
      devices: [],
      sessions: [],
    },
    consents: { about: 'Zgody', items: [] },
    rentals: { about: 'Przejazdy', items: [] },
    wallet: { about: 'Portfel', balance: money(0), entries: [] },
    payments: { about: 'Płatności', items: [] },
    refunds: { about: 'Zwroty', items: [] },
    receipts: { about: 'Paragony', items: [] },
    tickets: { about: 'Zgłoszenia', items: [] },
    photos: { about: 'Zdjęcia', items: [] },
    notifications: { about: 'Powiadomienia', items: [] },
  };

  it('plik eksportu ma wszystkie sekcje i odrzuca pola spoza schematu (np. token)', () => {
    expect(dataExportSchema.parse(minimal)).toEqual(minimal);
    expect(Object.keys(minimal).filter((key) => (DATA_EXPORT_SECTIONS as readonly string[]).includes(key))).toEqual([
      ...DATA_EXPORT_SECTIONS,
    ]);
    expect(dataExportSchema.safeParse({ ...minimal, profile: { ...minimal.profile, tokenHash: 'x' } }).success).toBe(
      false,
    );
    expect(dataExportSchema.safeParse({ ...minimal, wallet: { ...minimal.wallet, balance: 0 } }).success).toBe(false);
    expect(dataExportSchema.safeParse({ ...minimal, generatedAt: '2026-11-18 13:32' }).success).toBe(false);
  });
});
