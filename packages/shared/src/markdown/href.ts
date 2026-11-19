/**
 * Dozwolone adresy odnośników i przycisków (ADR 0063): `https:`, `mailto:`, `tel:`, ścieżka zaczynająca się od
 * jednego `/` albo kotwica `#`. Ta sama reguła działa w treści Markdown, w adresie przycisku bloku (core), w `CHECK`
 * bazy `content_blocks_cta_url` (migracja 0012, wcześniej słabszy wzorzec z 0011) i ponownie przy renderowaniu
 * (strona i aplikacja pokazują przycisk tylko z dozwolonym adresem); `http:`, `javascript:`, `data:`, adres względny
 * bez `/` i `/\host` są odrzucane.
 */

/** Najdłuższy adres przyjmowany w treści i w przycisku. */
export const HREF_MAX_LENGTH = 2000;

/**
 * Wzorzec dozwolonego adresu w składni zgodnej z wyrażeniami regularnymi PostgreSQL (do skopiowania w `CHECK`).
 * Bez białych znaków i ukośnika wstecznego (przeglądarka czyta `/\host` jak `//host`); po `https://` musi być host,
 * a ścieżka nie zaczyna się od `//` (adres bez schematu prowadziłby do innej domeny).
 */
export const ALLOWED_HREF_PATTERN =
  /^(https:\/\/[^/\s\\][^\s\\]*|mailto:[^\s\\]+|tel:\+?[0-9][0-9-]*|#[^\s\\]*|\/([^/\s\\][^\s\\]*)?)$/;

const hasControlCharacters = (value: string): boolean => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

/** Adres z białej listy schematów (ADR 0063); aplikacja sprawdza go ponownie przed `Linking.openURL`. */
export function isAllowedHref(href: string): boolean {
  if (!href || href.length > HREF_MAX_LENGTH || hasControlCharacters(href)) return false;
  return ALLOWED_HREF_PATTERN.test(href);
}

/** Podpowiedź do komunikatu błędu: `http:` da się zwykle zamienić na `https:`. */
export const hrefHint = (href: string): 'https' | null => (/^http:/i.test(href) ? 'https' : null);
