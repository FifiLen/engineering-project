# ADR 0071: Moduł raportów

- **Status:** zaakceptowana
- **Data:** 2026-11-19

## Kontekst

[ADR 0029](0029-raporty-pdf-xlsx.md) wybrał Gotenberga dla PDF i ExcelJS dla XLSX, definicje raportów w `report_definitions` z logiką w kodzie, dane z bazy, podgląd w panelu i eksport zadaniem z historią `report_runs`. Migracja 0002 założyła obie tabele, typ `report_format` i sześć uprawnień `reports.*` z przydziałami ról, ale nic ich nie używa. Widoki z 0002 (`v_daily_revenue`, `v_zone_usage`, `v_scooter_reliability`) nie przyjmują okresu i liczą przychód z kwot przejazdów, a nie z paragonów.

Odpowiedzi autora z 19 listopada 2026 ([plan iteracji 8](../iteracje/iteracja-08-raporty-domkniecie-panelu.md)):
- **pytania 1–4:** sześć raportów z zawartością z planu, przychód jako sprzedaż z paragonów i wpływy z płatności, okres do 366 dni z gotowymi zakresami, granulacją i porównaniem, PDF i XLSX;
- **pytania 5–8:** podgląd synchroniczny, eksport zadaniem z `report.ready`, plik usuwany po 30 dniach, dostęp według `reports.<kod>`, raporty bez danych osobowych, nowe uprawnienie `reports.manage`;
- **pytanie 15:** A4 pionowo albo poziomo, nagłówek z danymi firmy, stopka z identyfikatorem uruchomienia, chwilą danych, zlecającym i „Strona X z Y”;
- **D1, D3, D5, D8:** funkcje SQL z parametrami, katalog w core jako źródło prawdy, ExcelJS za portem, generator danych i indeksy w tej iteracji.

Plansze `32-panel-raporty` dołożyły: chwilę danych w nagłówku, stan „Plik usunięty”, kod błędu, limity [15] s podglądu i [60] s renderu, skracanie tabel PDF do [50] wierszy, wyłączony eksport pustego raportu i „Uruchom ponownie z tymi parametrami” z tym samym okresem.

Sprawdzone 19 listopada 2026:
- **ExcelJS:** najnowsze stabilne wydanie to 4.4.0 (19 października 2023), potem tylko `4.4.1-prerelease.0` (20 grudnia 2024). Licencja MIT, pakiet CommonJS bez `exports`. W Node 22 import domyślny w ESM (`import ExcelJS from 'exceljs'`) działa. Zapis strumieniowy `stream.xlsx.WorkbookWriter` do `PassThrough` zapisał 50 000 wierszy w 0,46 s (1,06 MB pliku, 129 MB pamięci procesu); formaty `#,##0.00 "zł"` i `dd.mm.yyyy hh:mm`, zamrożony wiersz i autofiltr wracają po odczycie. Daty zapisuje jako UTC, więc czas Europe/Warsaw trzeba przeliczyć przed zapisem. `npm audit` zgłasza `uuid < 11.1.1` (bufor w v3, v5, v6), ale ExcelJS woła tylko `v4`, więc luka go nie dotyczy. Zależności: 484 pakiety w drzewie, 50 MB w `node_modules`.
- **Gotenberg 9.5.1 (Chromium, kontener z iteracji 7):** `POST /forms/chromium/convert/html` z `index.html` i `footer.html`, `preferCssPageSize` i `@page { size: A4 landscape }`. Tabela 120 wierszy dała 5 stron w 0,2 s; nagłówek tabeli (`thead`) powtarza się na każdej stronie, stopka ma „Strona 2 z 5” z klas `pageNumber` i `totalPages`, polskie znaki i Inter są poprawne. Stopka ma własny dokument i własny CSS: układ trzeba w niej zbudować od nowa (flex z `body` nie rozciągnął się na szerokość strony).

## Rozważane opcje

Źródło danych:

1. **Widoki** jak w 0002. Nie przyjmują okresu ani strefy czasowej, a filtr po agregacji dnia omija indeksy.
2. **Funkcje SQL z parametrami** (`STABLE`, zwracają tabelę). Okres, granulacja i filtry wchodzą do zapytania przed agregacją; każdą funkcję da się przetestować na znanych danych.
3. **Widoki zmaterializowane** odświeżane zadaniem. Szybkie, ale z opóźnieniem danych i osobnym harmonogramem; zostają na iterację 9, jeśli pomiary je uzasadnią (D8).

Podgląd i eksport:

1. **Wszystko zadaniem.** Jeden przepływ, ale operator czeka na każdą zmianę parametru.
2. **Podgląd synchroniczny, plik zadaniem** (pytanie 5). Podgląd odpowiada od razu, a plik przetrwa zamknięcie okna i restart API.

## Decyzja

Opcja 2 w obu sprawach.

### Katalog raportów (`packages/core/src/reports`)

