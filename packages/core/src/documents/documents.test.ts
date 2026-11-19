import { describe, expect, it } from 'vitest';
import {
  buildDocumentData,
  COMMON_DOCUMENT_FIELDS,
  DOCUMENT_CATALOG,
  DOCUMENT_READ_PERMISSIONS,
  DOCUMENT_TEXTS_PL,
  DOCUMENT_TYPES,
  documentEntityLabel,
  documentFieldCatalog,
  documentFileName,
  documentFooter,
  documentSampleData,
  resolveDocumentParams,
  SAMPLE_COMPANY,
  shortDocumentId,
  TEMPLATE_DOCUMENT_TYPES,
  type DocumentBuildContext,
} from './catalog.js';
import {
  checkDocxContentTypes,
  DOCX_MAIN_CONTENT_TYPE,
  inspectDocxPackage,
  isTemplatedPart,
  templatePart,
  TEMPLATE_MAX_BYTES,
} from './docx-package.js';
import {
  documentDateStamp,
  documentFormatters,
  formatDocumentDate,
  formatDocumentDateTime,
  formatDocumentNumber,
} from './format.js';
import {
  canSeeCustomerData,
  dataExportKey,
  documentFilesExpired,
  ensureCanDownloadDocument,
  ensureCanPrint,
  ensureCanSetDefault,
  ensureDocumentFormat,
  ensureDocumentRetryable,
  ensureTemplateVersionDeletable,
  generatedDocumentKey,
  generatedDocumentState,
  isPrintable,
  reusableReceiptDocument,
  scooterLabelData,
  selectTemplate,
  shouldRunDocumentJob,
  isJobClaimable,
  isJobAbandoned,
  DOCUMENT_JOB_EXPIRE_MS,
  DOCUMENT_JOB_ABANDONED_MS,
  documentHasCustomerFields,
  documentShowsCustomerData,
  templateVersionState,
  visibleDocumentTypes,
  type ExistingReceiptDocument,
} from './prints.js';
import { isRetryableRenderError, renderErrorCode } from './renderer.js';
import type { TemplateData } from './renderer.js';
import {
  editDistance,
  lexTemplateText,
  loopFieldPath,
  parseFieldPath,
  readFieldPath,
  suggestField,
  validateTemplateTags,
  type TemplateFieldCatalog,
} from './tags.js';

/** Kwoty jak `formatPln` z shared (`Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' })`). */
const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const format = documentFormatters((grosze) => pln.format(grosze / 100));
const nbsp = (text: string) => text.replace(/ /g, ' ');

