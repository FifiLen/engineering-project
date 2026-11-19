/**
 * Kontrakt list w panelu (ADR 0031): definicja zasobu jest białą listą pól, filtrów i sortowań, a ten
 * moduł zamienia parametry adresu na zapytanie i z powrotem. Używają go API (walidacja) i panel (stan
 * listy w adresie URL), więc obie strony rozumieją parametry tak samo.
 */
import type { z } from 'zod';

export type FieldType = 'text' | 'integer' | 'decimal' | 'boolean' | 'enum' | 'datetime' | 'uuid';

/** `eq` przyjmuje też listę wartości po przecinku (`status=AVAILABLE,IN_USE`). */
export type FilterOperator = 'eq' | 'gte' | 'lte' | 'contains';

export interface FieldDefinition {
  type: FieldType;
  /** Dozwolone wartości pola typu `enum`. */
  values?: readonly string[];
  filters?: readonly FilterOperator[];
  sortable?: boolean;
  /** Liczniki wartości dla szybkich filtrów (`facets=status`). */
  facet?: boolean;
  /**
   * Kolumna jest tablicą wartości typu `type` (np. role operatora). Filtr `eq` wybiera rekordy, które
   * mają którąkolwiek z podanych wartości; pole tablicowe nie ma sortowania ani liczników.
   */
  array?: boolean;
  /**
   * Dane osobowe (ADR 0073): imię i nazwisko, telefon, e-mail i miejsca klienta oraz dane kontaktowe operatora
   * na listach operatorów. Okno eksportu listy ostrzega, gdy plik zawiera takie kolumny; maskowanie bez
   * `users.read` robi API tak samo jak w liście. Autor zmiany albo wykonawca (np. `updatedByName`) nie jest oznaczony.
   */
  personal?: boolean;
  /** Kwota w groszach (`integer`): eksport XLSX zapisuje ją jako liczbę w złotych z formatem `#,##0.00 "zł"`. */
  money?: boolean;
}

/** Usuwanie: zwykłe, archiwizacja (rekord zostaje, znika z oferty), wycofanie z floty, brak. */
export type DeleteMode = 'delete' | 'archive' | 'retire' | 'none';

export interface ResourceDefinition<F extends string = string> {
  /** Nazwa w adresie: `GET /admin/<name>`, klucze tłumaczeń `resource.<name>.*`. */
  name: string;
  fields: Readonly<Record<F, FieldDefinition>>;
  /** Pola przeszukiwane parametrem `q`: tekstowe fragmentem, liczbowe dokładnie. */
  search: readonly F[];
  /** Klucze sortowania, `-` oznacza malejąco. */
  defaultSort: readonly string[];
  deleteMode: DeleteMode;
  /** Uprawnienia z katalogu w packages/core (ADR 0028); sprawdzane od iteracji 2. */
  permissions: { read: string; write?: string; delete?: string };
  createSchema?: z.ZodType;
  updateSchema?: z.ZodType;
}

export type FilterValue = string | number | boolean;

export interface ListFilter {
  field: string;
  op: FilterOperator;
  values: FilterValue[];
}

export interface ListSort {
  field: string;
  desc: boolean;
}

export interface ListQuery {
  q?: string;
  filters: ListFilter[];
  sort: ListSort[];
  page: number;
  pageSize: number;
  facets: string[];
  /**
   * `false`: bez `count(*)` (kolejne partie eksportu listy, ADR 0073); `total` jest wtedy liczbą wierszy do końca
   * tej strony, nie liczbą wszystkich. Nie pochodzi z adresu listy.
   */
  withTotal?: boolean;
}

export interface ListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  /** Liczba rekordów dla każdej wartości pola przy pozostałych filtrach (bez filtra tego pola). */
  facets: Record<string, Record<string, number>>;
}

export interface ListIssue {
  /** Parametr, którego dotyczy błąd, np. `status`, `battery.gte`, `sort`. */
  param: string;
  code: 'UNKNOWN_PARAM' | 'UNSUPPORTED_OPERATOR' | 'INVALID_VALUE' | 'UNKNOWN_SORT' | 'INVALID_PAGE' | 'UNKNOWN_FACET';
  message: string;
}

export type ListQueryResult = { ok: true; query: ListQuery } | { ok: false; issues: ListIssue[] };

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const PAGE_SIZES = [10, 25, 50, 100] as const;

