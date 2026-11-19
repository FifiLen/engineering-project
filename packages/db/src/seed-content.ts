import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { SeedFileStorage, SeedMediaFile, SeedTemplateFile } from './seed-assets.js';

/**
 * Dane startowe treści i wydruków (iteracja 7, ADR 0062–0068): sekcje strony i aplikacji z rejestru, FAQ
 * z kategoriami, aktualności, grafiki biblioteki i szablony startowe DOCX. Teksty z makiet `14-strona`,
 * `28-panel-tresci`, `30-strona-tresci` i `31-mobile-tresci` oraz z dotychczasowych plików tłumaczeń; wartości
 * biznesowe zostają w nawiasach jak na makietach. Istniejących treści seed nie zmienia (zmienia je panel), a każdy
 * wstawiony wpis ma wpis systemu w dzienniku audytu, więc historia zaczyna się od „Dane startowe” (ADR 0062).
 */

type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface SeedContentBlock {
  title?: string | null;
  bodyMd?: string | null;
  /** Klucz grafiki z biblioteki (`media_assets.key`). */
  media?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  icon?: string | null;
  status?: Status;
}

export interface SeedContentSection {
  /** Klucz sekcji z rejestru `CONTENT_SECTIONS` w packages/shared. */
  key: string;
  client: 'WEB' | 'MOBILE' | 'ADMIN';
  /** Blok pojedynczy albo nagłówek sekcji-listy (pozycja 0). */
  block: SeedContentBlock;
  /** Elementy sekcji-listy (pozycje od 1). */
  items?: readonly SeedContentBlock[];
}

/**
 * Wszystkie sekcje rejestru startowego (ADR 0062). Opcjonalna `mobile.notice` nie ma treści na makietach, więc
 * dostaje pusty szkic nagłówka: każda sekcja rejestru ma w bazie nagłówek z wersją, którą zapisuje edytor sekcji.
 */