- `REPORT_CATALOG` jest źródłem prawdy: kod, uprawnienie `reports.<kod>`, schemat parametrów (Zod w `packages/shared`, ten sam dla API i panelu), formaty, orientacja PDF, sekcje (kafelki, wykresy, tabele) i kolumny tabel (klucz, etykieta, rodzaj: kwota, liczba, czas trwania, dystans, procent, data, tekst).
- Etykiety sekcji i kolumn są w katalogu, bo plik powstaje w API (tak jak teksty wyliczeń wydruków w `document-labels.ts`, [ADR 0067](0067-szablony-wydrukow-docx.md)). Nazwa i opis raportu pochodzą z `report_definitions` i zmienia je Administrator ([ADR 0027](0027-tresci-sterowane-z-panelu.md)).
- Funkcje katalogu budują model raportu z wierszy bazy: sumy, porównanie z poprzednim okresem (zmiana procentowa), udziały, średnie. Logika jest w core i ma testy jednostkowe bez bazy ([ADR 0025](0025-logika-biznesowa-packages-core.md)).

### Parametry

- **Okres:** gotowe zakresy (dziś, wczoraj, 7 dni, bieżący miesiąc, poprzedni miesiąc) albo własny `from`–`to` w datach Europe/Warsaw, najwyżej 366 dni (`REPORT_RANGE_TOO_LONG` z liczbą dni w `details`). Granice doby liczy baza (`AT TIME ZONE 'Europe/Warsaw'`), więc doba zmiany czasu ma 23 albo 25 godzin.
- **Granulacja:** dzień do 62 dni, tydzień (od poniedziałku) do 182 dni, dalej miesiąc; operator może ją zmienić. Raport bez szeregu czasowego (strefy i godziny) jej nie ma.
- **Porównanie:** przy zakresach miesięcznych poprzedni miesiąc kalendarzowy wyrównany do dnia miesiąca (31 października nie ma pary we wrześniu i porównanie tego dnia jest puste), w pozostałych przypadkach okres tej samej długości tuż przed.
- **Filtry** zależne od raportu: strefa, model, hulajnoga.
- Walidacja w core; `params` w `report_runs` zapisuje daty bezwzględne i etykietę zakresu („poprzedni miesiąc”), więc „Uruchom ponownie” liczy ten sam okres na dzisiejszych danych.

### Dane

Funkcje `fn_report_<kod>_<sekcja>(p_from timestamptz, p_to timestamptz, …)` w migracji 0013, po jednej na sekcję z tabelą albo szeregiem:
- **przychody:** sprzedaż z `receipts` i `receipt_items` według stawki VAT (pozycja bez stawki to opłata za odholowanie, kara umowna poza VAT, [ADR 0061](0061-oplata-za-odholowanie-jako-kara-umowna.md)), korekty z datą korekty jako wartości ujemne; wpływy z `payments` (`SUCCEEDED`) według metody i zwroty z `refunds`; szereg sprzedaży według granulacji;
- **wykorzystanie floty:** przedziały z historii stanów ([ADR 0074](0074-historia-stanow-hulajnogi.md)) przycięte do okresu, przejazdy, przychód z paragonów i przebieg na hulajnogę i model; definicje wskaźników z ADR 0074;
- **przejazdy według stref i godzin:** mapa ciepła dzień tygodnia × godzina startu jako średnia na wystąpienie dnia tygodnia w okresie, strefa końca, wjazdy do stref z `rental_events` (`ZONE_ENTERED`; `scooter_zone_presence` znika z końcem przejazdu), zakończenia z odholowaniem (`end_mode`);
- **awaryjność:** zgłoszenia według kategorii, źródła i hulajnogi (także zamknięte `OFFLINE`), zadania, średni czas naprawy, MTBF, koszt części, części poniżej minimum (`v_low_stock_parts` poprawiony na `<`);
- **użytkownicy:** rejestracje, aktywni, nowi i powracający, kohorty miesięczne, blokady i usunięcia, zgody marketingowe; same liczby;
- **portfel:** saldo na początek i koniec okresu z `balance_after` ostatniego wpisu klienta przed granicą, obroty według typu, korekty według przyczyny, przedziały sald, zaległości; same liczby.

Istniejące widoki z 0002 zostają bez zmian. Indeksy pod funkcje (np. `receipts (issued_at)`, `rentals (started_at)`) wchodzą do 0013 po `EXPLAIN` na danych z generatora ([ADR 0075](0075-dane-historyczne-do-demonstracji.md)).

### Dostęp

- Raport, jego podgląd, eksport i pliki wymagają `reports.<kod>`. Raport zawiera tylko dane obszaru swojego uprawnienia: przychodu w raporcie stref nie ma (odstępstwo od planszy `raport-strefy-godziny`), bo Dyspozytor z `reports.rides_by_zone` nie ma `payments.read`. Sprzedaż według strefy końca jest sekcją raportu przychodów.
- Historia pokazuje uruchomienia wszystkich operatorów dla raportów, do których operator ma uprawnienie.
- `reports.manage` (nowe, tylko Administrator): nazwa, opis, aktywność i kolejność definicji. Wyłączony raport znika z katalogu i z nawigacji także dla Administratora (zostaje w zakładce Definicje), a jego historia i pliki zostają.

### Podgląd