describe('formatowanie wartości wydruku', () => {
  it('daty w strefie Europe/Warsaw (zima UTC+1, lato UTC+2)', () => {
    expect(formatDocumentDateTime(new Date('2026-11-18T13:05:00Z'))).toBe('18.11.2026, 14:05');
    expect(formatDocumentDateTime(new Date('2026-07-01T22:30:00Z'))).toBe('02.07.2026, 00:30');
    expect(formatDocumentDate(new Date('2026-12-31T23:30:00Z'))).toBe('01.01.2027');
    expect(documentDateStamp(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19');
  });

  it('liczby z polskim separatorem i kwoty z formatera z shared', () => {
    expect(formatDocumentNumber(4.2, 1)).toBe('4,2');
    expect(formatDocumentNumber(23)).toBe('23');
    expect(format.money(1250)).toBe(nbsp('12,50 zł'));
    expect(format.money(-1250)).toBe(nbsp('-12,50 zł'));
  });
});

describe('znaczniki szablonu: ścieżki i lekser (ADR 0067)', () => {
  it('ścieżki z kropką bez wyrażeń, spacji i filtrów', () => {
    expect(parseFieldPath('customer.name')).toEqual(['customer', 'name']);
    expect(parseFieldPath('isCorrection')).toEqual(['isCorrection']);
    for (const tag of [
      'customer name',
      ' name',
      'name | upper',
      'a+b',
      'Customer.name',
      'a..b',
      'a.',
      '',
      'items[0]',
      '$x',
    ]) {
      expect(parseFieldPath(tag)).toBeNull();
    }
  });

  it('odczyt ścieżki tylko z własnych pól obiektów', () => {
    const scope = { customer: { name: 'Anna' }, list: [{ a: 1 }] };
    expect(readFieldPath(scope, ['customer', 'name'])).toBe('Anna');
    expect(readFieldPath(scope, ['customer', 'missing'])).toBeUndefined();
    expect(readFieldPath(scope, ['constructor', 'name'])).toBeUndefined();
    expect(readFieldPath(scope, ['customer', 'toString'])).toBeUndefined();
    expect(readFieldPath(scope, ['list', 'length'])).toBeUndefined();
    expect(readFieldPath(scope, [])).toBe(scope);
  });

  it('lekser buduje strukturę pętli z miejscem znaczników', () => {
    const text = 'Paragon {receipt.number}{#items}{description} {amount}{/items}{^isCorrection}Sprzedaż{/}';
    const { tags, issues } = lexTemplateText(text);
    expect(issues).toEqual([]);
    expect(tags.map((t) => [t.kind, t.value, t.offset])).toEqual([
      ['field', 'receipt.number', 8],
      ['loop', 'items', 24],
      ['inverted', 'isCorrection', 62],
    ]);
    expect(tags[1]!.children.map((t) => t.value)).toEqual(['description', 'amount']);
  });

  it('błędy składni: niezamknięty znacznik, `}` bez otwarcia, pętle bez zamknięcia i z innym zamknięciem', () => {
    expect(lexTemplateText('a {name b').issues).toEqual([
      { code: 'TEMPLATE_TAG_UNCLOSED', tag: '{name b', file: 'word/document.xml', offset: 2 },
    ]);
    expect(lexTemplateText('a {x {y}').issues.map((i) => i.code)).toEqual(['TEMPLATE_TAG_UNCLOSED']);
    expect(lexTemplateText('cena } zł').issues).toEqual([
      { code: 'TEMPLATE_TAG_UNOPENED', tag: '}', file: 'word/document.xml', offset: 5 },
    ]);
    expect(lexTemplateText('{#parts}{name}', 'word/header1.xml').issues).toEqual([
      { code: 'TEMPLATE_LOOP_UNCLOSED', tag: '{#parts}', file: 'word/header1.xml', offset: 0 },
    ]);
    expect(lexTemplateText('{/parts}').issues.map((i) => i.code)).toEqual(['TEMPLATE_LOOP_UNOPENED']);
    expect(lexTemplateText('{#a}{#b}{/a}{/b}{/a}').issues).toEqual([
      { code: 'TEMPLATE_LOOP_MISMATCH', tag: '{/a}', file: 'word/document.xml', offset: 8, loop: 'b' },
    ]);
    expect(lexTemplateText('{=[[ ]]=}').tags[0]).toMatchObject({ kind: 'delimiters', value: '[[ ]]' });
  });
});

describe('znaczniki względem katalogu pól', () => {
  const catalog: TemplateFieldCatalog = {
    fields: [
      { path: 'task.number', label: 'Numer', type: 'text', example: 'S-1' },
      { path: 'customer.name', label: 'Klient', type: 'text', example: 'A', customer: true },
      { path: 'hasParts', label: 'Części', type: 'boolean', example: 'true' },
      { path: 'scooter.odometerKm', label: 'Przebieg', type: 'text', example: '1' },
      { path: 'document.footer', label: 'Stopka', type: 'text', example: '', common: true },
    ],
    loops: [
      {
        path: 'parts',
        label: 'Części',
        fields: [
          { path: 'name', label: 'Nazwa', type: 'text', example: 'x' },
          { path: 'sku', label: 'SKU', type: 'text', example: 'x' },
          { path: 'quantity', label: 'Ilość', type: 'text', example: '1' },
          { path: 'unitPrice', label: 'Cena', type: 'text', example: '1' },
          { path: 'cost', label: 'Koszt', type: 'text', example: '1' },
        ],
      },
    ],
  };
  const validate = (text: string) => validateTemplateTags(lexTemplateText(text).tags, catalog);

  it('poprawny szablon: użyte pola, pola pętli jako `parts[].cost`, nieużyte pola jako ostrzeżenia (bez wspólnych)', () => {
    const result = validate(
      '{task.number}{#hasParts}{#parts}{name} {cost} {task.number}{/parts}{/hasParts}{customer.name}',
    );
    expect(result.issues).toEqual([]);
    expect(result.usedFields).toEqual([
      'customer.name',
      'hasParts',
      'parts',
      'parts[].cost',
      'parts[].name',
      'task.number',
    ]);
    expect(result.warnings).toEqual([
      { code: 'TEMPLATE_UNUSED_FIELD', field: 'scooter.odometerKm', loop: null },
      { code: 'TEMPLATE_UNUSED_FIELD', field: 'sku', loop: 'parts' },
      { code: 'TEMPLATE_UNUSED_FIELD', field: 'quantity', loop: 'parts' },
      { code: 'TEMPLATE_UNUSED_FIELD', field: 'unitPrice', loop: 'parts' },
    ]);
    expect(loopFieldPath('parts', 'cost')).toBe('parts[].cost');
  });

  it('plansza `wydruki-wgranie-bledy`: nieznane pole w pętli z podpowiedzią i listą pól pętli', () => {
    const [issue] = validate('{#parts}{task.partCost}{/parts}').issues;
    expect(issue).toEqual({
      code: 'TEMPLATE_UNKNOWN_FIELD',
      tag: '{task.partCost}',
      file: 'word/document.xml',
      offset: 8,
      loop: 'parts',
      available: ['name', 'sku', 'quantity', 'unitPrice', 'cost'],
      suggestion: 'cost',
    });
    expect(validate('{klient.imie}').issues[0]).toMatchObject({
      code: 'TEMPLATE_UNKNOWN_FIELD',
      available: ['task.number', 'customer.name', 'hasParts', 'scooter.odometerKm', 'document.footer'],
    });
    expect(validate('{task.numbr}').issues[0]).toMatchObject({ suggestion: 'task.number' });
  });

  it('pole pętli poza pętlą, lista i pole logiczne jako tekst, warunek na polu tekstowym, nieznana pętla', () => {
    expect(validate('{cost}').issues[0]).toMatchObject({ code: 'TEMPLATE_FIELD_OUT_OF_SCOPE', loop: 'parts' });
    expect(validate('{parts}').issues[0]).toMatchObject({ code: 'TEMPLATE_FIELD_TYPE' });
    expect(validate('{hasParts}').issues[0]).toMatchObject({ code: 'TEMPLATE_FIELD_TYPE' });
    expect(validate('{#task.number}x{/task.number}').issues[0]).toMatchObject({ code: 'TEMPLATE_CONDITION_TYPE' });
    expect(validate('{#prts}{name}{/prts}').issues).toEqual([
      expect.objectContaining({ code: 'TEMPLATE_UNKNOWN_LOOP', suggestion: 'parts' }),
      expect.objectContaining({ code: 'TEMPLATE_FIELD_OUT_OF_SCOPE', loop: 'parts' }),
    ]);
    expect(validate('{^parts}Brak części{/parts}').issues).toEqual([]);
    expect(validate('{^hasParts}Brak{/hasParts}').issues).toEqual([]);
  });

  it('zabronione: surowy XML, wyrażenia i spacje, zmiana ograniczników', () => {
    expect(validate('{@task.number}').issues[0]).toMatchObject({ code: 'TEMPLATE_RAW_TAG', tag: '{@task.number}' });
    expect(validate('{task.number | upper}').issues[0]).toMatchObject({ code: 'TEMPLATE_EXPRESSION' });
    expect(validate('{ task.number }').issues[0]).toMatchObject({ code: 'TEMPLATE_EXPRESSION' });
    expect(validate('{#items.length > 0}x{/items.length > 0}').issues[0]).toMatchObject({
      code: 'TEMPLATE_EXPRESSION',
    });
    expect(validate('{=[[ ]]=}').issues[0]).toMatchObject({ code: 'TEMPLATE_DELIMITERS' });
    expect(validate('{}').issues[0]).toMatchObject({ code: 'TEMPLATE_EXPRESSION' });
  });

  it('odległość edycyjna z limitem i podpowiedzi', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('cost', 'cots')).toBe(2);
    expect(editDistance('a', 'abcdef')).toBe(3);
    expect(suggestField('Task.Number', ['task.number'])).toBe('task.number');
    expect(suggestField('zupelnie.inne', ['task.number'])).toBeUndefined();
  });
});

