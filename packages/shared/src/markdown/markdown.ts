/**
 * Markdown w treściach (ADR 0063): własny parser podzbioru bez zależności, bez DOM i bez `node:*`, wspólny dla API,
 * panelu, strony i aplikacji. Zwraca drzewo elementów, listę nagłówków i listę błędów; HTML nie powstaje nigdzie,
 * a klienci składają drzewo z własnych komponentów (React DOM, React Native).
 *
 * Uproszczenia względem CommonMark (opisane testami):
 * - pogrubienie, kursywa i odnośnik zamykają się w tym samym wierszu, a niezamknięty znacznik to błąd
 *   (`MD_UNCLOSED`; dosłowną gwiazdkę zapisuje się jako `\*`);
 * - `_` wewnątrz słowa (`nazwa_pliku`) zostaje tekstem, a `*` wewnątrz słowa działa jak w CommonMark;
 * - lista ma jeden poziom; wcięty znacznik listy to błąd, a lista numerowana przerywa akapit tylko od `1.`;
 * - wiersz z błędem nie trafia do drzewa (podgląd: „Wiersz N pominięty do czasu poprawki”), parser nie rzuca.
 */
import { isAllowedHref } from './href.js';
import { createSlugger } from './slug.js';

/** Profile pól z rejestru sekcji (ADR 0062): `inline` w hero i elementach list, `faq`, `document` w dokumentach. */
export const MARKDOWN_PROFILES = ['inline', 'faq', 'document'] as const;
export type MarkdownProfile = (typeof MARKDOWN_PROFILES)[number];

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'emphasis'; children: MarkdownInline[] }
  | { type: 'link'; href: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: 'heading'; level: 2 | 3; id: string; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] };

/** Nagłówek do spisu treści; `id` jest kotwicą elementu `h2`/`h3`. */
export interface MarkdownHeading {
  level: 2 | 3;
  id: string;
  text: string;
}

export const MARKDOWN_ISSUE_CODES = [
  'MD_HTML',
  'MD_NOT_ALLOWED',
  'MD_HEADING_LEVEL',
  'MD_NESTED_LIST',
  'MD_UNCLOSED',
  'MD_LINK_SCHEME',
] as const;
export type MarkdownIssueCode = (typeof MARKDOWN_ISSUE_CODES)[number];

/** Nazwa konstrukcji w komunikacie („nagłówek nie jest dozwolony w sekcji Hero”); etykiety są w plikach tłumaczeń. */
export const MARKDOWN_CONSTRUCTS = [
  'html',
  'image',
  'code',
  'blockquote',
  'table',
  'thematic-break',
  'setext-heading',
  'heading',
  'empty-heading',
  'list',
  'nested-list',
  'strong',
  'emphasis',
  'link',
  'link-title',
  'empty-link',
] as const;
export type MarkdownConstruct = (typeof MARKDOWN_CONSTRUCTS)[number];

/** Błąd z miejscem w źródle; `line` i `column` od 1, kolumna w znakach (punktach kodowych), nie w bajtach. */
export interface MarkdownIssue {
  code: MarkdownIssueCode;
  line: number;
  column: number;
  construct: MarkdownConstruct;
  /** Odrzucony adres przy `MD_LINK_SCHEME` (skrócony do 200 znaków), do podpowiedzi `https:` w panelu. */
  href?: string;
}

export interface MarkdownResult {
  blocks: MarkdownBlock[];
  headings: MarkdownHeading[];
  issues: MarkdownIssue[];
}

/** Więcej błędów nie pomaga operatorowi, a odpowiedź `422` zostaje mała. */
export const MARKDOWN_MAX_ISSUES = 100;

const PROFILE_RULES: Record<MarkdownProfile, { lists: boolean; headings: boolean }> = {
  inline: { lists: false, headings: false },
  faq: { lists: true, headings: false },
  document: { lists: true, headings: true },
};

