/**
 * Znaczniki szablonów DOCX (ADR 0067). Autor szablonu pisze ścieżki z kropką (`{customer.name}`), pętle
 * (`{#items}…{/items}`) i warunki dla pól logicznych (`{#isCorrection}`, `{^isCorrection}`); wyrażeń, filtrów,
 * surowego XML (`{@pole}`) i zmiany ograniczników nie ma. docxtemplater działa w API; core daje parser ścieżek
 * (`readFieldPath` dla opcji `parser`), własny lekser tekstu części i walidację znaczników względem katalogu pól.
 */

/** Ścieżka pola: segmenty od małej litery z literami i cyframi, rozdzielone kropką. */
export const TEMPLATE_FIELD_PATH = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

/** Segmenty ścieżki albo `null` dla wyrażenia, spacji, filtra lub pustego znacznika. */
export function parseFieldPath(tag: string): string[] | null {
  return TEMPLATE_FIELD_PATH.test(tag) ? tag.split('.') : null;
}

/**
 * Wartość ścieżki w jednym zakresie danych (docxtemplater sam przechodzi do zakresów zewnętrznych pętli, gdy wynik
 * to `undefined`). Czyta tylko własne pola obiektów, więc `{constructor.name}` niczego nie zwraca.
 */
export function readFieldPath(scope: unknown, path: readonly string[]): unknown {
  let value: unknown = scope;
  for (const segment of path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

export type TemplateTagKind = 'field' | 'loop' | 'inverted' | 'raw' | 'delimiters';

/** Znacznik z miejscem w tekście części (`offset` w połączonym tekście `w:t`, jak w błędach docxtemplater). */
export interface TemplateTag {
  kind: TemplateTagKind;
  /** Treść znacznika bez ograniczników i przedrostka (`#`, `^`, `@`). */
  value: string;
  file: string;
  offset: number;
  /** Zawartość pętli albo warunku. */
  children: TemplateTag[];
}

export type TemplateTagIssueCode =
  | 'TEMPLATE_TAG_UNCLOSED'
  | 'TEMPLATE_TAG_UNOPENED'
  | 'TEMPLATE_LOOP_UNCLOSED'
  | 'TEMPLATE_LOOP_UNOPENED'
  | 'TEMPLATE_LOOP_MISMATCH'
  | 'TEMPLATE_RAW_TAG'
  | 'TEMPLATE_EXPRESSION'
  | 'TEMPLATE_DELIMITERS'
  | 'TEMPLATE_UNKNOWN_FIELD'
  | 'TEMPLATE_UNKNOWN_LOOP'
  | 'TEMPLATE_FIELD_OUT_OF_SCOPE'
  | 'TEMPLATE_FIELD_TYPE'
  | 'TEMPLATE_CONDITION_TYPE';

export interface TemplateTagIssue {
  code: TemplateTagIssueCode;
  /** Znacznik w zapisie autora, np. `{#parts}`. */
  tag: string;
  file: string;
  offset: number;
  suggestion?: string;
  available?: string[];
  /** Pętla, w której stoi znacznik (albo której dotyczy błąd zakresu). */
  loop?: string;
}

const PREFIX: Record<TemplateTagKind, string> = { field: '', loop: '#', inverted: '^', raw: '@', delimiters: '=' };

/** Znacznik w zapisie autora (`{#parts}`, `{^isCorrection}`, `{@raw}`). */
export const tagLabel = (tag: Pick<TemplateTag, 'kind' | 'value'>): string =>
  tag.kind === 'delimiters' ? `{=${tag.value}=}` : `{${PREFIX[tag.kind]}${tag.value}}`;

export interface TemplateLexResult {
  tags: TemplateTag[];
  issues: TemplateTagIssue[];
}

/**
 * Lekser połączonego tekstu części dokumentu (Word dzieli znacznik na kilka `w:t`; API łączy tekst akapitów tak
 * jak docxtemplater). Każdy `{` zaczyna znacznik, jak w docxtemplater: niezamknięty znacznik, `}` bez otwarcia,
 * pętla bez zamknięcia, zamknięcie bez otwarcia i zamknięcie innej pętli to błędy z miejscem.
 */
export function lexTemplateText(text: string, file = 'word/document.xml'): TemplateLexResult {
  const root: TemplateTag[] = [];
  const issues: TemplateTagIssue[] = [];
  const open: TemplateTag[] = [];
  const target = () => open[open.length - 1]?.children ?? root;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (start >= 0) issues.push({ code: 'TEMPLATE_TAG_UNCLOSED', tag: text.slice(start, i), file, offset: start });
      start = i;
      continue;
    }
    if (ch !== '}') continue;
    if (start < 0) {
      issues.push({ code: 'TEMPLATE_TAG_UNOPENED', tag: '}', file, offset: i });
      continue;
    }
    const raw = text.slice(start + 1, i);
    const offset = start;
    start = -1;
    const prefix = raw[0];
    if (prefix === '/') {
      const value = raw.slice(1);
      const innermost = open[open.length - 1];
      if (!innermost) issues.push({ code: 'TEMPLATE_LOOP_UNOPENED', tag: `{/${value}}`, file, offset });
      else if (value && value !== innermost.value) {
        issues.push({ code: 'TEMPLATE_LOOP_MISMATCH', tag: `{/${value}}`, file, offset, loop: innermost.value });
      } else open.pop();
      continue;
    }
    if (prefix === '=' && raw.length > 1 && raw.endsWith('=')) {
      target().push({ kind: 'delimiters', value: raw.slice(1, -1), file, offset, children: [] });
      continue;
    }
    const kind: TemplateTagKind =
      prefix === '#' ? 'loop' : prefix === '^' ? 'inverted' : prefix === '@' ? 'raw' : 'field';
    const tag: TemplateTag = { kind, value: kind === 'field' ? raw : raw.slice(1), file, offset, children: [] };
    target().push(tag);
    if (kind === 'loop' || kind === 'inverted') open.push(tag);
  }
  if (start >= 0)
    issues.push({ code: 'TEMPLATE_TAG_UNCLOSED', tag: text.slice(start, start + 40), file, offset: start });
  for (const tag of open) issues.push({ code: 'TEMPLATE_LOOP_UNCLOSED', tag: tagLabel(tag), file, offset: tag.offset });
  return { tags: root, issues };
}