// --- Archiwum DOCX -------------------------------------------------------------------------------

const enc = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

interface ZipEntry {
  name: string;
  data?: number[];
  method?: number;
  uncompressedSize?: number;
  flags?: number;
}

/** Archiwum ZIP z katalogiem centralnym (CRC nie jest sprawdzane przez core). */
function zip(entries: ZipEntry[], options: { comment?: number[] } = {}): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  for (const entry of entries) {
    const data = entry.data ?? enc('<x/>');
    const name = enc(entry.name);
    const method = entry.method ?? 0;
    const size = entry.uncompressedSize ?? data.length;
    const offset = local.length;
    local.push(...le32(0x04034b50), 20, 0, ...le16(entry.flags ?? 0), ...le16(method), 0, 0, 0, 0, ...le32(0));
    local.push(...le32(data.length), ...le32(size), ...le16(name.length), 0, 0, ...name, ...data);
    central.push(...le32(0x02014b50), 20, 0, 20, 0, ...le16(entry.flags ?? 0), ...le16(method), 0, 0, 0, 0, ...le32(0));
    central.push(...le32(data.length), ...le32(size), ...le16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    central.push(...le32(offset), ...name);
  }
  const comment = options.comment ?? [];
  const end = [...le32(0x06054b50), 0, 0, 0, 0, ...le16(entries.length), ...le16(entries.length)];
  end.push(...le32(central.length), ...le32(local.length), ...le16(comment.length), ...comment);
  return new Uint8Array([...local, ...central, ...end]);
}

const docxEntries: ZipEntry[] = [
  { name: '[Content_Types].xml' },
  { name: '_rels/.rels' },
  { name: 'word/' },
  { name: 'word/document.xml', data: enc('<w:document>{task.number}</w:document>') },
];

describe('rozpoznanie DOCX i ochrona przed bombą ZIP', () => {
  it('poprawne archiwum: części z położeniem danych do rozpakowania z limitem', () => {
    const pkg = inspectDocxPackage(zip(docxEntries, { comment: enc('komentarz') }));
    expect(pkg.entries.map((e) => e.name)).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    const document = pkg.entries[2]!;
    expect(document).toMatchObject({ method: 0, compressedSize: 38, uncompressedSize: 38 });
    const bytes = zip(docxEntries);
    expect(String.fromCharCode(...bytes.subarray(document.dataOffset, document.dataOffset + 12))).toBe('<w:document>');
  });

  it.each([
    [
      'plik nie jest ZIP (np. PDF albo zaszyfrowany DOCX w OLE)',
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, ...Array(40).fill(0)]),
      'signature',
    ],
    ['brak `word/document.xml`', zip([{ name: '[Content_Types].xml' }]), 'missing_part'],
    ['szyfrowanie', zip([...docxEntries, { name: 'x.xml', flags: 1 }]), 'encrypted'],
    ['inna kompresja', zip([...docxEntries, { name: 'x.xml', method: 12 }]), 'compression'],
    ['ścieżka spoza archiwum', zip([...docxEntries, { name: '../evil.xml' }]), 'path'],
    ['ścieżka bezwzględna', zip([...docxEntries, { name: '/etc/passwd' }]), 'path'],
    ['powtórzona nazwa', zip([...docxEntries, { name: 'WORD/document.xml' }]), 'duplicate_entry'],
  ])('%s → TEMPLATE_NOT_DOCX', (_name, bytes, reason) => {
    expect(() => inspectDocxPackage(bytes)).toThrow(
      expect.objectContaining({ code: 'TEMPLATE_NOT_DOCX', details: { reason } }),
    );
  });

  it('limity po rozpakowaniu: stosunek 200:1, suma 50 MB i liczba części', () => {
    const bomb = zip([
      ...docxEntries,
      { name: 'word/media/x.xml', method: 8, data: Array(100).fill(0), uncompressedSize: 1024 * 1024 },
    ]);
    expect(() => inspectDocxPackage(bomb)).toThrow(
      expect.objectContaining({
        code: 'TEMPLATE_TOO_LARGE_UNPACKED',
        details: expect.objectContaining({ reason: 'ratio' }),
      }),
    );
    const big = zip([
      ...docxEntries,
      ...Array.from({ length: 6 }, (_, i) => ({
        name: `word/p${i}.xml`,
        method: 8,
        data: Array(60_000).fill(1),
        uncompressedSize: 9_000_000,
      })),
    ]);
    expect(() => inspectDocxPackage(big)).toThrow(
      expect.objectContaining({
        code: 'TEMPLATE_TOO_LARGE_UNPACKED',
        details: expect.objectContaining({ reason: 'size' }),
      }),
    );
    const many = zip([...docxEntries, ...Array.from({ length: 1000 }, (_, i) => ({ name: `p/${i}`, data: [] }))]);
    expect(() => inspectDocxPackage(many)).toThrow(
      expect.objectContaining({
        code: 'TEMPLATE_TOO_LARGE_UNPACKED',
        details: expect.objectContaining({ reason: 'entries' }),
      }),
    );
    expect(() => inspectDocxPackage(new Uint8Array(TEMPLATE_MAX_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'TEMPLATE_TOO_LARGE' }),
    );
    const small = zip([
      ...docxEntries,
      { name: 'word/styles.xml', method: 8, data: Array(10).fill(0), uncompressedSize: 30_000 },
    ]);
    expect(() => inspectDocxPackage(small)).not.toThrow();
  });

  it('makra: część `vbaProject.bin` albo typ `macroEnabled`', () => {
    expect(() => inspectDocxPackage(zip([...docxEntries, { name: 'word/vbaProject.bin' }]))).toThrow(
      expect.objectContaining({ code: 'TEMPLATE_MACROS' }),
    );
    const override = (type: string) =>
      `<?xml version="1.0"?><Types><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${type}"/></Types>`;
    expect(() => checkDocxContentTypes(override(DOCX_MAIN_CONTENT_TYPE))).not.toThrow();
    expect(() => checkDocxContentTypes(override('application/vnd.ms-word.document.macroEnabled.main+xml'))).toThrow(
      expect.objectContaining({ code: 'TEMPLATE_MACROS' }),
    );
    expect(() =>
      checkDocxContentTypes(
        override('application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'),
      ),
    ).toThrow(expect.objectContaining({ code: 'TEMPLATE_NOT_DOCX', details: { reason: 'dotx' } }));
    expect(() => checkDocxContentTypes('<Types/>')).toThrow(expect.objectContaining({ code: 'TEMPLATE_NOT_DOCX' }));
    expect(() =>
      checkDocxContentTypes(
        `<Types><Override ContentType='${DOCX_MAIN_CONTENT_TYPE}' PartName='/word/document.xml'/></Types>`,
      ),
    ).not.toThrow();
  });

  it('części ze znacznikami i opis części w miejscu błędu', () => {
    expect(
      ['word/document.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footnotes.xml'].every(isTemplatedPart),
    ).toBe(true);
    expect(isTemplatedPart('word/styles.xml')).toBe(false);
    expect(templatePart('word/header2.xml')).toEqual({ part: 'header', partNumber: 2 });
    expect(templatePart('word/document.xml')).toEqual({ part: 'document', partNumber: null });
    expect(templatePart('word/styles.xml')).toEqual({ part: 'other', partNumber: null });
  });
});