/** Znaki, które ukośnik wsteczny zamienia w zwykły tekst (lista z ADR 0063 i znaki, które inaczej dają błąd). */
const ESCAPABLE = new Set(['\\', '*', '_', '[', ']', '(', ')', '#', '-', '`', '!', '<', '>', '.', '+', '|', '~']);
/** Znaki, od których zależy składnia w wierszu; reszta to tekst. */
const SPECIAL = new Set(['\\', '`', '<', '!', '[', ']', '*', '_']);

const LIST_ITEM = /^(?:([-*])|([0-9]{1,9})\.)[ \t]+(?=\S)/;
const FENCE = /^(?:`{3,}|~{3,})/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_DELIMITER_ROW = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;

const isWhitespace = (ch: string | undefined): boolean => ch === undefined || /\s/u.test(ch);
const isAlphanumeric = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Tekst węzłów bez formatowania (spis treści, opis strony, etykieta dostępności odnośnika). */
export function inlineText(nodes: readonly MarkdownInline[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.value : inlineText(node.children))).join('');
}

/** Tekst całego dokumentu: bloki rozdzielone pustą linią, elementy listy nową linią. */
export function markdownPlainText(blocks: readonly MarkdownBlock[]): string {
  return blocks
    .map((block) => (block.type === 'list' ? block.items.map(inlineText).join('\n') : inlineText(block.children)))
    .join('\n\n');
}

/** Spis treści dokumentu na stronie: tylko nagłówki `##` (ADR 0063). */
export const tableOfContents = (result: Pick<MarkdownResult, 'headings'>): MarkdownHeading[] =>
  result.headings.filter((heading) => heading.level === 2);

/** Łączy sąsiednie węzły tekstu (wynik nie zależy od podziału tekstu na fragmenty w parserze). */
function normalize(nodes: MarkdownInline[]): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === 'text') {
      if (!node.value) continue;
      if (last?.type === 'text') out[out.length - 1] = { type: 'text', value: last.value + node.value };
      else out.push(node);
    } else {
      out.push(node);
    }
  }
  return out;
}

interface LinkTarget {
  /** Indeks `]` kończącego tekst odnośnika. */
  textEnd: number;
  /** Indeks `)` kończącego adres; `-1`, gdy nawias nie jest zamknięty. */
  hrefEnd: number;
}

/**
 * Pary nawiasów w jednym przejściu (bez skanowania od każdego `[`, więc długi wiersz z tysiącami nawiasów
 * parsuje się liniowo). Ukośnik wsteczny wyłącza następny znak.
 */
function bracketPairs(text: string, open: string, close: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === open) stack.push(i);
    else if (ch === close && stack.length) pairs.set(stack.pop()!, i);
  }
  return pairs;
}

type Frame =
  | { kind: 'root'; children: MarkdownInline[]; index: number }
  | { kind: 'strong' | 'emphasis'; marker: '*' | '_'; children: MarkdownInline[]; index: number }
  | { kind: 'link'; target: LinkTarget; hrefStart: number; children: MarkdownInline[]; index: number };

type Report = (code: MarkdownIssueCode, construct: MarkdownConstruct, index: number, href?: string) => void;

/**
 * Elementy w wierszu: pogrubienie, kursywa, odnośnik, ucieczki. `report` dostaje indeks w `text`; wynik `ok: false`
 * oznacza wiersz z błędem (do pominięcia w drzewie).
 */
