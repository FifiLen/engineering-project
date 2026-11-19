# ADR 0067: Szablony wydruków DOCX: wersje i walidacja

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0030](0030-wydruki-z-szablonow-docx.md) wybrał docxtemplater z modułem inspekcji. Rodzaje dokumentów i pola mają być katalogiem w core. Wgranie wersji kończy się walidacją, podglądem PDF, aktywacją i możliwością powrotu do starszej wersji. Grafiki stałe (logo) są częścią pliku, a obrazów zmiennych nie ma, bo moduł obrazów jest płatny.

Migracja 0002 ma:
- `document_templates`: rodzaj, nazwa, domyślny (jeden na rodzaj), aktywny;
- `document_template_versions`: plik, `fields text[]`, jedna aktywna wersja szablonu.

Odpowiedzi autora z 18 listopada 2026:
- **pytanie 1:** cztery rodzaje z szablonem startowym (paragon z korektą, potwierdzenie przejazdu, protokół zadania serwisowego, karta hulajnogi). Raport zdarzenia i potwierdzenie korekty salda są w katalogu bez szablonu startowego;
- **pytanie 5:** logo i pieczęć jako stałe grafiki, linia „Podpis” z imieniem i nazwiskiem operatora, bez podpisu elektronicznego;
- **pytanie 6:** `templates.write` ma tylko Administrator;
- **D4:** szablony startowe `.docx` w repozytorium, walidowane testem i wgrywane przez seed jako wersja 1;
- **D5:** naklejka QR poza szablonami DOCX.

Plansze `wydruki-szablony`, `wydruki-szablon-wersja` i `wydruki-wgranie-bledy` ustalają, że:
- wersja ma stan „Do aktywacji”, „Aktywna” albo „Archiwalna”;
- wersja z błędem nie powstaje, a nieużyte pola katalogu są ostrzeżeniem;
- „Przywróć” aktywuje starszą wersję bez kopiowania pliku;
- panel ma „Lista pól (DOCX)” i „Pobierz aktywną”;
- błąd podaje nazwę nieznanego pola z podpowiedzią i listą dostępnych pól, a jego miejsce to tabela, wiersz, kolumna albo akapit.

Numer strony z planszy był do sprawdzenia, bo DOCX nie ma podziału na strony przed renderowaniem.

Sprawdzone 18 listopada 2026 (rejestr npm i kod pakietów 3.71.1 i 3.3.0; kodu nie uruchamialiśmy, więc zachowanie potwierdzi test w kroku 6 planu):
- **`docxtemplater` 3.71.1** (15 października 2026):
  - licencja MIT, pakiet CommonJS z typami `export =` i zależnością `@xmldom/xmldom` ^0.9.12 (0.9.12 z 21 sierpnia);
  - w ESM pod NestJS 12 działa domyślny import pakietu CommonJS (`import Docxtemplater from 'docxtemplater'`); pakiet nie ma pola `exports`, więc moduł inspekcji importuje się ścieżką `docxtemplater/js/inspect-module.js` (z typami `inspect-module.d.ts`).
- **`InspectModule` jest w darmowym pakiecie:** `getAllTags()`, `getAllStructuredTags()` (części z `type`, `module`, `value`, `inverted`, `offset`, `lIndex`, `subparsed` dla pętli), `getTemplatedFiles()`.
- **Moduły zwykłych części:** pętla i warunek to moduł `loop` z przedrostkiem `#` (odwrócony `^`), a surowy XML to `rawxml` z przedrostkiem `@`.
- **Format błędów:**
  - konstruktor kompiluje szablon i rzuca `TemplateError`, dla wielu błędów z `properties.id = "multi_error"` i listą `properties.errors`;
  - każdy błąd ma `properties.id` (np. `unopened_tag`, `unclosed_tag`, `unclosed_loop`), `explanation`, `xtag`, `context`, `offset` (pozycja znaku w połączonym tekście części, nie w XML) i `file` (np. `word/document.xml`, `word/header1.xml`);
  - położenie błędu jako komentarz w Wordzie daje tylko płatny moduł Error Location.
- **Rozbite znaczniki:** lekser działa na połączonym tekście wszystkich `w:t` części, więc znacznik rozbity przez Worda na kilka fragmentów tekstu w jednym akapicie łączy się sam.
- **Parser domyślny nie zna kropki:** `{rental.number}` szuka klucza `"rental.number"` przez `hasOwn`. Kropkę obsługuje `expressions.js` na `angular-expressions`, które jest tylko zależnością deweloperską pakietu i wykonuje wyrażenia.
- **`pizzip` 3.3.0** (21 września 2026), licencja „MIT OR GPL-3.0” (wybieramy MIT), zależność `pako` ^2.1.0. Wczytuje całe archiwum i rozpakowuje części na żądanie, bez limitu rozmiaru po rozpakowaniu.
- **Płatne moduły** (README): obrazy, HTML, QR, tabele, położenie błędów i inne. Darmowy `docxtemplater-image-module-free` 1.1.1 jest z 26 stycznia 2019 i zależy od `xmldom` ^0.1.27, nieutrzymywanego pakietu ze znanymi podatnościami. Odnotowane przy D5, nie używamy.

