/**
 * Etykiety interfejsu z plików tłumaczeń (ADR 0027, ADR 0032). Klient przekazuje swój katalog
 * (JSON z zagnieżdżonymi kluczami), a komponenty używają tylko kluczy. Parametry w formacie
 * ICU MessageFormat, np. `"{count, plural, one {# hulajnoga} few {# hulajnogi} other {# hulajnóg}}"`.
 */
import { IntlMessageFormat } from 'intl-messageformat';

export interface Messages {
  [key: string]: string | Messages;
}

/** Klucze katalogu w notacji kropkowej, np. `fleet.status.AVAILABLE`. */
export type MessageKey<M> = {
  [K in keyof M & string]: M[K] extends string ? K : M[K] extends Messages ? `${K}.${MessageKey<M[K]>}` : never;
}[keyof M & string];

export type MessageValues = Record<string, string | number | boolean | Date | null | undefined>;

export interface Translator<M extends Messages> {
  (key: MessageKey<M>, values?: MessageValues): string;
  /** Wersja dla kluczy składanych w czasie działania (np. `fleet.status.${status}`); brak klucza zwraca klucz. */
  dynamic(key: string, values?: MessageValues): string;
  has(key: string): boolean;
  locale: string;
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function createTranslator<M extends Messages>(messages: M, locale = 'pl'): Translator<M> {
  const cache = new Map<string, IntlMessageFormat>();
  const format = (key: string, values?: MessageValues): string => {
    const source = lookup(messages, key);
    if (source === undefined) return key;
    let compiled = cache.get(key);
    if (!compiled) {
      compiled = new IntlMessageFormat(source, locale);
      cache.set(key, compiled);
    }
    return String(compiled.format(values as Record<string, string | number | boolean | Date>));
  };
  const t = ((key: MessageKey<M>, values?: MessageValues) => format(key, values)) as Translator<M>;
  t.dynamic = format;
  t.has = (key) => lookup(messages, key) !== undefined;
  t.locale = locale;
  return t;
}