function parseInline(text: string, report: Report): { nodes: MarkdownInline[]; ok: boolean } {
  let ok = true;
  const fail: Report = (code, construct, index, href) => {
    ok = false;
    report(code, construct, index, href);
  };
  const squares = bracketPairs(text, '[', ']');
  const parens = bracketPairs(text, '(', ')');
  const linkTarget = (open: number): LinkTarget | null => {
    const textEnd = squares.get(open);
    if (textEnd === undefined || text[textEnd + 1] !== '(') return null;
    return { textEnd, hrefEnd: parens.get(textEnd + 1) ?? -1 };
  };

  const stack: Frame[] = [{ kind: 'root', children: [], index: 0 }];
  const top = () => stack[stack.length - 1]!;
  const pushText = (value: string) => {
    top().children.push({ type: 'text', value });
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\') {
      const next = text[i + 1];
      if (next !== undefined && ESCAPABLE.has(next)) {
        pushText(next);
        i += 2;
      } else {
        pushText('\\');
        i += 1;
      }
      continue;
    }
    if (ch === '`') {
      // Kod w wierszu to jeden błąd do zamykającego znaku `, a nie osobny błąd dla każdego znaku.
      fail('MD_NOT_ALLOWED', 'code', i);
      const closing = text.indexOf('`', i + 1);
      i = closing < 0 ? i + 1 : closing + 1;
      continue;
    }
    if (ch === '<' && /^[A-Za-z/!?]$/.test(text[i + 1] ?? '')) {
      fail('MD_HTML', 'html', i);
      pushText(ch);
      i += 1;
      continue;
    }
    if (ch === '!' && text[i + 1] === '[') {
      const target = linkTarget(i + 1);
      if (target) {
        fail('MD_NOT_ALLOWED', 'image', i);
        i = target.hrefEnd >= 0 ? target.hrefEnd + 1 : target.textEnd + 1;
        continue;
      }
      pushText(ch);
      i += 1;
      continue;
    }
    if (ch === '[') {
      const target = stack.some((frame) => frame.kind === 'link') ? null : linkTarget(i);
      if (!target) {
        pushText(ch);
      } else if (target.hrefEnd < 0) {
        fail('MD_UNCLOSED', 'link', i);
        pushText(ch);
      } else {
        stack.push({ kind: 'link', target, hrefStart: target.textEnd + 2, children: [], index: i });
      }
      i += 1;
      continue;
    }
    if (ch === ']') {
      const linkIndex = stack.findIndex((frame) => frame.kind === 'link' && frame.target.textEnd === i);
      if (linkIndex < 0) {
        pushText(ch);
        i += 1;
        continue;
      }
      for (const inner of stack.slice(linkIndex + 1)) {
        if (inner.kind === 'strong' || inner.kind === 'emphasis') fail('MD_UNCLOSED', inner.kind, inner.index);
      }
      const link = stack[linkIndex] as Extract<Frame, { kind: 'link' }>;
      stack.length = linkIndex;
      const href = text.slice(link.hrefStart, link.target.hrefEnd).trim();
      const children = normalize(link.children);
      if (/\s/u.test(href)) fail('MD_NOT_ALLOWED', 'link-title', link.hrefStart);
      else if (!isAllowedHref(href)) fail('MD_LINK_SCHEME', 'link', link.hrefStart, href.slice(0, 200));
      if (!inlineText(children).trim()) fail('MD_NOT_ALLOWED', 'empty-link', link.index);
      top().children.push({ type: 'link', href, children });
      i = link.target.hrefEnd + 1;
      continue;
    }
    if (ch === '*' || ch === '_') {
      let end = i;
      while (text[end] === ch) end++;
      const before = text[i - 1];
      const after = text[end];
      let canOpen = !isWhitespace(after);
      let canClose = i > 0 && !isWhitespace(before);
      if (ch === '_') {
        canOpen &&= !isAlphanumeric(before);
        canClose &&= !isAlphanumeric(after);
      }
      let left = end - i;
      while (left > 0) {
        if (canClose) {
          let index = stack.length - 1;
          while (index > 0) {
            const frame = stack[index]!;
            if ((frame.kind === 'strong' || frame.kind === 'emphasis') && frame.marker === ch) break;
            index--;
          }
          const frame = stack[index]!;
          const need = frame.kind === 'strong' ? 2 : 1;
          if (index > 0 && left >= need && (frame.kind === 'strong' || frame.kind === 'emphasis')) {
            for (const inner of stack.slice(index + 1)) {
              if (inner.kind !== 'root') fail('MD_UNCLOSED', inner.kind === 'link' ? 'link' : inner.kind, inner.index);
            }
            stack.length = index;
            top().children.push({ type: frame.kind, children: normalize(frame.children) });
            left -= need;
            continue;
          }
        }
        if (canOpen) {
          const kind = left >= 2 ? 'strong' : 'emphasis';
          // Bez zagnieżdżania tego samego znacznika (ADR 0063): drugi znacznik w środku zostaje tekstem.
          if (!stack.some((frame) => frame.kind === kind)) {
            stack.push({ kind, marker: ch, children: [], index: end - left });
            left -= kind === 'strong' ? 2 : 1;
            continue;
          }
        }
        pushText(ch.repeat(left));
        left = 0;
      }
      i = end;
      continue;
    }
    let next = i + 1;
    while (next < text.length && !SPECIAL.has(text[next]!)) next++;
    pushText(text.slice(i, next));
    i = next;
  }
  for (const frame of stack.slice(1)) fail('MD_UNCLOSED', frame.kind === 'root' ? 'link' : frame.kind, frame.index);
  return { nodes: normalize(stack[0]!.children), ok };
}

