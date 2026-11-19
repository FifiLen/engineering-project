import { describe, expect, it } from 'vitest';
import {
  companyAddress,
  companyProfileIssues,
  ensureCompanyProfileValid,
  isValidNip,
  isValidRegon,
  normalizeTaxId,
  sellerFromCompany,
  type CompanyProfile,
} from './company.js';
import {
  contentAuditData,
  contentBlockIssues,
  contentLength,
  contentSectionIssues,
  ensureContentDeletable,
  ensureContentTransition,
  ensureFaqCategoryDeletable,
  ensureReorder,
  ensureSectionSave,
  faqItemIssues,
  planSectionItems,
  sameFaqCategory,
  type ContentBlockDraft,
  type ContentRulesContext,
  type ContentSectionRules,
} from './content.js';
import {
  ensureNewsSlugChange,
  ensureNewsValid,
  isNewsVisible,
  newsBoundaryJobs,
  isNewsBoundaryCurrent,
  newsIssues,
  newsPublication,
  newsState,
  uniqueSlug,
} from './news.js';

/** Atrapa parsera z shared: `##` to nagłówek (błąd poza profilem `document`), `<` to HTML. */
const ctx: ContentRulesContext = {
  markdown: (source, profile) => ({
    issues: source.split('\n').flatMap((line, i) => {
      if (line.startsWith('## ') && profile !== 'document') {
        return [{ code: 'MD_NOT_ALLOWED', line: i + 1, column: 1, construct: 'heading' }];
      }
      const html = line.indexOf('<');
      return html >= 0 ? [{ code: 'MD_HTML', line: i + 1, column: html + 1, construct: 'html' }] : [];
    }),
  }),
  isAllowedHref: (href) => /^(https:\/\/|mailto:|tel:|\/(?!\/)|#)/.test(href),
  icons: ['helmet', 'parking', 'no-alcohol'],
};

const hero: ContentSectionRules = {
  client: 'WEB',
  kind: 'single',
  required: true,
  header: {
    title: { max: 60, required: true },
    body: { max: 240, required: true, profile: 'inline' },
    media: { required: true, minWidth: 1200 },
    button: { required: false, labelMax: 40 },
  },
};

const rules: ContentSectionRules = {
  client: 'MOBILE',
  kind: 'list',
  required: false,
  header: { title: { max: 60, required: true }, body: { max: 240, required: false, profile: 'inline' } },
  item: {
    title: { max: 40, required: true },
    body: { max: 140, required: true, profile: 'inline' },
    icon: { required: true },
  },
  items: { min: 3, max: 6 },
};

const block = (overrides: Partial<ContentBlockDraft> = {}): ContentBlockDraft => ({
  title: 'Hulajnoga zawsze blisko.',
  bodyMd: 'Znajdź ją na mapie.',
  mediaId: 'm-wide',
  buttonLabel: null,
  buttonHref: null,
  icon: null,
  status: 'PUBLISHED',
  ...overrides,
});
const item = (overrides: Partial<ContentBlockDraft> = {}) =>
  block({ title: 'Załóż kask', bodyMd: 'Kask zmniejsza ryzyko urazów.', mediaId: null, icon: 'helmet', ...overrides });
const widths = new Map([
  ['m-wide', 2400],
  ['m-narrow', 800],
]);

describe('treści: blok w sekcji z rejestru (ADR 0062)', () => {
  it('poprawny blok hero nie ma problemów', () => {
    expect(
      contentBlockIssues(
        hero.header,
        block({ buttonLabel: 'Pobierz aplikację', buttonHref: '/#aplikacja' }),
        ctx,
        widths,
      ),
    ).toEqual([]);
  });

  it('pola wymagane, limity w znakach i tytuł w jednym wierszu', () => {
    expect(contentBlockIssues(hero.header, block({ title: '  ', bodyMd: null, mediaId: null }), ctx, widths)).toEqual([
      { item: null, field: 'title', code: 'CONTENT_FIELD_REQUIRED' },
      { item: null, field: 'bodyMd', code: 'CONTENT_FIELD_REQUIRED' },
      { item: null, field: 'mediaId', code: 'CONTENT_FIELD_REQUIRED' },
    ]);
    expect(contentLength('Zażółć 🛴')).toBe(8);
    expect(contentBlockIssues(hero.header, block({ title: 'ż'.repeat(61) }), ctx, widths)).toEqual([
      { item: null, field: 'title', code: 'CONTENT_TOO_LONG', max: 60, length: 61 },
    ]);
    expect(contentBlockIssues(hero.header, block({ title: 'ż'.repeat(60) }), ctx, widths)).toEqual([]);
    expect(contentBlockIssues(hero.header, block({ title: 'a\nb' }), ctx, widths)).toEqual([
      { item: null, field: 'title', code: 'CONTENT_FIELD_INVALID' },
    ]);
  });

  it('Markdown w profilu sekcji: błąd z wierszem i kolumną, a za długie źródło bez parsowania', () => {
    expect(contentBlockIssues(hero.header, block({ bodyMd: 'Akapit\n\n## Nowość' }), ctx, widths)).toEqual([
      { item: null, field: 'bodyMd', code: 'MD_NOT_ALLOWED', line: 3, column: 1, construct: 'heading' },
    ]);
    expect(contentBlockIssues(hero.header, block({ bodyMd: `${'a'.repeat(240)}<b>` }), ctx, widths)).toEqual([
      { item: null, field: 'bodyMd', code: 'CONTENT_TOO_LONG', max: 240, length: 243 },
    ]);
  });

  it('grafika z biblioteki: nieistniejąca i za wąska dla hero (1200 px)', () => {
    expect(contentBlockIssues(hero.header, block({ mediaId: 'm-narrow' }), ctx, widths)).toEqual([
      { item: null, field: 'mediaId', code: 'MEDIA_TOO_NARROW', minWidth: 1200, width: 800 },
    ]);
    expect(contentBlockIssues(hero.header, block({ mediaId: 'm-missing' }), ctx, widths)).toEqual([
      { item: null, field: 'mediaId', code: 'MEDIA_NOT_FOUND' },
    ]);
  });

  it('przycisk: etykieta i adres razem, adres z białej listy', () => {
    expect(contentBlockIssues(hero.header, block({ buttonLabel: 'Pobierz' }), ctx, widths)).toEqual([
      { item: null, field: 'button', code: 'CONTENT_BUTTON_INCOMPLETE' },
    ]);
    expect(
      contentBlockIssues(
        hero.header,
        block({ buttonLabel: 'Pobierz', buttonHref: 'javascript:alert(1)' }),
        ctx,
        widths,
      ),
    ).toEqual([{ item: null, field: 'buttonHref', code: 'CONTENT_HREF_NOT_ALLOWED', href: 'javascript:alert(1)' }]);
    expect(
      contentBlockIssues(hero.header, block({ buttonLabel: 'x'.repeat(41), buttonHref: 'https://x.pl' }), ctx, widths),
    ).toEqual([{ item: null, field: 'buttonLabel', code: 'CONTENT_TOO_LONG', max: 40, length: 41 }]);
  });

  it('pole spoza definicji sekcji i ikona spoza zamkniętej listy', () => {
    expect(contentBlockIssues(hero.header, block({ icon: 'helmet' }), ctx, widths)).toEqual([
      { item: null, field: 'icon', code: 'CONTENT_FIELD_NOT_ALLOWED' },
    ]);
    expect(contentBlockIssues(rules.item!, item({ icon: 'rocket' }), ctx, widths, 2)).toEqual([
      { item: 2, field: 'icon', code: 'CONTENT_ICON_UNKNOWN' },
    ]);
    expect(contentBlockIssues(rules.item!, item({ icon: null, mediaId: 'm-wide' }), ctx, widths, 0)).toEqual([
      { item: 0, field: 'mediaId', code: 'CONTENT_FIELD_NOT_ALLOWED' },
      { item: 0, field: 'icon', code: 'CONTENT_FIELD_REQUIRED' },
    ]);
  });
});

describe('treści: sekcja-lista, stany i zapis', () => {
  const header = block({ title: 'Zanim ruszysz', bodyMd: null, mediaId: null });
  const four = [item(), item({ icon: 'parking' }), item({ icon: 'no-alcohol' }), item()];

  it('limit elementów liczy wszystkie, minimum tylko opublikowane w opublikowanej sekcji', () => {
    expect(contentSectionIssues(rules, { header, items: four }, ctx)).toEqual([]);
    expect(contentSectionIssues(rules, { header, items: [...four, item(), item(), item()] }, ctx)).toEqual([
      { item: null, field: 'items', code: 'CONTENT_ITEMS_LIMIT', min: 3, max: 6, count: 7 },
    ]);
    const drafts = [item(), item(), item({ status: 'DRAFT' }), item({ status: 'ARCHIVED' })];
    expect(contentSectionIssues(rules, { header, items: drafts }, ctx)).toEqual([
      { item: null, field: 'items', code: 'CONTENT_ITEMS_LIMIT', min: 3, max: 6, count: 2 },
    ]);
    expect(contentSectionIssues(rules, { header: { ...header, status: 'DRAFT' }, items: drafts }, ctx)).toEqual([]);
  });

  it('blok pojedynczy nie ma elementów, a problemy elementów mają indeks', () => {
    expect(contentSectionIssues(hero, { header: block(), items: [item()] }, ctx, widths)).toEqual([
      { item: null, field: 'items', code: 'CONTENT_FIELD_NOT_ALLOWED' },
    ]);
    expect(contentSectionIssues(rules, { header, items: [item(), item({ title: '' }), item()] }, ctx)).toEqual([
      { item: 1, field: 'title', code: 'CONTENT_FIELD_REQUIRED' },
    ]);
  });

  it('przejścia stanu w obie strony; sekcja wymagana zostaje opublikowana', () => {
    expect(() => ensureContentTransition('DRAFT', 'PUBLISHED')).not.toThrow();
    expect(() => ensureContentTransition('ARCHIVED', 'DRAFT')).not.toThrow();
    expect(() => ensureContentTransition('PUBLISHED', 'ARCHIVED')).not.toThrow();
    expect(() => ensureContentTransition('PUBLISHED', 'DRAFT', { required: true })).toThrow(
      expect.objectContaining({ code: 'CONTENT_SECTION_REQUIRED' }),
    );
    expect(() => ensureContentDeletable('PUBLISHED')).toThrow(
      expect.objectContaining({ code: 'CONTENT_DELETE_PUBLISHED' }),
    );
    expect(() => ensureContentDeletable('ARCHIVED')).not.toThrow();
  });

  it('zapis sekcji: blokada wersji nagłówka, sekcja wymagana i wszystkie problemy naraz', () => {
    const current = { version: 5, status: 'PUBLISHED' as const };
    expect(() =>
      ensureSectionSave(hero, { version: 5, header: block(), items: [] }, current, ctx, widths),
    ).not.toThrow();
    expect(() => ensureSectionSave(hero, { version: 4, header: block(), items: [] }, current, ctx, widths)).toThrow(
      expect.objectContaining({ code: 'CONFLICT', details: { expectedVersion: 4, currentVersion: 5 } }),
    );
    expect(() =>
      ensureSectionSave(hero, { version: 5, header: block({ status: 'ARCHIVED' }), items: [] }, current, ctx, widths),
    ).toThrow(expect.objectContaining({ code: 'CONTENT_SECTION_REQUIRED' }));
    expect(() =>
      ensureSectionSave(
        hero,
        { version: 5, header: block({ title: '', mediaId: 'm-narrow' }), items: [] },
        current,
        ctx,
        widths,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTENT_VALIDATION_FAILED',
        details: {
          issues: [
            { item: null, field: 'title', code: 'CONTENT_FIELD_REQUIRED' },
            { item: null, field: 'mediaId', code: 'MEDIA_TOO_NARROW', minWidth: 1200, width: 800 },
          ],
        },
      }),
    );
  });

  it('plan elementów: kolejność z żądania, nowe, usunięte szkice; opublikowanego nie usuwa', () => {
    const current = [
      { id: 'a', status: 'PUBLISHED' as const },
      { id: 'b', status: 'DRAFT' as const },
      { id: 'c', status: 'PUBLISHED' as const },
    ];
    expect(planSectionItems(current, [{ id: 'c' }, {}, { id: 'a' }])).toEqual({
      created: [1],
      kept: [
        { id: 'c', position: 1, index: 0 },
        { id: 'a', position: 3, index: 2 },
      ],
      deleted: ['b'],
    });
    expect(() => planSectionItems(current, [{ id: 'a' }, { id: 'b' }])).toThrow(
      expect.objectContaining({ code: 'CONTENT_DELETE_PUBLISHED' }),
    );
    expect(() => planSectionItems(current, [{ id: 'x' }])).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => planSectionItems(current, [{ id: 'a' }, { id: 'a' }, { id: 'c' }])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('jawna kolejność FAQ: ten sam zbiór i zgodne wersje', () => {
    const current = [
      { id: 'q1', version: 2 },
      { id: 'q2', version: 1 },
    ];
    expect(
      ensureReorder(current, [
        { id: 'q2', version: 1 },
        { id: 'q1', version: 2 },
      ]),
    ).toEqual(['q2', 'q1']);
    expect(() => ensureReorder(current, [{ id: 'q2', version: 1 }])).toThrow(
      expect.objectContaining({ code: 'ORDER_MISMATCH', details: { missing: ['q1'], unexpected: [] } }),
    );
    expect(() =>
      ensureReorder(current, [
        { id: 'q2', version: 1 },
        { id: 'q1', version: 1 },
      ]),
    ).toThrow(
      expect.objectContaining({ code: 'CONFLICT', details: { id: 'q1', expectedVersion: 1, currentVersion: 2 } }),
    );
  });

  it('historia: pełny stan przed i po z wersjami i wpisem przywrócenia', () => {
    expect(contentAuditData({ title: 'a' }, { title: 'b' }, { from: 4, to: 5 }, 812)).toEqual({
      before: { title: 'a' },
      after: { title: 'b' },
      version: [4, 5],
      restoredFrom: 812,
    });
    expect(contentAuditData(null, { title: 'a' }, { from: null, to: 1 })).toEqual({
      before: null,
      after: { title: 'a' },
      version: [null, 1],
    });
  });
});

describe('FAQ', () => {
  const faq = {
    category: 'Przejazd',
    question: 'Gdzie zostawić hulajnogę?',
    answerMd: 'W strefie.',
    showOnWeb: true,
    showInApp: false,
  };

  it('pytanie widoczne co najmniej w jednym kliencie, odpowiedź w profilu `faq`', () => {
    expect(faqItemIssues(faq, ctx)).toEqual([]);
    expect(faqItemIssues({ ...faq, showOnWeb: false }, ctx)).toEqual([
      { item: null, field: 'showOnWeb', code: 'FAQ_NO_CLIENT' },
    ]);
    expect(faqItemIssues({ ...faq, answerMd: '## Nagłówek' }, ctx)).toEqual([
      { item: null, field: 'answerMd', code: 'MD_NOT_ALLOWED', line: 1, column: 1, construct: 'heading' },
    ]);
    expect(faqItemIssues({ ...faq, question: 'x'.repeat(121) }, ctx)[0]).toMatchObject({
      code: 'CONTENT_TOO_LONG',
      max: 120,
    });
  });

  it('kategoria bez względu na wielkość liter i spacje; usunięcie tylko pustej', () => {
    expect(sameFaqCategory('Zanim  pojedziesz ', 'zanim pojedziesz')).toBe(true);
    expect(sameFaqCategory('Płatności', 'PŁATNOŚCI')).toBe(true);
    expect(sameFaqCategory('Konto', 'Przejazd')).toBe(false);
    expect(() => ensureFaqCategoryDeletable(1)).toThrow(expect.objectContaining({ code: 'FAQ_CATEGORY_NOT_EMPTY' }));
    expect(() => ensureFaqCategoryDeletable(0)).not.toThrow();
  });
});

describe('aktualności z planowaniem', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const hour = 60 * 60_000;
  const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * hour);

  it.each([
    ['DRAFT', null, null, 'DRAFT'],
    ['ARCHIVED', at(-5), null, 'ARCHIVED'],
    ['PUBLISHED', at(2), null, 'SCHEDULED'],
    ['PUBLISHED', at(-2), null, 'PUBLISHED'],
    ['PUBLISHED', null, null, 'PUBLISHED'],
    ['PUBLISHED', at(-48), at(-1), 'EXPIRED'],
    ['PUBLISHED', at(-48), at(0), 'EXPIRED'],
    ['PUBLISHED', at(0), at(5), 'PUBLISHED'],
  ] as const)('%s od %s do %s → %s', (status, publishFrom, publishTo, state) => {
    expect(newsState({ status, publishFrom, publishTo }, now)).toBe(state);
    expect(isNewsVisible({ status, publishFrom, publishTo }, now)).toBe(state === 'PUBLISHED');
  });

  it('„Opublikuj teraz” ustawia początek na czas zapisu; koniec przed początkiem albo w przeszłości to błąd', () => {
    expect(newsPublication({ status: 'PUBLISHED', publishFrom: null, publishTo: null }, now).publishFrom).toEqual(now);
    expect(newsPublication({ status: 'DRAFT', publishFrom: null, publishTo: null }, now).publishFrom).toBeNull();
    expect(() => newsPublication({ status: 'PUBLISHED', publishFrom: null, publishTo: at(-1) }, now)).toThrow(
      expect.objectContaining({ code: 'CONTENT_VALIDATION_FAILED' }),
    );
    expect(() => newsPublication({ status: 'PUBLISHED', publishFrom: at(5), publishTo: at(4) }, now)).toThrow(
      expect.objectContaining({ code: 'CONTENT_VALIDATION_FAILED' }),
    );
  });

  it('tytuł, wymagana zajawka do 280 znaków i treść w profilu `document`', () => {
    const news = { title: 'Ruszamy', lead: 'Od dziś w Rybniku.', bodyMd: '## Co nowego\n\nTekst' };
    expect(newsIssues(news, ctx)).toEqual([]);
    expect(newsIssues({ ...news, lead: '' }, ctx)).toEqual([
      { item: null, field: 'lead', code: 'CONTENT_FIELD_REQUIRED' },
    ]);
    expect(newsIssues({ ...news, lead: 'x'.repeat(281) }, ctx)[0]).toMatchObject({
      code: 'CONTENT_TOO_LONG',
      max: 280,
    });
    expect(newsIssues({ ...news, publishFrom: at(2), publishTo: at(1) }, ctx)).toEqual([
      { item: null, field: 'publishTo', code: 'NEWS_DATES_INVALID' },
    ]);
    expect(() => ensureNewsValid({ ...news, bodyMd: '<b>x</b>' }, ctx)).toThrow(
      expect.objectContaining({ code: 'CONTENT_VALIDATION_FAILED' }),
    );
  });

  it('adres nie zmienia się po pierwszej publikacji; kolizja dostaje przyrostek', () => {
    expect(() => ensureNewsSlugChange({ firstPublishedAt: null, currentSlug: 'a', nextSlug: 'b' })).not.toThrow();
    expect(() => ensureNewsSlugChange({ firstPublishedAt: now, currentSlug: 'a', nextSlug: 'a' })).not.toThrow();
    expect(() => ensureNewsSlugChange({ firstPublishedAt: now, currentSlug: 'a', nextSlug: 'b' })).toThrow(
      expect.objectContaining({ code: 'NEWS_SLUG_LOCKED' }),
    );
    expect(uniqueSlug('ruszamy', ['ruszamy', 'ruszamy-2'])).toBe('ruszamy-3');
    expect(uniqueSlug('ruszamy', [])).toBe('ruszamy');
  });

  it('zadania na granicach publikacji: tylko przyszłe granice opublikowanej aktualności, z kluczem singletonu', () => {
    expect(newsBoundaryJobs({ id: 'n1', status: 'PUBLISHED', publishFrom: at(2), publishTo: at(26) }, now)).toEqual([
      { boundary: 'from', startAfter: at(2), singletonKey: `news:n1:from:${at(2).toISOString()}` },
      { boundary: 'to', startAfter: at(26), singletonKey: `news:n1:to:${at(26).toISOString()}` },
    ]);
    expect(newsBoundaryJobs({ id: 'n1', status: 'PUBLISHED', publishFrom: at(-2), publishTo: null }, now)).toEqual([]);
    expect(newsBoundaryJobs({ id: 'n1', status: 'DRAFT', publishFrom: at(2), publishTo: null }, now)).toEqual([]);
  });

  it('zadanie granicy po zmianie dat, archiwizacji albo usunięciu niczego nie robi', () => {
    const news = { id: 'n1', status: 'PUBLISHED' as const, publishFrom: at(2), publishTo: at(26) };
    expect(isNewsBoundaryCurrent(news, { boundary: 'from', at: at(2) })).toBe(true);
    expect(isNewsBoundaryCurrent(news, { boundary: 'to', at: at(26) })).toBe(true);
    expect(isNewsBoundaryCurrent({ ...news, publishFrom: at(5) }, { boundary: 'from', at: at(2) })).toBe(false);
    expect(isNewsBoundaryCurrent({ ...news, publishTo: null }, { boundary: 'to', at: at(26) })).toBe(false);
    expect(isNewsBoundaryCurrent({ ...news, status: 'ARCHIVED' }, { boundary: 'from', at: at(2) })).toBe(false);
    expect(isNewsBoundaryCurrent(null, { boundary: 'from', at: at(2) })).toBe(false);
  });
});

