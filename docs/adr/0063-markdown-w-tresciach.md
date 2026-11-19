# ADR 0063: Markdown w treściach

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

Treści w bazie (dokumenty prawne, bloki, odpowiedzi FAQ, aktualności) są w Markdown, jak przewiduje [ADR 0027](0027-tresci-sterowane-z-panelu.md). Dziś działają dwa różne parsery:
- podgląd w panelu (`MarkdownPreview` w `components/admin/access/documents.tsx`) obsługuje nagłówki, listy i pogrubienie;
- aplikacja (`components/markdown.tsx`) dzieli dokument na sekcje po `#` i zna tylko pogrubienie.

Strona promocyjna byłaby trzecim parserem. Dokumenty startowe (`packages/db/seed/documents/*.md`) używają `##`, list numerowanych, pogrubienia i znaczników w nawiasach (`[nazwa]`, `[WIEK]`), które nie są odnośnikami. Seed usuwa komentarz HTML z pierwszej linii.

Odpowiedź autora na pytanie 9: Markdown z podglądem w ograniczonym zakresie, bez HTML i bez WYSIWYG. Z planszy `tresci-blok-edycja` wynika jeszcze, że:
- rejestr sekcji zawęża składnię (w hero bez nagłówków);
- błąd podaje wiersz i blokuje zapis;
- podgląd pomija błędny wiersz;
- spis treści dokumentu na stronie powstaje z nagłówków `##`, a kotwice są bez znaków diakrytycznych (`strona-dokument`).

Sprawdzone w rejestrze npm 18 listopada 2026 (najnowsze wersje starsze niż 3 dni):
- **`marked`** 18.2.0 (9 listopada; 18.2.1 z 16 listopada jest za świeża): tylko ESM, Node ≥ 20, bez zależności. Lekser daje tokeny pełnego CommonMark i GFM, w tym `html`, `table` i `code`, które trzeba by odfiltrować.
- **`mdast-util-from-markdown`** 2.1.0 (3 października) na `micromark` 4.0.3: tylko ESM, kilkanaście pakietów `micromark-*` i `debug`. Daje dokładne pozycje węzłów.
- **`markdown-it`** 15.0.3: generuje HTML.
- **Sanityzacja** byłaby potrzebna tylko przy HTML: `dompurify` 3.4.18 (14 listopada, wymaga DOM) albo `sanitize-html` 2.18.2 (11 listopada, Node ≥ 22.12, nie działa w React Native).

## Rozważane opcje

1. **`marked` z lekserem i filtrem tokenów.** Dojrzały parser, ale pełna składnia jest szersza niż podzbiór. Pozycje błędów trzeba liczyć z surowego tekstu tokenów, a obsługa w React Native wymaga sprawdzenia ESM w Metro.
2. **`mdast-util-from-markdown`.** Najlepsze pozycje i drzewo, ale kilkanaście zależności w trzech klientach, żeby obsłużyć sześć konstrukcji.
3. **Własny parser podzbioru w `packages/shared`.** Około 300 wierszy TypeScript bez zależności, bez DOM i `node:*`. Działa tak samo w Node, Next.js i React Native, a błędy mają wiersz i kolumnę z definicji. Kosztem jest własny kod i testy.
4. **Biblioteka generująca HTML z sanityzacją.** Odrzucona przez autora (pytanie 9): wymaga `dangerouslySetInnerHTML` na stronie i komponentu WebView albo konwersji w aplikacji.

## Decyzja

**Opcja 3.** Parser w `packages/shared/src/markdown/` zwraca drzewo elementów, listę nagłówków i listę błędów. HTML nie powstaje nigdzie, więc nie ma sanityzacji ani biblioteki do niej.

### Składnia (pełny profil)

| Konstrukcja | Zapis | Uwagi |
|---|---|---|
| Nagłówki | `## Tytuł`, `### Podtytuł` | `#` jest zarezerwowany dla tytułu strony; `####` i niższe to błąd |
| Akapit | tekst, pusta linia rozdziela akapity | pojedynczy znak nowej linii to spacja |
| Lista | `- `, `* ` albo `1. ` na początku linii | jeden poziom; wcięta lista to błąd |
| Pogrubienie, kursywa | `**tekst**`, `*tekst*`, `_tekst_` | bez zagnieżdżania tego samego znacznika |
| Odnośnik | `[tekst](adres)` | bez tytułu, bez odnośników przez odwołanie; `[nazwa]` bez `(…)` zostaje tekstem |
| Ucieczka | `\*`, `\_`, `\[`, `\]`, `\(`, `\)`, `\#`, `\-`, `\\` | |