## Rozważane opcje

Parser znaczników:

1. **Parser domyślny z płaskimi kluczami** (`{"rental.number": …}`). Bez kodu, ale pola w pętlach i ich zakres trudno opisać w katalogu.
2. **`angular-expressions` (`expressions.js`).** Kropki, filtry i warunki w szablonie, ale szablon od operatora dostaje język wyrażeń, a formatowanie przenosi się do pliku Worda.
3. **Własny parser ścieżek z kropką,** bez wyrażeń. Kilka wierszy kodu. Szablon nie wykonuje niczego, a formatuje kod.

Miejsce błędu:

1. **Moduł Error Location (płatny)** wstawia komentarze w Wordzie.
2. **Własne przeliczenie `offset` na miejsce:** część dokumentu, tabela, wiersz, kolumna albo akapit z fragmentem tekstu.

## Decyzja

Opcja 3 dla parsera i opcja 2 dla miejsca błędu.

### Biblioteki i składnia

- **`docxtemplater` 3.71.1 i `pizzip` 3.3.0** tylko w `apps/api` (adapter `DocxTemplateEngine` za portem z [ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md)), nie w core.
- **Opcje docxtemplater:**
  - `paragraphLoop: true` i `linebreaks: true`;
  - `errorLogging: false`;
  - `parser: dotPathParser`;
  - `nullGetter: () => ''` jako zabezpieczenie, bo po walidacji puste pole nie powinno wystąpić.
- **Składnia dla autora szablonu:**
  - pole `{customer.name}`, ścieżka `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$`;
  - pętla `{#items}…{/items}`; w tabeli powtarza wiersz, gdy otwarcie i zamknięcie są w tym samym wierszu;
  - warunek `{#isCorrection}…{/isCorrection}` i jego zaprzeczenie `{^isCorrection}…{/isCorrection}` dla pól typu `boolean`.
- **Zabronione:**
  - `{@pole}` (surowy XML, możliwe wstrzyknięcie znaczników): `TEMPLATE_RAW_TAG`;
  - wyrażenia, filtry i spacje w znaczniku: `TEMPLATE_EXPRESSION`;
  - zmiana ograniczników `{=[[ ]]=}`: `TEMPLATE_DELIMITERS`.
- **Formatowanie przed wstawieniem:** wartości przychodzą jako gotowe teksty z katalogu (kwoty przez `formatPln`, daty w strefie Europe/Warsaw `dd.MM.yyyy, HH:mm`, liczby z polskim separatorem). Szablon niczego nie formatuje.

### Katalog rodzajów (`packages/core/src/documents/catalog.ts`)

- **Wpis rodzaju:**
  - `fields` i `loops` (ścieżka, etykieta po polsku, typ `text|boolean|list`, przykład, znacznik `customer` dla danych klienta ukrywanych bez `users.read`);
  - `params` z wartościami domyślnymi (np. karta hulajnogi: `historyDays` 30, 90 albo 365, domyślnie 90; potwierdzenie przejazdu i protokół: `includeTimeline`);
  - `readPermission`;
  - `build(dane z widoku, kontekst) → dane szablonu`;
  - `sample()` (dane przykładowe dla podglądu i testów);
  - `fileName()` (np. `S-1037-protokol-serwisowy`) i `entityLabel()`.

  Rodzaje i źródła danych opisuje [ADR 0068](0068-wydruki-w-procesach.md).
- **Pola wspólne każdego rodzaju:**
  - `company.*`: dane firmy z chwili generowania ([ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md)); paragon bierze dane sprzedawcy z chwili wystawienia;
  - `document.id` (8 znaków), `document.generatedAt`, `document.footer`;
  - `template.name`, `template.version`;
  - `staff.name` i `staff.present` (warunek linii „Podpis”; dokument klienta ma „aplikacja” bez podpisu).
- **Katalog dla panelu** pochodzi z API: `GET /admin/document-types` i `GET /admin/document-types/{type}/fields`. Zamiast kopii w `packages/shared` z planu panel nie powiela opisu pól, a jedynym źródłem zostaje core.

### Wgranie wersji

`POST /admin/document-templates/{id}/versions` (`multipart/form-data`: plik i notatka, `templates.write`):

