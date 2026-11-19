import { inflateRawSync } from 'node:zlib';
import {
  checkDocxContentTypes,
  DomainError,
  inspectDocxPackage,
  lexTemplateText,
  parseFieldPath,
  readFieldPath,
  templatePart,
  validateTemplateTags,
  type TemplateData,
  type TemplateFieldCatalog,
  type TemplateTag,
  type TemplateTagIssue,
} from '@hulajnogi/core';
import type { TemplateIssueDetails, TemplatePlace, TemplateWarningDetails } from '@hulajnogi/shared';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

/**
 * Wypełnianie i sprawdzanie szablonów DOCX (ADR 0067) w procesie API: docxtemplater 3.71.1 z własnym parserem
 * ścieżek z core (bez wyrażeń), archiwum rozpakowane wcześniej z limitem rozmiaru (ochrona przed bombą ZIP),
 * a miejsce błędu przeliczone z pozycji w tekście części na tabelę, wiersz, kolumnę albo akapit.
 *
 * Moduł inspekcji docxtemplater (`InspectModule`) wymaga `lodash`, którego pakiet nie deklaruje, więc znaczniki
 * czyta lekser z core (`lexTemplateText`) z tego samego połączonego tekstu, na którym działa docxtemplater: wszystkie
 * części, które docxtemplater szablonuje (po typie zawartości: treść, nagłówki, stopki, przypisy, komentarze,
 * ustawienia, właściwości dokumentu, diagramy; lista z `templatedFiles`), i wszystkie elementy tekstu z jego
 * `tagsXmlTextArray` (`w:t`, `m:t`, `a:t`, `dc:title`, `vt:lpstr`…). Błędy kompilacji docxtemplater są zapasem, gdy
 * lekser niczego nie znalazł.
 *
 * Przy wypełnianiu działa też `templateGuardModule`: znacznik surowego XML (`{@pole}`) kończy wypełnianie błędem,
 * a zmiana ograniczników (`{=[[ ]]=}`) jest wyłączona, więc nawet wersja wgrana przed tą kontrolą nie wstawi danych
 * klienta jako XML dokumentu.
 */
export const DOCX_TEMPLATE_OPTIONS = {
  paragraphLoop: true,
  linebreaks: true,
  errorLogging: false,
  /** Bez zmiany ograniczników w szablonie (`{=[[ ]]=}`): ograniczniki są zawsze `{` i `}`. */
  syntax: { changeDelimiterPrefix: null },
  /** Ścieżka z kropką bez wyrażeń; czyta tylko własne pola obiektów (`readFieldPath`). */
  parser: (tag: string) => {
    const path = parseFieldPath(tag.trim());
    return { get: (scope: unknown) => (path ? readFieldPath(scope, path) : undefined) };
  },
  /** Po walidacji puste pole nie powinno wystąpić; zabezpieczenie zamiast tekstu „undefined”. */
  nullGetter: () => '',
};

/**
 * Archiwum DOCX rozpakowane z limitem: katalog centralny sprawdza core (`inspectDocxPackage`), a każdą część
 * rozpakowuje `inflateRawSync` z `maxOutputLength` równym rozmiarowi zadeklarowanemu (kłamiący nagłówek przerywa
 * rozpakowanie). `pizzip` dostaje już rozpakowane części, więc sam niczego nie rozpakowuje.
 */
export interface UnpackedDocx {
  parts: Map<string, Buffer>;
  sizeBytes: number;
  uncompressedBytes: number;
}