export const DEV_CONTENT_SECTIONS: readonly SeedContentSection[] = [
  {
    key: 'web.meta',
    client: 'WEB',
    block: {
      title: '[nazwa]: hulajnogi elektryczne w Rybniku',
      // Grafika Open Graph opcjonalna (co najmniej 760 px, ADR 0070).
      bodyMd: 'Znajdź hulajnogę na mapie, zeskanuj kod i ruszaj.',
    },
  },
  {
    key: 'web.notice',
    client: 'WEB',
    block: { bodyMd: 'Promocja na otwarcie: [CENA] zł za odblokowanie', status: 'ARCHIVED' },
  },
  {
    key: 'web.hero',
    client: 'WEB',
    block: {
      title: 'Hulajnoga zawsze blisko.',
      bodyMd:
        'Znajdź ją na mapie, zeskanuj kod i ruszaj. Płacisz za **minuty**, parkujesz w [wyznaczonych strefach](/#strefy).',
      media: 'scooter.grafit.trzy',
      ctaLabel: 'Pobierz aplikację',
      ctaUrl: '/#aplikacja',
    },
  },
  {
    key: 'web.steps',
    client: 'WEB',
    block: {
      title: 'Trzy kroki do jazdy.',
      bodyMd: 'Od otwarcia aplikacji do odblokowania mija mniej niż minuta. Bez kluczyków, bez kolejek.',
    },
    items: [
      {
        title: 'Znajdź na mapie',
        bodyMd:
          'Aplikacja pokaże najbliższe hulajnogi, poziom baterii i zasięg. Jeśli potrzebujesz chwili, zarezerwuj ją bezpłatnie.',
      },
      {
        title: 'Zeskanuj i ruszaj',
        bodyMd:
          'Zeskanuj kod QR na kierownicy. Hulajnoga odblokuje się w kilka sekund, a opłata naliczy się dopiero od tego momentu.',
      },
      {
        title: 'Zaparkuj w strefie',
        bodyMd:
          'Zakończ jazdę w strefie parkowania zaznaczonej na mapie i zrób zdjęcie. Podsumowanie przejazdu od razu trafi do aplikacji.',
      },
    ],
  },
  {
    key: 'web.design',
    client: 'WEB',
    block: {
      title: 'Zaprojektowana do miasta.',
      bodyMd:
        'Szerokie koła na krawężniki i kostkę, hamulce z przodu i z tyłu oraz światła, które włączają się same po odblokowaniu.',
      media: 'scooter.grafit.bok',
    },
  },
  {
    key: 'web.pricing',
    client: 'WEB',
    block: { title: 'Płacisz tylko za jazdę.', bodyMd: 'Bez abonamentu i bez ukrytych opłat.' },
  },
  {
    key: 'web.zones',
    client: 'WEB',
    block: { title: 'Jeździsz bezpiecznie. Parkujesz porządnie.' },
    items: [
      {
        title: 'Strefy parkowania',
        bodyMd: 'Tylko tu zakończysz jazdę, więc chodniki zostają wolne.',
        icon: 'parking',
      },
      {
        title: 'Strefy wolnej jazdy',
        bodyMd: 'W miejscach z dużym ruchem pieszych hulajnoga sama zwolni.',
        icon: 'zone-slow',
      },
      {
        title: 'Strefy zakazu',
        bodyMd: 'W parkach i na deptakach jazda jest wyłączona. Hulajnoga łagodnie się zatrzyma.',
        icon: 'zone-no-ride',
      },
    ],
  },
  {
    key: 'web.app',
    client: 'WEB',
    block: {
      title: 'Cała hulajnoga w jednej aplikacji.',
      bodyMd:
        'Mapa na żywo, rezerwacja, portfel, historia przejazdów i zgłaszanie usterek. Działa na iOS i Androidzie.',
    },
  },
  {
    key: 'web.stores',
    client: 'WEB',
    // Nagłówek bez pól (rejestr), a adresy sklepów ogólne do czasu publikacji aplikacji (wartości deweloperskie).
    block: {},
    items: [
      { title: 'App Store', ctaLabel: 'Pobierz z App Store', ctaUrl: 'https://apps.apple.com/' },
      { title: 'Google Play', ctaLabel: 'Pobierz z Google Play', ctaUrl: 'https://play.google.com/store/apps' },
    ],
  },
  { key: 'web.faq', client: 'WEB', block: { title: 'Pytania i odpowiedzi.' } },
  { key: 'web.footer', client: 'WEB', block: { bodyMd: 'Elektryczne hulajnogi na minuty. Projekt inżynierski.' } },
  {
    key: 'mobile.start',
    client: 'MOBILE',
    block: {
      title: 'Hulajnoga zawsze blisko.',
      bodyMd: 'Znajdź ją na mapie, zeskanuj kod i ruszaj.',
      media: 'scooter.grafit.trzy',
    },
  },
  {
    key: 'mobile.rules',
    client: 'MOBILE',
    block: { title: 'Zanim ruszysz', bodyMd: 'Cztery zasady, które chronią Ciebie i innych na drodze.' },
    items: [
      {
        title: 'Jedna osoba na hulajnodze',
        bodyMd: 'Hulajnoga jest zaprojektowana dla jednej osoby.',
        icon: 'rider-single',
      },
      {
        title: 'Droga dla rowerów, jeśli jest',
        bodyMd: 'Na chodniku jedź tylko wtedy, gdy nie ma drogi dla rowerów, i ustępuj pieszym.',
        icon: 'bike-lane',
      },
      {
        title: 'Parkuj w strefach',
        bodyMd: 'Strefy parkowania są zaznaczone na mapie. Poza nimi nie zakończysz jazdy.',
        icon: 'parking',
      },
      {
        title: 'Załóż kask',
        bodyMd: 'Nie jest obowiązkowy, ale znacząco zmniejsza ryzyko urazów.',
        icon: 'helmet',
      },
      {
        title: 'Jedź trzeźwo',
        bodyMd: 'Po alkoholu nie prowadź hulajnogi. Wróć do niej, gdy będziesz gotowy.',
        icon: 'no-alcohol',
        status: 'DRAFT',
      },
    ],
  },
  {
    key: 'mobile.help',
    client: 'MOBILE',
    block: { title: 'Pomoc', bodyMd: 'Odpowiedzi na częste pytania i kontakt z naszym zespołem.' },
  },
  { key: 'mobile.notice', client: 'MOBILE', block: { status: 'DRAFT' } },
  {
    key: 'admin.scooter-label',
    client: 'ADMIN',
    block: { title: 'hulajnoga', bodyMd: 'Zeskanuj w aplikacji albo aparatem' },
  },
];

