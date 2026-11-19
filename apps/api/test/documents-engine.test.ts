import {
  documentFieldCatalog,
  documentFormatters,
  documentSampleData,
  DOCUMENT_TEXTS_PL,
  DomainError,
} from '@hulajnogi/core';
import { loadStarterTemplates } from '@hulajnogi/db';
import { formatPln } from '@hulajnogi/shared';
import { describe, expect, it } from 'vitest';
import PizZip from 'pizzip';
import { fillDocx, inspectTemplate } from '../src/documents/docx-engine.js';
import { minimalPdf } from '../src/documents/renderers.js';
import {
  docxText,
  lieAboutSize,
  modifyDocx,
  replaceInDocument,
  STARTER_TEMPLATES,
  starterTemplate,
} from './document-helpers.js';

const sample = (type: Parameters<typeof documentSampleData>[0]) =>
  documentSampleData(type, {
    documentId: '7f3a2c91-0000-4000-8000-000000000000',
    template: { name: 'Szablon', versionNo: 1 },
    format: documentFormatters(formatPln),
    texts: DOCUMENT_TEXTS_PL,
  });

const domainError = (fn: () => unknown): DomainError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('Oczekiwano błędu domeny');
};

describe('szablony DOCX (ADR 0067)', () => {
  it.each(STARTER_TEMPLATES)(
    'szablon startowy $file przechodzi pełną walidację i wypełnia się danymi przykładowymi',
    ({ file, documentType }) => {
      const bytes = starterTemplate(file);
      const inspection = inspectTemplate(bytes, documentFieldCatalog(documentType));
      expect(inspection.issues).toEqual([]);
      expect(inspection.usedFields.length).toBeGreaterThan(10);
      const docx = fillDocx(bytes, sample(documentType));
      expect(docxText(docx)).not.toMatch(/\{[#^/]?[a-zA-Z.]+\}/);
      expect(docxText(docx, 'word/footer1.xml')).toContain('Podgląd na danych przykładowych');
    },
  );

  it('pola wersji startowej z seeda (manifest.json) są tymi samymi ścieżkami co inspekcja API przy wgraniu', () => {
    const starters = loadStarterTemplates().filter((t) => t.documentType);
    expect(starters.map((t) => t.file).sort()).toEqual(STARTER_TEMPLATES.map((t) => t.file).sort());
    for (const starter of starters) {
      const inspection = inspectTemplate(starter.bytes, documentFieldCatalog(starter.documentType as never));
      expect(starter.fields, starter.file).toEqual(inspection.usedFields);
    }
  });

  it('paragon z korektą i pozycją poza VAT: wariant korekty, „np.” i grupy stawek', () => {
    const data = sample('RECEIPT');
    const text = docxText(
      fillDocx(starterTemplate('paragon.docx'), {
        ...data,
        isCorrection: true,
        corrected: { number: 'PAR/2026/000120', issuedAt: '17.11.2026, 18:10' },
      }),
    );
    expect(text).toContain('PAR/2026/000120');
    expect(text).toContain('np.');
    expect(text).toContain('50,00');
  });

  it('nieznane pole: kod, podpowiedź, lista pól w zakresie i miejsce bez numeru strony', () => {
    const broken = replaceInDocument(starterTemplate('protokol-serwisowy.docx'), '{task.number}', '{task.numbr}');
    const [issue] = inspectTemplate(broken, documentFieldCatalog('SERVICE_PROTOCOL')).issues as unknown as Array<
      Record<string, unknown>
    >;
    expect(issue).toMatchObject({ code: 'TEMPLATE_UNKNOWN_FIELD', tag: '{task.numbr}', suggestion: 'task.number' });
    expect(issue!.available).toContain('task.number');
    const place = issue!.place as Record<string, unknown>;
    expect(place.part).toBe('document');
    expect(place).not.toHaveProperty('page');
    expect(place.paragraph ?? place.table).not.toBeNull();
  });

  it('pole pętli poza tabelą części i w pętli: podpowiedź z pól pętli', () => {
    const broken = replaceInDocument(starterTemplate('protokol-serwisowy.docx'), '{unitPrice}', '{unitCost}');
    const [issue] = inspectTemplate(broken, documentFieldCatalog('SERVICE_PROTOCOL')).issues as unknown as Array<
      Record<string, unknown>
    >;
    expect(issue).toMatchObject({ code: 'TEMPLATE_UNKNOWN_FIELD', loop: 'parts' });
    expect(issue!.available).toContain('unitPrice');
    const place = issue!.place as Record<string, unknown>;
    expect(place.table).toEqual(expect.any(Number));
    expect(place.row).toEqual(expect.any(Number));
    expect(place.column).toEqual(expect.any(Number));
  });

  it('pętla bez zamknięcia i surowy XML to błędy składni z miejscem', () => {
    const unclosed = replaceInDocument(starterTemplate('protokol-serwisowy.docx'), '{/parts}', '');
    const issues = inspectTemplate(unclosed, documentFieldCatalog('SERVICE_PROTOCOL')).issues;
    expect(issues.map((i) => i.code)).toContain('TEMPLATE_LOOP_UNCLOSED');
    expect(issues.find((i) => i.code === 'TEMPLATE_LOOP_UNCLOSED')!.place).toMatchObject({ part: 'document' });
    const raw = replaceInDocument(starterTemplate('protokol-serwisowy.docx'), '{task.number}', '{@task.number}');
    expect(inspectTemplate(raw, documentFieldCatalog('SERVICE_PROTOCOL')).issues[0]!.code).toBe('TEMPLATE_RAW_TAG');
  });

  it('surowy XML i nieznane pola poza w:t i poza standardowymi częściami: wzór m:t, nagłówek pod inną nazwą, docProps', () => {
    const catalog = documentFieldCatalog('SERVICE_PROTOCOL');
    // Nagłówek pod niestandardową nazwą (typ zawartości nagłówka) i wzór matematyczny (`m:t`) w treści.
    const header = modifyDocx(starterTemplate('protokol-serwisowy.docx'), (zip) => {
      const types = zip.file('[Content_Types].xml')!.asText();
      zip.file(
        '[Content_Types].xml',
        types.replace(
          '</Types>',
          '<Override PartName="/word/hdrx.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
        ),
      );
      zip.file(
        'word/hdrx.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:p><w:r><w:t>{@customer.name}</w:t></w:r></w:p><w:p><w:r><w:t>{unknownField}</w:t></w:r></w:p></w:hdr>',
      );
    });
    const headerIssues = inspectTemplate(header, catalog).issues;
    expect(headerIssues.map((i) => [i.code, i.tag, i.place?.part])).toEqual(
      expect.arrayContaining([
        ['TEMPLATE_RAW_TAG', '{@customer.name}', 'other'],
        ['TEMPLATE_UNKNOWN_FIELD', '{unknownField}', 'other'],
      ]),
    );

    const mathAndProps = modifyDocx(starterTemplate('protokol-serwisowy.docx'), (zip) => {
      const xml = zip.file('word/document.xml')!.asText();
      zip.file(
        'word/document.xml',
        xml.replace(
          '<w:body>',
          '<w:body><w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>{@customer.name}</m:t></m:r></m:oMath></w:p>',
        ),
      );
      const core = zip.file('docProps/core.xml')!.asText();
      expect(core).toContain('<dc:creator>');
      zip.file(
        'docProps/core.xml',
        core.replace(/<dc:creator>[^<]*<\/dc:creator>/, '<dc:creator>{totally.unknown}</dc:creator>'),
      );
    });
    const issues = inspectTemplate(mathAndProps, catalog).issues;
    expect(issues.map((i) => [i.code, i.tag])).toEqual(
      expect.arrayContaining([
        ['TEMPLATE_RAW_TAG', '{@customer.name}'],
        ['TEMPLATE_UNKNOWN_FIELD', '{totally.unknown}'],
      ]),
    );
    expect(issues.find((i) => i.tag === '{@customer.name}')!.place).toMatchObject({ part: 'document' });
  });

  it('wersja wgrana przed kontrolą nie wstawi surowego XML ani nie zmieni ograniczników przy wypełnianiu', () => {
    const data = {
      ...sample('SERVICE_PROTOCOL'),
      customer: { name: '<w:p><w:r><w:t>RAW-INJECTED</w:t></w:r></w:p>', phone: '' },
    };
    const math = modifyDocx(starterTemplate('protokol-serwisowy.docx'), (zip) => {
      const xml = zip.file('word/document.xml')!.asText();
      zip.file(
        'word/document.xml',
        xml.replace(
          '<w:body>',
          '<w:body><w:p><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>{@customer.name}</m:t></m:r></m:oMath></w:p>',
        ),
      );
    });
    const error = domainError(() => fillDocx(math, data));
    expect(error).toMatchObject({ code: 'TEMPLATE_RENDER_FAILED', details: { reason: 'raw_xml_tag' } });
    const raw = replaceInDocument(starterTemplate('protokol-serwisowy.docx'), '{task.number}', '{@customer.name}');
    expect(domainError(() => fillDocx(raw, data)).details).toMatchObject({ reason: 'raw_xml_tag' });

    // Zmiana ograniczników: lekser zgłasza ją przy wgraniu, a przy wypełnianiu `[[pole]]` zostaje zwykłym tekstem.
    const delimiters = replaceInDocument(
      starterTemplate('protokol-serwisowy.docx'),
      '{task.number}',
      '{=[[ ]]=}[[customer.name]]',
    );
    expect(inspectTemplate(delimiters, documentFieldCatalog('SERVICE_PROTOCOL')).issues.map((i) => i.code)).toContain(
      'TEMPLATE_DELIMITERS',
    );
    const text = docxText(fillDocx(delimiters, data));
    expect(text).toContain('[[customer.name]]');
    // Zwykłe pole z XML w danych jest tekstem (docxtemplater koduje znaki).
    const xml = new PizZip(Buffer.from(fillDocx(starterTemplate('protokol-serwisowy.docx'), data)))
      .file('word/document.xml')!
      .asText();
    expect(xml).not.toContain('<w:t>RAW-INJECTED</w:t>');
  });

  it('bomba ZIP: kłamliwy rozmiar przerywa rozpakowanie, a wysoki stosunek odrzuca katalog centralny', () => {
    const lying = lieAboutSize(starterTemplate('paragon.docx'), 'word/document.xml', 100);
    expect(domainError(() => inspectTemplate(lying, documentFieldCatalog('RECEIPT'))).code).toBe(
      'TEMPLATE_TOO_LARGE_UNPACKED',
    );
    const bomb = modifyDocx(starterTemplate('paragon.docx'), (zip) =>
      zip.file('word/media/zero.bin', Buffer.alloc(40 * 1024 * 1024)),
    );
    expect(domainError(() => inspectTemplate(bomb, documentFieldCatalog('RECEIPT'))).code).toBe(
      'TEMPLATE_TOO_LARGE_UNPACKED',
    );
  });

  it('makra (.docm, vbaProject.bin) i plik spoza ZIP są odrzucane', () => {
    const vba = modifyDocx(starterTemplate('paragon.docx'), (zip) => zip.file('word/vbaProject.bin', Buffer.from('x')));
    expect(domainError(() => inspectTemplate(vba, documentFieldCatalog('RECEIPT'))).code).toBe('TEMPLATE_MACROS');
    const docm = modifyDocx(starterTemplate('paragon.docx'), (zip) => {
      const types = zip.file('[Content_Types].xml')!.asText();
      zip.file(
        '[Content_Types].xml',
        types.replace('wordprocessingml.document.main+xml', 'ms-word.document.macroEnabled.main+xml'),
      );
    });
    expect(domainError(() => inspectTemplate(docm, documentFieldCatalog('RECEIPT'))).code).toBe('TEMPLATE_MACROS');
    expect(domainError(() => inspectTemplate(minimalPdf('x'), documentFieldCatalog('RECEIPT'))).code).toBe(
      'TEMPLATE_NOT_DOCX',
    );
  });
});