// --- Katalog pól ----------------------------------------------------------------------------------

export type DocumentFieldType = 'text' | 'boolean';

export interface DocumentFieldSpec {
  path: string;
  label: string;
  type: DocumentFieldType;
  example: string;
  /** Dane klienta: operator bez `users.read` dostaje „Klient” (ADR 0068). */
  customer?: boolean;
  /** Pole wspólne wszystkich rodzajów; nieużyte nie daje ostrzeżenia. */
  common?: boolean;
}

export interface DocumentLoopSpec {
  path: string;
  label: string;
  /** Pola elementu pętli, ścieżki względne (`name`, `cost`). */
  fields: readonly DocumentFieldSpec[];
}

export interface TemplateFieldCatalog {
  fields: readonly DocumentFieldSpec[];
  loops: readonly DocumentLoopSpec[];
}

/** Ścieżka pola pętli w `fields text[]` wersji i w ostrzeżeniach: `parts[].cost`. */
export const loopFieldPath = (loop: string, field: string): string => `${loop}[].${field}`;

/** Odległość edycyjna (Levenshtein) z limitem: powyżej `max` zwraca `max + 1`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    previous = current;
  }
  return Math.min(previous[b.length]!, max + 1);
}

const lastSegment = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/**
 * Najbliższe pole: odległość edycyjna do 2 dla całej ścieżki (bez względu na wielkość liter), potem dla ostatniego
 * segmentu, a na końcu ostatni segment zawarty w drugim (`task.partCost` → `cost`).
 */
export function suggestField(value: string, candidates: readonly string[]): string | undefined {
  const lower = value.toLowerCase();
  const rank = (score: (candidate: string) => number) => {
    let best: { candidate: string; score: number } | undefined;
    for (const candidate of candidates) {
      const s = score(candidate);
      if (s <= 2 && (!best || s < best.score)) best = { candidate, score: s };
    }
    return best?.candidate;
  };
  return (
    rank((c) => editDistance(lower, c.toLowerCase())) ??
    rank((c) => editDistance(lastSegment(value), lastSegment(c))) ??
    rank((c) => {
      const a = lastSegment(value);
      const b = lastSegment(c);
      return b.length >= 3 && a.length >= 3 && (a.endsWith(b) || b.endsWith(a)) ? 0 : 3;
    })
  );
}

export interface TemplateTagValidation {
  issues: TemplateTagIssue[];
  warnings: Array<{ code: 'TEMPLATE_UNUSED_FIELD'; field: string; loop: string | null }>;
  /** Użyte ścieżki (`fields text[]` wersji): pola, pętle i pola pętli jako `parts[].cost`. */
  usedFields: string[];
}

/**
 * Znaczniki względem katalogu rodzaju (ADR 0067): nieznane pole z podpowiedzią i listą pól dostępnych w zakresie
 * (także w pętli), pole pętli poza pętlą, pole logiczne albo lista wstawione jako tekst, warunek na polu, które
 * nie jest logiczne, nieznana pętla, znaczniki zabronione (`@`, wyrażenia, ograniczniki). Nieużyte pola katalogu
 * (poza wspólnymi) to ostrzeżenia, nie błędy.
 */
