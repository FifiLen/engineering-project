/**
 * Wspólny mechanizm list w panelu (ADR 0031). Zapytanie powstaje wyłącznie z białej listy:
 * pola z definicji zasobu (packages/shared) są przypisane do kolumn widoku albo tabeli, a nazwy
 * przesłane przez klienta służą tylko do wyboru z tej listy. Wartości idą jako parametry zapytania.
 */
import type { FieldDefinition, ListFilter, ListQuery, ListResponse, ResourceDefinition } from '@hulajnogi/shared';
import { and, asc, count, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable, PgView } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '../client.js';

export type ColumnMap<F extends string> = Record<F, AnyPgColumn>;

export interface ListSource<F extends string> {
  from: PgView | PgTable;
  columns: ColumnMap<F>;
  /** Klucz dopisywany na końcu sortowania, żeby kolejność stron była stabilna. */
  id: AnyPgColumn;
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
    asc(source.id),
  ];

  const [rows, totals, ...facetRows] = await Promise.all([
    db
      .select(columns)
      .from(source.from)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(source.from).where(where),
    ...query.facets.map((name) =>
      db
        .select({ value: columns[name]!, count: count() })
        .from(source.from)
        .where(conditions(name))
        .groupBy(columns[name]!),
    ),
  ]);

  const facets: ListResponse<T>['facets'] = {};
  query.facets.forEach((name, i) => {
    facets[name] = Object.fromEntries(facetRows[i]!.map((r) => [String(r.value), r.count]));
  });

  return {
    items: rows.map((r) => normalize(def, r) as T),
    page: query.page,
    pageSize: query.pageSize,
    total: totals[0]!.total,
    facets,
  };
}