Błąd z wierszem i kolumną dają:
- HTML: `<` z literą, `/` albo `!` po nim, także komentarz `<!-- -->`;
- obraz `![…](…)` (grafiki pochodzą z biblioteki mediów);
- kod (`` ` ``, `~~~`, wcięcie o 4 spacje);
- cytat `>`;
- tabela;
- linia pozioma;
- nagłówek `Setext`;
- zagnieżdżona lista;
- niezamknięty znacznik;
- adres spoza listy schematów.

Komentarz z pierwszej linii dokumentu startowego seed usuwa już dziś, więc dokumenty przechodzą walidację. Sprawdza to test.

### Profile według sekcji

Rejestr sekcji ([ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md)) wskazuje profil pola:

| Profil | Dozwolone | Gdzie |
|---|---|---|
| `inline` | akapity, pogrubienie, kursywa, odnośniki | hero, elementy list (kroki, zasady, strefy), stopka |
| `faq` | jak `inline` i listy | odpowiedzi FAQ, `mobile.help` |
| `document` | jak `faq` i nagłówki `##`, `###` | dokumenty prawne, treść aktualności |

Konstrukcja poprawna w pełnej składni, ale spoza profilu, daje błąd `MD_NOT_ALLOWED` z nazwą konstrukcji, np. „Wiersz 4: nagłówek nie jest dozwolony w sekcji Hero”.

### Odnośniki

- **Dozwolone adresy:**
  - `https:`;
  - `mailto:`;
  - `tel:`;
  - ścieżka zaczynająca się od jednego `/` (nie `//`);
  - kotwica `#…`.
- **Odrzucane:** `http:` (komunikat podpowiada `https:`) i każdy inny schemat (`javascript:`, `data:`). Daje to `MD_LINK_SCHEME`.
- **Jedna funkcja `isAllowedHref`** sprawdza odnośniki w treści i adres przycisku bloku. Baza ma tę samą regułę w `CHECK`.
- **Render:**
  - adres `https:` otwiera nową kartę z `rel="noopener noreferrer"`;
  - ścieżka idzie przez `next/link`;
  - w aplikacji odnośnik otwiera się przez `Linking.openURL` po ponownym sprawdzeniu schematu.

### Drzewo i błędy

```ts
type Inline = { type: 'text'; value: string } | { type: 'strong' | 'emphasis'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };
type Block = { type: 'heading'; level: 2 | 3; id: string; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] } | { type: 'list'; ordered: boolean; items: Inline[][] };
interface MarkdownResult { blocks: Block[]; headings: { level: 2 | 3; id: string; text: string }[]; issues: MarkdownIssue[] }
interface MarkdownIssue { code: 'MD_HTML' | 'MD_NOT_ALLOWED' | 'MD_HEADING_LEVEL' | 'MD_NESTED_LIST' | 'MD_UNCLOSED' | 'MD_LINK_SCHEME'; line: number; column: number; construct: string }
```

- **Parser nie rzuca wyjątków.** Błędny wiersz trafia do `issues`, a do drzewa idzie jako zwykły tekst albo jest pominięty. Panel pokazuje więc podgląd z dopiskiem „Wiersz N pominięty do czasu poprawki”, jak na makiecie.
- **Przy zapisie** API woła parser z profilem pola z rejestru. Reguła bloku w core ([ADR 0025](0025-logika-biznesowa-packages-core.md)) zamienia niepustą listę `issues` na `422 CONTENT_VALIDATION_FAILED` z `details.issues[]` (`field`, `line`, `column`, `code`, `construct`), razem z limitami znaków i wymaganymi polami. Core nie zależy od `packages/shared`, więc dostaje wynik parsera jako argument.
- **Limity znaków** liczą się na źródle (licznik „168 / 240” w edytorze).

### Kotwice nagłówków

`headingId(text)`:
1. NFKD i usunięcie znaków łączących;
2. `ł → l` i `Ł → L` (litera nie rozkłada się w NFKD);
3. małe litery, a ciągi spoza `[a-z0-9]` zamienione na `-`;
4. przycięcie `-` na brzegach; pusty wynik to `sekcja`;
5. powtórzenia dostają `-2`, `-3`.

Przykład: „Zażółć gęślą jaźń” → `zazolc-gesla-jazn`. Spis treści dokumentu na stronie powstaje z nagłówków `##`. Ta sama funkcja tworzy slug aktualności z tytułu.

### Render

- **Strona i panel:** komponent `MarkdownView` w `apps/web` zamienia drzewo na elementy React (`h2` z `id`, `p`, `ul`/`ol`, `strong`, `em`, `a`), bez `dangerouslySetInnerHTML`. Zastępuje `MarkdownPreview`.
- **Aplikacja:** komponent `MarkdownView` w `apps/mobile` składa zagnieżdżone `Text` ze stylami nagłówków i list. Zastępuje `components/markdown.tsx` (także podział na sekcje przy zasadach jazdy, który teraz czyta `headings`).
- **Wspólne jest drzewo, nie komponenty,** bo prymitywy React DOM i React Native są różne ([ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md)).

### Testy

Testy tabelaryczne w `packages/shared`:
- każda konstrukcja i każdy błąd z wierszem i kolumną;
- ucieczki i nawiasy bez adresu;
- kotwice ze znakami diakrytycznymi i powtórzeniami;
- profile;
- dokumenty startowe z seeda i dane startowe bloków bez błędów.

## Konsekwencje

Pozytywne:

- Jeden parser i jedna reguła w trzech klientach i w API: podgląd w panelu wygląda jak strona i aplikacja.
- Bez HTML nie ma wstrzyknięcia skryptu z treści ani biblioteki sanityzacji do aktualizowania.
- Błędy mają miejsce w źródle (wiersz, kolumna) i nazwę konstrukcji, więc operator wie, co poprawić.

Negatywne i ryzyka:

- To nie jest pełny CommonMark. Przypadki brzegowe (np. `*` wewnątrz słowa, nawiasy w adresie) działają według uproszczonych reguł opisanych w testach, a nie według specyfikacji.
- Własny kod parsera trzeba utrzymywać. Wąski podzbiór i testy ograniczają ryzyko, a do opcji 2 można przejść bez zmiany formatu w bazie.
- Treść z zabronioną konstrukcją wpisana do bazy poza API (np. ręcznie) pokaże się jako tekst z pominiętymi wierszami, nie jako błąd strony.

## Powiązane

[ADR 0027](0027-tresci-sterowane-z-panelu.md), [ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0032](0032-etykiety-w-plikach-tlumaczen.md), [ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md), [ADR 0065](0065-strona-promocyjna-z-tresci.md), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytanie 9), makiety `tresci-blok-edycja`, `dostep-dokument-wersja`, `strona-dokument`