/** Wcięcie w kolumnach (tabulator jak 4 spacje) i indeks pierwszego znaku treści. */
function indentation(line: string): { width: number; offset: number } {
  let width = 0;
  let offset = 0;
  while (offset < line.length && (line[offset] === ' ' || line[offset] === '\t')) {
    width += line[offset] === '\t' ? 4 - (width % 4) : 1;
    offset++;
  }
  return { width, offset };
}

/** Treść nagłówka ATX bez znaczników `#` zamykających (`## Tytuł ##`), bez wyrażeń regularnych z nawrotami. */
function headingText(rest: string): { text: string; start: number } {
  let start = 0;
  while (start < rest.length && (rest[start] === ' ' || rest[start] === '\t')) start++;
  let end = rest.length;
  while (end > start && (rest[end - 1] === ' ' || rest[end - 1] === '\t')) end--;
  let hashes = end;
  while (hashes > start && rest[hashes - 1] === '#') hashes--;
  if (hashes < end && (hashes === start || rest[hashes - 1] === ' ' || rest[hashes - 1] === '\t')) {
    end = hashes;
    while (end > start && (rest[end - 1] === ' ' || rest[end - 1] === '\t')) end--;
  }
  return { text: rest.slice(start, end), start };
}

type OpenBlock =
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][]; lastSkipped: boolean };

/**
 * Drzewo, nagłówki i błędy źródła w danym profilu. Konstrukcja poprawna w pełnej składni, ale spoza profilu,
 * daje `MD_NOT_ALLOWED` z nazwą konstrukcji. Nie rzuca wyjątków dla żadnego wejścia.
 */