export function unpackDocx(bytes: Uint8Array): UnpackedDocx {
  const pkg = inspectDocxPackage(bytes);
  const parts = new Map<string, Buffer>();
  for (const entry of pkg.entries) {
    const raw = Buffer.from(bytes.buffer, bytes.byteOffset + entry.dataOffset, entry.compressedSize);
    let data: Buffer;
    if (entry.method === 0) data = Buffer.from(raw);
    else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(entry.uncompressedSize, 1) });
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw new DomainError('TEMPLATE_TOO_LARGE_UNPACKED', { reason: 'declared_size', entry: entry.name });
        }
        throw new DomainError('TEMPLATE_NOT_DOCX', { reason: 'corrupted', entry: entry.name });
      }
    }
    if (data.length !== entry.uncompressedSize) {
      throw new DomainError('TEMPLATE_NOT_DOCX', { reason: 'size_mismatch', entry: entry.name });
    }
    parts.set(entry.name, data);
  }
  checkDocxContentTypes(parts.get('[Content_Types].xml')!.toString('utf8'));
  return { parts, sizeBytes: pkg.sizeBytes, uncompressedBytes: pkg.uncompressedBytes };
}

/** Elementy tekstu, które docxtemplater 3.71.1 łączy w tekst części (`fileTypeConfig.docx().tagsXmlTextArray`). */
export const TEMPLATE_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'Company',
  'HyperlinkBase',
  'Manager',
  'cp:category',
  'cp:keywords',
  'dc:creator',
  'dc:description',
  'dc:subject',
  'dc:title',
  'cp:contentStatus',
  'PublishDate',
  'Abstract',
  'CompanyAddress',
  'CompanyPhone',
  'CompanyFax',
  'CompanyEmail',
  'w:t',
  'a:t',
  'm:t',
  'vt:lpstr',
  'vt:lpwstr',
]);

const RAW_XML_MODULE = 'hulajnogi-raw-xml-forbidden';

/**
 * Moduł docxtemplater pilnujący szablonu: zapamiętuje listę części szablonowanych (`templatedFiles` przed
 * kompilacją, więc jest też przy błędzie kompilacji) i przejmuje znaczniki surowego XML (`{@…}`, priorytet wyższy niż
 * wbudowany moduł `rawxml`), a ich wypełnienie kończy błędem `TEMPLATE_RENDER_FAILED` (`raw_xml_tag`).
 */
function templateGuardModule() {
  const state: { templatedFiles: string[] | null } = { templatedFiles: null };
  const module = {
    name: 'TemplateGuardModule',
    docxtemplater: null as { templatedFiles?: string[] } | null,
    on(event: string) {
      if (event === 'before-preparse') state.templatedFiles = [...(module.docxtemplater?.templatedFiles ?? [])];
    },
    matchers: (): Array<[string, string, { priority: number }]> => [['@', RAW_XML_MODULE, { priority: 1_000_000 }]],
    render(part: { module?: string; value?: string }) {
      if (part.module !== RAW_XML_MODULE) return null;
      throw new DomainError('TEMPLATE_RENDER_FAILED', { reason: 'raw_xml_tag', tag: `{@${part.value ?? ''}}` });
    },
  };
  return { module, state };
}

function zipOf(unpacked: UnpackedDocx): PizZip {
  const zip = new PizZip();
  for (const [name, data] of unpacked.parts) zip.file(name, data);
  return zip;
}

// --- Tekst części i miejsce błędu --------------------------------------------------------------------

interface TextRun {
  start: number;
  end: number;
  place: Omit<TemplatePlace, 'part' | 'partNumber'>;
}

interface PartText {
  file: string;
  text: string;
  runs: TextRun[];
}

const EXCERPT = 40;
const excerpt = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > EXCERPT ? `${clean.slice(0, EXCERPT)}…` : clean;
};

/** Elementy tekstu (`TEMPLATE_TEXT_ELEMENTS`) w kolejności dokumentu, tak jak łączy je docxtemplater. */
function textElements(root: Node): Element[] {
  const out: Element[] = [];
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      if (TEMPLATE_TEXT_ELEMENTS.has(child.nodeName)) out.push(child as Element);
      else walk(child);
    }
  };
  walk(root);
  return out;
}

const textOf = (node: Node): string =>
  textElements(node)
    .map((element) => element.textContent ?? '')
    .join('');

const ancestor = (node: Node, name: string): Element | null => {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (current.nodeName === name) return current as Element;
  }
  return null;
};