export interface SeedFaqItem {
  question: string;
  answerMd: string;
  status?: Status;
  web?: boolean;
  app?: boolean;
}

/** Kategorie z kolejnością i pytania z makiet `tresci-faq`, `14-strona` i `31-mobile-tresci/pomoc`. */
export const DEV_FAQ: readonly { category: string; items: readonly SeedFaqItem[] }[] = [
  {
    category: 'Zanim pojedziesz',
    items: [
      { question: 'Czy muszę mieć prawo jazdy?', answerMd: 'Nie. Wystarczy konto w aplikacji i ukończone [WIEK] lat.' },
      {
        question: 'Ile lat trzeba mieć, żeby jeździć?',
        answerMd: 'Musisz mieć ukończone [WIEK] lat. Wiek potwierdzasz przy zakładaniu konta.',
      },
      {
        question: 'Czy mogę jechać we dwoje?',
        answerMd: 'Nie. Hulajnoga jest zaprojektowana dla jednej osoby i tak przewidują przepisy.',
      },
    ],
  },
  {
    category: 'Przejazd',
    items: [
      {
        question: 'Jak zarezerwować hulajnogę?',
        answerMd:
          'Wybierz hulajnogę na mapie i stuknij **Zarezerwuj**. Przez pierwsze [CZAS] min rezerwacja jest bezpłatna.',
        web: false,
      },
      {
        question: 'Gdzie mogę zostawić hulajnogę?',
        answerMd: 'Tylko w strefie parkowania zaznaczonej na mapie literą **P**. Poza strefą nie zakończysz przejazdu.',
      },
      {
        question: 'Co, jeśli rozładuje się bateria w trakcie jazdy?',
        answerMd:
          'Przy [PRÓG]% aplikacja ostrzeże Cię i pokaże najbliższą strefę parkowania. Gdy bateria się wyczerpie, hulajnoga zwolni i zatrzyma się łagodnie.',
        status: 'DRAFT',
      },
      {
        question: 'Co, jeśli hulajnoga jest uszkodzona?',
        answerMd: 'Zakończ przejazd w najbliższej strefie parkowania i zgłoś problem w aplikacji.',
      },
      {
        question: 'Co, jeśli hulajnoga się nie odblokuje?',
        answerMd: 'Sprawdź połączenie z internetem i spróbuj jeszcze raz. Jeśli nadal nie działa, zadzwoń do pomocy.',
        web: false,
      },
      {
        question: 'Dlaczego nie mogę zakończyć przejazdu?',
        answerMd: 'Przejazd zakończysz tylko w strefie parkowania. Sprawdź na mapie, czy hulajnoga stoi w strefie.',
      },
    ],
  },
  {
    category: 'Płatności',
    items: [
      {
        question: 'Jak płacę za przejazd?',
        answerMd:
          'Z portfela w aplikacji albo kartą zapisaną w aplikacji. Opłata naliczy się po zakończeniu przejazdu.',
      },
      {
        question: 'Jak doładować portfel?',
        answerMd: 'W aplikacji wybierz **Portfel**, potem **Doładuj**, i zapłać kartą.',
        web: false,
      },
      {
        question: 'Gdzie znajdę paragon?',
        answerMd: 'Potwierdzenie sprzedaży każdego przejazdu jest w portfelu, w historii operacji.',
        web: false,
      },
      {
        question: 'Kiedy dostanę zwrot?',
        answerMd: 'Zwrot do portfela jest od razu, a zwrot na kartę trwa zwykle kilka dni roboczych.',
      },
      {
        question: 'Ile kosztuje rezerwacja?',
        answerMd: 'Przez pierwsze [CZAS] min rezerwacja jest bezpłatna.',
        status: 'ARCHIVED',
      },
    ],
  },
  {
    category: 'Konto',
    items: [
      {
        question: 'Jak zmienić numer telefonu?',
        answerMd: 'Numerem telefonu logujesz się kodem SMS, więc nie zmienisz go w aplikacji. Napisz do pomocy.',
      },
      {
        question: 'Jak usunąć konto?',
        answerMd:
          'W aplikacji wybierz **Profil**, potem **Ustawienia** i **Usuń konto**. Saldo portfela musi wynosić 0 zł.',
      },
    ],
  },
];

