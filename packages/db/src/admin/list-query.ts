/**
 * Wspólny mechanizm list w panelu (ADR 0031). Zapytanie powstaje wyłącznie z białej listy:
 * pola z definicji zasobu (packages/shared) są przypisane do kolumn widoku albo tabeli, a nazwy
 * przesłane przez klienta służą tylko do wyboru z tej listy. Wartości idą jako parametry zapytania.
 */
import type { FieldDefinition, ListFilter, ListQuery, ListResponse, ResourceDefinition } from '@hulajnogi/shared';
import { and, asc, count, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { PgTransaction, type AnyPgColumn, type PgTable, type PgView } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '../client.js';

export type ColumnMap<F extends string> = Record<F, AnyPgColumn>;

export interface ListSource<F extends string> {
  from: PgView | PgTable;
  columns: ColumnMap<F>;
  /**
   * Klucz dopisywany na końcu sortowania, żeby kolejność stron była stabilna; klucz złożony (np. obecność w strefach:
   * hulajnoga i strefa) jako lista kolumn w kolejności rozstrzygania.
   */
  id: AnyPgColumn | readonly AnyPgColumn[];
  /** Warunek stały źródła, np. ukrycie rekordów usuniętych. */
  where?: SQL;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function toSqlValue(field: FieldDefinition, value: string | number | boolean): unknown {
  return field.type === 'datetime' ? new Date(value as string) : value;
}

function filterCondition(column: AnyPgColumn, field: FieldDefinition, filter: ListFilter): SQL | undefined {
  const values = filter.values.map((v) => toSqlValue(field, v));
  switch (filter.op) {
    case 'eq':
      if (field.array) {
        // Część wspólna tablic (`&&`): rekord ma którąkolwiek z wartości. Typ elementu z białej listy; kolumna
        // tablicy wyliczenia (np. kategorie zgłoszenia) porównuje się jako tekst.
        const elementType = sql.raw(field.type === 'uuid' ? 'uuid' : 'text');
        return sql`${column}::${elementType}[] && ARRAY[${sql.join(
          values.map((v) => sql`${v}`),
          sql`, `,
        )}]::${elementType}[]`;
      }
      return values.length === 1 ? eq(column, values[0]) : inArray(column, values);
    case 'gte':
      return gte(column, values[0]);
    case 'lte':
      return lte(column, values[0]);
    case 'contains':
      return ilike(column, `%${escapeLike(String(values[0]))}%`);
  }
}

/** Wyszukiwanie `q`: pola tekstowe fragmentem, liczbowe dokładnie (`#0142` i `142` znajdują hulajnogę 142). */
function searchCondition<F extends string>(def: ResourceDefinition<F>, columns: ColumnMap<F>, q: string): SQL {
  const number = /^#?0*(\d{1,9})$/.exec(q)?.[1];
  const parts = def.search.flatMap((name): SQL[] => {
    const type = def.fields[name].type;
    if (type === 'text') return [ilike(columns[name], `%${escapeLike(q)}%`)];
    if (type === 'integer' && number !== undefined) return [eq(columns[name], Number(number))];
    return [];
  });
  return parts.length ? or(...parts)! : sql`false`;
}

function normalize<F extends string>(def: ResourceDefinition<F>, row: Record<string, unknown>): Record<F, unknown> {
  for (const [name, field] of Object.entries<FieldDefinition>(def.fields)) {
    // numeric z PostgreSQL przychodzi jako tekst.
    if (field.type === 'decimal' && typeof row[name] === 'string') row[name] = Number(row[name]);
  }
  return row as Record<F, unknown>;
}

export async function runListQuery<F extends string, T = Record<F, unknown>>(
  db: DbExecutor,
  def: ResourceDefinition<F>,
  source: ListSource<F>,
  query: ListQuery,
): Promise<ListResponse<T>> {
  const fields = def.fields as Record<string, FieldDefinition>;
  const columns = source.columns as Record<string, AnyPgColumn>;
  const conditions = (skipField?: string): SQL | undefined =>
    and(
      source.where,
      query.q ? searchCondition(def, source.columns, query.q) : undefined,
      ...query.filters
        .filter((f) => f.field !== skipField)
        .map((f) => filterCondition(columns[f.field]!, fields[f.field]!, f)),
    );

  const where = conditions();
  const orderBy = [
    // Puste wartości zawsze na końcu, niezależnie od kierunku.
    ...query.sort.map((s) => sql`${columns[s.field]} ${s.desc ? sql`desc` : sql`asc`} nulls last`),
    ...(Array.isArray(source.id) ? source.id : [source.id as AnyPgColumn]).map((column) => asc(column)),
  ];

  const offset = (query.page - 1) * query.pageSize;
  const page = () =>
    db
      .select(columns)
      .from(source.from)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset(offset);
  const total = () =>
    query.withTotal === false
      ? Promise.resolve(null)
      : db
          .select({ total: count() })
          .from(source.from)
          .where(where)
          .then((r) => r[0]!.total);
  const facet = (name: string) =>
    db
      .select({ value: columns[name]!, count: count() })
      .from(source.from)
      .where(conditions(name))
      .groupBy(columns[name]!);

  // Transakcja ma jedno połączenie: zapytania po kolei (równoległe `query` na jednym kliencie `pg` są przestarzałe
  // i i tak czekają w kolejce); poza transakcją każde zapytanie bierze własne połączenie z puli.
  let rows: Awaited<ReturnType<typeof page>>;
  let totalCount: number | null;
  let facetRows: Awaited<ReturnType<typeof facet>>[];
  if (db instanceof PgTransaction) {
    rows = await page();
    totalCount = await total();
    facetRows = [];
    for (const name of query.facets) facetRows.push(await facet(name));
  } else {
    [rows, totalCount, ...facetRows] = await Promise.all([page(), total(), ...query.facets.map(facet)]);
  }

  const facets: ListResponse<T>['facets'] = {};
  query.facets.forEach((name, i) => {
    facets[name] = Object.fromEntries(facetRows[i]!.map((r) => [String(r.value), r.count]));
  });

  return {
    items: rows.map((r) => normalize(def, r) as T),
    page: query.page,
    pageSize: query.pageSize,
    total: totalCount ?? offset + rows.length,
    facets,
  };
}

/**
 * Wszystkie strony listy partiami (eksport list, ADR 0073): to samo zapytanie, sortowanie listy z identyfikatorem
 * na końcu i strony po `batch` wierszy, bez liczników. Wywołujący otwiera transakcję `REPEATABLE READ READ ONLY`,
 * więc partie widzą te same dane, a limit wierszy sprawdza wcześniej osobnym zliczeniem; funkcja listy może
 * pominąć `count(*)` (`withTotal: false`), bo koniec wyznacza partia krótsza od `batch`.
 */
export async function* listPages<T>(
  list: (query: ListQuery) => Promise<ListResponse<T>>,
  query: ListQuery,
  batch = 1000,
): AsyncGenerator<T[]> {
  for (let page = 1; ; page++) {
    const result = await list({ ...query, page, pageSize: batch, facets: [] });
    if (result.items.length) yield result.items;
    if (result.items.length < batch) return;
  }
}
