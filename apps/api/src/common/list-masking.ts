import { DomainError } from '@hulajnogi/core';
import { personalFields, type ListQuery, type ListResponse, type ResourceDefinition } from '@hulajnogi/shared';

/**
 * Lista bez danych klienta dla operatora bez `users.read` (jak zgłoszenia, wysłane powiadomienia i wydruki): filtr
 * albo sortowanie po danych osobowych to `403 FORBIDDEN`, wyszukiwanie ich pomija, a wartości wracają jako `null`
 * (panel pokazuje „Klient”). Ta sama ścieżka obsługuje `GET` listy i eksport (ADR 0073).
 */
export async function listWithCustomerData<T, D extends ResourceDefinition>(
  def: D,
  query: ListQuery,
  seesCustomers: boolean,
  run: (query: ListQuery, def: D) => Promise<ListResponse<T>>,
  fields: readonly string[] = personalFields(def),
): Promise<ListResponse<T>> {
  if (seesCustomers) return run(query, def);
  const personal = (field: string) => fields.includes(field);
  if (query.filters.some((f) => personal(f.field)) || query.sort.some((s) => personal(s.field))) {
    throw new DomainError('FORBIDDEN', { permission: 'users.read' });
  }
  const result = await run(query, { ...def, search: def.search.filter((f) => !personal(f)) });
  const hidden = Object.fromEntries(fields.map((f) => [f, null]));
  return { ...result, items: result.items.map((item) => ({ ...item, ...hidden }) as T) };
}

/** Szczegóły rekordu bez danych klienta (te same pola co na liście, `null` bez `users.read`). */
export function withoutCustomerData<T extends object>(item: T, fields: readonly (keyof T & string)[]): T {
  return { ...item, ...Object.fromEntries(fields.map((f) => [f, null])) };
}