export interface SeedNews {
  slug: string;
  title: string;
  lead: string;
  bodyMd: string;
  media?: string | null;
  /** Przesunięcie daty „od” względem chwili seedu w dniach (ujemne: w przeszłości, dodatnie: zaplanowana). */
  publishFromDays: number;
  status: Status;
}

/** Dwie opublikowane aktualności i jedna zaplanowana (lista w panelu pokazuje stany z dat). */
export const DEV_NEWS: readonly SeedNews[] = [
  {
    slug: 'ruszamy-w-rybniku',
    title: 'Ruszamy w Rybniku',
    lead: 'Hulajnogi [nazwa] są już na ulicach Rybnika. Znajdziesz je w strefach parkowania w centrum.',
    bodyMd: [
      'Od dziś wypożyczysz hulajnogę [nazwa] w aplikacji. Wystarczy konto, portfel albo karta i kilka sekund na odblokowanie.',
      '',
      '## Jak zacząć',
      '',
      '- pobierz aplikację i załóż konto numerem telefonu,',
      '- znajdź na mapie najbliższą hulajnogę,',
      '- zeskanuj kod QR na kierownicy i ruszaj.',
      '',
      'Zasady jazdy i parkowania znajdziesz w [regulaminie](/regulamin).',
    ].join('\n'),
    media: 'scooter.kobalt.trzy',
    publishFromDays: -17,
    status: 'PUBLISHED',
  },
  {
    slug: 'park-sarkandra-bez-hulajnog',
    title: 'Park im. św. Jana Sarkandra bez hulajnóg',
    lead: 'W parku jazda jest wyłączona. Hulajnoga łagodnie się zatrzyma.',
    bodyMd: [
      'Park im. św. Jana Sarkandra jest strefą zakazu jazdy. Gdy wjedziesz do parku, hulajnoga zwolni i łagodnie się zatrzyma.',
      '',
      'Strefę zakazu zobaczysz na mapie w aplikacji. Hulajnogę zostaw w najbliższej strefie parkowania i przejdź przez park pieszo.',
    ].join('\n'),
    publishFromDays: -6,
    status: 'PUBLISHED',
  },
  {
    slug: 'jezdzimy-do-pierwszego-sniegu',
    title: 'Jeździmy do pierwszego śniegu',
    lead: 'Hulajnogi zostają na ulicach, dopóki pogoda pozwala bezpiecznie jeździć.',
    bodyMd: [
      'Przy śniegu i oblodzeniu hulajnogi zjadą do serwisu. O przerwie i powrocie hulajnóg napiszemy w aktualnościach.',
      '',
      'Zimą jedź **wolniej** i hamuj wcześniej niż zwykle.',
    ].join('\n'),
    publishFromDays: 3,
    status: 'PUBLISHED',
  },
];

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Klucz obiektu `{cel}/{rrrr}/{mm}/{uuid}.{rozszerzenie}` jak `fileStorageKey` w core (czas UTC). */
function storageKey(purpose: string, id: string, extension: string, at = new Date()): string {
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${purpose}/${at.getUTCFullYear()}/${month}/${id}.${extension}`;
}

const systemAudit = (client: PoolClient, action: string, entityType: string, entityId: string | null, data: object) =>
  client.query(
    `INSERT INTO audit_log (actor, staff_id, action, entity_type, entity_id, data) VALUES ('SYSTEM', NULL, $1, $2, $3, $4)`,
    [action, entityType, entityId, JSON.stringify({ ...data, source: 'seed' })],
  );

async function mediaIds(client: PoolClient): Promise<Map<string, string>> {
  const rows = await client.query<{ key: string; id: string }>('SELECT key, id FROM media_assets');
  return new Map(rows.rows.map((r) => [r.key, r.id]));
}

/** Grafiki biblioteki: nowa grafika to obiekt w magazynie, wiersz `files` (MEDIA z wymiarami) i `media_assets`. */
async function seedMedia(client: PoolClient, storage: SeedFileStorage, media: readonly SeedMediaFile[]): Promise<void> {
  const existing = await mediaIds(client);
  for (const item of media) {
    if (existing.has(item.key)) continue;
    const fileId = randomUUID();
    const key = storageKey('media', fileId, 'png');
    await storage.put(key, item.bytes, item.contentType);
    await client.query(
      `INSERT INTO files (id, storage_key, purpose, content_type, size_bytes, sha256, width, height, original_name)
       VALUES ($1, $2, 'MEDIA', $3, $4, $5, $6, $7, $8)`,
      [fileId, key, item.contentType, item.bytes.length, item.sha256, item.width, item.height, item.name],
    );
    const row = await client.query<{ id: string }>(
      `INSERT INTO media_assets (key, name, file_id, alt_text, caption, is_system) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [item.key, item.name, fileId, item.altText, item.caption, item.key.startsWith('scooter.')],
    );
    await systemAudit(client, 'media_asset.created', 'media_asset', row.rows[0]!.id, {
      before: null,
      after: { key: item.key, name: item.name, altText: item.altText, caption: item.caption, fileId },
      version: [null, 1],
    });
  }
  // Zdjęcie modelu podstawowego (strona `/h/{numer}` i „Zaprojektowana do miasta”), jeśli operator go nie wybrał.
  await client.query(
    `UPDATE scooter_models SET photo_media_id = (SELECT id FROM media_assets WHERE key = 'scooter.grafit.trzy'),
            updated_at = now(), version = version + 1
     WHERE code = 'BASE' AND photo_media_id IS NULL AND EXISTS (SELECT 1 FROM media_assets WHERE key = 'scooter.grafit.trzy')`,
  );
}