// --- Katalog rodzajów ------------------------------------------------------------------------------

const ctx: Omit<DocumentBuildContext, 'params'> = {
  documentId: '7f3a2c91-0b5e-4c1f-9a77-1d2e3f405061',
  generatedAt: new Date('2026-11-18T13:22:00Z'),
  template: { name: 'Protokół serwisowy', versionNo: 2 },
  staff: { name: 'Tomasz Nowak' },
  company: SAMPLE_COMPANY,
  format,
  texts: DOCUMENT_TEXTS_PL,
};

/** Wszystkie liście danych jako ścieżki katalogu (`parts[].cost` dla pól pętli). */
function leafPaths(data: TemplateData, loops: ReadonlySet<string>, prefix = ''): string[] {
  return Object.entries(data).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      expect(loops.has(path)).toBe(true);
      return [
        path,
        ...value.flatMap((item) => leafPaths(item, new Set(), '').map((field) => loopFieldPath(path, field))),
      ];
    }
    if (typeof value === 'object') return leafPaths(value, loops, path);
    return [path];
  });
}

describe('katalog rodzajów dokumentów (ADR 0067, ADR 0068)', () => {
  it('rodzaje: sześć z szablonem, cztery z szablonem startowym, naklejka wbudowana', () => {
    expect(DOCUMENT_TYPES).toHaveLength(7);
    expect(Object.keys(DOCUMENT_CATALOG).sort()).toEqual([...TEMPLATE_DOCUMENT_TYPES].sort());
    expect(TEMPLATE_DOCUMENT_TYPES.filter((type) => DOCUMENT_CATALOG[type].starter).sort()).toEqual(
      ['RECEIPT', 'RENTAL_CONFIRMATION', 'SCOOTER_CARD', 'SERVICE_PROTOCOL'].sort(),
    );
    expect(DOCUMENT_READ_PERMISSIONS).toEqual({
      RENTAL_CONFIRMATION: 'rentals.read',
      SERVICE_PROTOCOL: 'service.read',
      SCOOTER_CARD: 'scooters.read',
      INCIDENT_REPORT: 'tickets.read',
      WALLET_ADJUSTMENT: 'payments.read',
      RECEIPT: 'payments.read',
      SCOOTER_LABEL: 'scooters.read',
    });
  });

  it.each(TEMPLATE_DOCUMENT_TYPES)('%s: dane przykładowe mają dokładnie pola katalogu z właściwymi typami', (type) => {
    const catalog = documentFieldCatalog(type);
    const paths = [...catalog.fields.map((f) => f.path), ...catalog.loops.map((l) => l.path)];
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/);
    const data = documentSampleData(type, ctx);
    const loops = new Set(catalog.loops.map((l) => l.path));
    const expected = [
      ...catalog.fields.map((f) => f.path),
      ...catalog.loops.flatMap((l) => [l.path, ...l.fields.map((f) => loopFieldPath(l.path, f.path))]),
    ].sort();
    expect([...new Set(leafPaths(data, loops))].sort()).toEqual(expected);
    for (const field of catalog.fields) {
      const value = readFieldPath(data, field.path.split('.'));
      expect(typeof value).toBe(field.type === 'boolean' ? 'boolean' : 'string');
    }
    for (const loop of catalog.loops) {
      const items = readFieldPath(data, [loop.path]) as TemplateData[];
      expect(items.length).toBeGreaterThan(0);
      for (const field of loop.fields)
        expect(typeof items[0]![field.path]).toBe(field.type === 'boolean' ? 'boolean' : 'string');
    }
  });

  it.each(TEMPLATE_DOCUMENT_TYPES)(
    '%s: szablon ze wszystkimi polami katalogu przechodzi walidację bez ostrzeżeń',
    (type) => {
      const catalog = documentFieldCatalog(type);
      const text = [
        ...catalog.fields.map((f) => (f.type === 'boolean' ? `{#${f.path}}tak{/${f.path}}` : `{${f.path}}`)),
        ...catalog.loops.map(
          (l) =>
            `{#${l.path}}${l.fields.map((f) => (f.type === 'boolean' ? `{#${f.path}}x{/${f.path}}` : `{${f.path}}`)).join(' ')}{/${l.path}}`,
        ),
      ].join('\n');
      const lexed = lexTemplateText(text);
      expect(lexed.issues).toEqual([]);
      const result = validateTemplateTags(lexed.tags, catalog);
      expect(result.issues).toEqual([]);
      expect(result.warnings).toEqual([]);
    },
  );

  it('pola wspólne: dane firmy, stopka, szablon i linia „Podpis”', () => {
    expect(COMMON_DOCUMENT_FIELDS.every((field) => field.common)).toBe(true);
    const data = documentSampleData('SERVICE_PROTOCOL', { ...ctx, preview: false });
    expect(data.document).toEqual({
      id: '7f3a2c91',
      generatedAt: '18.11.2026, 14:22',
      footer: 'Wydruk 7f3a2c91 · Protokół serwisowy v2 · 18.11.2026, 14:22 · Tomasz Nowak',
    });
    expect(data.staff).toEqual({ name: 'Tomasz Nowak', present: true });
    expect(data.company).toMatchObject({ address: '[ulica i numer], 44-200 Rybnik', hasRegistry: false, krs: '' });
    expect((documentSampleData('SERVICE_PROTOCOL', ctx).document as TemplateData).footer).toBe(
      'Podgląd na danych przykładowych · Protokół serwisowy v2 · nie jest dokumentem',
    );
  });

  it('stopka dokumentu klienta: „aplikacja” i brak linii podpisu', () => {
    const data = buildDocumentData('RECEIPT', DOCUMENT_CATALOG.RECEIPT.sample, {
      ...ctx,
      template: { name: 'Paragon', versionNo: 1 },
      staff: null,
      canReadCustomers: true,
    });
    expect((data.document as TemplateData).footer).toBe('Wydruk 7f3a2c91 · Paragon v1 · 18.11.2026, 14:22 · aplikacja');
    expect(data.staff).toEqual({ name: '', present: false });
  });

  it('paragon: grupy VAT, pozycja poza VAT jako „np.” i wariant korekty z kwotami ujemnymi', () => {
    const data = buildDocumentData('RECEIPT', DOCUMENT_CATALOG.RECEIPT.sample, { ...ctx, canReadCustomers: true });
    expect(data.vatGroups).toEqual([
      { rate: '23%', gross: nbsp('12,50 zł'), net: nbsp('10,16 zł'), vat: nbsp('2,34 zł') },
      { rate: 'np.', gross: nbsp('50,00 zł'), net: nbsp('50,00 zł'), vat: nbsp('0,00 zł') },
    ]);
    expect(data.totals).toEqual({ gross: nbsp('62,50 zł'), net: nbsp('60,16 zł'), vat: nbsp('2,34 zł') });
    expect(data.hasOutsideVat).toBe(true);
    expect((data.items as TemplateData[])[2]).toMatchObject({ vatRate: 'np.', outsideVat: true });
    const correction = buildDocumentData(
      'RECEIPT',
      {
        ...DOCUMENT_CATALOG.RECEIPT.sample,
        kind: 'CORRECTION',
        number: 'PAR/2026/000130',
        corrected: { number: 'PAR/2026/000126', issuedAt: new Date('2026-11-18T13:05:00Z') },
        correctionReasonLabel: 'Awaria hulajnogi',
        items: [{ label: 'Zwrot', quantity: 1, unitPrice: -950, vatRate: 23, amount: -950 }],
      },
      { ...ctx, canReadCustomers: true },
    );
    expect(correction).toMatchObject({
      isCorrection: true,
      corrected: { number: 'PAR/2026/000126', issuedAt: '18.11.2026, 14:05' },
      correction: { reason: 'Awaria hulajnogi' },
      totals: { gross: nbsp('-9,50 zł') },
    });
  });

  it('bez `users.read` dane klienta to „Klient” (ADR 0068)', () => {
    const hidden = buildDocumentData('SERVICE_PROTOCOL', DOCUMENT_CATALOG.SERVICE_PROTOCOL.sample, {
      ...ctx,
      canReadCustomers: false,
    });
    expect(hidden.customer).toEqual({ name: 'Klient', phone: 'Klient' });
    const shown = buildDocumentData('SERVICE_PROTOCOL', DOCUMENT_CATALOG.SERVICE_PROTOCOL.sample, {
      ...ctx,
      canReadCustomers: true,
    });
    expect(shown.customer).toEqual({ name: 'Anna Kowalska', phone: '+48 500 100 200' });
    expect(
      buildDocumentData('RECEIPT', DOCUMENT_CATALOG.RECEIPT.sample, { ...ctx, canReadCustomers: false }).customer,
    ).toEqual({
      name: 'Klient',
      phone: 'Klient',
    });
  });

  it('parametry: domyślne z katalogu, oś czasu do wyłączenia, zakres historii karty hulajnogi', () => {
    expect(resolveDocumentParams('SERVICE_PROTOCOL')).toEqual({ includeTimeline: true });
    expect(resolveDocumentParams('SCOOTER_CARD', { historyDays: 365 })).toEqual({ historyDays: 365 });
    expect(resolveDocumentParams('SCOOTER_LABEL')).toEqual({ layout: 'single' });
    expect(resolveDocumentParams('RECEIPT')).toEqual({});
    expect(() => resolveDocumentParams('SCOOTER_CARD', { historyDays: 7 })).toThrow(
      expect.objectContaining({
        code: 'DOCUMENT_PARAM_INVALID',
        details: { param: 'historyDays', options: [30, 90, 365] },
      }),
    );
    expect(() => resolveDocumentParams('RECEIPT', { includeTimeline: true })).toThrow(
      expect.objectContaining({ code: 'DOCUMENT_PARAM_INVALID', details: { param: 'includeTimeline' } }),
    );
    expect(() => resolveDocumentParams('SERVICE_PROTOCOL', { includeTimeline: 'tak' })).toThrow(
      expect.objectContaining({ code: 'DOCUMENT_PARAM_INVALID' }),
    );
    const noTimeline = buildDocumentData('SERVICE_PROTOCOL', DOCUMENT_CATALOG.SERVICE_PROTOCOL.sample, {
      ...ctx,
      params: { includeTimeline: false },
      canReadCustomers: true,
    });
    expect(noTimeline).toMatchObject({ includeTimeline: false, timeline: [] });
    const card = (historyDays: number) =>
      buildDocumentData('SCOOTER_CARD', DOCUMENT_CATALOG.SCOOTER_CARD.sample, {
        ...ctx,
        params: { historyDays },
        canReadCustomers: true,
      });
    expect((card(90).tasks as TemplateData[]).map((t) => t.number)).toEqual(['S-1037']);
    expect((card(365).tasks as TemplateData[]).map((t) => t.number)).toEqual(['S-1037']);
    expect(card(90).history).toEqual({ days: '90', from: '20.08.2026' });
  });

  it('protokół: części z kosztem, przebieg i adres jako strefa ze współrzędnymi bez Photon', () => {
    const protocol = buildDocumentData('SERVICE_PROTOCOL', DOCUMENT_CATALOG.SERVICE_PROTOCOL.sample, {
      ...ctx,
      canReadCustomers: true,
    });
    expect(protocol.partsTotal).toBe(nbsp('36,50 zł'));
    expect((protocol.parts as TemplateData[])[1]).toMatchObject({
      name: 'Linka hamulca tylnego',
      unitPrice: nbsp('12,50 zł'),
    });
    expect(protocol.scooter).toMatchObject({ number: '#0203', odometerKm: '2041' });
    const rental = buildDocumentData('RENTAL_CONFIRMATION', DOCUMENT_CATALOG.RENTAL_CONFIRMATION.sample, {
      ...ctx,
      canReadCustomers: true,
    });
    expect(rental.start).toEqual({ place: 'P-01 Rynek · 50,09721, 18,54183', zone: 'P-01 Rynek' });
    expect(rental.end).toEqual({ place: 'ul. Kościuszki 15, Rybnik', zone: 'P-03 Kampus' });
    expect(rental.rental).toMatchObject({ distanceKm: '4,2', rideMinutes: '23' });
  });

  it('numer obiektu i nazwa pliku wyniku', () => {
    expect(documentEntityLabel('SERVICE_PROTOCOL', DOCUMENT_CATALOG.SERVICE_PROTOCOL.sample)).toBe('S-1037');
    expect(documentEntityLabel('SCOOTER_CARD', DOCUMENT_CATALOG.SCOOTER_CARD.sample)).toBe('#0007');
    expect(documentFileName('SERVICE_PROTOCOL', 'S-1037')).toBe('S-1037-protokol-serwisowy');
    expect(documentFileName('RECEIPT', 'PAR/2026/000126')).toBe('PAR-2026-000126');
    expect(documentFileName('SCOOTER_CARD', '#0007')).toBe('0007-karta-hulajnogi');
    expect(documentFileName('SCOOTER_LABEL', '#0007')).toBe('0007-naklejka');
    expect(shortDocumentId('7F3A2C91-0B5E-4C1F')).toBe('7f3a2c91');
    expect(documentFooter({ ...ctx, template: null })).toBe('Wydruk 7f3a2c91 · 18.11.2026, 14:22 · Tomasz Nowak');
  });
});