1. **Rozmiar** do 5 MB i sygnatura ZIP (`PK\x03\x04`). Inaczej `TEMPLATE_NOT_DOCX` (także dla zaszyfrowanego DOCX, który jest plikiem OLE).
2. **Struktura archiwum** z katalogu centralnego (core `inspectDocxPackage`, czysty TypeScript na `Uint8Array`):
   - najwyżej 1000 części;
   - suma zadeklarowanych rozmiarów po rozpakowaniu do 50 MB i stosunek rozpakowania części do 200:1 (`TEMPLATE_TOO_LARGE_UNPACKED`);
   - bez ZIP64;
   - wymagane `[Content_Types].xml` i `word/document.xml` z typem `…wordprocessingml.document.main+xml`;
   - typ `…ms-word.document.macroEnabled.main+xml` (`.docm`) albo część `word/vbaProject.bin` daje `TEMPLATE_MACROS`; szablon `.dotx` jest odrzucany.
3. **Ochrona przed bombą ZIP.** Zadeklarowane rozmiary mogą kłamać, więc API rozpakowuje każdą część `zlib.inflateRawSync(dane, { maxOutputLength: rozmiar zadeklarowany })` przed przekazaniem archiwum do `pizzip`. Przekroczenie przerywa rozpakowanie.
4. **Kompilacja** docxtemplater z `InspectModule`. Błędy składni z `multi_error` trafiają na listę.
5. **Znaczniki z `getAllStructuredTags()`** porównuje core `validateTemplateTags(tags, catalog)`:
   - nieznane pole: `TEMPLATE_UNKNOWN_FIELD` z podpowiedzią (odległość edycyjna do 2) i listą pól dostępnych w zakresie, także wewnątrz pętli;
   - nieznana pętla albo pole użyte poza zakresem swojej pętli;
   - warunek na polu, które nie jest `boolean`;
   - znaczniki zabronione;
   - nieużyte pola katalogu dają ostrzeżenie, nie błąd.
6. **Miejsce błędu:** API przelicza `file` i `offset` na miejsce. Przechodzi XML części parserem `@xmldom/xmldom` (zależność docxtemplater), sumuje długości tekstu `w:t` i numeruje elementy w kolejności dokumentu:
   - część: treść, nagłówek N albo stopka N;
   - w części: `tabela T („tekst pierwszej komórki”), wiersz R, kolumna C` albo `akapit P: „początek tekstu…”`.

   **Bez numeru strony (rozstrzygnięcie):** podział na strony powstaje dopiero przy renderowaniu w LibreOffice albo Wordzie. „Strona 1” z planszy `wydruki-wgranie-bledy` znika, co trafi do dziennika jako odstępstwo od makiety.
7. **Próbne wypełnienie** danymi `sample()` musi się udać. Wyłapuje to błędy widoczne dopiero przy renderowaniu.
8. **Wynik:**
   - błąd: `422 TEMPLATE_INVALID` z `details.issues[]` (`code`, `tag`, `place`, `suggestion`, `available`). Plik nie trafia do magazynu, a wersja nie powstaje;
   - sukces: plik w magazynie (`DOCUMENT_TEMPLATE`) i wiersz wersji (`version_no` kolejny, `fields`, `warnings`, rozmiary) w stanie „Do aktywacji”, z wpisem w dzienniku audytu.

### Podgląd, aktywacja i przywrócenie

- **Podgląd PDF:** `GET /admin/document-templates/{id}/versions/{versionId}/preview.pdf` (`templates.read`).
  - Wypełnia wersję danymi `sample()` i zamienia ją przez Gotenberga synchronicznie, z limitem 30 s.
  - Wynik zapisuje się w `preview_file_id`, więc kolejne otwarcia nie wołają silnika.
  - `document.footer` w podglądzie to „Podgląd na danych przykładowych · {szablon} v{n} · nie jest dokumentem”.
- **Aktywacja i „Przywróć”:** procedura `sp_document_template_activate(p_version_id, p_staff_id)`.
  - Blokuje wiersz szablonu (`FOR UPDATE`), wyłącza bieżącą wersję i włącza wskazaną z `activated_at` i `activated_by`.
  - „Przywróć” to aktywacja starszej wersji bez kopiowania pliku.
  - Aktywacja zmienia tylko kolejne wydruki, bo wcześniejsze wskazują swoją wersję.
- **Stan wersji** liczy widok `v_document_template_versions`:
  - `ACTIVE`: `is_active`;
  - `ARCHIVED`: była aktywna (`activated_at` jest), ale już nie jest;
  - `PENDING`: nigdy nieaktywowana.

  Usunąć można tylko wersję `PENDING`. Pozostałe zostają, bo wskazują je wydruki.