/** Sekcja, której jeszcze nie ma (żadnego bloku z tym kluczem), dostaje nagłówek i elementy. */
async function seedSections(client: PoolClient): Promise<void> {
  const media = await mediaIds(client);
  for (const section of DEV_CONTENT_SECTIONS) {
    const exists = await client.query('SELECT 1 FROM content_blocks WHERE key = $1 LIMIT 1', [section.key]);
    if (exists.rowCount) continue;
    const blocks = [section.block, ...(section.items ?? [])];
    for (const [position, block] of blocks.entries()) {
      const after = {
        key: section.key,
        client: section.client,
        position,
        title: block.title ?? null,
        bodyMd: block.bodyMd ?? null,
        icon: block.icon ?? null,
        mediaId: (block.media && media.get(block.media)) ?? null,
        ctaLabel: block.ctaLabel ?? null,
        ctaUrl: block.ctaUrl ?? null,
        status: block.status ?? 'PUBLISHED',
      };
      const row = await client.query<{ id: string }>(
        `INSERT INTO content_blocks (key, client, position, title, body_md, icon, media_id, cta_label, cta_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          after.key,
          after.client,
          after.position,
          after.title,
          after.bodyMd,
          after.icon,
          after.mediaId,
          after.ctaLabel,
          after.ctaUrl,
          after.status,
        ],
      );
      await systemAudit(client, 'content_block.created', 'content_block', row.rows[0]!.id, {
        before: null,
        after,
        version: [null, 1],
      });
    }
  }
}

/** FAQ tylko w bazie bez pytań (kolejność i treść prowadzi potem panel). */
async function seedFaq(client: PoolClient): Promise<void> {
  if ((await client.query('SELECT 1 FROM faq_items LIMIT 1')).rowCount) return;
  for (const [categoryIndex, group] of DEV_FAQ.entries()) {
    await client.query(
      `INSERT INTO faq_categories (name, sort_order) VALUES ($1, $2) ON CONFLICT ((lower(name))) DO NOTHING`,
      [group.category, categoryIndex + 1],
    );
    const category = await client.query<{ id: string }>('SELECT id FROM faq_categories WHERE lower(name) = lower($1)', [
      group.category,
    ]);
    const categoryId = category.rows[0]!.id;
    for (const [index, item] of group.items.entries()) {
      const after = {
        categoryId,
        question: item.question,
        answerMd: item.answerMd,
        sortOrder: index + 1,
        status: item.status ?? 'PUBLISHED',
        showOnWeb: item.web ?? true,
        showInApp: item.app ?? true,
      };
      const row = await client.query<{ id: string }>(
        `INSERT INTO faq_items (category_id, question, answer_md, sort_order, status, show_on_web, show_in_app)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [categoryId, after.question, after.answerMd, after.sortOrder, after.status, after.showOnWeb, after.showInApp],
      );
      await systemAudit(client, 'faq_item.created', 'faq_item', row.rows[0]!.id, {
        before: null,
        after,
        version: [null, 1],
      });
    }
  }
}