const RESERVED = new Set(['q', 'sort', 'page', 'pageSize', 'facets']);
const OPERATORS: readonly FilterOperator[] = ['gte', 'lte', 'contains'];

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function entries(params: Params): Array<[string, string]> {
  if (params instanceof URLSearchParams) return [...params.entries()];
  return Object.entries(params).flatMap(([k, v]) =>
    v === undefined ? [] : Array.isArray(v) ? v.map((x): [string, string] => [k, x]) : [[k, v] as [string, string]],
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zamienia tekst z adresu na wartość pola; `undefined` oznacza wartość niepoprawną. */
export function parseFieldValue(field: FieldDefinition, raw: string): FilterValue | undefined {
  switch (field.type) {
    case 'integer':
      return /^-?\d+$/.test(raw) ? Number(raw) : undefined;
    case 'decimal':
      return raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'enum':
      return field.values?.includes(raw) ? raw : undefined;
    case 'datetime':
      return ISO_DATE.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
    case 'uuid':
      return UUID.test(raw) ? raw.toLowerCase() : undefined;
    case 'text':
      return raw;
  }
}

/** Waliduje parametry listy względem definicji; nieznany parametr, operator lub klucz sortowania to błąd. */
export function parseListQuery(def: ResourceDefinition, params: Params): ListQueryResult {
  const issues: ListIssue[] = [];
  const query: ListQuery = { filters: [], sort: [], page: 1, pageSize: DEFAULT_PAGE_SIZE, facets: [] };
  const fields = def.fields as Record<string, FieldDefinition>;
  // Tylko własne pola definicji (nie `constructor` ani `toString` z prototypu obiektu).
  const own = (name: string): FieldDefinition | undefined => (Object.hasOwn(fields, name) ? fields[name] : undefined);
  let sortParam: string | undefined;

  for (const [key, raw] of entries(params)) {
    if (RESERVED.has(key)) {
      if (key === 'q') query.q = raw.trim() || undefined;
      if (key === 'sort') sortParam = raw;
      if (key === 'page' || key === 'pageSize') {
        const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
        const max = key === 'page' ? Number.MAX_SAFE_INTEGER : MAX_PAGE_SIZE;
        if (!(n >= 1 && n <= max))
          issues.push({ param: key, code: 'INVALID_PAGE', message: `${key} musi być liczbą od 1 do ${max}` });
        else query[key] = n;
      }
      if (key === 'facets') {
        for (const name of raw.split(',').filter(Boolean)) {
          if (!own(name)?.facet)
            issues.push({ param: key, code: 'UNKNOWN_FACET', message: `Brak liczników dla pola ${name}` });
          else if (!query.facets.includes(name)) query.facets.push(name);
        }
      }
      continue;
    }

    const dot = key.lastIndexOf('.');
    const suffix = dot > 0 ? key.slice(dot + 1) : '';
    const isOperator = (OPERATORS as readonly string[]).includes(suffix);
    const name = isOperator ? key.slice(0, dot) : key;
    const op: FilterOperator = isOperator ? (suffix as FilterOperator) : 'eq';
    const field = own(name);
    if (!field) {
      issues.push({ param: key, code: 'UNKNOWN_PARAM', message: `Nieznany parametr ${key}` });
      continue;
    }
    if (!field.filters?.includes(op)) {
      issues.push({ param: key, code: 'UNSUPPORTED_OPERATOR', message: `Pole ${name} nie obsługuje filtra ${op}` });
      continue;
    }
    const rawValues = op === 'eq' && field.type !== 'text' ? raw.split(',') : [raw];
    const values = rawValues.map((v) => parseFieldValue(field, v));
    if (values.some((v) => v === undefined) || (op === 'contains' && raw.trim() === '')) {
      issues.push({ param: key, code: 'INVALID_VALUE', message: `Nieprawidłowa wartość parametru ${key}` });
      continue;
    }
    query.filters.push({ field: name, op, values: values as FilterValue[] });
  }

  for (const key of (sortParam ?? def.defaultSort.join(',')).split(',').filter(Boolean)) {
    const desc = key.startsWith('-');
    const name = desc ? key.slice(1) : key;
    if (!own(name)?.sortable)
      issues.push({ param: 'sort', code: 'UNKNOWN_SORT', message: `Nie można sortować po ${name}` });
    else if (!query.sort.some((s) => s.field === name)) query.sort.push({ field: name, desc });
  }

  return issues.length ? { ok: false, issues } : { ok: true, query };
}

/** Pola z danymi osobowymi w definicji zasobu (ostrzeżenie w oknie eksportu, ADR 0073). */
export const personalFields = (def: ResourceDefinition): string[] =>
  Object.entries<FieldDefinition>(def.fields as Record<string, FieldDefinition>)
    .filter(([, field]) => field.personal)
    .map(([name]) => name);

/**
 * Pola z danymi klienta, które API maskuje bez `users.read` (ADR 0055, ADR 0073): pola `personal` bez danych
 * kontaktowych operatora (`staff*` i zasób `staff`, chronione uprawnieniem `staff.read`). Panel nie sortuje po nich
 * bez `users.read` i pokazuje w nich „Klient”; okno eksportu mówi, że te kolumny będą puste.
 */
export const customerDataFields = (def: ResourceDefinition): string[] =>
  def.name === 'staff' ? [] : personalFields(def).filter((name) => !name.startsWith('staff'));

/** Odwrotność `parseListQuery`: parametry adresu dla stanu listy (pomija wartości domyślne). */
export function toSearchParams(def: ResourceDefinition, query: Partial<ListQuery>): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  for (const f of query.filters ?? []) {
    params.append(f.op === 'eq' ? f.field : `${f.field}.${f.op}`, f.values.map(String).join(','));
  }
  const sort = (query.sort ?? []).map((s) => (s.desc ? `-${s.field}` : s.field)).join(',');
  if (sort && sort !== def.defaultSort.join(',')) params.set('sort', sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.pageSize && query.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(query.pageSize));
  if (query.facets?.length) params.set('facets', query.facets.join(','));
  return params;
}