const indexAmong = (element: Element, name: string): number => {
  let index = 0;
  for (let sibling = element.parentNode?.firstChild ?? null; sibling; sibling = sibling.nextSibling) {
    if (sibling.nodeName === name) index += 1;
    if (sibling === element) return index;
  }
  return index;
};

/**
 * Połączony tekst części ze wszystkich elementów tekstu (tak łączy go docxtemplater) z mapą pozycji na miejsce:
 * tabela (numerowana w kolejności części, z tekstem pierwszej komórki), wiersz i kolumna albo akapit poza tabelą.
 */
function partText(file: string, xml: string): PartText {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const tables = doc.getElementsByTagName('w:tbl');
  const tableNo = new Map<Element, number>();
  for (let i = 0; i < tables.length; i++) tableNo.set(tables[i]!, i + 1);
  const paragraphs = doc.getElementsByTagName('w:p');
  const paragraphNo = new Map<Element, number>();
  let outside = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (!ancestor(paragraphs[i]!, 'w:tbl')) paragraphNo.set(paragraphs[i]!, ++outside);
  }
  const nodes = textElements(doc);
  const runs: TextRun[] = [];
  let text = '';
  for (const node of nodes) {
    const value = node.textContent ?? '';
    const paragraph = ancestor(node, 'w:p');
    const cell = ancestor(node, 'w:tc');
    const table = cell ? ancestor(cell, 'w:tbl') : null;
    const row = cell ? ancestor(cell, 'w:tr') : null;
    const firstCell = table?.getElementsByTagName('w:tc')[0];
    runs.push({
      start: text.length,
      end: text.length + value.length,
      place: {
        table: table ? (tableNo.get(table) ?? null) : null,
        tableCaption: firstCell ? excerpt(textOf(firstCell)) || null : null,
        row: row ? indexAmong(row, 'w:tr') : null,
        column: cell ? indexAmong(cell, 'w:tc') : null,
        paragraph: !table && paragraph ? (paragraphNo.get(paragraph) ?? null) : null,
        excerpt: paragraph ? excerpt(textOf(paragraph)) || null : null,
      },
    });
    text += value;
  }
  return { file, text, runs };
}

function placeOf(parts: Map<string, PartText>, file: string, offset: number): TemplatePlace | null {
  const part = parts.get(file);
  const { part: kind, partNumber } = templatePart(file);
  if (!part)
    return {
      part: kind,
      partNumber,
      table: null,
      tableCaption: null,
      row: null,
      column: null,
      paragraph: null,
      excerpt: null,
    };
  const run =
    part.runs.find((r) => offset >= r.start && offset < r.end) ?? part.runs.findLast((r) => r.start <= offset);
  return {
    part: kind,
    partNumber,
    ...(run?.place ?? { table: null, tableCaption: null, row: null, column: null, paragraph: null, excerpt: null }),
  };
}

/** Kody błędów kompilacji docxtemplater na kody walidacji (zapas, gdy lekser niczego nie wyłapał). */
const DOCXTEMPLATER_ERRORS: Record<string, string> = {
  unclosed_tag: 'TEMPLATE_TAG_UNCLOSED',
  unopened_tag: 'TEMPLATE_TAG_UNOPENED',
  unclosed_loop: 'TEMPLATE_LOOP_UNCLOSED',
  unopened_loop: 'TEMPLATE_LOOP_UNOPENED',
  closing_tag_does_not_match_opening_tag: 'TEMPLATE_LOOP_MISMATCH',
  duplicate_open_tag: 'TEMPLATE_TAG_UNCLOSED',
  duplicate_close_tag: 'TEMPLATE_TAG_UNOPENED',
};

interface DocxtemplaterErrorProperties {
  id?: string;
  xtag?: string;
  offset?: number;
  file?: string;
  errors?: Array<{ properties?: DocxtemplaterErrorProperties }>;
}

export interface TemplateInspection {
  issues: TemplateIssueDetails[];
  warnings: TemplateWarningDetails[];
  usedFields: string[];
  sizeBytes: number;
  uncompressedBytes: number;
}