/** Aktualności po adresie (slug): istniejąca zostaje bez zmian. */
async function seedNews(client: PoolClient): Promise<void> {
  const media = await mediaIds(client);
  for (const news of DEV_NEWS) {
    const publishFrom = new Date(Date.now() + news.publishFromDays * 24 * 3600_000);
    publishFrom.setUTCMinutes(0, 0, 0);
    const mediaId = (news.media && media.get(news.media)) ?? null;
    const row = await client.query<{ id: string }>(
      `INSERT INTO news (slug, title, lead, body_md, media_id, status, publish_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [news.slug, news.title, news.lead, news.bodyMd, mediaId, news.status, publishFrom],
    );
    if (!row.rows[0]) continue;
    await systemAudit(client, 'news.created', 'news', row.rows[0].id, {
      before: null,
      after: {
        slug: news.slug,
        title: news.title,
        lead: news.lead,
        bodyMd: news.bodyMd,
        mediaId,
        status: news.status,
        publishFrom: publishFrom.toISOString(),
        publishTo: null,
      },
      version: [null, 1],
    });
  }
}

/** Dane firmy wstawia migracja 0011; seed dopisuje tylko pierwszy wpis historii. */
async function seedCompanyHistory(client: PoolClient): Promise<void> {
  const logged = await client.query(`SELECT 1 FROM audit_log WHERE entity_type = 'company_profile' LIMIT 1`);
  if (logged.rowCount) return;
  const row = await client.query<Record<string, unknown>>(
    `SELECT name, street, postal_code AS "postalCode", city, tax_id AS "taxId", support_email AS "supportEmail",
            support_phone AS "supportPhone", support_hours AS "supportHours", regon, krs,
            registry_court AS "registryCourt", share_capital_grosze AS "shareCapitalGrosze", version
     FROM company_profile`,
  );
  if (!row.rows[0]) return;
  const { version, ...after } = row.rows[0];
  await systemAudit(client, 'company_profile.created', 'company_profile', null, {
    before: null,
    after,
    version: [null, version],
  });
}

/**
 * Szablony startowe (D4): plik w magazynie (DOCUMENT_TEMPLATE), szablon, wersja 1 aktywowana procedurą
 * i szablon domyślny rodzaju, jeśli rodzaj go jeszcze nie ma. Systemowa lista pól nie jest szablonem rodzaju.
 * Istniejący szablon startowy (ta sama nazwa i rodzaj) dostaje nową wersję tylko wtedy, gdy jego aktywna wersja
 * pochodzi z danych startowych (`uploaded_by IS NULL`), a plik w repozytorium ma inną sumę SHA-256; wersji wgranej
 * przez operatora seed nie zastępuje.
 */
async function seedTemplates(
  client: PoolClient,
  storage: SeedFileStorage,
  templates: readonly SeedTemplateFile[],
): Promise<void> {
  for (const template of templates) {
    if (!template.documentType) continue;
    const existing = await client.query<{
      id: string;
      versionId: string | null;
      versionNo: number | null;
      uploadedBy: string | null;
      sha256: string | null;
      lastNo: number;
    }>(
      `SELECT t.id, v.id AS "versionId", v.version_no AS "versionNo", v.uploaded_by AS "uploadedBy", f.sha256,
              (SELECT max(version_no) FROM document_template_versions WHERE template_id = t.id) AS "lastNo"
       FROM document_templates t
       LEFT JOIN document_template_versions v ON v.template_id = t.id AND v.is_active
       LEFT JOIN files f ON f.id = v.file_id
       WHERE t.document_type = $1 AND t.name = $2
       FOR UPDATE OF t`,
      [template.documentType, template.name],
    );
    const current = existing.rows[0];
    if (current) {
      const starterActive = current.versionId !== null && current.uploadedBy === null;
      if (!starterActive || current.sha256 === template.sha256) continue;
      const versionNo = current.lastNo + 1;
      const versionId = await insertTemplateVersion(
        client,
        storage,
        template,
        current.id,
        versionNo,
        'Szablon startowy zaktualizowany',
      );
      await client.query('CALL sp_document_template_activate($1, NULL)', [versionId]);
      await systemAudit(client, 'document_template.starter_updated', 'document_template', current.id, {
        documentType: template.documentType,
        name: template.name,
        versionId,
        versionNo,
        previousVersionId: current.versionId,
        previousVersionNo: current.versionNo,
        activated: true,
      });
      continue;
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO document_templates (document_type, name, description) VALUES ($1, $2, $3) RETURNING id`,
      [template.documentType, template.name, template.description],
    );
    const templateId = created.rows[0]!.id;
    const versionId = await insertTemplateVersion(client, storage, template, templateId, 1, 'Szablon startowy');
    await client.query('CALL sp_document_template_activate($1, NULL)', [versionId]);
    const hasDefault = await client.query('SELECT 1 FROM document_templates WHERE document_type = $1 AND is_default', [
      template.documentType,
    ]);
    if (!hasDefault.rowCount) await client.query('CALL sp_document_template_set_default($1)', [templateId]);
    await systemAudit(client, 'document_template.created', 'document_template', templateId, {
      documentType: template.documentType,
      name: template.name,
      versionId,
      versionNo: 1,
      activated: true,
      isDefault: !hasDefault.rowCount,
    });
  }
}