describe('wydruki w procesach', () => {
  const perms = (...codes: string[]) => ({ has: (p: string) => codes.includes(p) });

  it('„Drukuj” wymaga `documents.generate` i uprawnienia odczytu rodzaju; dane klienta z `users.read`', () => {
    expect(() => ensureCanPrint(perms('documents.generate', 'service.read'), 'SERVICE_PROTOCOL')).not.toThrow();
    expect(() => ensureCanPrint(perms('service.read'), 'SERVICE_PROTOCOL')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', details: { permission: 'documents.generate' } }),
    );
    expect(() => ensureCanPrint(perms('documents.generate', 'service.read'), 'RECEIPT')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN', details: { permission: 'payments.read' } }),
    );
    expect(visibleDocumentTypes(perms('documents.generate', 'service.read', 'scooters.read'), DOCUMENT_TYPES)).toEqual([
      'SERVICE_PROTOCOL',
      'SCOOTER_CARD',
      'SCOOTER_LABEL',
    ]);
    expect(visibleDocumentTypes(perms('service.read'), DOCUMENT_TYPES)).toEqual([]);
    expect(canSeeCustomerData(perms('users.read'))).toBe(true);
    expect(canSeeCustomerData(perms('documents.generate'))).toBe(false);
  });

  it('wybór szablonu: wskazany z aktywną wersją albo domyślny; rodzaj bez szablonu nie drukuje', () => {
    const templates = [
      { id: 't1', isDefault: true, activeVersionId: 'v2' },
      { id: 't2', isDefault: false, activeVersionId: null },
    ];
    expect(selectTemplate(templates)).toEqual({ templateId: 't1', versionId: 'v2' });
    expect(() => selectTemplate(templates, 't2')).toThrow(expect.objectContaining({ code: 'TEMPLATE_NOT_ACTIVE' }));
    expect(() => selectTemplate(templates, 't9')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => selectTemplate([])).toThrow(expect.objectContaining({ code: 'DOCUMENT_TYPE_NOT_PRINTABLE' }));
    expect(isPrintable('INCIDENT_REPORT', [])).toBe(false);
    expect(isPrintable('SCOOTER_LABEL', [])).toBe(true);
    expect(isPrintable('RECEIPT', templates)).toBe(true);
    expect(() => ensureDocumentFormat('SCOOTER_LABEL', 'DOCX')).toThrow(
      expect.objectContaining({ code: 'DOCUMENT_FORMAT_NOT_ALLOWED' }),
    );
    expect(() => ensureDocumentFormat('RECEIPT', 'DOCX')).not.toThrow();
  });

  it('paragon PDF klienta: ponowne użycie wydruku z aktywną wersją, PDF, bez błędu i z plikami', () => {
    const doc = (overrides: Partial<ExistingReceiptDocument>): ExistingReceiptDocument => ({
      id: 'd',
      templateVersionId: 'v2',
      format: 'PDF',
      status: 'SUCCEEDED',
      filesDeletedAt: null,
      requestedByCustomer: true,
      ...overrides,
    });
    expect(reusableReceiptDocument([doc({ id: 'ok' })], 'v2')?.id).toBe('ok');
    expect(reusableReceiptDocument([doc({ id: 'running', status: 'RUNNING' })], 'v2')?.id).toBe('running');
    for (const other of [
      doc({ templateVersionId: 'v1' }),
      doc({ status: 'FAILED' }),
      doc({ format: 'DOCX' }),
      doc({ filesDeletedAt: new Date() }),
      doc({ requestedByCustomer: false }),
    ]) {
      expect(reusableReceiptDocument([other], 'v2')).toBeNull();
    }
  });

  it('stan i retencja 30 dni, ponowienie tylko błędu, zadanie tylko na `QUEUED`', () => {
    const now = new Date('2026-12-20T12:00:00Z');
    expect(generatedDocumentState({ status: 'SUCCEEDED', filesDeletedAt: new Date() })).toBe('DELETED');
    expect(generatedDocumentState({ status: 'FAILED', filesDeletedAt: null })).toBe('FAILED');
    expect(documentFilesExpired({ finishedAt: new Date('2026-11-19T11:00:00Z'), filesDeletedAt: null }, now)).toBe(
      true,
    );
    expect(documentFilesExpired({ finishedAt: new Date('2026-11-21T13:00:00Z'), filesDeletedAt: null }, now)).toBe(
      false,
    );
    expect(documentFilesExpired({ finishedAt: null, filesDeletedAt: null }, now)).toBe(false);
    expect(() => ensureDocumentRetryable({ status: 'SUCCEEDED' })).toThrow(
      expect.objectContaining({ code: 'DOCUMENT_NOT_RETRYABLE' }),
    );
    expect(() => ensureDocumentRetryable({ status: 'FAILED' })).not.toThrow();
    const at = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(shouldRunDocumentJob({ status: 'QUEUED', startedAt: null }, now)).toBe(true);
    expect(shouldRunDocumentJob({ status: 'RUNNING', startedAt: at(30) }, now)).toBe(false);
    expect(shouldRunDocumentJob({ status: 'SUCCEEDED', startedAt: at(600) }, now)).toBe(false);
  });

  it('zadania w tle po restarcie API: ponowienie przejmuje porzucony RUNNING, sprzątanie kończy porzucone', () => {
    const now = new Date('2026-12-20T12:00:00Z');
    const at = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    // Ponowienie pg-boss po limicie czasu zadania (120 s) przejmuje wiersz `RUNNING` po restarcie API.
    expect(shouldRunDocumentJob({ status: 'RUNNING', startedAt: at(DOCUMENT_JOB_EXPIRE_MS / 1000) }, now)).toBe(true);
    expect(shouldRunDocumentJob({ status: 'RUNNING', startedAt: at(119) }, now)).toBe(false);
    expect(isJobClaimable({ status: 'RUNNING', startedAt: at(299) }, now, 300_000)).toBe(false);
    expect(isJobClaimable({ status: 'FAILED', startedAt: at(9999) }, now, 300_000)).toBe(false);
    // Zadanie porządkowe: w toku od startu, w kolejce od zlecenia dłużej niż 15 min.
    const abandoned = DOCUMENT_JOB_ABANDONED_MS / 1000;
    expect(
      isJobAbandoned(
        { status: 'RUNNING', startedAt: at(abandoned + 1), createdAt: at(abandoned + 5) },
        now,
        DOCUMENT_JOB_ABANDONED_MS,
      ),
    ).toBe(true);
    expect(
      isJobAbandoned(
        { status: 'RUNNING', startedAt: at(60), createdAt: at(abandoned + 5) },
        now,
        DOCUMENT_JOB_ABANDONED_MS,
      ),
    ).toBe(false);
    expect(
      isJobAbandoned(
        { status: 'QUEUED', startedAt: null, createdAt: at(abandoned + 1) },
        now,
        DOCUMENT_JOB_ABANDONED_MS,
      ),
    ).toBe(true);
    expect(
      isJobAbandoned({ status: 'QUEUED', startedAt: null, createdAt: at(60) }, now, DOCUMENT_JOB_ABANDONED_MS),
    ).toBe(false);
    expect(
      isJobAbandoned({ status: 'SUCCEEDED', startedAt: at(9999), createdAt: at(9999) }, now, DOCUMENT_JOB_ABANDONED_MS),
    ).toBe(false);
  });

  it('dane klienta w pliku wydruku: rodzaje z polami klienta wypełnione bez maskowania', () => {
    expect(documentHasCustomerFields('SERVICE_PROTOCOL')).toBe(true);
    expect(documentHasCustomerFields('RECEIPT')).toBe(true);
    expect(documentHasCustomerFields('SCOOTER_CARD')).toBe(false);
    expect(documentHasCustomerFields('SCOOTER_LABEL')).toBe(false);
    expect(documentShowsCustomerData('SERVICE_PROTOCOL', true)).toBe(true);
    expect(documentShowsCustomerData('SERVICE_PROTOCOL', false)).toBe(false);
    expect(documentShowsCustomerData('SCOOTER_CARD', true)).toBe(false);
  });

  it('wydruk z danymi klienta pobiera tylko operator z users.read, także zlecający', () => {
    const doc = {
      id: 'd2',
      documentType: 'SERVICE_PROTOCOL' as const,
      requestedByStaff: 'dispatcher',
      requestedByUser: null,
      customerDataVisible: true,
    };
    const technician = perms('documents.generate', 'service.read');
    expect(() => ensureCanDownloadDocument(doc, { kind: 'staff', staffId: 'tech', permissions: technician })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() =>
      ensureCanDownloadDocument(doc, {
        kind: 'staff',
        staffId: 'tech',
        permissions: perms('documents.generate', 'service.read', 'users.read'),
      }),
    ).not.toThrow();
    expect(() =>
      ensureCanDownloadDocument(doc, {
        kind: 'staff',
        staffId: 'dispatcher',
        permissions: perms('documents.generate'),
      }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() =>
      ensureCanDownloadDocument(
        { ...doc, customerDataVisible: false },
        { kind: 'staff', staffId: 'tech', permissions: technician },
      ),
    ).not.toThrow();
    // Paragon klienta z jego danymi: klient pobiera, operator bez users.read nie.
    const receipt = { ...doc, documentType: 'RECEIPT' as const, requestedByStaff: null, requestedByUser: 'u1' };
    expect(() => ensureCanDownloadDocument(receipt, { kind: 'customer', userId: 'u1' })).not.toThrow();
    expect(() =>
      ensureCanDownloadDocument(receipt, {
        kind: 'staff',
        staffId: 's',
        permissions: perms('documents.generate', 'payments.read'),
      }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('pobranie: klient swój, operator zlecający albo z uprawnieniami rodzaju', () => {
    const doc = {
      id: 'd1',
      documentType: 'RECEIPT' as const,
      requestedByStaff: 's1',
      requestedByUser: null,
      customerDataVisible: false,
    };
    expect(() => ensureCanDownloadDocument(doc, { kind: 'staff', staffId: 's1', permissions: perms() })).not.toThrow();
    expect(() =>
      ensureCanDownloadDocument(doc, {
        kind: 'staff',
        staffId: 's2',
        permissions: perms('documents.generate', 'payments.read'),
      }),
    ).not.toThrow();
    expect(() =>
      ensureCanDownloadDocument(doc, { kind: 'staff', staffId: 's2', permissions: perms('documents.generate') }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => ensureCanDownloadDocument(doc, { kind: 'customer', userId: 'u1' })).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(() =>
      ensureCanDownloadDocument(
        { ...doc, requestedByStaff: null, requestedByUser: 'u1' },
        { kind: 'customer', userId: 'u1' },
      ),
    ).not.toThrow();
  });

  it('wersje szablonu: stan, usunięcie tylko do aktywacji, domyślny z aktywną wersją', () => {
    expect(templateVersionState({ isActive: true, activatedAt: new Date() })).toBe('ACTIVE');
    expect(templateVersionState({ isActive: false, activatedAt: new Date() })).toBe('ARCHIVED');
    expect(templateVersionState({ isActive: false, activatedAt: null })).toBe('PENDING');
    expect(() => ensureTemplateVersionDeletable({ isActive: false, activatedAt: new Date() })).toThrow(
      expect.objectContaining({ code: 'TEMPLATE_VERSION_IN_USE', details: { state: 'ARCHIVED' } }),
    );
    expect(() => ensureTemplateVersionDeletable({ isActive: false, activatedAt: null })).not.toThrow();
    expect(() => ensureCanSetDefault({ activeVersionId: null })).toThrow(
      expect.objectContaining({ code: 'TEMPLATE_NOT_ACTIVE' }),
    );
  });

  it('klucze plików i naklejka z kodem QR', () => {
    const at = new Date('2026-11-18T23:30:00Z');
    expect(generatedDocumentKey('u-1', 'PDF', at)).toBe('generated-document/2026/11/u-1.pdf');
    expect(dataExportKey('u-2', at)).toBe('data-export/2026/11/u-2.json');
    expect(
      scooterLabelData({
        number: 7,
        siteUrl: 'https://example.pl/',
        layout: 'a4x6',
        text: { title: 'Zeskanuj w aplikacji', body: null },
      }),
    ).toEqual({
      layout: 'a4x6',
      number: '0007',
      url: 'https://example.pl/h/0007',
      title: 'Zeskanuj w aplikacji',
      body: '',
      copies: 6,
    });
  });

  it('błędy silnika na kody i ponowienie tylko niedostępnego silnika', () => {
    expect(renderErrorCode({ kind: 'timeout' })).toBe('RENDER_TIMEOUT');
    expect(renderErrorCode({ kind: 'http', status: 503 })).toBe('RENDER_TIMEOUT');
    expect(renderErrorCode({ kind: 'http', status: 429 })).toBe('RENDERER_UNAVAILABLE');
    expect(renderErrorCode({ kind: 'network' })).toBe('RENDERER_UNAVAILABLE');
    expect(renderErrorCode({ kind: 'http', status: 400 })).toBe('RENDER_FAILED');
    expect(renderErrorCode({ kind: 'template' })).toBe('TEMPLATE_RENDER_FAILED');
    expect(isRetryableRenderError('RENDERER_UNAVAILABLE')).toBe(true);
    expect(isRetryableRenderError('RENDER_TIMEOUT')).toBe(false);
  });
});