- **Szablon domyślny:** procedura `sp_document_template_set_default(p_template_id)` wymaga aktywnej wersji. Istniejący `CHECK (active OR NOT is_default)` zostaje. Rodzaj bez szablonu z aktywną wersją nie pokazuje „Drukuj”.
- **Pozostałe punkty:**
  - `POST /admin/document-templates` (rodzaj, nazwa, opis) zakłada szablon;
  - `GET …/versions/{versionId}/file` daje adres z podpisem do „Pobierz aktywną” i pobrania dowolnej wersji;
  - `GET /admin/document-types/{type}/fields.docx` generuje listę pól z katalogu systemowym szablonem `lista-pol.docx` z pętlą po polach, bez nowej biblioteki.
- **Uprawnienia:** `templates.read` daje podgląd, pobranie, listę pól i podgląd PDF; `templates.write` (Administrator) daje szablon, wersję, aktywację, przywrócenie, domyślny i usunięcie wersji `PENDING`. Każda zmiana ma wpis w dzienniku audytu.

### Schemat (migracja 0011)

- **`document_template_versions`:**
  - `activated_at`, `activated_by`;
  - `warnings jsonb NOT NULL DEFAULT '[]'`;
  - `size_bytes`, `uncompressed_bytes`;
  - `preview_file_id`;
  - `CHECK (NOT is_active OR activated_at IS NOT NULL)`.
- **Widoki list panelu:** `v_document_templates` (rodzaj, nazwa, domyślny, numer aktywnej wersji, liczba wersji, ostatni wydruk) i `v_document_template_versions`.

### Szablony startowe (D4) i grafiki

- **Pliki w `packages/db/seed/templates/`:** `paragon.docx`, `potwierdzenie-przejazdu.docx`, `protokol-serwisowy.docx`, `karta-hulajnogi.docx` i systemowy `lista-pol.docx`.
  - Przygotowane w edytorze z czcionką Inter.
  - Mają stopkę `{document.footer}` i pola Worda „strona X z Y”.
  - Logo i pieczęć są stałymi grafikami (pytanie 5), a linia „Podpis: {staff.name}” stoi w warunku `{#staff.present}`.
- **Paragon** to jeden szablon dla sprzedaży i korekty (`{#isCorrection}`), z pętlą grup VAT i oznaczeniem „np.” dla pozycji poza VAT ([ADR 0061](0061-oplata-za-odholowanie-jako-kara-umowna.md)).
- **Test w `apps/api`** przepuszcza każdy szablon startowy przez pełną walidację z katalogiem i wypełnia go danymi przykładowymi. Seed wgrywa je jako wersję 1, aktywuje i ustawia jako domyślne.
- **Obrazy zmienne** nie wchodzą do szablonów (D5). Karta hulajnogi podaje adres `/h/{numer}` tekstem, a zdjęcia zgłoszeń pojawiają się jako liczba i daty.

## Konsekwencje

Pozytywne:

- Szablon od operatora nie wykonuje kodu ani wyrażeń i nie wstawia surowego XML. Archiwum ma limit przed rozpakowaniem i w trakcie.
- Błędy wskazują miejsce w języku autora szablonu (tabela, wiersz, akapit) i podpowiadają poprawne pole, bez płatnego modułu.
- Katalog pól jest w jednym miejscu (core), z którego biorą walidacja, dane przykładowe, lista pól w panelu i lista pól w DOCX.
- Aktywacja i przywrócenie nie kopiują plików, a każdy wydruk wskazuje swoją wersję.

Negatywne i ryzyka:

- Przeliczenie `offset` na miejsce zależy od tego, jak docxtemplater łączy tekst części. Zmiana tego w nowej wersji biblioteki wymaga poprawki, a test z planszy błędów to wykryje.
- Bez wyrażeń każda nowa potrzeba formatowania to zmiana katalogu w kodzie, nie w szablonie. To świadome, bo szablon zmienia osoba bez dostępu do kodu.
- Synchroniczny podgląd PDF zajmuje żądanie panelu do 30 s, gdy silnik jest przeciążony.
- Szablony startowe w `.docx` są binarne, więc ich zmiany w repozytorium widać tylko jako nową wersję pliku.

## Powiązane

[ADR 0030](0030-wydruki-z-szablonow-docx.md) (rozwija; zmienia: znaczniki jako ścieżki bez wyrażeń, miejsce błędu bez numeru strony, katalog pól dla panelu z API), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0057](0057-pliki-zdjecia.md), [ADR 0061](0061-oplata-za-odholowanie-jako-kara-umowna.md), [ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md), [ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md), [ADR 0068](0068-wydruki-w-procesach.md), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytania 1, 5, 6; D4, D5), makiety `wydruki-szablony`, `wydruki-szablon-wersja`, `wydruki-wgranie-bledy`
