# Iteracja 8: raporty i domknięcie panelu

**Status:** plan (19 listopada 2026); decyzje autora przyjęte 19 listopada 2026 ([odpowiedzi](#odpowiedzi-autora-19-listopada-2026)); makiety gotowe 19 listopada 2026 (21 plansz panelu, przy implementacji doszła plansza `31-mobile-tresci/komunikat`); ADR 0071–0076 przyjęte 19 listopada 2026; zrealizowana 19 listopada 2026 ([dziennik](../dziennik.md#iteracja-8-implementacja-19-listopada-2026)); zielone CI 20 listopada 2026 (commit `83d223f` na `main`); aplikacja natywna (komunikat na mapie, dane urządzenia) niesprawdzona do czasu development build

## Cel
Operator wyciąga z systemu rozbudowane zestawienia i dostaje je jako PDF albo XLSX, a każda tabela bazy ma w panelu swoje miejsce z filtrowaniem i sortowaniem. Konkretnie:
- **Raporty** ([ADR 0029](../adr/0029-raporty-pdf-xlsx.md)): sześć raportów z parametrami, podglądem w panelu (kafelki, wykres, tabela) i eksportem PDF (HTML przez Chromium w Gotenbergu) i XLSX (ExcelJS) zadaniem w tle; historia uruchomień `report_runs`; nazwy i opisy raportów z `report_definitions` edytowane w panelu.
- **Pulpit z wykresami:** kafelki, przejazdy według godzin i stan floty z makiety `13-panel/admin-pulpit` obok istniejącej grupy „Wymaga uwagi” (D1 iteracji 6 odłożył wykresy do tej iteracji).
- **Eksport list:** „Eksportuj” na każdej liście wzorca widoku tabeli do XLSX i CSV z bieżącymi filtrami i sortowaniem ([ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md); odkładany od iteracji 1).
- **Domknięcie macierzy operacji:** pozostałe tabele z [macierzy](../model-danych/README.md#operacje-w-panelu-dla-każdej-tabeli) dostają listę z filtrowaniem i sortowaniem albo udokumentowane miejsce w szczegółach rekordu nadrzędnego; brakujące operacje z macierzy (edycja i dezaktywacja szablonu wydruku, opis uprawnienia).

Granice z sąsiednimi iteracjami:
- **Iteracja 7 (zrobiona):** Gotenberg 9.5.1, port `DocumentRenderer` z `htmlToPdf` (naklejka QR), zadania pg-boss z porządkowaniem i retencją, `document.ready` w pokoju `staff:{id}`. Raporty używają tego samego portu i wzoru zadania.
- **Iteracja 9:** testy obciążeniowe, przegląd bezpieczeństwa, zestawienie z zasadami ICK, spis widoków, dokumentacja końcowa. Generator danych historycznych z tej iteracji (pytanie 12) posłuży też testom obciążeniowym.
- **Poza projektem:** raporty cykliczne wysyłane e-mailem, kreator raportów w panelu (zapytanie wpisywane przez operatora; ADR 0029 to wyklucza), hurtownia danych, eksport do systemu księgowego.

Wymagania uczelni:
- **18:** raporty z parametrami, podglądem i eksportem PDF i XLSX; historia uruchomień.
- **12:** wszystkie tabele z macierzy dostępne w panelu z filtrowaniem i sortowaniem; eksport każdej listy.
- **14:** ekrany Raportów (katalog, raport z podglądem, eksport, historia, definicja), pulpit z wykresami, nowe listy.
- **8:** funkcje raportowe z parametrami, historia stanów hulajnogi (D4), widoki nowych list.
- **13:** proces raportu: parametry → podgląd → zlecenie eksportu → gotowy plik → pobranie, z historią i ponowieniem.
- **3c:** katalog raportów, walidacja parametrów, wskaźniki i geometria wykresów w `packages/core` i `packages/shared`.

## Stan wyjściowy
- **Baza:**
  - `report_definitions` (kod, nazwa, opis, uprawnienie, `parameters jsonb` na schemat parametrów, `formats report_format[]`, aktywność, kolejność, wersja rekordu) i `report_runs` (raport, format, parametry, `job_status`, zlecający, `file_id`, błąd, czasy) z migracji 0002; obie puste, seed ich nie wypełnia; typ `report_format` ma `PDF`, `XLSX`, `CSV`;
  - uprawnienia `reports.revenue`, `reports.fleet_usage`, `reports.rides_by_zone`, `reports.reliability`, `reports.users`, `reports.wallet` (katalog w `packages/core/src/access/permissions.ts`); Dyspozytor ma `reports.fleet_usage` i `reports.rides_by_zone`, Serwisant `reports.reliability`, Administrator wszystkie;
  - widoki analityczne z 0002 bez parametrów i bez użycia w API: `v_daily_revenue` (poprawiony w 0007: przejazdy `ENDED` i `UNPAID`, doładowania, zwroty za przejazdy), `v_zone_usage` (przejazdy według strefy końca i dnia), `v_scooter_reliability` (zgłoszenia, zadania, czas naprawy, koszt części), `v_user_activity` (źródło listy klientów), `v_low_stock_parts` (liczy `<=`, a core i `v_spare_part_list` liczą `<`; arc42 §11);
  - brak historii stanów hulajnogi: `scooters.status` i `online` mają tylko bieżącą wartość; zmiany stanu są w dzienniku audytu tylko dla części operacji (wpisy operatora i systemu z iteracji 6), więc czasu przestoju nie da się policzyć wiarygodnie;
  - cel pliku `file_purpose` bez wartości dla raportów;
  - po migracji 0012: 57 tabel, 64 widoki, 24 funkcje, 22 procedury.
- **API:**
  - pulpit: `GET /admin/dashboard/attention` (`DashboardService`, `fn_dashboard_attention`, grupy według uprawnień);
  - moduł Dokumenty: `GotenbergRenderer` (`fillDocx`, `docxToPdf`, `htmlToPdf`), HTML naklejki budowany w API z funkcją `escape` (`scooter-label.ts`), zadanie `document.generate` z `document.ready`, `documents.sweep` i retencja po 30 dniach;
  - kontrakt list (`ListQueryPipe`, `ListSource` w repozytoriach) bez eksportu; brak ExcelJS w zależnościach.
- **Panel:**
  - pulpit tylko z grupami „Wymaga uwagi”; w nawigacji „Analiza” ma Wydruki i Symulator, bez Raportów;
  - 32 zasoby wzorca widoku tabeli (`packages/shared/src/admin`); bez przycisku eksportu (odstępstwo zapisane w dzienniku przy iteracjach 1, 3, 5 i 6);
  - zgody i sesje klienta tylko na karcie klienta, sesje i zaproszenia operatora tylko na karcie operatora, zdarzenia przejazdu tylko na osi czasu (bez filtrów i sortowania);
  - bez biblioteki wykresów (pasek i wykres z makiety pulpitu nie mają implementacji).
- **Makiety:** `13-panel/admin-pulpit` (kafelki, mapa, „Wymaga uwagi”, przejazdy według godzin, stan floty; nawigacja sprzed iteracji 2), `17-panel-wzorce/wzorzec-lista` (przycisk eksportu, makieta Flota pokazuje tylko CSV); pozycja „Raporty” w nawigacji na planszach od iteracji 2, ale bez ekranów raportów, wydruku PDF raportu ani okna eksportu listy.
- **Dane deweloperskie:** kilka przejazdów, paragonów i zgłoszeń z przeklikania; raporty za miesiąc pokażą prawie puste wykresy (pytanie 12).
- **Długi z poprzednich iteracji, które dotyczą tej:**
  - iteracja 1–6: „Eksportuj XLSX” na listach; iteracja 4: eksport stref do pliku; iteracja 6: wykresy pulpitu, ujednolicenie `v_low_stock_parts`, koszt części w raporcie awaryjności, zamknięte zgłoszenia `OFFLINE` w raporcie awaryjności (arc42 §11);
  - iteracja 7 („Potrzebne zmiany odłożone”): edycja nazwy i opisu oraz dezaktywacja szablonu wydruku, liczba pól aktywnej wersji i wydruki z 30 dni w `v_document_templates`, punkt pulpitu dla grupy „Treści”, przyczyna korekty w `v_doc_receipt`, `mobile.notice`, godziny pomocy w danych startowych;
  - iteracja 6 („Potrzebne zmiany odłożone”): lista zmian panelu i aplikacji (porównanie wersji szablonów, `payment.updated`, punkt odczytu powiadomienia i inne).

## Pokrycie tabel w panelu (wymaganie 12)
Stan po iteracji 7 i propozycja (pytanie 11). Tabele z własną listą wzorca widoku tabeli (32 zasoby) pominięte.

| Tabela | Dziś | Propozycja |
|---|---|---|
| `consents` | karta klienta (lista bez filtrów) | lista Klienci → Zgody (typ, wersja, aktualność, wycofanie; filtr klienta, typu, stanu); wycofanie zgody marketingowej przez operatora według macierzy |
| `sessions` | liczba na karcie klienta, unieważnienie wszystkich | lista Klienci → Sesje (bez skrótu tokenu): urządzenie, utworzenie, ostatnie użycie, stan; unieważnienie pojedynczej |
| `otp_codes` | brak | lista Klienci → Kody SMS (bez skrótu kodu): numer zamaskowany, utworzenie, wygaśnięcie, próby, użycie; „Usuń wygasłe” (`sp_purge_expired_otp`) |
| `saved_places` | brak | lista na karcie klienta z filtrem i sortowaniem, tylko odczyt i usunięcie (dane klienta z `users.manage`) |
| `staff_sessions`, `staff_invitations` | karta operatora | listy Operatorzy → Sesje i Zaproszenia z unieważnieniem |
| `permissions` | macierz w roli | lista Role → Uprawnienia: kod, grupa, opis (edycja opisu), liczba ról |
| `role_permissions`, `staff_roles` | macierz roli, formularz operatora | bez zmian: tabele łączące edytowane w rekordzie nadrzędnym (ADR 0076) |
| `rental_events` | oś czasu przejazdu | lista Przejazdy → Zdarzenia (typ, przejazd, czas; filtry), tylko odczyt |
| `telemetry` | brak | lista Flota → Telemetria: hulajnoga i zakres czasu wymagane, stronicowanie kursorem, bez liczenia wszystkich wierszy; tylko odczyt |
| `scooter_commands` | brak (wyniki na osi czasu) | lista Flota → Komendy (typ, stan, źródło, czas potwierdzenia, przejazd); tylko odczyt, wysyłka z karty hulajnogi |
| `scooter_zone_presence`, `scooter_zone_control` | brak, komendy stref na osi czasu | lista Strefy → Obecność w strefach i komendy stref (techniczne, tylko odczyt) |
| `payment_customers` | brak | lista Płatności → Klienci operatora (identyfikator u operatora płatności, klient, utworzenie); tylko odczyt |
| `receipt_items`, `service_task_parts`, `ticket_photos`, `document_template_versions`, `notification_template_versions`, `content_page_versions` | szczegóły rekordu nadrzędnego | bez zmian, z sortowaniem w tabeli szczegółów (ADR 0076) |
| `document_templates` | bez edycji nazwy i dezaktywacji | edycja nazwy i opisu, dezaktywacja szablonu bez aktywnej roli domyślnej (dług z iteracji 7) |
| `report_definitions` | brak | Raporty → Definicje: nazwa, opis, aktywność, kolejność, formaty |
| `report_runs` | brak | Raporty → Historia uruchomień |
| `scooter_status_history` (nowa, D4) | — | zakładka „Historia stanów” na karcie hulajnogi i lista do raportu floty |

## Warunek wstępny: decyzje i makiety
Zanim zacznie się implementacja:
- autor odpowiada na pytania i decyzje poniżej;
- brakujące stany dostają makiety w `docs/projekt/ekrany/` według [design systemu](../projekt/design-system.md). Proponowane katalogi:
  - `32-panel-raporty`: katalog, raport z parametrami i podglądem, eksport, historia, definicja oraz strony PDF raportu;
  - `33-panel-pulpit`: pulpit z wykresami w wariantach ról (zastępuje `13-panel/admin-pulpit` z nową nawigacją);
  - `34-panel-domkniecie`: okno eksportu listy i nowe zakładki list (wzorzec `17-panel-wzorce` z danymi konkretnych tabel).

Brakujące makiety (propozycja):
- [x] **Panel: katalog raportów** (karty raportów według uprawnień z opisem z `report_definitions` i ostatnim uruchomieniem; pusty stan bez uprawnień).
- [x] **Panel: raport z parametrami i podglądem** dla przychodów (kafelki z porównaniem do poprzedniego okresu, wykres słupkowy w czasie, tabela) i dla przejazdów według stref i godzin (mapa ciepła dzień tygodnia × godzina); stany: ładowanie, brak danych w okresie, zakres za długi, błąd.
- [x] **Panel: eksport raportu** (format PDF albo XLSX, w kolejce, w toku, gotowe z „Pobierz”, błąd z „Ponów”), jak okno „Drukuj” z `29-panel-wydruki`.
- [x] **Panel: historia uruchomień** (lista z filtrami raportu, zlecającego, stanu i dat; „Uruchom ponownie z tymi parametrami”; plik usunięty po retencji).
- [x] **Panel: definicja raportu** (nazwa, opis, aktywność, kolejność; parametry i formaty tylko do odczytu).
- [x] **PDF raportu:** strona tytułowa albo nagłówek (dane firmy, nazwa raportu, parametry, chwila danych, zlecający), kafelki, wykres, tabela z powtarzanym nagłówkiem, stopka z identyfikatorem uruchomienia i „Strona X z Y”; A4 pionowo i poziomo (pytanie 15).
- [x] **Pulpit** dla Administratora, Dyspozytora i Serwisanta (kafelki i wykresy według uprawnień, pytanie 9).
- [x] **Okno eksportu listy** (format XLSX albo CSV, liczba wierszy z filtrów, limit, ostrzeżenie o danych osobowych) i przycisk w pasku listy.
- [x] **Nowe listy:** telemetria (wybór hulajnogi i zakresu czasu, stronicowanie kursorem), zgody, sesje klienta, kody SMS, komendy; historia stanów na karcie hulajnogi; edycja i dezaktywacja szablonu wydruku.

## Zakres
- [x] **Migracja 0013** (`0013_reports.sql`, testy w `packages/db/src/db.test.ts`):
  - funkcje raportowe z parametrami (D1), po jednej lub dwie na raport, np. `fn_report_revenue(p_from, p_to, p_granularity)`, `fn_report_fleet_usage(…)`, `fn_report_rides_by_zone(…)`, `fn_report_reliability(…)`, `fn_report_users(…)`, `fn_report_wallet(…)`; dni i godziny w strefie Europe/Warsaw, kwoty w groszach;
  - historia stanów hulajnogi (D4): tabela tylko do dopisywania wypełniana wyzwalaczem przy zmianie `status` i `online`, z wierszem otwarcia dla bieżących hulajnóg;
  - `report_definitions`: wiersze sześciu raportów z katalogu w core (seed albo synchronizacja przy starcie API, D3), nowe uprawnienie według pytania 8;
  - `report_runs`: czas usunięcia pliku (retencja), liczba wierszy, przyczyna błędu jako kod, indeks do historii zlecającego; cel pliku `REPORT` i `LIST_EXPORT` w `file_purpose` (`ADD VALUE` nieużywalne w tej samej transakcji migracji, jak w 0002 i 0011);
  - widoki nowych list (`v_consent_list`, `v_session_list`, `v_otp_code_list` bez skrótu, `v_scooter_command_list`, `v_rental_event_list`, `v_report_run_list` i pozostałe z pytania 11), `v_document_templates` z liczbą pól i wydrukami z 30 dni;
  - `v_low_stock_parts` przez `CREATE OR REPLACE VIEW` z regułą `<` (arc42 §11); przyczyna korekty w `v_doc_receipt`;
  - dezaktywacja szablonu wydruku (procedura z regułą: nie domyślny rodzaju z aktywną wersją);
  - indeksy pod funkcje raportowe (np. `rentals (ended_at)`, `payments (created_at)` częściowe według stanu), sprawdzone `EXPLAIN` na danych z generatora;
  - po migracji `pnpm db:pull` i aktualizacja liczb w teście bazy oraz w [modelu danych](../model-danych/README.md).

  Zrobione: 58 tabel, 79 widoków, 58 funkcji, 24 procedury (bez funkcji `btree_gist`); 34 funkcje raportowe i pomocnicze, `scooter_status_history` z wyzwalaczami i ograniczeniem wykluczającym, 15 widoków list, kolumny z ADR 0076, dezaktywacja i ponowna aktywacja szablonu procedurami. Pliki raportów w istniejącym od 0002 celu `REPORT_EXPORT` (bez nowej wartości `REPORT`), eksport list bez pliku w magazynie (bez `LIST_EXPORT`). Poprawki po przeglądzie w migracji `0014_iteration8_fixes.sql` (przyczyna w historii stanów, typy `bigint`, saldo w chwili, przedziały okresu, zaokrąglanie kategorii czasu), liczby bez zmian.
- [x] **`packages/core`:**
  - katalog raportów: kod, uprawnienie, schemat parametrów, formaty, kolumny (klucz, typ: kwota, liczba, czas trwania, procent, data), sekcje, limity; funkcja budująca model raportu z wierszy (sumy, porównanie z poprzednim okresem, udziały);
  - walidacja parametrów (zakres dat, limit długości okresu, granulacja dobrana do długości, filtry strefy, modelu, hulajnogi) i nazwa pliku wyniku;
  - wskaźniki: wykorzystanie floty (czas w przejeździe do czasu dostępności), dostępność, MTBF i średni czas naprawy, klienci nowi, aktywni i powracający;
  - port `ReportRenderer` albo rozszerzenie `DocumentRenderer` o XLSX (D5), reguły dostępu do historii i pliku.

  Zrobione: `REPORT_CATALOG` i `REPORT_LIMITS`, parametry w Europe/Warsaw, budowanie modelu (`build-*.ts`), wskaźniki floty w `scooter-time.ts`, reguły uruchomień, osobny port `SpreadsheetWriter` (D5), eksport list (`list-export.ts`), katalog kafelków pulpitu (`dashboard.ts`).
- [x] **`packages/shared`:** schematy parametrów i odpowiedzi podglądu, geometria wykresów (D2: skale, podziałki, słupki, linie, mapa ciepła, pasek udziałów jako dane kształtów bez DOM), zasoby nowych list, `report-runs` i `report-definitions`, schemat żądania eksportu listy. Zrobione: geometria w `src/charts`, 15 nowych zasobów, pola `personal` i `money` w `FieldDefinition`, schematy raportów, pulpitu i eksportu listy; kolory wykresów w `docs/projekt/tokens.json` (`color.chart`).
- [x] **Kontrakty:** OpenAPI (`pnpm api:openapi`); Socket.IO 1.7.0 (`report.ready` w `staff:{id}`). Zrobione: [OpenAPI](../kontrakty/openapi.json) (katalog uprawnień na `/admin/permissions/catalog`, `platform` i `appVersion` w logowaniu i odświeżeniu sesji), [Socket.IO 1.7.0](../kontrakty/asyncapi-realtime.yaml).
- [x] **API:**
  - **Raporty:** `GET /admin/reports` (katalog według uprawnień), `GET /admin/reports/{code}/preview?…` (podgląd synchroniczny z limitem), `POST /admin/reports/{code}/runs` (eksport zadaniem `report.generate`), `GET /admin/report-runs` (historia, kontrakt list), pobranie pliku z podpisem, ponowienie; definicje z blokadą optymistyczną i dziennikiem audytu; `reports.sweep` i retencja jak w wydrukach;
  - **PDF:** HTML raportu w API (D3) z wykresami SVG z geometrii w shared, czcionka Inter, `htmlToPdf` w Gotenbergu; **XLSX:** ExcelJS (wersja i ESM do sprawdzenia), arkusz danych z typami i formatami, arkusz parametrów;
  - **Pulpit:** `GET /admin/dashboard/summary` (kafelki i wykresy według uprawnień, pytanie 9), punkt grupy „Treści” (dług z iteracji 7);
  - **Eksport list:** `GET /admin/{zasób}/export?format=xlsx|csv&…` dla każdego zasobu (D6), wspólny dla `ListQueryPipe`, z maskowaniem jak w liście, limitem wierszy, ochroną przed formułami i wpisem w dzienniku audytu;
  - **Nowe listy:** kontrolery z `ListQueryPipe` i polecenia z macierzy (unieważnienie sesji, wycofanie zgody, usunięcie wygasłych kodów, opis uprawnienia, edycja i dezaktywacja szablonu).

  Zrobione: moduł `reports` z zadaniami `report.generate`, `reports.sweep` i `reports.retention`, PDF z HTML i SVG przez Gotenberga, XLSX przez ExcelJS 4.4.0, `GET /admin/dashboard/summary` (z grupą „Treści”), eksport list jako `POST /admin/{zasób}/export` (zmiana planu po ADR-ach) dla każdej listy, z limitem 3 eksportów naraz na instancję. Retencji telemetrii pilnuje istniejące zadanie `telemetry.purge` (ADR 0037), bez nowego `telemetry.retention`. Po przeglądzie dane klienta zamaskowane także w listach i szczegółach przejazdów i płatności bez `users.read`.
- [x] **Generator danych historycznych** (pytanie 12): polecenie `pnpm db:history` w `packages/db`, deterministyczny (ziarno), przez procedury i wyzwalacze bazy, z oznaczeniem danych do usunięcia. Zrobione według ADR 0075: wiersze z jawnymi czasami i wartościami z core, tylko na świeżej bazie (`SEED_SAMPLE_RENTALS=0`), 90 dób w 16,8 s, 17 kontroli spójności; usunięcie danych to nowa baza.
- [x] **Panel:** Analiza → Raporty (katalog, raport z parametrami w adresie URL i podglądem, okno eksportu z `report.ready`, Historia, Definicje); pulpit z wykresami; komponenty wykresów z geometrii w shared (bez biblioteki, D2); „Eksportuj” w `ResourceList`; nowe zakładki list; edycja i dezaktywacja szablonu wydruku; historia stanów na karcie hulajnogi. Zrobione; eksport także w `InlineList`, zapisane miejsca na karcie klienta; odstępstwa od makiet w [dzienniku](../dziennik.md#iteracja-8-implementacja-19-listopada-2026).
- [x] **Aplikacja:** tylko długi według D7 (`mobile.notice`, godziny pomocy). Zrobione: baner `mobile.notice` na mapie (plansza `31-mobile-tresci/komunikat`), tekst „Godziny pomocy: {hours}”; ponad plan platforma, wersja i model urządzenia w sesji (lista sesji w panelu). Sprawdzone `tsc` i `expo lint`, bez development build.
- [x] **Dokumentacja:** arc42 §5 (moduł Raporty), §6 (raport: podgląd i eksport), §8 (raporty, wykresy, eksport list), §11 (ryzyka: wydajność raportów na dużych okresach, ExcelJS bez wydań); model danych z pełną macierzą (każda tabela z miejscem w panelu); wymagania uczelni (12, 18); spis makiet; instrukcja raportów dla operatora. Zrobione: arc42 §5, §6.14–6.15, §7, §8.18–8.21, §11; model danych (kolumna „Miejsce w panelu”); wymagania uczelni (3c, 6, 8, 12, 13, 14, 17, 18); spis makiet. Instrukcję raportów dla operatora zastępują [scenariusz demo](#scenariusz-demo) i opisy raportów z `report_definitions` w katalogu.

## ADR-y do napisania

| Nr | Temat | Co rozstrzyga |
|---|---|---|
| 0071 | Moduł raportów | Katalog raportów w core i `report_definitions` w bazie (synchronizacja, D3), funkcje raportowe z parametrami (D1), podgląd synchroniczny i eksport zadaniem, `report_runs` i retencja (pytanie 6), uprawnienia do raportów, historii i plików (pytania 7–8), limity okresu i wierszy, chwila danych w nagłówku. Rozwija [ADR 0029](../adr/0029-raporty-pdf-xlsx.md). |
| 0072 | Wykresy w panelu i w PDF | Geometria wykresów w `packages/shared` bez biblioteki i bez DOM, dwa renderery (React SVG w panelu, tekst SVG w HTML raportu), rodzaje wykresów, kolory z tokenów design systemu, dostępność (tabela obok wykresu, opisy). Alternatywy: biblioteka wykresów w panelu i osobne SVG w PDF. |
| 0073 | Eksport list do XLSX i CSV | Punkt eksportu w kontrakcie list, synchronicznie strumieniem albo zadaniem (D6), limit wierszy, kolumny z definicji zasobu, maskowanie danych osobowych, ochrona przed wstrzyknięciem formuł, kodowanie CSV (UTF-8 z BOM, średnik), dziennik audytu. Realizuje eksport z [ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md). |
| 0074 | Historia stanów hulajnogi | Tabela tylko do dopisywania z wyzwalaczem (D4), stan i łączność, przedziały zamiast zdarzeń, retencja, użycie w raporcie floty i na karcie hulajnogi. |
| 0075 | Dane historyczne do demonstracji | Generator przez procedury bazy, deterministyczne ziarno, skala (dni, przejazdy na dobę), rozkład godzin i stref Rybnika, oznaczenie i usunięcie danych, zakaz uruchomienia w produkcji. |
| 0076 | Domknięcie macierzy operacji | Które tabele mają własną listę, a które zostają w rekordzie nadrzędnym (łączące, pozycje, wersje), telemetria z kursorem bez liczenia, tabele techniczne tylko do odczytu; uzupełnia [ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md) i odpowiedź na pytanie 4 do prowadzącego. |

## Pytania do autora
Seed ma wartości deweloperskie, a makiety pokazują nawiasy.

1. **Zawartość sześciu raportów.** Rekomendacja (parametry wspólne w pytaniu 3):
   - **Przychody** (`reports.revenue`): sprzedaż i wpływy według pytania 2, w podziale na okresy, porównanie z poprzednim okresem, średnia wartość przejazdu, udział opłat za odholowanie i korekt;
   - **Wykorzystanie floty** (`reports.fleet_usage`): czas w przejeździe, rezerwacji, dostępności, serwisie i bez łączności według hulajnogi i modelu (D4), wykorzystanie i dostępność w procentach, przejazdy i przychód na hulajnogę, przebieg, rozkład baterii przy końcu przejazdu;
   - **Przejazdy według stref i godzin** (`reports.rides_by_zone`): mapa ciepła dzień tygodnia × godzina startu, przejazdy według strefy końca i stref odwiedzonych, czas i dystans, przejazdy z wjazdem do strefy zakazu albo wolnej jazdy, zakończenia poza strefą parkowania z odholowaniem;
   - **Awaryjność** (`reports.reliability`): zgłoszenia według kategorii, źródła (klient, automatyczne, operator) i hulajnogi (także zamknięte `OFFLINE`), zadania i średni czas naprawy, MTBF, koszt części według hulajnogi i modelu, części poniżej minimum (ujednolicone `v_low_stock_parts`);
   - **Użytkownicy** (`reports.users`): rejestracje, aktywni, nowi i powracający w okresie, kohorty miesięczne (procent wracających w kolejnych miesiącach), blokady i usunięcia kont, zgody marketingowe; bez danych osobowych;
   - **Portfel** (`reports.wallet`): saldo początkowe i końcowe okresu, obroty według typu operacji (doładowanie, przejazd, zwrot, korekta), korekty według przyczyny, rozkład sald (przedziały), zaległości; bez danych osobowych.
2. **Co znaczy „przychód”.** Rekomendacja: raport przychodów ma dwie części:
   - **sprzedaż** z paragonów (`receipts`, `receipt_items`): brutto, netto i VAT według stawki, korekty jako wartości ujemne, opłata za odholowanie osobno jako kara umowna poza VAT (ADR 0061);
   - **wpływy** z płatności: doładowania i płatności kartą według metody (karta, BLIK), zwroty, saldo portfeli jako zobowiązanie wobec klientów (odsyłacz do raportu portfela).

   Dziś `v_daily_revenue` liczy kwoty przejazdów z `rentals`, a nie paragony, więc widok zostaje bez zmian (używa go dokumentacja), a raport korzysta z nowej funkcji.
3. **Parametry wspólne i limity.** Rekomendacja: okres z gotowymi zakresami (dziś, wczoraj, 7 dni, bieżący i poprzedni miesiąc, własny), najwyżej 366 dni; granulacja dzień, tydzień, miesiąc dobierana do długości okresu z możliwością zmiany; filtry strefa, model, hulajnoga tam, gdzie mają sens; porównanie z poprzednim okresem tej samej długości; dni według Europe/Warsaw (doba zmiany czasu ma 23 albo 25 godzin).
4. **Formaty.** Rekomendacja: raporty w PDF i XLSX (typ `report_format` ma też `CSV`, ale CSV zostaje dla eksportu list); XLSX ma arkusz na każdą tabelę raportu i arkusz „Parametry”, PDF ma wykresy i tabele skrócone do pierwszych N wierszy z dopiskiem, że pełne dane są w XLSX.
5. **Podgląd i eksport.** Rekomendacja: podgląd w panelu synchronicznie (te same funkcje bazy, limit czasu zapytania), eksport zadaniem `report.generate` z `report.ready` i odpytywaniem jako zapasem (jak wydruki); eksport liczy dane od nowa, a nagłówek podaje chwilę danych.
6. **Przechowywanie plików raportów.** Rekomendacja: wiersz `report_runs` na zawsze, plik usuwany po 30 dniach (jak wydruki, stan pliku „usunięty”), „Uruchom ponownie z tymi parametrami” tworzy nowy wiersz.
7. **Dostęp do raportów i historii.** Rekomendacja: raport widzi i uruchamia operator z `reports.<kod>`; historia pokazuje wszystkie uruchomienia raportów, do których operator ma uprawnienie (także cudze), a pobranie wymaga tego samego uprawnienia; raporty bez danych osobowych, więc bez maskowania jak w wydrukach. Przydziały ról z migracji 0002 zostają, Redaktor bez raportów.
8. **Edycja definicji raportów.** Macierz przewiduje `content.write`, przez co Redaktor zmieniałby nazwy raportów, których nie widzi. Rekomendacja: nowe uprawnienie `reports.manage` (tylko Administrator) do nazwy, opisu, aktywności i kolejności; parametry i formaty z katalogu w kodzie, tylko do odczytu.
9. **Pulpit.** Rekomendacja według `admin-pulpit` w nowej nawigacji:
   - kafelki: aktywne przejazdy, dostępne hulajnogi z udziałem we flocie, niska bateria, sprzedaż dziś (z `payments.read`), nowe zgłoszenia (z `tickets.read`);
   - wykresy: przejazdy dziś według godzin z obecną godziną i średnią z 4 tych samych dni tygodnia, stan floty jako pasek udziałów;
   - grupy „Wymaga uwagi” bez zmian, grupa „Treści” dla Redaktora;
   - mapa zostaje w „Mapa floty” (na pulpicie odnośnik), odświeżanie co 60 s i po zdarzeniach `fleet`;
   - każdy kafelek i wykres według uprawnienia jego danych.
10. **Eksport list.** Rekomendacja: „Eksportuj” na każdej liście wzorca, formaty XLSX i CSV, bieżące filtry, wyszukiwanie i sortowanie, wszystkie strony do 50 000 wierszy (powyżej komunikat o zawężeniu filtrów), kolumny listy z etykietami z panelu, dane osobowe zamaskowane jak w liście, wpis `list.exported` w dzienniku audytu z zasobem, filtrami i liczbą wierszy; uprawnienie odczytu zasobu. Eksport stref do GeoJSON (dług z iteracji 4) poza zakresem.
11. **Pozostałe tabele.** Rekomendacja według tabeli „Pokrycie tabel w panelu” wyżej: osobne listy dla zgód, sesji, kodów SMS, sesji i zaproszeń operatorów, uprawnień, zdarzeń przejazdu, telemetrii, komend, obecności i komend stref, klientów operatora płatności, definicji i uruchomień raportów; tabele łączące, pozycje i wersje zostają w szczegółach rekordu nadrzędnego z sortowaniem (ADR 0076).
12. **Dane do raportów.** Rekomendacja: generator historii za 90 dni (ok. 150–250 przejazdów na dobę z rytmem dobowym i tygodniowym, trasy między strefami Rybnika, płatności z portfela i kartą, paragony, zwroty, zgłoszenia, zadania z częściami, historia stanów), uruchamiany ręcznie (`pnpm db:history`), deterministyczny, przez procedury bazy (`sp_wallet_post`, `sp_issue_receipt`, procedury magazynu), z oznaczonymi klientami i hulajnogami, które da się usunąć; nie działa przy `NODE_ENV=production`. Bez generatora raporty i wykresy na obronie będą puste.
13. **Historia stanów hulajnogi.** Rekomendacja: nowa tabela według D4; raport floty liczy czasy od wdrożenia migracji, a dla starszych danych tylko czas w przejeździe (z `rentals`).
14. **Długi w tej iteracji.** Rekomendacja: w zakresie wszystko, co domyka macierz i raporty (edycja i dezaktywacja szablonu, `v_low_stock_parts`, `v_document_templates`, przyczyna korekty w `v_doc_receipt`, grupa „Treści” na pulpicie) oraz dwa drobne z aplikacji (`mobile.notice`, godziny pomocy); odłożone zmiany z iteracji 6 do iteracji 9 albo poza projekt (decyzja przy iteracji 9).
15. **Wygląd PDF raportu.** Rekomendacja: A4 pionowo dla raportów z kafelkami i wykresami w czasie, A4 poziomo dla szerokich tabel (wykorzystanie floty, awaryjność według hulajnogi); nagłówek z nazwą firmy z danych firmy (marka `[nazwa]` zostaje etykietą), stopka z identyfikatorem uruchomienia, chwilą danych, zlecającym i „Strona X z Y”; styl design systemu (Inter, liczby Medium, kobalt tylko dla bieżącej wartości).

## Decyzje do potwierdzenia
- **D1. Dane raportów.** Rekomendacja: funkcje SQL z parametrami (`fn_report_*`, `STABLE`, zwracają tabele) zamiast widoków, bo widok nie przyjmuje okresu i strefy czasowej, a filtrowanie widoku po agregacji dnia psuje indeksy; testy bazy na znanych danych dla każdej funkcji. Istniejące widoki z 0002 zostają. Alternatywa: widoki zmaterializowane odświeżane zadaniem (szybsze, ale dane z opóźnieniem).
- **D2. Wykresy.** Rekomendacja: własna geometria w `packages/shared` (słupki, linie, mapa ciepła, pasek udziałów, podziałki osi) zwracająca kształty jako dane; panel rysuje je komponentami React SVG, a API zamienia na tekst SVG w HTML raportu. Jeden wygląd w panelu i w PDF, bez `dangerouslySetInnerHTML` i bez biblioteki w API. Alternatywa: biblioteka wykresów w panelu (np. Recharts) i osobny generator SVG do PDF (dwa wyglądy do utrzymania).
- **D3. Katalog raportów a `report_definitions`.** Rekomendacja: katalog w core (kod, uprawnienie, parametry, formaty, kolumny) jest źródłem prawdy; seed wstawia brakujące wiersze i aktualizuje schemat parametrów i formaty, ale nie nadpisuje nazwy, opisu, aktywności i kolejności (jak szablony powiadomień); HTML raportu w API funkcjami z ucieczką znaków (jak naklejka QR), bez renderowania Reacta na serwerze.
- **D4. Historia stanów hulajnogi.** Rekomendacja: tabela `scooter_status_history` (hulajnoga, stan, łączność, od, do) wypełniana wyzwalaczem `AFTER UPDATE OF status, online` na `scooters`, zamykająca poprzedni przedział; tylko do dopisywania poza zamknięciem przedziału. Alternatywa: liczyć przestoje z dziennika audytu, zadań i telemetrii (niepełne i drogie).
- **D5. XLSX.** Rekomendacja: ExcelJS za portem (rozszerzenie `DocumentRenderer` o `toXlsx` albo osobny `SpreadsheetWriter`), kwoty jako liczby w złotych z formatem `# ##0,00 zł`, daty jako daty Excela w Europe/Warsaw, zamrożony wiersz nagłówka, autofiltr; przed ADR sprawdzić wersję, ESM pod NestJS 12 i zapis strumieniowy (ADR 0029 przewiduje wymianę biblioteki, jeśli nie działa).
- **D6. Eksport list.** Rekomendacja: synchronicznie strumieniem (XLSX zapisem strumieniowym, CSV wiersz po wierszu) w odpowiedzi `GET`, bez zadania i pliku w magazynie, bo lista ma limit wierszy i działa na widoku listy; wartości zaczynające się od `=`, `+`, `-`, `@`, tabulatora albo powrotu karetki dostają apostrof (wstrzyknięcie formuł). Alternatywa: zadanie jak raport (wolniej, ale z historią).
- **D7. Miejsce w panelu.** Rekomendacja: Analiza → Raporty (zakładki Raporty, Historia, Definicje) przed Wydrukami; nowe listy jako zakładki w obszarach domenowych (Klienci: Zgody, Sesje, Kody SMS; Operatorzy: Sesje, Zaproszenia; Role: Uprawnienia; Flota: Telemetria, Komendy; Przejazdy: Zdarzenia; Strefy: Obecność i komendy stref; Płatności: Klienci operatora), a nie osobny obszar „Dane systemowe”, żeby operator szukał danych tam, gdzie pracuje.
- **D8. Granica z iteracją 9.** Rekomendacja: ta iteracja dostarcza generator danych i indeksy pod raporty sprawdzone `EXPLAIN`; pomiary pod obciążeniem, widoki zmaterializowane (jeśli potrzebne) i spis widoków do pracy w iteracji 9.

## Odpowiedzi autora (19 listopada 2026)
Autor przyjął wszystkie rekomendacje: pytania 1–15 i decyzje D1–D8 bez zmian.

| Pytanie | Odpowiedź |
|---|---|
| 1. Raporty | Sześć raportów z zawartością według rekomendacji: przychody, wykorzystanie floty, przejazdy według stref i godzin, awaryjność (z kosztem części i częściami poniżej minimum), użytkownicy i portfel bez danych osobowych. |
| 2. Przychód | Dwie części: sprzedaż z paragonów (brutto, netto, VAT według stawek, korekty, odholowanie poza VAT) i wpływy z płatności według metody; `v_daily_revenue` bez zmian. |
| 3. Parametry | Gotowe zakresy i własny okres do 366 dni, granulacja dobierana do długości, filtry strefy, modelu i hulajnogi, porównanie z poprzednim okresem, doby w Europe/Warsaw. |
| 4. Formaty | Raporty w PDF i XLSX (arkusz na tabelę i „Parametry”; PDF z tabelami skróconymi); CSV tylko w eksporcie list. |
| 5. Podgląd i eksport | Podgląd synchroniczny, eksport zadaniem `report.generate` z `report.ready` (odpytywanie jako zapas); nagłówek z chwilą danych. |
| 6. Przechowywanie | Wiersz `report_runs` na zawsze, plik usuwany po 30 dniach; „Uruchom ponownie z tymi parametrami” tworzy nowy wiersz. |
| 7. Dostęp | Raport, historia (także cudze uruchomienia) i pobranie według `reports.<kod>`; raporty bez danych osobowych; przydziały ról z 0002 bez zmian, Redaktor bez raportów. |
| 8. Definicje | Nowe uprawnienie `reports.manage` (Administrator): nazwa, opis, aktywność, kolejność; parametry i formaty z kodu. |
| 9. Pulpit | Kafelki i wykresy według uprawnień (przejazdy według godzin ze średnią, stan floty), „Wymaga uwagi” bez zmian plus grupa „Treści”, mapa tylko jako odnośnik, odświeżanie co 60 s i po zdarzeniach `fleet`. |
| 10. Eksport list | „Eksportuj” na każdej liście, XLSX i CSV, bieżące filtry i sortowanie, do 50 000 wierszy, maskowanie jak w liście, wpis `list.exported`; GeoJSON stref poza zakresem. |
| 11. Pozostałe tabele | Według tabeli „Pokrycie tabel w panelu”; tabele łączące, pozycje i wersje w szczegółach rekordu nadrzędnego. |
| 12. Dane do raportów | Generator `pnpm db:history`: 90 dni, deterministyczny, przez procedury bazy, z oznaczeniem do usunięcia, zablokowany w produkcji. |
| 13. Historia stanów | Nowa tabela (D4); czasy od wdrożenia migracji, wcześniej tylko czas w przejeździe. |
| 14. Długi | W zakresie długi domykające macierz i raporty oraz `mobile.notice` i godziny pomocy; odłożone zmiany z iteracji 6 do decyzji przy iteracji 9. |
| 15. PDF raportu | A4 pionowo, poziomo dla szerokich tabel; nagłówek z nazwą firmy, stopka z identyfikatorem uruchomienia, chwilą danych, zlecającym i „Strona X z Y”; styl design systemu. |

| Decyzja | Rozstrzygnięcie |
|---|---|
| D1 | Funkcje SQL `fn_report_*` z parametrami; widoki z 0002 zostają. |
| D2 | Własna geometria wykresów w `packages/shared`, renderery React SVG (panel) i tekst SVG (PDF). |
| D3 | Katalog raportów w core jako źródło prawdy, seed nie nadpisuje nazwy, opisu, aktywności i kolejności; HTML raportu funkcjami z ucieczką znaków. |
| D4 | `scooter_status_history` z wyzwalaczem na `status` i `online`. |
| D5 | ExcelJS za portem (po sprawdzeniu wersji, ESM i zapisu strumieniowego); kwoty w złotych z formatem, daty Excela. |
| D6 | Eksport list synchronicznie strumieniem, ochrona przed formułami. |
| D7 | Analiza → Raporty (Raporty, Historia, Definicje); nowe listy jako zakładki w obszarach domenowych. |
| D8 | Generator danych i indeksy w tej iteracji; pomiary pod obciążeniem i widoki zmaterializowane w iteracji 9. |

## Do rozstrzygnięcia w ADR 0071–0076 (z makiet, 19 listopada 2026)
Luki i propozycje z projektowania plansz; autor zatwierdza je razem z ADR-ami.
- **Definicje wskaźników (ADR 0071, 0074):** plansze liczą je różnie. Raport floty: wykorzystanie = przejazd ÷ (przejazd + rezerwacja + dostępna), dostępność = (przejazd + rezerwacja + dostępna) ÷ czas okresu. Karta hulajnogi: wykorzystanie = przejazd ÷ czas okresu, dostępność = czas gotowości z łącznością ÷ czas okresu. Jedna definicja w core dla pulpitu, karty i raportu; czas okresu z Europe/Warsaw (październik 2026 ma 745 h).
- **`report_runs` (migracja 0013):** czas usunięcia pliku (stan „Plik usunięty”), chwila danych `data_as_of`, kod błędu osobno od opisu, liczba wierszy, stron i rozmiar pliku; `params` z datami bezwzględnymi i etykietą zakresu. Pozycja w kolejce pg-boss tylko, jeśli tania.
- **Raporty (ADR 0071):** uprawnienie na raport, a nie na kolumnę: Dyspozytor z `reports.rides_by_zone` widzi przychód w tabeli stref bez `payments.read` (zostawić albo usunąć kolumnę); porównanie miesięcy wyrównane do dnia miesiąca; czy synchronizacja katalogu podbija `version` definicji i jaki wpis systemu trafia do dziennika; wyłączony raport znika z katalogu także dla Administratora; odpowiedź podglądu z najwcześniejszą datą danych (stan „Brak danych”).
- **Wykresy (ADR 0072):** stałe progi mapy ciepła czy kwantyle; kolory jak w spisie makiet (słupki `#6B6E75`, beton dla porównania, kobalt dla bieżącej wartości, rezerwacja `#AEB6FB`).
- **Pulpit (API):** `GET /admin/dashboard/summary` z polami `null` bez uprawnienia; „Twoje zadania” Serwisanta (spoza planu: przypisane zadania według terminu); grupa „Treści” Redaktora; wyszukiwarka w nagłówku tylko po danych roli.
- **Eksport list (ADR 0073):** oznaczenie kolumn z danymi osobowymi w definicji zasobu, błąd `LIST_EXPORT_LIMIT` z liczbą wierszy, CSV ze średnikiem i przecinkiem dziesiętnym.
- **Historia stanów (ADR 0074):** przyczyna przedziału w widoku `v_scooter_status_history` (z przejazdów, zadań, zgłoszeń, dziennika) albo w kolumnie; uprawnienie zakładki `scooters.read`.
- **Telemetria (ADR 0076):** kolumny `locked` i `buffered` z kontraktu MQTT (dziś niezapisywane); stronicowanie kursorem bez `total` jako wyjątek od kontraktu list; zakres najwyżej [24 h]; retencja: `sp_purge_telemetry` istnieje, ale żadne zadanie jej nie woła (plansza zakłada 90 dni).
- **Brakujące kolumny (migracja 0013):** `consents.source` i `revoked_by_staff`; `sessions.platform` i `app_version`; `otp_codes.purpose`; `scooter_commands.source` (operator, przejazd, strefa, system) i `zone_id` z uzupełnieniem starych wierszy; `staff_invitations.replaced_by`; `staff_sessions.remembered`; `permissions.updated_at`, `updated_by`, `version` (synchronizacja katalogu nie nadpisuje opisu); `document_templates.deactivated_at`; procedura dezaktywacji z błędem `TEMPLATE_IS_DEFAULT` i błąd `TEMPLATE_NAME_TAKEN` przy zmianie nazwy.
- **Uprawnienia nowych list (ADR 0076):** komendy z `scooters.read` (macierz: `scooters.command`), kody SMS z `users.read` i usuwanie z `users.manage`, wycofanie zgody z `users.manage` (macierz: `users.read`); wpisy `consent.revoked`, `session.revoked`, `staff.invitation_revoked`, `permission.updated`, `otp.purged`.
- **Sesje:** unieważnienie nie zatrzymuje tokenu dostępu (do 15 min), a strażnik operatora sprawdza tylko aktywność konta, nie sesję; wystarcza czy sprawdzać sesję.
- **Macierz roli:** krótka etykieta uprawnienia z `pl.json`, opis z bazy po najechaniu (opis do 160 znaków).
- **Nawigacja:** plansze z `29-panel-wydruki` nie mają „Modele hulajnóg” w Konfiguracji, które są w `sidebar.tsx`; implementacja zostaje przy kodzie.

## Zmiany planu po ADR-ach (19 listopada 2026)
Przyjęte przez autora razem z ADR-ami 19 listopada 2026:
- **Dane do demonstracji (ADR 0075):** generator wstawia wiersze z jawnymi czasami i wartościami z `packages/core` zamiast przez `sp_wallet_post` i `sp_issue_receipt` (procedury stemplują `now()`, a księga i paragony nie pozwalają na zmianę czasu po zapisie); działa tylko na świeżej bazie, a usunięcie danych to odtworzenie bazy, bo tabele tylko do dopisywania nie pozwalają na selektywne usunięcie (zmiana odpowiedzi na pytanie 12).
- **Raport stref bez przychodu (ADR 0071):** raport zawiera tylko dane obszaru swojego uprawnienia; sprzedaż według strefy końca jest sekcją raportu przychodów (odstępstwo od planszy `raport-strefy-godziny`).
- **Jedna definicja wykorzystania i dostępności (ADR 0074):** wykorzystanie = czas w przejeździe ÷ czas okresu, dostępność = (dostępna + rezerwacja + w przejeździe) ÷ czas okresu; tabela na planszy `raport-pdf` przyjmie te definicje.
- **Eksport list jako `POST /admin/{zasób}/export` z etykietami z panelu (ADR 0073)** zamiast `GET …/export`: żądanie zapisuje wpis w dzienniku audytu i niesie etykiety kolumn z `pl.json`, więc API nie trzyma ich kopii.
- **Telemetria (ADR 0076):** kolumny `locked` i `buffered` oraz zadanie retencji `telemetry.retention` (90 dni) w zakresie iteracji.

## Do sprawdzenia przed ADR-ami
Wersje starsze niż 3 dni; nic nie instalujemy przed akceptacją ADR.
- **ADR 0071 i 0073 (ExcelJS):** aktualna wersja i data wydania (ADR 0029: 4.4.0 z października 2023), import w ESM pod NestJS 12 i Node z `.nvmrc`, zapis strumieniowy (`stream.xlsx.WorkbookWriter`) do odpowiedzi Fastify, formaty liczb i dat, rozmiar zależności; alternatywa, jeśli niezgodna.
- **ADR 0071 (Gotenberg 9.5.1, Chromium):** nagłówek i stopka z numerem strony (`header.html`, `footer.html` albo `@page` z licznikami), orientacja i marginesy, powtarzany nagłówek tabeli (`thead`), podział stron przy wykresach (`break-inside`), czas generowania 20-stronicowego raportu.
- **ADR 0072 (wykresy):** czytelność w PDF (SVG z Inter z kontenera), skala barw mapy ciepła z tokenów design systemu (kontrast WCAG), wzorzec dostępności wykresów w panelu.
- **ADR 0074 (historia stanów):** zachowanie wyzwalacza `scooters_status` z iteracji 6 (kolejność wyzwalaczy, wpis systemu), liczba aktualizacji `online` z telemetrii (czy wyzwalacz nie mnoży wierszy przy każdej partii).
- **ADR 0075 (generator):** czas generowania 90 dni przez procedury, wpływ na sekwencję numerów paragonów (`PAR/2026/…`), trasy z OSRM czy linie proste.
- **Next.js 16.4.6:** pobranie pliku z `GET` z nagłówkiem autoryzacji (Blob w przeglądarce) i nazwa pliku z `Content-Disposition`.

## Poza zakresem (świadomie)
- Raporty cykliczne i wysyłka e-mailem, kreator raportów, własne zapytania w panelu.
- Mapa w PDF raportu (kafelki mapy z zewnętrznego serwera są zablokowane w Gotenbergu).
- Eksport stref do GeoJSON, import danych z pliku.
- Odłożone zmiany z iteracji 6 (pytanie 14).
- Testy obciążeniowe i widoki zmaterializowane (iteracja 9, D8).

## Kolejność kroków
1. ~~Odpowiedzi autora na pytania 1–15 i decyzje D1–D8; aktualizacja tego planu.~~ Zrobione 19 listopada 2026 (wszystkie rekomendacje).
2. ~~Makiety brakujących stanów w `32-panel-raporty`, `33-panel-pulpit` i `34-panel-domkniecie`, PNG obejrzane przed implementacją, wpis w [spisie makiet](../projekt/README.md).~~ Zrobione 19 listopada 2026: 21 plansz (8 w `32-panel-raporty`, 3 w `33-panel-pulpit`, 10 w `34-panel-domkniecie`).
3. ~~Sprawdzenia z sekcji „Do sprawdzenia przed ADR-ami” z datami~~ zrobione 19 listopada 2026 (wyniki w ADR 0071, 0073, 0074, 0075 i w [dzienniku](../dziennik.md)); ADR 0071–0076 przyjęte przez autora 19 listopada 2026.
4. ~~Migracja 0013, `pnpm db:pull`, testy bazy (funkcje raportowe na znanych danych, historia stanów, dezaktywacja szablonu, widoki list); generator danych historycznych i `EXPLAIN` funkcji na jego danych.~~ Zrobione 19 listopada 2026: 58 tabel, 79 widoków, 58 funkcji, 24 procedury; generator 90 dób w 16,8 s; poprawki w 0014.
5. ~~`packages/core` i `packages/shared`: katalog raportów, parametry, wskaźniki, geometria wykresów, zasoby nowych list, z testami.~~ Zrobione 19 listopada 2026.
6. ~~API: raporty (podgląd, eksport, historia, definicje), renderery PDF i XLSX, pulpit, eksport list, nowe listy i polecenia; testy API; `pnpm api:openapi`.~~ Zrobione 19 listopada 2026 (moduł Raporty, eksport list, nowe listy).
7. ~~Panel (raporty i pulpit; listy i eksport, równolegle, każdy w swoim katalogu) i drobne długi aplikacji.~~ Zrobione 19 listopada 2026; odstępstwa od makiet w [dzienniku](../dziennik.md#iteracja-8-implementacja-19-listopada-2026).
8. ~~Domknięcie: arc42, model danych z pełną macierzą, wymagania uczelni (12, 18), spis makiet, dziennik; scenariusz demo krok po kroku; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`~~; zielone CI. Dokumentacja zrobiona 19 listopada 2026; lint, typy, testy i build przechodzą; zielone CI 20 listopada 2026 (commit `83d223f`).

## Scenariusz demo
Według faktycznej implementacji (19 listopada 2026). Wymaga:
- infrastruktury z Gotenbergiem (`pnpm infra:up`, Gotenberg na `127.0.0.1:3010`);
- osobnej bazy z danymi z generatora (ADR 0075). Generator działa tylko na świeżej bazie, więc baza deweloperska z przejazdami z przeklikania się nie nadaje:
  - `docker compose --env-file .env -f infra/docker-compose.yml exec postgres createdb -U hulajnogi hulajnogi_history`;
  - z `DATABASE_URL` wskazującym tę bazę (port `POSTGRES_PORT`): `pnpm db:migrate`, `SEED_SAMPLE_RENTALS=0 pnpm db:seed`, `pnpm db:history` (90 dób w ok. 17 s, na końcu 17 kontroli spójności z wynikiem 0; ponowne uruchomienie na tej samej bazie kończy się odmową);
  - okno danych to 90 dób przed uruchomieniem generatora (przy uruchomieniu 19 listopada 2026: 20.08–18.11.2026), więc „Poprzedni miesiąc” w raportach to pełny miesiąc z danymi tylko wtedy, gdy generator działał w miesiącu demo;
- API z buildu na tej bazie: `pnpm --filter @hulajnogi/api build`, potem konfiguracja `api-history` z `.claude/launch.json` (port 3005, bez MQTT, z kolejką zadań, `PANEL_URL=http://localhost:3007`; adres bazy z portem z komputera autora);
- panelu z `NEXT_PUBLIC_API_URL=http://localhost:3005` (konfiguracja `web-reports`, `next dev` na 3007). Drugi panel na innym porcie `localhost` w tej samej przeglądarce miesza sesje (wspólne ciasteczko `admin_refresh`), więc na demo jeden panel;
- kont Administratora, Dyspozytora i Serwisanta z danych startowych (hasło z `SEED_ADMIN_PASSWORD`, TOTP przy pierwszym logowaniu) i konta z rolą Redaktor (Klienci i dostęp → Operatorzy i role → „Zaproś operatora”).

1. **Pulpit.** Administrator: pięć kafelków (aktywne przejazdy, dostępne hulajnogi z udziałem we flocie, niska bateria, sprzedaż dziś, nowe zgłoszenia), przejazdy dziś według godzin ze średnią z czterech poprzednich tych samych dni tygodnia (24 słupki; dziś bez przejazdów, bo generator kończy okno dzień wcześniej), stan floty jako pasek udziałów, „Pokaż jako tabelę” pod wykresem i grupy „Wymaga uwagi”. Serwisant: kafelki floty, zgłoszeń, zadań i części poniżej minimum oraz „Twoje zadania” zamiast wykresu godzin. Redaktor: grupa „Treści” (zaplanowane, wygasające, szkice, nieużywane grafiki). Pulpit odświeża się co 60 s.
2. **Raport przychodów.** Analiza → Raporty: katalog sześciu raportów z opisami z bazy. Przychody → „Poprzedni miesiąc”: kafelki z porównaniem do poprzedniego miesiąca, wykres sprzedaży brutto według dni z dymkami, tabele sprzedaży według stawek VAT (korekty jako wartości ujemne, odholowanie poza VAT), wpływów według metody, zwrotów i sprzedaży według strefy końca. Zmiana granulacji na „Tydzień” zmienia adres i podgląd; odświeżenie strony zostawia parametry. Okres dłuższy niż 366 dni daje stan „Okres ma … dni” z „Ustaw …”, a okres sprzed danych stan „Brak danych w okresie …”.
3. **Eksport raportu.** „Eksportuj” → „PDF do druku i przesłania” → „Eksportuj PDF”: „W kolejce”, „Generowanie PDF…”, „Gotowe” (`report.ready`) → „Pobierz PDF”. PDF: nagłówek z danymi firmy, nazwą raportu, parametrami, chwilą danych i zlecającym na pierwszej stronie, wykresy, tabele do 50 wierszy z dopiskiem o pełnych danych w XLSX, powtarzany nagłówek tabeli i stopka „Strona X z N” z identyfikatorem uruchomienia. To samo w XLSX: arkusz na każdą tabelę i arkusz „Parametry”, kwoty jako liczby w złotych, daty jako daty.
4. **Przejazdy według stref i godzin.** Mapa ciepła dzień tygodnia × godzina startu (średnia na wystąpienie dnia), przejazdy według strefy końca, wjazdy do stref z czasem w strefie (wjazdy do strefy zakazu około 1,5% przejazdów), zakończenia według trybu i kafelek „Odholowania (zakończone w okresie)”. Filtr strefy zawęża tabele. Raport nie ma kwot (sprzedaż według strefy końca jest w raporcie przychodów).
5. **Wykorzystanie floty, awaryjność, użytkownicy, portfel.** Wykorzystanie floty: czas według stanu (pasek udziałów), wykorzystanie i dostępność według hulajnogi i modelu, PDF w A4 poziomo. Hulajnoga z najdłuższym serwisem → Flota → karta hulajnogi → „Historia stanów”: przedziały z przyczyną (przejazd, rezerwacja, zadanie, zgłoszenie, operator). Awaryjność: zgłoszenia według kategorii i źródła, MTBF, czas naprawy i koszt części, części poniżej minimum. Użytkownicy i Portfel: same liczby, bez danych osobowych.
6. **Historia i definicje.** Raporty → Historia: uruchomienia z wyszukiwarką, panelem filtrów i szybkim filtrem „Moje”, „Uruchom ponownie z tymi parametrami” tworzy nowy wiersz (ten sam okres, dane na teraz); „Eksportuj” na tej liście. Definicje (Administrator, `reports.manage`): zmiana nazwy i opisu raportu i zapis; nowa nazwa jest w katalogu, w nagłówku podglądu, w PDF i w XLSX (treść z panelu, wymaganie 17). Wyłączony raport znika z katalogu, a historia i pliki zostają. Zmiana kolejności → „Zapisano kolejność raportów.”
7. **Eksport listy.** Przejazdy z filtrem stanu i okresu → „Eksportuj” → XLSX i CSV: te same wiersze i kolejność co na liście, CSV w UTF-8 z BOM, ze średnikiem i przecinkiem dziesiętnym. Wpis `list.exported` z zasobem, filtrami i liczbą wierszy w Dzienniku audytu. Przejazdy → Zdarzenia bez filtrów: „Za dużo wierszy do eksportu” (ponad 50 000), po zawężeniu okresu eksport przechodzi. Serwisant (bez `users.read`) eksportuje Zgłoszenia: okno uprzedza, że dane klienta będą puste, a w pliku kolumny klienta są puste.
8. **Domknięcie macierzy.** Klienci i dostęp → Użytkownicy → Zgody (filtr stanu, „Wycofaj” zgodę marketingową z powodem), Sesje (unieważnienie jednej sesji z platformą i wersją aplikacji), Kody SMS (numer z trzema ostatnimi cyframi, „Usuń wygasłe kody” z liczbą do usunięcia); karta klienta → Zapisane miejsca. Operatorzy i role → Zaproszenia (ponowne wysłanie, unieważnienie), Sesje, Uprawnienia (edycja opisu w wysuwanym panelu). Flota → Komendy (źródło: operator, przejazd, strefa, system) i Telemetria (wybór hulajnogi i zakresu do 24 h, stronicowanie kursorem; baza z generatora nie ma telemetrii, więc ten krok pokazuje baza deweloperska z konfiguracjami `api` i `simulator`). Strefy → Obecność w strefach i Komendy stref, Płatności → Klienci operatora. Analiza → Wydruki → szablon → „Edytuj nazwę i opis”, „Dezaktywuj szablon” (domyślnego z aktywną wersją nie da się dezaktywować), na liście „Aktywuj ponownie”.
9. **Uprawnienia.** Dyspozytor widzi w katalogu tylko Wykorzystanie floty i Przejazdy według stref i godzin, a adres raportu przychodów nie pokazuje raportu (API: `404 REPORT_NOT_FOUND`, bez zdradzania, że raport istnieje). Serwisant widzi tylko Awaryjność, Redaktor nie ma Raportów w nawigacji. Definicje zmienia tylko Administrator (`reports.manage`). Historia pokazuje także cudze uruchomienia raportów, do których operator ma uprawnienie.