`GET /admin/reports/{code}/preview?…` liczy sekcje w jednej transakcji `REPEATABLE READ READ ONLY` z `SET LOCAL statement_timeout = '15s'` (`REPORT_TIMEOUT`). Odpowiedź ma `dataAsOf` (czas transakcji), `earliestDataAt` (do stanu „Brak danych”), sekcje i tabele obcięte do 200 wierszy z liczbą wszystkich.

### Eksport

- `POST /admin/reports/{code}/runs` z parametrami i formatem zapisuje wiersz `report_runs` (`QUEUED`) i w tej samej transakcji planuje zadanie `report.generate` (`sendInTransaction`, `batchSize: 1`, limit wykonania 120 s; [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)). Pusty raport daje `409 REPORT_EMPTY`.
- Zadanie liczy dane od nowa (te same funkcje, `data_as_of` = czas transakcji odczytu), buduje plik i zapisuje go w magazynie z celem `REPORT` ([ADR 0057](0057-pliki-zdjecia.md)), potem `report.ready` w pokoju `staff:{id}` (Socket.IO 1.7.0); panel odpytuje co [2] s jako zapas.
- **PDF:** HTML w API z funkcji z ucieczką znaków (jak naklejka QR, [ADR 0068](0068-wydruki-w-procesach.md)), wykresy SVG z geometrii w shared ([ADR 0072](0072-wykresy-w-panelu-i-w-pdf.md)), Inter z kontenera, `htmlToPdf` z `footer.html` (identyfikator uruchomienia, chwila danych, zlecający, „Strona X z Y”). Pierwsza strona ma nagłówek z `company_profile`, nazwą i opisem raportu i parametrami; tabele mają `thead` i `break-inside: avoid` na wierszach i sekcjach, a ponad [50] wierszy tabela kończy się dopiskiem o pełnych danych w XLSX. Limit renderu [60] s (`REPORT_RENDER_TIMEOUT`).
- **XLSX:** ExcelJS 4.4.0 za portem `SpreadsheetWriter` w core (adapter w API), `WorkbookWriter` strumieniowo; arkusz na tabelę raportu i arkusz „Parametry”; kwoty jako liczby w złotych z formatem `#,##0.00 "zł"`, daty jako daty Excela w czasie polskim, zamrożony nagłówek i autofiltr.
- `report_runs` dostaje w 0013: `data_as_of`, `error_code` (osobno od opisu w `error`), `row_count`, `page_count`, `file_deleted_at` i indeks do historii; stan „Plik usunięty” to `SUCCEEDED` z `file_deleted_at`.
- Porządki jak w wydrukach ([ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md)): `reports.sweep` co 5 min kończy wiersze `QUEUED` i `RUNNING` starsze niż 15 min, `reports.retention` usuwa pliki po 30 dniach partiami po 200.

### Definicje w bazie

Seed wstawia brakujące wiersze `report_definitions` z katalogu i aktualizuje `permission_code`, `parameters` (JSON Schema z Zod przez `z.toJSONSchema`) i `formats`, ale nie rusza nazwy, opisu, aktywności i kolejności (jak szablony powiadomień). Zmiana z katalogu nie podbija `version` (formularz edytuje tylko pola operatora) i zapisuje wpis systemu w dzienniku audytu tylko wtedy, gdy coś się zmieniło. Edycja w panelu ma blokadę optymistyczną i wpis `report_definition.updated`.

## Konsekwencje

Pozytywne:

- Punkt 18 spełniony sześcioma raportami z podglądem, PDF i XLSX; funkcje raportowe zwiększają liczbę funkcji bazy (punkt 8) i mają testy na znanych danych.
- Ten sam przepływ co wydruki (wiersz, zadanie, zdarzenie, retencja), więc mniej nowego kodu i ten sam wzorzec do opisania w pracy.
- Raporty bez danych osobowych nie potrzebują maskowania ani śladu odczytu danych klientów.

Negatywne i ryzyka:

- ExcelJS nie ma stabilnego wydania od października 2023 i ciągnie 484 pakiety. Port `SpreadsheetWriter` pozwala go wymienić; przy problemie z Node 24 albo z bezpieczeństwem zależności wybieramy inną bibliotekę nowym ADR.
- Podgląd i plik liczą dane osobno, więc mogą się różnić o operacje z tych kilku sekund; nagłówek pokazuje chwilę danych.
- Etykiety kolumn raportów są w katalogu w core, czyli poza plikami tłumaczeń panelu; to wyjątek tego samego rodzaju co teksty wydruków.
- Duże okresy obciążają bazę; limit 366 dni, limit czasu podglądu i pomiary w iteracji 9.

## Powiązane

[ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0029](0029-raporty-pdf-xlsx.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0061](0061-oplata-za-odholowanie-jako-kara-umowna.md), [ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md), [ADR 0072](0072-wykresy-w-panelu-i-w-pdf.md), [ADR 0074](0074-historia-stanow-hulajnogi.md), [ADR 0075](0075-dane-historyczne-do-demonstracji.md), [plan iteracji 8](../iteracje/iteracja-08-raporty-domkniecie-panelu.md), makiety `32-panel-raporty`