/**
 * Kontrola wgranej wersji (ADR 0067, kroki 2–6): archiwum, kompilacja, znaczniki względem katalogu rodzaju i miejsce
 * każdego błędu. Wynik bez błędów może jeszcze nie przejść próbnego wypełnienia danymi przykładowymi (krok 7).
 */
export function inspectTemplate(bytes: Uint8Array, catalog: TemplateFieldCatalog): TemplateInspection {
  const unpacked = unpackDocx(bytes);
  // Kompilacja docxtemplater daje listę części, które naprawdę szablonuje (po typie zawartości, także pod
  // niestandardową nazwą), i błędy, których nie widzi lekser (np. pętla rozpięta między akapitami w sposób, którego
  // docxtemplater nie potrafi rozwinąć). Lista jest znana przed kompilacją części, więc jest też przy jej błędzie.
  const guard = templateGuardModule();
  let compileErrors: DocxtemplaterErrorProperties[] = [];
  try {
    new Docxtemplater(zipOf(unpacked), { ...DOCX_TEMPLATE_OPTIONS, modules: [guard.module] });
  } catch (error) {
    const properties = (error as { properties?: DocxtemplaterErrorProperties }).properties;
    compileErrors = properties?.errors?.map((e) => e.properties ?? {}) ?? (properties ? [properties] : []);
    if (!compileErrors.length || !guard.state.templatedFiles) {
      throw new DomainError('TEMPLATE_NOT_DOCX', { reason: 'compile' });
    }
  }
  const texts = new Map<string, PartText>();
  const tags: TemplateTag[] = [];
  const syntax: TemplateTagIssue[] = [];
  for (const name of guard.state.templatedFiles ?? []) {
    const data = unpacked.parts.get(name);
    if (!data) continue;
    const part = partText(name, data.toString('utf8'));
    texts.set(name, part);
    const lexed = lexTemplateText(part.text, name);
    tags.push(...lexed.tags);
    syntax.push(...lexed.issues);
  }
  const validation = validateTemplateTags(tags, catalog);
  // Przy błędach już znalezionych przez lekser błędy kompilacji nie dublują ich swoim opisem.
  if (!syntax.length && !validation.issues.length) {
    for (const e of compileErrors) {
      syntax.push({
        code: (DOCXTEMPLATER_ERRORS[e.id ?? ''] ?? 'TEMPLATE_SYNTAX_ERROR') as TemplateTagIssue['code'],
        tag: e.xtag ? `{${e.xtag}}` : '',
        file: e.file ?? 'word/document.xml',
        offset: e.offset ?? 0,
      });
    }
  }
  const issues = [...syntax, ...validation.issues].map((issue): TemplateIssueDetails => ({
    code: issue.code,
    tag: issue.tag || null,
    place: placeOf(texts, issue.file, issue.offset),
    suggestion: issue.suggestion ?? null,
    available: issue.available ?? [],
    loop: issue.loop ?? null,
  }));
  return {
    issues,
    warnings: validation.warnings,
    usedFields: validation.usedFields,
    sizeBytes: unpacked.sizeBytes,
    uncompressedBytes: unpacked.uncompressedBytes,
  };
}

/**
 * Wypełnienie szablonu danymi (`fillDocx` portu `DocumentRenderer`); błąd to `TEMPLATE_RENDER_FAILED`. Znacznik
 * surowego XML odrzuca moduł `templateGuardModule`, a zmiana ograniczników jest wyłączona.
 */
export function fillDocx(template: Uint8Array, data: TemplateData): Uint8Array {
  const unpacked = unpackDocx(template);
  try {
    const doc = new Docxtemplater(zipOf(unpacked), {
      ...DOCX_TEMPLATE_OPTIONS,
      modules: [templateGuardModule().module],
    });
    doc.render(data);
    return doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const id = (error as { properties?: DocxtemplaterErrorProperties }).properties?.id ?? null;
    throw new DomainError('TEMPLATE_RENDER_FAILED', { reason: id ?? (error as Error).message });
  }
}