export function parseMarkdown(source: string, profile: MarkdownProfile = 'document'): MarkdownResult {
  const rules = PROFILE_RULES[profile];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const headings: MarkdownHeading[] = [];
  const issues: MarkdownIssue[] = [];
  const slug = createSlugger();
  let current: OpenBlock | null = null;

  const close = () => {
    if (current?.type === 'paragraph' && current.children.length) {
      blocks.push({ type: 'paragraph', children: normalize(current.children) });
    } else if (current?.type === 'list' && current.items.length) {
      blocks.push({ type: 'list', ordered: current.ordered, items: current.items });
    }
    current = null;
  };

  lines.forEach((raw, lineIndex) => {
    const line = lineIndex + 1;
    const report = (offset: number): Report => {
      return (code, construct, index, href) => {
        if (issues.length >= MARKDOWN_MAX_ISSUES) return;
        const column = [...raw.slice(0, offset + index)].length + 1;
        issues.push(href === undefined ? { code, line, column, construct } : { code, line, column, construct, href });
      };
    };
    const lineIssue = (code: MarkdownIssueCode, construct: MarkdownConstruct, offset: number) =>
      report(offset)(code, construct, 0);
    const inline = (text: string, offset: number) => parseInline(text, report(offset));
    /** Dalszy ciąg akapitu albo elementu listy (pojedynczy znak nowej linii to spacja). */
    const appendTo = (target: MarkdownInline[], text: string, offset: number): boolean => {
      const parsed = inline(text, offset);
      if (!parsed.ok) return false;
      if (target.length) target.push({ type: 'text', value: ' ' });
      target.push(...parsed.nodes);
      return true;
    };

    if (/^\s*$/u.test(raw)) {
      close();
      return;
    }
    const { width, offset } = indentation(raw);
    const content = raw.slice(offset).trimEnd();
    const listMatch = LIST_ITEM.exec(content);
    const open = current as OpenBlock | null;

    if (width >= 4 || (width > 0 && listMatch)) {
      if (listMatch) lineIssue('MD_NESTED_LIST', 'nested-list', offset);
      else if (open?.type === 'paragraph') appendTo(open.children, content, offset);
      else if (open?.type === 'list') {
        const item = open.items[open.items.length - 1];
        if (!open.lastSkipped && item) appendTo(item, content, offset);
      } else lineIssue('MD_NOT_ALLOWED', 'code', offset);
      return;
    }
    if (FENCE.test(content)) {
      close();
      lineIssue('MD_NOT_ALLOWED', 'code', offset);
      return;
    }
    if (content.startsWith('>')) {
      close();
      lineIssue('MD_NOT_ALLOWED', 'blockquote', offset);
      return;
    }
    if (open?.type === 'paragraph' && SETEXT_UNDERLINE.test(content)) {
      close();
      lineIssue('MD_NOT_ALLOWED', 'setext-heading', offset);
      return;
    }
    if (THEMATIC_BREAK.test(content)) {
      close();
      lineIssue('MD_NOT_ALLOWED', 'thematic-break', offset);
      return;
    }
    const hashes = /^#{1,6}(?=[ \t]|$)/.exec(content)?.[0];
    if (hashes) {
      close();
      const level = hashes.length;
      if (!rules.headings) return lineIssue('MD_NOT_ALLOWED', 'heading', offset);
      if (level !== 2 && level !== 3) return lineIssue('MD_HEADING_LEVEL', 'heading', offset);
      const { text, start } = headingText(content.slice(level));
      if (!text) return lineIssue('MD_NOT_ALLOWED', 'empty-heading', offset);
      const parsed = inline(text, offset + level + start);
      if (!parsed.ok) return;
      const plain = inlineText(parsed.nodes).trim();
      const id = slug(plain);
      blocks.push({ type: 'heading', level, id, children: parsed.nodes });
      headings.push({ level, id, text: plain });
      return;
    }
    if (content.startsWith('|') || TABLE_DELIMITER_ROW.test(content)) {
      close();
      lineIssue('MD_NOT_ALLOWED', 'table', offset);
      return;
    }
    // Lista numerowana przerywa akapit tylko od `1.`, więc „2026. rok” w środku akapitu zostaje tekstem.
    const startsList = listMatch && !(open?.type === 'paragraph' && listMatch[2] !== undefined && listMatch[2] !== '1');
    if (listMatch && startsList) {
      if (!rules.lists) {
        close();
        lineIssue('MD_NOT_ALLOWED', 'list', offset);
        return;
      }
      const ordered = listMatch[2] !== undefined;
      let list: Extract<OpenBlock, { type: 'list' }>;
      if (open?.type === 'list' && open.ordered === ordered) {
        list = open;
      } else {
        close();
        list = { type: 'list', ordered, items: [], lastSkipped: false };
        current = list;
      }
      const parsed = inline(content.slice(listMatch[0].length), offset + listMatch[0].length);
      list.lastSkipped = !parsed.ok;
      if (parsed.ok) list.items.push(parsed.nodes);
      return;
    }
    if (open?.type === 'list') {
      const item = open.items[open.items.length - 1];
      if (!open.lastSkipped && item) appendTo(item, content, offset);
      return;
    }
    const paragraph: Extract<OpenBlock, { type: 'paragraph' }> =
      open?.type === 'paragraph' ? open : (current = { type: 'paragraph', children: [] });
    appendTo(paragraph.children, content, offset);
  });
  close();

  for (const block of blocks) {
    if (block.type === 'list') block.items = block.items.map(normalize);
  }
  return { blocks, headings, issues };
}
