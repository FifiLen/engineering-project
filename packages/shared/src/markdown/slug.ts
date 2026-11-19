/**
 * Kotwice nagłówków i adresy z tytułów (ADR 0063): bez znaków diakrytycznych, małe litery i cyfry rozdzielone
 * `-`. Ta sama funkcja tworzy slug aktualności z tytułu (ADR 0062) i podpowiada klucz grafiki z nazwy pliku
 * (ADR 0064), więc adresy na stronie i w panelu wyglądają tak samo.
 */

/** Wynik dla tekstu bez liter i cyfr (np. same znaki interpunkcyjne). */
export const EMPTY_SLUG = 'sekcja';

/**
 * „Zażółć gęślą jaźń” → `zazolc-gesla-jazn`: NFKD i usunięcie znaków łączących, `ł → l` (litera nie rozkłada się
 * w NFKD), małe litery, ciągi spoza `[a-z0-9]` jako `-`, przycięcie `-` na brzegach. `maxLength` skraca wynik
 * bez urwanego `-` na końcu.
 */
export function headingId(text: string, maxLength = 80): string {
  const slug = text
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, '');
  return slug || EMPTY_SLUG;
}

/** Kotwice jednego dokumentu: powtórzenia dostają `-2`, `-3` w kolejności wystąpienia. */
export function createSlugger(maxLength = 80): (text: string) => string {
  const used = new Set<string>();
  return (text) => {
    const base = headingId(text, maxLength);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}

/**
 * Podpowiedź klucza grafiki z nazwy pliku (ADR 0064): `Aktualność Kampus.webp` → `aktualnosc-kampus`, przy kolizji
 * z istniejącym kluczem przyrostek `-2`, `-3`.
 */
export function mediaKeyFromFileName(fileName: string, taken: Iterable<string> = []): string {
  const base = headingId(fileName.replace(/\.[A-Za-z0-9]{1,5}$/, ''), 60);
  const used = new Set(taken);
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}
