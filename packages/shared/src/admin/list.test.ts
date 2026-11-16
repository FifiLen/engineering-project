import { describe, expect, it } from 'vitest';
import { scooterModelCreateSchema, scooterModelUpdateSchema, scootersResource } from './fleet.js';
import { parseListQuery, toSearchParams } from './list.js';

const parse = (qs: string) => parseListQuery(scootersResource, new URLSearchParams(qs));

describe('kontrakt list (ADR 0031)', () => {
  it('bez parametrów zwraca sortowanie domyślne i pierwszą stronę', () => {
    expect(parse('')).toEqual({
      ok: true,
      query: { filters: [], sort: [{ field: 'number', desc: false }], page: 1, pageSize: 25, facets: [] },
    });
  });

  it('rozumie listę wartości, zakresy, sortowanie malejące i liczniki', () => {
    const result = parse(
      'fleetStatus=AVAILABLE,LOW_BATTERY&batteryPct.lte=20&sort=-lastSeenAt,number&page=2&pageSize=10&facets=fleetStatus&q=%230142',
    );
    expect(result).toEqual({
      ok: true,
      query: {
        q: '#0142',
        filters: [
          { field: 'fleetStatus', op: 'eq', values: ['AVAILABLE', 'LOW_BATTERY'] },
          { field: 'batteryPct', op: 'lte', values: [20] },
        ],
        sort: [
          { field: 'lastSeenAt', desc: true },
          { field: 'number', desc: false },
        ],
        page: 2,
        pageSize: 10,
        facets: ['fleetStatus'],
      },
    });
  });

  it('odrzuca nieznane pole, operator, wartość, sortowanie i rozmiar strony', () => {
    const result = parse(
      'passwordHash=x&modelName.gte=a&fleetStatus=BROKEN&sort=serialNumber,-lat&pageSize=500&facets=number',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => [i.param, i.code])).toEqual([
      ['passwordHash', 'UNKNOWN_PARAM'],
      ['modelName.gte', 'UNSUPPORTED_OPERATOR'],
      ['fleetStatus', 'INVALID_VALUE'],
      ['pageSize', 'INVALID_PAGE'],
      ['facets', 'UNKNOWN_FACET'],
      ['sort', 'UNKNOWN_SORT'],
    ]);
  });

  it('sprawdza typy wartości: liczby, daty, identyfikatory', () => {
    expect(parse('number.gte=abc').ok).toBe(false);
    expect(parse('lastSeenAt.gte=2026-11-01').ok).toBe(true);
    expect(parse('lastSeenAt.gte=wczoraj').ok).toBe(false);
    expect(parse('modelId=not-a-uuid').ok).toBe(false);
    expect(parse('online=true').ok).toBe(true);
  });

  it('zapisuje stan listy w adresie i odczytuje go bez zmian', () => {
    const result = parse('fleetStatus=OFFLINE&sort=-batteryPct&page=3');
    if (!result.ok) throw new Error('niepoprawne zapytanie');
    const params = toSearchParams(scootersResource, result.query);
    expect(params.toString()).toBe('fleetStatus=OFFLINE&sort=-batteryPct&page=3');
    expect(parseListQuery(scootersResource, params)).toEqual(result);
  });
});

describe('formularze modeli', () => {
  it('tworzenie uzupełnia pola opcjonalne', () => {
    expect(scooterModelCreateSchema.parse({ code: 'X-200', name: 'Model X' })).toMatchObject({
      manufacturer: null,
      rangeKm: null,
      active: true,
    });
  });

  it('edycja zmienia tylko podane pola i wymaga wersji', () => {
    expect(scooterModelUpdateSchema.parse({ version: 2, rangeKm: 40 })).toEqual({ version: 2, rangeKm: 40 });
    expect(scooterModelUpdateSchema.safeParse({ rangeKm: 40 }).success).toBe(false);
  });

  it('kod modelu to wielkie litery, cyfry i myślniki', () => {
    expect(scooterModelCreateSchema.safeParse({ code: 'x 1', name: 'Model' }).success).toBe(false);
  });
});