describe('dane firmy', () => {
  const profile: CompanyProfile = {
    name: 'Hulajnogi Rybnik sp. z o.o.',
    street: 'ul. Rynek 1',
    postalCode: '44-200',
    city: 'Rybnik',
    taxId: '6422901846',
    supportEmail: 'pomoc@example.pl',
    supportPhone: '+48 32 000 00 00',
    supportHours: 'Codziennie 8:00–20:00',
    regon: null,
    krs: null,
    registryCourt: null,
    shareCapitalGrosze: null,
  };

  it.each([
    ['6422901846', true],
    ['5260250995', true],
    ['1234567890', false],
    ['6422901847', false],
    ['642290183', false],
    ['642-290-18-30', false],
  ])('NIP %s → %s', (nip, valid) => {
    expect(isValidNip(nip)).toBe(valid);
  });

  it('NIP z kreskami i przedrostkiem PL normalizuje się do cyfr', () => {
    expect(normalizeTaxId('PL 642-290-18-46')).toBe('6422901846');
  });

  it.each([
    ['123456785', true],
    ['123456786', false],
    ['12345678512347', true],
    ['12345678512348', false],
    ['12345678612347', false],
    ['1234', false],
  ])('REGON %s → %s', (regon, valid) => {
    expect(isValidRegon(regon)).toBe(valid);
  });

  it('sprawdza tylko zmienione pola, KRS wymaga sądu rejestrowego', () => {
    expect(companyProfileIssues(profile)).toEqual([]);
    const legacy = { ...profile, taxId: '[NIP]' };
    expect(companyProfileIssues({ ...legacy, supportPhone: '+48 32 111 11 11' }, legacy)).toEqual([]);
    expect(companyProfileIssues({ ...legacy, taxId: '1234567890' }, legacy)).toEqual([
      { item: null, field: 'taxId', code: 'COMPANY_TAX_ID_INVALID' },
    ]);
    expect(companyProfileIssues({ ...profile, krs: '0000123456' }, profile)).toEqual([
      { item: null, field: 'registryCourt', code: 'COMPANY_REGISTRY_INCOMPLETE' },
    ]);
    expect(
      companyProfileIssues({ ...profile, krs: '0000123456', registryCourt: 'Sąd Rejonowy w Gliwicach' }, profile),
    ).toEqual([]);
    expect(companyProfileIssues({ ...profile, krs: '123', regon: '123456786', postalCode: '44200' }, profile)).toEqual([
      { item: null, field: 'postalCode', code: 'COMPANY_POSTAL_CODE_INVALID' },
      { item: null, field: 'regon', code: 'COMPANY_REGON_INVALID' },
      { item: null, field: 'krs', code: 'COMPANY_KRS_INVALID' },
      { item: null, field: 'registryCourt', code: 'COMPANY_REGISTRY_INCOMPLETE' },
    ]);
    expect(() => ensureCompanyProfileValid({ ...profile, supportHours: ' ' }, profile)).toThrow(
      expect.objectContaining({ code: 'CONTENT_VALIDATION_FAILED' }),
    );
  });

  it('sprzedawca na paragonie z danych firmy (nazwa, adres, NIP)', () => {
    expect(companyAddress(profile)).toBe('ul. Rynek 1, 44-200 Rybnik');
    expect(sellerFromCompany(profile)).toEqual({
      name: 'Hulajnogi Rybnik sp. z o.o.',
      address: 'ul. Rynek 1, 44-200 Rybnik',
      taxId: '6422901846',
    });
  });
});