export function validateTemplateTags(
  tags: readonly TemplateTag[],
  catalog: TemplateFieldCatalog,
): TemplateTagValidation {
  const issues: TemplateTagIssue[] = [];
  const used = new Set<string>();
  const fields = new Map(catalog.fields.map((field) => [field.path, field]));
  const loops = new Map(catalog.loops.map((loop) => [loop.path, loop]));
  const topLevelText = catalog.fields.map((field) => field.path);
  const sections = [
    ...catalog.loops.map((loop) => loop.path),
    ...catalog.fields.filter((f) => f.type === 'boolean').map((f) => f.path),
  ];

  const issue = (code: TemplateTagIssueCode, tag: TemplateTag, extra: Partial<TemplateTagIssue> = {}) =>
    issues.push({ code, tag: tagLabel(tag), file: tag.file, offset: tag.offset, ...extra });

  /** Pole widoczne w zakresie: najpierw pole elementu pętli, potem pola zewnętrzne (jak docxtemplater). */
  const resolve = (path: string, loop: DocumentLoopSpec | null) => {
    const own = loop?.fields.find((field) => field.path === path);
    if (own && loop) return { field: own, key: loopFieldPath(loop.path, own.path) };
    const field = fields.get(path);
    return field ? { field, key: field.path } : null;
  };

  const walk = (tagList: readonly TemplateTag[], loop: DocumentLoopSpec | null) => {
    for (const tag of tagList) {
      const where = loop ? { loop: loop.path } : {};
      if (tag.kind === 'raw') {
        issue('TEMPLATE_RAW_TAG', tag, where);
        continue;
      }
      if (tag.kind === 'delimiters') {
        issue('TEMPLATE_DELIMITERS', tag, where);
        continue;
      }
      if (!parseFieldPath(tag.value)) {
        issue('TEMPLATE_EXPRESSION', tag, where);
        walk(tag.children, loop);
        continue;
      }
      const resolved = resolve(tag.value, loop);
      const loopSpec = loops.get(tag.value);
      if (tag.kind === 'field') {
        if (resolved && resolved.field.type === 'text') used.add(resolved.key);
        else if (resolved || loopSpec) issue('TEMPLATE_FIELD_TYPE', tag, where);
        else {
          const owner = catalog.loops.find((l) => l !== loop && l.fields.some((field) => field.path === tag.value));
          if (owner) issue('TEMPLATE_FIELD_OUT_OF_SCOPE', tag, { loop: owner.path });
          else {
            const available = loop ? loop.fields.map((field) => field.path) : topLevelText;
            const suggestion = suggestField(tag.value, loop ? [...available, ...topLevelText] : available);
            issue('TEMPLATE_UNKNOWN_FIELD', tag, { ...where, available, ...(suggestion ? { suggestion } : {}) });
          }
        }
        continue;
      }
      // Pętla albo warunek (`#`), zaprzeczenie (`^`): lista albo pole logiczne.
      if (loopSpec && !(resolved && resolved.field.type === 'boolean')) {
        used.add(loopSpec.path);
        walk(tag.children, tag.kind === 'loop' ? loopSpec : loop);
        continue;
      }
      if (resolved) {
        if (resolved.field.type === 'boolean') used.add(resolved.key);
        else issue('TEMPLATE_CONDITION_TYPE', tag, where);
        walk(tag.children, loop);
        continue;
      }
      const available = loop
        ? [...loop.fields.filter((f) => f.type === 'boolean').map((f) => f.path), ...sections]
        : sections;
      const suggestion = suggestField(tag.value, available);
      issue('TEMPLATE_UNKNOWN_LOOP', tag, { ...where, available, ...(suggestion ? { suggestion } : {}) });
      walk(tag.children, loop);
    }
  };
  walk(tags, null);

  const warnings: TemplateTagValidation['warnings'] = [];
  for (const field of catalog.fields) {
    if (!field.common && !used.has(field.path))
      warnings.push({ code: 'TEMPLATE_UNUSED_FIELD', field: field.path, loop: null });
  }
  for (const loop of catalog.loops) {
    if (!used.has(loop.path)) {
      warnings.push({ code: 'TEMPLATE_UNUSED_FIELD', field: loop.path, loop: null });
      continue;
    }
    for (const field of loop.fields) {
      if (!field.common && !used.has(loopFieldPath(loop.path, field.path))) {
        warnings.push({ code: 'TEMPLATE_UNUSED_FIELD', field: field.path, loop: loop.path });
      }
    }
  }
  return { issues, warnings, usedFields: [...used].sort() };
}