/** Plik szablonu w magazynie i wiersz `files`, potem wersja z danych startowych (`uploaded_by` NULL). */
async function insertTemplateVersion(
  client: PoolClient,
  storage: SeedFileStorage,
  template: SeedTemplateFile,
  templateId: string,
  versionNo: number,
  note: string,
): Promise<string> {
  const fileId = randomUUID();
  const key = storageKey('document-template', fileId, 'docx');
  await storage.put(key, template.bytes, DOCX_CONTENT_TYPE);
  await client.query(
    `INSERT INTO files (id, storage_key, purpose, content_type, size_bytes, sha256, original_name)
     VALUES ($1, $2, 'DOCUMENT_TEMPLATE', $3, $4, $5, $6)`,
    [fileId, key, DOCX_CONTENT_TYPE, template.bytes.length, template.sha256, template.file],
  );
  const version = await client.query<{ id: string }>(
    `INSERT INTO document_template_versions (template_id, version_no, file_id, fields, size_bytes, uncompressed_bytes, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [templateId, versionNo, fileId, template.fields, template.bytes.length, template.uncompressedBytes, note],
  );
  return version.rows[0]!.id;
}

export interface SeedContentFiles {
  storage: SeedFileStorage;
  media: readonly SeedMediaFile[];
  templates: readonly SeedTemplateFile[];
}

/** Treści i wydruki w transakcji danych startowych; bez magazynu plików bez grafik i szablonów (testy API). */
export async function seedContent(client: PoolClient, files?: SeedContentFiles): Promise<void> {
  if (files) await seedMedia(client, files.storage, files.media);
  await seedSections(client);
  await seedFaq(client);
  await seedNews(client);
  await seedCompanyHistory(client);
  if (files) await seedTemplates(client, files.storage, files.templates);
}
