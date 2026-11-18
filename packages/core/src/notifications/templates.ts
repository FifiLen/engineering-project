import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';
import { DomainError } from '../errors.js';

/**
 * Szablony powiadomień w ICU MessageFormat (ADR 0058, wymaganie 17). Rejestr kodów i parametrów jest w
 * packages/shared; core dostaje parametry kodu jako dane, więc nie zależy od rejestru. Walidacja działa przy
 * każdej zmianie w edytorze (podgląd przez API) i przy zapisie.
 */
export const NOTIFICATION_CHANNELS = ['PUSH', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** `text` i `number` z API (kwoty i daty API formatuje przed renderowaniem), `select` z listą wartości. */
export const TEMPLATE_PARAM_TYPES = ['text', 'number', 'select'] as const;
export type TemplateParamType = (typeof TEMPLATE_PARAM_TYPES)[number];

export interface TemplateParamSpec {
  name: string;
  type: TemplateParamType;
  /** Wartości parametru `select`; szablon może dodać tylko gałąź `other`. */
  options?: readonly string[];
  /** Parametr, bez którego wiadomość traci sens (np. kod w SMS logowania): szablon musi go użyć. */
  required?: boolean;
}

/** Limity znaków źródła szablonu (licznik w edytorze); SMS ma jedną wiadomość bez tytułu. */
export const TEMPLATE_LIMITS = { title: 50, body: 240, smsBody: 160 } as const;

export type TemplateField = 'title' | 'body';

export interface TemplateSource {
  channel: NotificationChannel;
  title: string | null;
  body: string;
}

export type TemplateIssueCode =
  | 'TEMPLATE_SYNTAX_ERROR'
  | 'TEMPLATE_UNKNOWN_PARAM'
  | 'TEMPLATE_PARAM_TYPE'
  | 'TEMPLATE_UNKNOWN_OPTION'
  | 'TEMPLATE_MISSING_PARAM'
  | 'TEMPLATE_TOO_LONG'
  | 'VALIDATION_FAILED';

/** Problem w szablonie; `line` i `column` liczone od 1, jak w komunikacie edytora „Wiersz 5, znak 42”. */
export interface TemplateIssue {
  code: TemplateIssueCode;
  field: TemplateField;
  line?: number;
  column?: number;
  /** Rodzaj błędu parsera, np. `EXPECT_ARGUMENT_CLOSING_BRACE`. */
  kind?: string;
  param?: string;
  option?: string;
  max?: number;
  length?: number;
}

/** Znaki widoczne dla operatora (punkty kodowe, nie jednostki UTF-16). */
const length = (text: string) => [...text].length;

const PARSER_OPTIONS = { ignoreTag: true, requiresOtherClause: true, captureLocation: true } as const;

/** Elementy, które potrzebują liczby: odmiana i format liczbowy. */
const NUMERIC = new Set<TYPE>([TYPE.number, TYPE.plural]);

function checkElements(
  elements: readonly MessageFormatElement[],
  params: ReadonlyMap<string, TemplateParamSpec>,
  field: TemplateField,
  issues: TemplateIssue[],
  used: Set<string>,
): void {
  for (const element of elements) {
    if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
    if (element.type === TYPE.tag) {
      checkElements(element.children, params, field, issues, used);
      continue;
    }
    used.add(element.value);
    const where = { line: element.location?.start.line, column: element.location?.start.column };
    const spec = params.get(element.value);
    if (!spec) {
      issues.push({ code: 'TEMPLATE_UNKNOWN_PARAM', field, param: element.value, ...where });
    } else if (element.type === TYPE.date || element.type === TYPE.time) {
      issues.push({ code: 'TEMPLATE_PARAM_TYPE', field, param: element.value, ...where });
    } else if (NUMERIC.has(element.type) && spec.type !== 'number') {
      issues.push({ code: 'TEMPLATE_PARAM_TYPE', field, param: element.value, ...where });
    } else if (element.type === TYPE.select && spec.type === 'number') {
      issues.push({ code: 'TEMPLATE_PARAM_TYPE', field, param: element.value, ...where });
    } else if (element.type === TYPE.select && spec.options) {
      for (const option of Object.keys(element.options)) {
        if (option !== 'other' && !spec.options.includes(option)) {
          issues.push({ code: 'TEMPLATE_UNKNOWN_OPTION', field, param: element.value, option, ...where });
        }
      }
    }
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      for (const option of Object.values(element.options)) checkElements(option.value, params, field, issues, used);
    }
  }
}

function checkText(
  text: string,
  field: TemplateField,
  max: number,
  params: ReadonlyMap<string, TemplateParamSpec>,
  issues: TemplateIssue[],
  used: Set<string>,
): void {
  if (length(text) > max) issues.push({ code: 'TEMPLATE_TOO_LONG', field, max, length: length(text) });
  let elements: MessageFormatElement[];
  try {
    elements = parse(text, PARSER_OPTIONS);
  } catch (error) {
    const syntax = error as SyntaxError & { location?: { start: { line: number; column: number } } };
    issues.push({
      code: 'TEMPLATE_SYNTAX_ERROR',
      field,
      kind: syntax.message,
      line: syntax.location?.start.line,
      column: syntax.location?.start.column,
    });
    return;
  }
  checkElements(elements, params, field, issues, used);
}

/**
 * Wszystkie problemy szablonu (edytor pokazuje je naraz): składnia z wierszem i znakiem, parametry spoza rejestru,
 * parametr niezgodny z typem (odmiana tylko dla liczb, bez formatów dat), wartości `select` spoza rejestru,
 * limity znaków, wymagana treść i tytuł tylko w push, parametry wymagane przez rejestr (np. `code` w `login_code`:
 * SMS bez kodu zablokowałby logowanie) użyte w tytule albo treści.
 */
export function templateIssues(template: TemplateSource, params: readonly TemplateParamSpec[]): TemplateIssue[] {
  const registry = new Map(params.map((p) => [p.name, p]));
  const issues: TemplateIssue[] = [];
  const used = new Set<string>();
  const title = template.title?.trim() ? template.title : null;
  if (template.channel === 'PUSH') {
    if (!title) issues.push({ code: 'VALIDATION_FAILED', field: 'title' });
    else checkText(title, 'title', TEMPLATE_LIMITS.title, registry, issues, used);
  } else if (title) {
    issues.push({ code: 'VALIDATION_FAILED', field: 'title' });
  }
  if (!template.body.trim()) issues.push({ code: 'VALIDATION_FAILED', field: 'body' });
  else {
    const max = template.channel === 'SMS' ? TEMPLATE_LIMITS.smsBody : TEMPLATE_LIMITS.body;
    checkText(template.body, 'body', max, registry, issues, used);
  }
  // Brak parametru wymaganego zgłaszamy tylko przy poprawnej składni (przy błędzie parser nie widzi parametrów).
  if (!issues.some((i) => i.code === 'TEMPLATE_SYNTAX_ERROR' || i.code === 'VALIDATION_FAILED')) {
    for (const spec of params) {
      if (spec.required && !used.has(spec.name)) {
        issues.push({ code: 'TEMPLATE_MISSING_PARAM', field: 'body', param: spec.name });
      }
    }
  }
  return issues;
}

/** Walidacja przy zapisie: pierwszy problem jako błąd domeny, a pełna lista w `details.issues`. */
export function validateTemplate(template: TemplateSource, params: readonly TemplateParamSpec[]): void {
  const issues = templateIssues(template, params);
  const [first] = issues;
  if (first) throw new DomainError(first.code, { ...first, issues });
}

export type TemplateValues = Record<string, string | number | boolean>;

export interface RenderedNotification {
  title: string | null;
  body: string;
}

function format(text: string, values: TemplateValues, locale: string, field: TemplateField): string {
  // `select` porównuje tekst, więc wartości logiczne trafiają jako `true`/`false`.
  const normalized = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v]),
  );
  try {
    return String(new IntlMessageFormat(text, locale, undefined, { ignoreTag: true }).format(normalized));
  } catch (error) {
    throw new DomainError('TEMPLATE_RENDER_FAILED', { field, message: (error as Error).message });
  }
}

/**
 * Treść powiadomienia z wersji szablonu z chwili wysyłki (ADR 0058), lokalizacja `pl` (odmiana liczebników).
 * Brak wartości parametru kończy się `TEMPLATE_RENDER_FAILED`.
 */
export function renderTemplate(
  template: Pick<TemplateSource, 'title' | 'body'>,
  values: TemplateValues,
  locale = 'pl',
): RenderedNotification {
  return {
    title: template.title?.trim() ? format(template.title, values, locale, 'title') : null,
    body: format(template.body, values, locale, 'body'),
  };
}
