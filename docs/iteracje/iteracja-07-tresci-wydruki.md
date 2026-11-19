# Iteracja 7: treści i wydruki

**Status:** plan (18 listopada 2026); decyzje autora przyjęte 18 listopada 2026 ([odpowiedzi](#odpowiedzi-autora-18-listopada-2026)); makiety gotowe 18 listopada 2026; ADR 0062–0069 przyjęte 18 listopada 2026, ADR 0070 (hero 760 px) 18 listopada 2026; zrealizowana 19 listopada 2026 (bez zielonego CI); aplikacja natywna (pobranie i udostępnienie PDF, pamięć treści) niesprawdzona do czasu development build

## Cel
Operator zmienia w panelu wszystko, co klient czyta i ogląda poza etykietami interfejsu, a operator i klient dostają dokumenty z szablonów zmienianych bez programisty. Konkretnie:
- **Treści** ([ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md)): bloki treści w sekcjach strony i aplikacji, FAQ, aktualności z planowaną publikacją, biblioteka mediów (render hulajnogi, ilustracje, zdjęcia modeli) i dane firmy (kontakt pomocy, dane sprzedawcy). Dokumenty prawne z wersjami działają od iteracji 2 i zostają.
- **Strona promocyjna** w `apps/web` renderowana z treści z bazy według makiety `14-strona`, ze stronami dokumentów, aktualnościami i stroną kodu QR `/h/{numer}` ([ADR 0041](../adr/0041-kod-qr-hulajnogi.md)).
- **Wydruki** ([ADR 0030](../adr/0030-wydruki-z-szablonow-docx.md)): szablony DOCX z wersjami, walidacją znaczników i aktywacją; wydruk DOCX i PDF z karty przejazdu, zadania serwisowego, hulajnogi i paragonu; paragon PDF w aplikacji ([ADR 0052](../adr/0052-paragony.md), D7 iteracji 5).
- **Silnik dokumentów:** Gotenberg w `infra/`, port `DocumentRenderer`, zadanie pg-boss ([ADR 0029](../adr/0029-raporty-pdf-xlsx.md)). Iteracja 8 użyje go do raportów.

Granice z sąsiednimi iteracjami:
- **Iteracja 6 (zrobiona):** szablony powiadomień push i SMS z wersjami ([ADR 0058](../adr/0058-powiadomienia-push-z-szablonow.md)) są częścią modułu treści i nie zmieniają się; wzór wersji i podglądu bierzemy z nich.
- **Iteracja 8:** raporty (HTML → PDF przez Chromium w Gotenbergu, ExcelJS), historia uruchomień `report_runs`, eksport list do XLSX, wykresy na pulpicie, pozostałe tabele z macierzy (`consents`, `sessions`, `otp_codes` itd.).
- **Poza projektem:** wielojęzyczność treści, podpis elektroniczny, e-mail z dokumentem, zewnętrzny CMS.

Wymagania uczelni:
- **17:** treści merytoryczne i grafiki strony i aplikacji z bazy, edytowane w panelu; w `messages/pl.json` i `apps/mobile/src/i18n/pl.json` zostają tylko etykiety (pytanie 5 do prowadzącego).
- **19:** parametryzowane wydruki z szablonów DOCX; użytkownik pobiera szablon, zmienia go w Wordzie i wgrywa nową wersję; wynik DOCX i PDF.
- **12:** w panelu `content_blocks`, `faq_items`, `news`, `media_assets`, `document_templates`, `document_template_versions`, `generated_documents` i nowa tabela danych firmy według [macierzy operacji](../model-danych/README.md#operacje-w-panelu-dla-każdej-tabeli).
- **13:** proces publikacji treści (szkic → publikacja → archiwum, aktualność zaplanowana) i proces zmiany szablonu (wgranie → walidacja → podgląd → aktywacja → wydruk).
- **14:** ekrany Treści (bloki, FAQ, aktualności, media, dane firmy) i Wydruki w panelu; strona promocyjna, strony dokumentów i aktualności; pomoc z FAQ i paragon PDF w aplikacji.
- **8:** nowe tabele, widoki danych do wydruków, procedura aktywacji wersji szablonu.
- **3c:** reguły publikacji, sekcji treści, walidacji Markdown i mediów, katalog rodzajów dokumentów i pól, walidacja szablonu w `packages/core`.

## Stan wyjściowy
- **Baza (migracje 0002 i 0004):**
  - `content_pages` i `content_page_versions` (Markdown, `DRAFT|PUBLISHED|ARCHIVED`, jedna obowiązująca wersja, `change_summary` z 0004), zgody wskazują wersję (`consents.page_version_id`);
  - `content_blocks` (klucz, klient `WEB|MOBILE|ADMIN`, tytuł, `body_md`, grafika, przycisk, kolejność, status), `faq_items` (kategoria jako tekst, kolejność, status), `news` (slug, lead, `body_md`, grafika, `publish_from`, `publish_to`), `media_assets` (klucz, plik, tekst alternatywny, podpis);
  - `document_templates` (rodzaj, nazwa, domyślny, aktywny), `document_template_versions` (plik, `fields text[]`, jedna aktywna wersja), `generated_documents` (rodzaj, `entity_ref` jako tekst bez klucza obcego, wersja szablonu `NOT NULL`, pliki DOCX i PDF, operator albo klient, `job_status`);
  - typ `document_type`: `RENTAL_CONFIRMATION`, `SERVICE_PROTOCOL`, `SCOOTER_CARD`, `INCIDENT_REPORT`, `WALLET_ADJUSTMENT`, `RECEIPT`; cele plików `MEDIA`, `DOCUMENT_TEMPLATE`, `GENERATED_DOCUMENT` (od 0002, nieużywane);
  - widoki `v_current_documents`, `v_published_news`; licznik `content_revision_seq` z wyzwalaczem na tabelach treści i `fn_content_revision()`; `scooter_models.photo_media_id`;
  - uprawnienia `content.read|write` (Dyspozytor ma `content.read`, zapis tylko Administrator), `templates.read|write`, `documents.generate` (Dyspozytor i Serwisant mają `templates.read` i `documents.generate`);
  - tabele bloków, FAQ, aktualności, mediów i szablonów są puste (seed ich nie wypełnia).
- **API:**
  - dokumenty prawne: `admin/legal-documents` (wersja robocza, publikacja) i `GET /legal/{slug}`; brak punktów bloków, FAQ, aktualności i mediów;
  - `ETag` jest tylko w `GET /zones`; zdarzenia `content.updated` nie ma w kontrakcie Socket.IO (1.4.0);
  - pliki ([ADR 0057](../adr/0057-pliki-zdjecia.md)): `POST /files` przyjmuje tylko `PARKING_PHOTO` i `TICKET_PHOTO`, typy JPEG, PNG, WebP po sygnaturze, odczyt przez adres z podpisem HMAC ważnym 10 min;
  - dane sprzedawcy na paragonie z konfiguracji (`SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_TAX_ID`, domyślnie „[dane sprzedawcy]”); ADR 0052 przewiduje przejęcie ich przez moduł treści.
- **Infrastruktura:** brak Gotenberga w `infra/docker-compose.yml`; brak docxtemplater, ExcelJS i biblioteki Markdown w zależnościach.
- **Panel:** Treści mają tylko zakładkę „Dokumenty prawne” z edytorem Markdown i podglądem (`components/admin/access/documents.tsx`, własny parser podglądu); w nawigacji nie ma Raportów ani Wydruków.
- **Strona promocyjna:** szkielet `app/(marketing)/page.tsx` z nagłówkiem i leadem z `messages/pl.json` (`marketing.*`, `meta.*`); brak stron dokumentów, aktualności i `/h/{numer}`.
- **Aplikacja:**
  - ekran startowy bez renderu (tekst z `pl.json`: `start.headline`, `start.lead`), zasady przed jazdą z dokumentu `zasady-jazdy` z numerami zamiast ikon;
  - dane kontaktowe pomocy jako `[e-mail pomocy]` i `[telefon pomocy]` w `pl.json`; marka `[nazwa]` w `pl.json`;
  - rendery hulajnogi wkompilowane (`assets/images/rendery`, `components/scooter.tsx`);
  - własny parser Markdown (`components/markdown.tsx`, tylko sekcje i pogrubienie), inny niż w panelu;
  - „Pomoc i zgłoszenia” w profilu otwiera od razu „Moje zgłoszenia”; paragon tylko jako ekran; „Pobierz moje dane” ukryte (D8 iteracji 3);
  - brak pamięci treści bez sieci (ADR 0027 ją zakłada) i brak modułów do zapisu i udostępnienia pliku (`expo-file-system`, `expo-sharing`).
- **CI:** `pnpm build` buduje panel bez działającego API i bez Gotenberga; testy API mają `FILE_STORAGE=memory`.
- **Długi z poprzednich iteracji, które dotyczą tej:**
  - iteracja 2: render na ekranie startowym, dane kontaktowe pomocy, ikony zasad, wersja robocza dokumentu bez blokady optymistycznej;
  - iteracja 3 (D8) i 5: „Pobierz moje dane” i paragon PDF;
  - [ADR 0041](../adr/0041-kod-qr-hulajnogi.md): naklejka z kodem QR na karcie hulajnogi i strona `/h/{numer}`;
  - iteracja 6 („Potrzebne zmiany odłożone”): porównanie wersji szablonów powiadomień, punkt odczytu powiadomienia i pozostałe pozycje; poza zakresem tej iteracji (D7).

## Warunek wstępny: decyzje i makiety
Zanim zacznie się implementacja:
- autor odpowiada na pytania i decyzje poniżej;
- brakujące stany dostają makiety w `docs/projekt/ekrany/` według [design systemu](../projekt/design-system.md). Proponowane katalogi:
  - `28-panel-tresci` i `29-panel-wydruki`: dwa obszary nawigacji panelu (Konfiguracja → Treści, Analiza → Wydruki), jak para `25-panel-platnosci` i `27-panel-serwis`;
  - `30-strona-tresci`: nowe podstrony strony promocyjnej; `14-strona` zostaje wzorem strony głównej (strona ma inny układ niż panel i aplikacja, więc osobny katalog);
  - `31-mobile-tresci`: ekrany aplikacji (pomoc z FAQ, paragon PDF, eksport danych).

Istniejące makiety, z których korzysta iteracja:

| Obszar | Makiety |
|---|---|
| Panel | `18-panel-dostep/dostep-dokumenty` (zakładki Treści: Dokumenty prawne, Bloki treści, FAQ, Aktualności, Media), `dostep-dokument-wersja` (edytor Markdown z podglądem, wzór dla bloków i aktualności), `27-panel-serwis/szablony-powiadomien` (wersje, historia, przywrócenie), `zadanie-zakoncz` („protokół zadania (iteracja 7)”), `17-panel-wzorce` (lista, filtry, formularz, stany); pozycja „Wydruki” w nawigacji na planszach od iteracji 2 |
| Strona | `14-strona/strona-desktop`, `strona-mobile`: nawigacja, hero z renderem, trzy kroki, „Zaprojektowana do miasta” z parametrami modelu, cennik, strefy z legendą, aplikacja, FAQ, stopka z linkami Regulamin, Polityka prywatności, Cookies |
| Aplikacja | `02-mobile-przeplyw/flow-start` (render z mediów), `03-mobile-konto/konto-zasady` (zasady z ikonami), `06-mobile-profil/profil` („Pomoc i zgłoszenia”, „Regulamin i prywatność”), `24-mobile-platnosci/paragon` (bez „Pobierz PDF”, odłożone do iteracji 7), `26-mobile-operacje/moje-zgloszenia` |

Brakujące makiety (propozycja):
- [x] **Panel: bloki treści** pogrupowane według klienta i sekcji (strona, aplikacja), edytor bloku (tytuł, Markdown z podglądem, grafika z biblioteki, przycisk), sekcja-lista z dodawaniem i kolejnością (trzy kroki, zasady), status i historia z przywróceniem (pytanie 7, D1).
- [x] **Panel: FAQ** (lista z kategoriami i kolejnością, edycja, publikacja).
- [x] **Panel: aktualności** (lista ze stanami szkic, zaplanowana, opublikowana, wygasła; edytor z datami publikacji i grafiką).
- [x] **Panel: biblioteka mediów** (siatka z wyszukiwaniem, wysyłka z tekstem alternatywnym i błędem typu albo rozmiaru, szczegóły z miejscami użycia, usunięcie zablokowane przy użyciu, zastąpienie pliku, okno wyboru grafiki).
- [x] **Panel: dane firmy** (formularz: nazwa, adres, NIP, kontakt pomocy, godziny; pytanie 13).
- [x] **Panel: szablony wydruków** (lista według rodzaju z aktywną wersją i domyślnym szablonem; szczegóły szablonu z wersjami).
- [x] **Panel: wgranie wersji szablonu** (walidacja: lista nieznanych znaczników i błędów składni z miejscem w dokumencie; podgląd PDF na danych przykładowych; aktywacja i przywrócenie; pobranie listy pól).
- [x] **Panel: okno „Drukuj”** z karty obiektu (wybór szablonu, parametry, format, generowanie, gotowe, błąd) i **lista wygenerowanych dokumentów**.
- [x] **Panel: naklejka z kodem QR** na karcie hulajnogi (D5).
- [x] **Strona: dokument** (regulamin) na komputerze i telefonie, **aktualności** (lista i artykuł), **`/h/{numer}`**, strona 404.
- [x] **Aplikacja: Pomoc** (FAQ rozwijane, kontakt z danych firmy, wejście do „Moje zgłoszenia”) i stan bez sieci z treścią z pamięci.
- [x] **Aplikacja: paragon z „Pobierz PDF”** (generowanie, gotowe, błąd; wersja web otwiera plik) i **„Pobierz moje dane”** w ustawieniach (pytanie 14).

## Zakres
- [x] **Migracja 0011** (`0011_content_documents.sql`, testy w `packages/db/src/db.test.ts`):
  - treści:
    - bloki: sekcja i pozycja w sekcji według rejestru (D1), zmiana unikalności klucza, dozwolone schematy adresu przycisku (`https:`, `mailto:`, `tel:`, ścieżka względna) w ograniczeniu;
    - FAQ: widoczność na stronie i w aplikacji (pytanie 12);
    - aktualności: stan liczony w widoku (szkic, zaplanowana, opublikowana, wygasła);
    - dane firmy: nowa tabela z jednym wierszem (pytanie 13);
  - media: szerokość, wysokość, typ i rozmiar z pliku, licznik użyć w widoku; usunięcie tylko nieużytego (klucze obce z bloków, aktualności i modeli już są);
  - szablony: autor i czas aktywacji, procedura aktywacji wersji z blokadą (jedna aktywna, indeks z 0002), ustawienie domyślnego szablonu rodzaju;
  - wygenerowane dokumenty: format żądany, czas startu, przyczyna błędu, czas usunięcia plików (pytanie 3), indeks dokumentów klienta; typ `document_type` według pytania 1 i D5 (nowe wartości `ADD VALUE` są nieużywalne w tej samej transakcji migracji, jak w 0002);
  - eksport danych klienta według pytania 14 (cel pliku albo osobna tabela, bo `generated_documents.template_version_id` jest `NOT NULL`);
  - widoki list panelu: bloki, FAQ, aktualności, media z użyciami, szablony z aktywną wersją, wersje, wygenerowane dokumenty; widoki publiczne treści dla strony i aplikacji;
  - widoki danych do wydruków (jeden na rodzaj dokumentu: przejazd z osią czasu i kwotami, zadanie z częściami, hulajnoga z historią serwisu, paragon z pozycjami i grupami VAT, zgłoszenie z przebiegiem);
  - uprawnienia i rola według pytania 6;
  - dane startowe: bloki strony i aplikacji z tekstów makiet i obecnych `pl.json`, FAQ z makiety, dwie aktualności, media z `docs/projekt/rendery`, dane firmy z wartościami w nawiasach, szablony startowe DOCX (D4). Seed media i szablonów zapisuje pliki w SeaweedFS, więc wymaga `pnpm infra:up`;
  - po migracji `pnpm db:pull` i aktualizacja liczb w teście bazy oraz w [modelu danych](../model-danych/README.md) (dziś 54 tabele, 42 widoki, 21 funkcji, 18 procedur).

  Zrobione: 57 tabel, 64 widoki, 24 funkcje, 22 procedury; poprawki po przeglądzie w migracji `0012_iteration7_fixes.sql` (`customer_data_visible`, `CHECK` adresu przycisku, indeksy zadań porządkowych), liczby bez zmian.
- [x] **`packages/core`:**
  - treści: rejestr sekcji i walidacja bloku (wymagane pola, limity, liczba elementów sekcji-listy), przejścia statusu, stan aktualności z dat, odnośniki tylko z dozwolonych schematów;
  - Markdown: walidacja podzbioru (pytanie 9) przy zapisie;
  - media: typ po sygnaturze i wymiary z nagłówka JPEG, PNG i WebP, limit rozmiaru, reguła usunięcia;
  - dokumenty: katalog rodzajów z opisem pól i funkcją budującą dane (ADR 0030), walidacja znaczników z inspekcji szablonu względem katalogu, wybór szablonu (domyślny albo wskazany), nazwa pliku wyniku, port `DocumentRenderer` (`fillDocx`, `toPdf`);
  - rozpoznanie DOCX po zawartości (ZIP z `word/document.xml`, odrzucenie `.docm`, limit rozmiaru po rozpakowaniu).
- [x] **`packages/shared`:** rejestr sekcji treści (klucz, klient, pola, limity), wspólny parser Markdown do drzewa elementów dla panelu, strony i aplikacji (zastępuje dwa obecne parsery), zasoby panelu (`content-blocks`, `faq`, `news`, `media`, `document-templates`, `generated-documents`), schematy żądań, widoki publicznych treści, katalog pól wydruków dla panelu. Katalog pól panel czyta z API (`GET /admin/document-types/{type}/fields`), bez kopii w `packages/shared` ([ADR 0067](../adr/0067-szablony-wydrukow-docx.md)).
- [x] **Kontrakty:** OpenAPI (`pnpm api:openapi`); Socket.IO 1.5.0 (`content.updated` z rewizją, `document.ready` dla panelu i klienta). Zrobione: [OpenAPI](../kontrakty/openapi.json), [Socket.IO 1.6.1](../kontrakty/asyncapi-realtime.yaml) (1.5.0 `content.updated`, 1.6.0 pokój `staff:{id}`, `document.ready`, `data-export.ready`, 1.6.1 opis po poprawkach).
- [x] **Infrastruktura:** Gotenberg w `infra/docker-compose.yml` (obraz przypięty, sieć wewnętrzna, czcionka Inter, limity czasu; D2 w ADR 0066), `GOTENBERG_URL` w `.env.example`. Zrobione: obraz 9.5.1 z Inter 4.1 (`infra/gotenberg/`), port `127.0.0.1:3010`.
- [x] **API:**
  - **Treści:** CRUD bloków, FAQ, aktualności i danych firmy z blokadą optymistyczną i dziennikiem audytu; publiczne `GET /content/{client}` (wszystkie opublikowane treści klienta jedną odpowiedzią) z `ETag` z `fn_content_revision()`; `GET /faq`, `GET /news`, `GET /news/{slug}`; zdarzenie `content.updated`; zadanie przy `publish_from` i `publish_to` aktualności (odświeżenie strony o czasie);
  - **Media:** wysyłka (`POST /files` z celem `MEDIA` i `content.write`), opis, zastąpienie pliku, usunięcie nieużytej, publiczny odczyt (D3);
  - **Wydruki:** szablony (lista, wgranie wersji z walidacją, podgląd PDF, aktywacja, domyślny, pobranie DOCX, lista pól), `POST /admin/documents` (rodzaj, obiekt, szablon, parametry, format) z zadaniem `documents.generate`, lista wygenerowanych, pobranie; dla klienta `POST /me/receipts/{id}/pdf` z ponownym użyciem gotowego pliku (pytanie 2);
  - adapter `GotenbergRenderer` i atrapa do testów (DOCX naprawdę z docxtemplater, PDF z atrapy); jeden test integracyjny przy dostępnym `GOTENBERG_URL`;
  - paragon bierze dane sprzedawcy z danych firmy zamiast z `SELLER_*` (pytanie 13);
  - eksport danych klienta według pytania 14.

  Bez osobnego `GET /faq` (FAQ jest w `GET /content/{client}`, ADR 0062); `ETag` ze skrótu treści zamiast z `fn_content_revision()` (poprawka po przeglądzie).
- [x] **Strona promocyjna (`apps/web`):** strona główna według `14-strona` z bloków, mediów, FAQ, cennika (`GET /tariff`) i parametrów modelu (D2), strony dokumentów z `content_pages`, aktualności, `/h/{numer}`, metadane z treści, odświeżanie po `content.updated`, build w CI bez API.
- [x] **Panel:** zakładki Treści (bloki, FAQ, aktualności, media, dane firmy), okno wyboru grafiki, Wydruki (szablony z wersjami, wygenerowane dokumenty), „Drukuj” na kartach przejazdu, zadania, hulajnogi, zgłoszenia i paragonu, zdjęcie modelu z biblioteki w formularzu modelu; „Wydruki” w nawigacji; blokada optymistyczna wersji roboczej dokumentu (dług z iteracji 2). „Drukuj” na zgłoszeniu i wpisie portfela pojawi się po wgraniu szablonu (rodzaje bez szablonu startowego); odstępstwa od makiet w [dzienniku](../dziennik.md#iteracja-7-implementacja-19-listopada-2026).
- [x] **Aplikacja:** treści z `GET /content/mobile` z pamięcią na urządzeniu i odświeżaniem po `ETag` i `content.updated`; ekran startowy z renderem z mediów, zasady z ikonami (pytanie 12), kontakt pomocy z danych firmy, ekran Pomoc z FAQ, paragon „Pobierz PDF”, „Pobierz moje dane” (pytanie 14); teksty merytoryczne usunięte z `pl.json`. Sprawdzone w wersji web, bez development build.
- [x] **Dokumentacja:** arc42 §5 (moduły Treści i Dokumenty), §6 (generowanie wydruku, publikacja treści), §7 (Gotenberg), §8 (treści, Markdown, media, dokumenty), §11 (ryzyka: LibreOffice a układ, szablon zepsuty w Wordzie); model danych; wymagania uczelni (17, 19); spis makiet; instrukcja dla autora szablonu (lista pól generowana z katalogu). Zrobione: arc42 §5, §6.11–6.13, §7, §8.14–8.17, §11; instrukcja i lista pól (DOCX) w panelu (Wydruki → „Instrukcja i lista pól”).

## ADR-y do napisania

| Nr | Temat | Co rozstrzyga |
|---|---|---|
| 0062 | Moduł treści: sekcje, publikacja i dane firmy | Rejestr sekcji w kodzie a bloki w bazie (D1), statusy i edycja opublikowanych treści, historia z dziennika audytu z przywróceniem (pytanie 7), planowanie aktualności z zadaniem, FAQ na stronie i w aplikacji, tabela danych firmy zamiast `SELLER_*` (pytanie 13), `GET /content/{client}` z `ETag`, `content.updated`, pamięć treści w aplikacji, rola Redaktor (pytanie 6), tylko język polski (pytanie 8). Rozwija [ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md). |
| 0063 | Markdown w treściach | Podzbiór składni, jeden parser w `packages/shared` do drzewa elementów, render bez HTML w panelu, na stronie i w aplikacji, odnośniki z białą listą schematów, walidacja przy zapisie (pytanie 9). Zastępuje dwa parsery z iteracji 2. |
| 0064 | Biblioteka mediów | Typy i limity (pytanie 10), wymiary, publiczny adres z długim cache zamiast podpisu na 10 min (D3), zastąpienie pliku pod tym samym kluczem, usunięcie tylko nieużytej grafiki, rendery hulajnogi w aplikacji (wyjątek z kopią w paczce przy pierwszym uruchomieniu bez sieci). Zmienia [ADR 0057](../adr/0057-pliki-zdjecia.md) w części o odczycie dla celu `MEDIA`. |
| 0065 | Strona promocyjna z treści z bazy | Renderowanie w Next.js 16 (cache z tagiem i odświeżanie na żądanie po `content.updated`, czas zapasowy), build w CI bez API, grafiki (`next/image` albo `<img>`), metadane i mapa strony, strony dokumentów, aktualności, `/h/{numer}`, brak ciasteczek i banera (pytanie 11). |
| 0066 | Silnik dokumentów: Gotenberg i zadania | Obraz i wersja (ADR 0029 zakłada 9.x, do sprawdzenia), czcionka Inter, sieć wewnętrzna i blokada zasobów zewnętrznych, limity czasu i pamięci, port `DocumentRenderer` z atrapą, zadanie `documents.generate`, `document.ready`, przechowywanie i retencja plików (pytanie 3), ponowne użycie gotowego dokumentu. Realizuje część infrastrukturalną [ADR 0029](../adr/0029-raporty-pdf-xlsx.md) i [ADR 0030](../adr/0030-wydruki-z-szablonow-docx.md). |
| 0067 | Szablony wydruków DOCX: wersje i walidacja | Wersja docxtemplater i moduł inspekcji, składnia znaczników (pola, pętle, warunki, formatowanie kwot i dat przed wstawieniem), katalog pól w core, rozpoznanie i limity DOCX, wgranie → walidacja → podgląd → aktywacja, przywrócenie wersji, szablony startowe w repozytorium (D4), kod QR (D5). Rozwija [ADR 0030](../adr/0030-wydruki-z-szablonow-docx.md). |
| 0068 | Wydruki w procesach | Które dokumenty i skąd (pytanie 1), dostęp klienta do paragonu PDF, stopka z identyfikatorem i wersją szablonu zamiast własnej numeracji (pytanie 4), podpis i pieczęć (pytanie 5), uprawnienia (`documents.generate` a dane klienta przy braku `users.read`). Uzupełnia [ADR 0052](../adr/0052-paragony.md) i [ADR 0041](../adr/0041-kod-qr-hulajnogi.md). |
| 0069 | Eksport danych klienta | Według pytania 14: format (JSON), zakres danych, zadanie, ważność adresu, limit zleceń, dziennik audytu. Tylko jeśli autor zostawi eksport w tej iteracji. |

## Pytania do autora
Seed ma wartości deweloperskie, a makiety pokazują nawiasy.

1. **Które wydruki w tej iteracji** (typ `document_type` ma sześć rodzajów). Rekomendacja: cztery rodzaje z szablonem startowym:
   - paragon (potwierdzenie sprzedaży z korektą jako wariant warunkowy w tym samym szablonie) dla panelu i klienta;
   - potwierdzenie przejazdu (oś czasu, trasa jako adres, kwoty);
   - protokół zadania serwisowego (części, notatka, skutek dla hulajnogi; makieta `zadanie-zakoncz` go zapowiada);
   - karta hulajnogi (dane, model, historia serwisu z parametrem zakresu).

   Raport zdarzenia (zgłoszenie) i potwierdzenie korekty salda zostają w katalogu bez szablonu startowego, do dodania, jeśli zostanie czas. Umowa i regulamin nie są wydrukami: to dokumenty prawne z wersjami na stronie.
2. **Generowanie.** Rekomendacja: zadanie pg-boss (ADR 0030), panel czeka na `document.ready` (z odpytywaniem jako zapasem); paragon PDF dla klienta z tą samą wersją szablonu nie generuje się drugi raz, tylko zwraca gotowy plik.
3. **Przechowywanie wygenerowanych dokumentów.** Rekomendacja: wiersz `generated_documents` zostaje na zawsze (kto, kiedy, z której wersji szablonu), pliki DOCX i PDF usuwa po 30 dniach zadanie jak zdjęcia parkowania (stan `DELETED`); dokument da się wygenerować ponownie, ale z bieżących danych i aktywnej wersji.
4. **Numeracja dokumentów.** Rekomendacja: bez osobnej numeracji wydruków; dokument nosi numer obiektu (`PAR/2026/…`, `Z-…`, numer zadania, `#0007`), a stopka podaje identyfikator wydruku, szablon z wersją, datę i operatora.
5. **Podpis i pieczęć.** Rekomendacja: logo i pieczęć jako stałe grafiki w pliku szablonu (ADR 0030), pole „Podpis” jako linia z imieniem i nazwiskiem operatora; bez podpisu elektronicznego.
6. **Kto edytuje treści.** Dziś zapis treści ma tylko Administrator. Rekomendacja: nowa rola „Redaktor” w migracji (`content.read`, `content.write`, `templates.read`, `dashboard.read`); `templates.write` zostaje przy Administratorze; Dyspozytor i Serwisant drukują (`documents.generate`, już mają).
7. **Publikacja i historia treści.** Rekomendacja:
   - bloki, FAQ i aktualności mają status szkic, opublikowany, archiwum; zmiana opublikowanego wpisu działa od zapisu, a panel pokazuje podgląd przed zapisem;
   - bez tabel wersji: historia z dziennika audytu (pełna treść przed i po) z „Przywróć”;
   - aktualności z planowaniem od–do (kolumny już są);
   - dokumenty prawne bez zmian (wersje i ponowna akceptacja).
8. **Wielojęzyczność.** Rekomendacja: tylko polski; bez kolumny języka; ADR opisuje, jak ją dodać (klucz bloku plus język).
9. **Edytor.** Rekomendacja: Markdown z podglądem jak w dokumentach prawnych (makieta `dostep-dokument-wersja`), podzbiór: nagłówki, akapity, listy, pogrubienie, kursywa, odnośniki; bez HTML i bez WYSIWYG. Uzasadnienie: jeden format w bazie, render bez `dangerouslySetInnerHTML`, więc bez sanityzacji HTML.
10. **Media: typy i limity.** Rekomendacja: JPEG, PNG, WebP (bez SVG ze względu na skrypty, bez GIF), do 5 MB, wymagany tekst alternatywny, wymiary zapisane przy wysyłce, bez skalowania na serwerze (operator wgrywa przygotowany plik; panel ostrzega powyżej 2560 px).
11. **Strona promocyjna: zakres.** Rekomendacja:
    - z bloków i mediów: hero, trzy kroki, „Zaprojektowana do miasta”, strefy (legenda), aplikacja, przyciski sklepów, stopka;
    - z danych: cennik z bieżącej wersji (`GET /tariff`), parametry z aktywnego modelu (`range_km`, `max_speed_kmh`), FAQ, dane firmy;
    - podstrony: dokumenty z `content_pages` (`/regulamin`, `/polityka-prywatnosci`, `/zasady-jazdy`), `/aktualnosci` z artykułami, `/h/{numer}`;
    - nawigacja i etykiety w `messages/pl.json`;
    - strona bez ciasteczek i analityki, więc bez banera; link „Cookies” prowadzi do dokumentu „Polityka cookies” jako trzeciej strony w `content_pages` bez zgody.
12. **Aplikacja: które treści z bazy.** Rekomendacja:
    - ekran startowy (blok z renderem), kontakt pomocy, ekran Pomoc z FAQ i wejściem do „Moje zgłoszenia”;
    - zasady przed jazdą jako sekcja-lista bloków z ikoną z zamkniętej listy (makieta `konto-zasady`); dokument `zasady-jazdy` zostaje pełną treścią na stronie;
    - rendery wariantów hulajnogi z mediów, z kopią w paczce tylko na pierwsze uruchomienie bez sieci (wyjątek w ADR 0064, jak ikona i ekran startowy w ADR 0027);
    - aktualności tylko na stronie, nie w aplikacji.
13. **Dane firmy.** Rekomendacja: jedna tabela (nazwa, adres, NIP, e-mail i telefon pomocy, godziny pomocy) edytowana w panelu; zastępuje `SELLER_*` w paragonie (paragon nadal kopiuje dane w chwili wystawienia), zasila stopkę strony, Pomoc w aplikacji i wydruki. Marka `[nazwa]` zostaje etykietą do decyzji o nazwie.
14. **„Pobierz moje dane”** (D8 iteracji 3, obiecane też w iteracji 5). Rekomendacja: w tej iteracji, jako plik JSON (prawo do przenoszenia danych) generowany zadaniem, dostępny przez 7 dni z ustawień aplikacji, jedno zlecenie na dobę; bez szablonu DOCX. Alternatywa: iteracja 9.

## Decyzje do potwierdzenia
- **D1. Rejestr sekcji treści.** Rekomendacja: lista sekcji (klucz, klient, pola, pojedynczy blok albo lista z limitem elementów) w `packages/shared`, jak rejestr szablonów powiadomień; panel edytuje treść i elementy sekcji-list (dodaj, usuń, kolejność), ale nie tworzy sekcji, bo kod renderuje konkretne miejsca. Alternatywa: dowolne klucze w panelu (kod szuka klucza, którego może nie być).
- **D2. Odświeżanie strony.** Rekomendacja: strona czyta treści z API po stronie serwera z cache z tagiem; API po zmianie treści woła punkt odświeżenia strony (sekret w `.env`), czas zapasowy 5 min; przy braku API w buildzie (CI) strona renderuje się przy pierwszym żądaniu zamiast przerywać build. Szczegóły po sprawdzeniu dokumentacji Next.js 16.4.6.
- **D3. Adresy mediów.** Rekomendacja: grafiki z biblioteki są publiczne (`GET /media/{id}/{sha256}.{ext}`, `Cache-Control: public, immutable`), bo podpis ważny 10 min (ADR 0057) psuje cache strony i pamięć aplikacji; zdjęcia klientów i wydruki zostają przy podpisie.
- **D4. Szablony startowe.** Rekomendacja: pliki `.docx` w repozytorium (`packages/db/seed/templates/`), przygotowane w edytorze tekstu i sprawdzane testem walidacji z katalogiem pól; seed wgrywa je jako wersję 1 i ustawia domyślne; testy API czytają je do pamięci.
- **D5. Kod QR na naklejce.** Moduł obrazów docxtemplater jest płatny (ADR 0030 wyklucza obrazy zmienne). Rekomendacja: naklejka jako PDF z HTML przez Chromium w Gotenbergu z kodem z biblioteki `qrcode` (jest już w panelu), poza szablonami DOCX; karta hulajnogi DOCX podaje adres `/h/{numer}` tekstem. Alternatywa do sprawdzenia przy ADR 0067: darmowy moduł obrazów (licencja, utrzymanie).
- **D6. Miejsce w panelu.** Rekomendacja: Treści (Konfiguracja) z zakładkami Dokumenty prawne, Bloki treści, FAQ, Aktualności, Media, Dane firmy; Wydruki (Analiza) z zakładkami Szablony i Wygenerowane; „Drukuj” w nagłówku kart przejazdu, zadania, hulajnogi, zgłoszenia i paragonu. Szablony powiadomień zostają pod Powiadomieniami.
- **D7. Długi w tej iteracji.** Rekomendacja: w zakresie render na ekranie startowym, dane kontaktowe pomocy, ikony zasad, wspólny parser Markdown, blokada optymistyczna wersji roboczej dokumentu, paragon PDF, „Pobierz moje dane” (pytanie 14), naklejka QR i `/h/{numer}`. Poza zakresem: odłożone zmiany z iteracji 6 (porównanie wersji szablonów, odczyt powiadomień i pozostałe) i `v_low_stock_parts` (iteracja 8).
- **D8. Granica z iteracją 8.** Rekomendacja: iteracja 7 wprowadza kontener, port `DocumentRenderer` (DOCX → PDF i HTML → PDF dla naklejki) i zadanie; raporty, ExcelJS, `report_definitions` w panelu i eksport list w iteracji 8 korzystają z tego samego portu.

## Do rozstrzygnięcia w ADR 0062–0069 (z makiet, 18 listopada 2026)
Luki i propozycje z projektowania plansz; autor zatwierdza je razem z ADR-ami.
- **Schemat (migracja 0011):** ikona elementu sekcji-listy w `content_blocks` (zamknięta lista); kolejność kategorii FAQ (tabela kategorii albo kolejność z `sort_order`); klucze mediów: rejestr kluczy systemowych w kodzie, a klucz grafiki z nazwy pliku; `generated_documents` dla naklejki QR i eksportu danych (`template_version_id` dziś `NOT NULL`, rodzaj dokumentu bez szablonu); stan wersji szablonu „archiwalna” z czasu i autora aktywacji; `news.lead` wymagany.
- **Dokumenty prawne na stronie:** publiczna lista wersji i odczyt wersji archiwalnej (dziś tylko bieżąca); osobna data wejścia w życie do zapowiedzi zmian — w zakresie czy nie.
- **`/h/{numer}`:** publiczny, okrojony odczyt hulajnogi po numerze (dziś `GET /scooters/by-number` wymaga logowania) albo tylko kontrola formatu i render domyślny; cel odnośnika „Mam aplikację” (ADR 0041 odrzucił własny schemat adresu).
- **Uprawnienia:** Redaktor z `content.write` edytuje też szablony powiadomień (w tym `login_code`) i dane firmy (NIP) — rozdzielić uprawnienia czy zostawić; pozycja „Wydruki” i zakładka Wygenerowane według `templates.read` i `documents.generate`; pulpit Redaktora bez grup „Wymaga uwagi”.
- **Dane firmy:** KRS i REGON na paragonie i w stopce; kontakt pomocy przy pierwszym uruchomieniu aplikacji bez sieci (kopia w paczce albo ekran bez sieci).
- **Eksport danych:** nowy kod powiadomienia (`data_export_ready`), zdarzenie Socket.IO, czy plik obejmuje zdjęcia.
- **Szablony DOCX:** miejsce błędu bez numeru strony (DOCX nie ma podziału na strony przed renderowaniem).

## Odpowiedzi autora (18 listopada 2026)
Autor przyjął wszystkie rekomendacje: pytania 1–14 i decyzje D1–D8 bez zmian.

| Pytanie | Odpowiedź |
|---|---|
| 1. Wydruki | Cztery z szablonem startowym: paragon z korektą, potwierdzenie przejazdu, protokół zadania serwisowego, karta hulajnogi. Raport zdarzenia i potwierdzenie korekty salda w katalogu bez szablonu startowego. |
| 2. Generowanie | Zadanie pg-boss ze zdarzeniem `document.ready` (odpytywanie jako zapas); paragon PDF klienta z tą samą wersją szablonu nie generuje się drugi raz. |
| 3. Przechowywanie | Wiersz `generated_documents` na zawsze; pliki DOCX i PDF usuwane po 30 dniach (`DELETED`); ponowne wygenerowanie z bieżących danych i aktywnej wersji. |
| 4. Numeracja | Bez własnej numeracji wydruków; numer obiektu, a w stopce identyfikator wydruku, szablon z wersją, data i operator. |
| 5. Podpis i pieczęć | Logo i pieczęć jako stałe grafiki w szablonie; linia „Podpis” z imieniem i nazwiskiem operatora; bez podpisu elektronicznego. |
| 6. Edycja treści | Nowa rola „Redaktor” (`content.read`, `content.write`, `templates.read`, `dashboard.read`); `templates.write` tylko Administrator; drukują role z `documents.generate`. |
| 7. Publikacja i historia | Bloki, FAQ i aktualności: szkic, opublikowany, archiwum; historia z dziennika audytu z „Przywróć”; aktualności z planowaniem od–do; dokumenty prawne bez zmian. |
| 8. Języki | Tylko polski; ADR opisuje drogę do kolejnych języków. |
| 9. Edytor | Markdown z podglądem w ograniczonym zakresie, bez HTML i bez WYSIWYG. |
| 10. Media | JPEG, PNG, WebP do 5 MB, wymagany tekst alternatywny, wymiary przy wysyłce, bez skalowania na serwerze. |
| 11. Strona promocyjna | Sekcje z bloków i mediów, dane z cennika i modelu, FAQ, dane firmy; podstrony dokumentów, aktualności i `/h/{numer}`; bez ciasteczek i banera. |
| 12. Treści w aplikacji | Ekran startowy, kontakt pomocy, ekran Pomoc z FAQ, zasady jako sekcja-lista z ikonami, rendery wariantów z mediów (kopia w paczce na pierwsze uruchomienie); aktualności tylko na stronie. |
| 13. Dane firmy | Jedna tabela edytowana w panelu, zastępuje `SELLER_*`; paragon kopiuje dane w chwili wystawienia. |
| 14. „Pobierz moje dane” | W tej iteracji: JSON generowany zadaniem, dostępny 7 dni, jedno zlecenie na dobę; ADR 0069 powstaje. |

| Decyzja | Rozstrzygnięcie |
|---|---|
| D1 | Rejestr sekcji treści w `packages/shared`; panel edytuje treść i elementy sekcji-list, nie tworzy sekcji. |
| D2 | Strona czyta treści po stronie serwera z cache z tagiem, API odświeża ją na żądanie (sekret w `.env`), czas zapasowy 5 min; build bez API nie przerywa się. |
| D3 | Publiczne adresy mediów z biblioteki z długim cache; zdjęcia klientów i wydruki zostają przy podpisie (ADR 0057). |
| D4 | Szablony startowe `.docx` w repozytorium, walidowane testem, wgrywane przez seed jako wersja 1. |
| D5 | Naklejka QR jako PDF z HTML (Chromium w Gotenbergu, biblioteka `qrcode`); karta hulajnogi DOCX podaje adres `/h/{numer}` tekstem. |
| D6 | Treści (Konfiguracja) z zakładkami, Wydruki (Analiza) z zakładkami Szablony i Wygenerowane, „Drukuj” na kartach obiektów. |
| D7 | Długi w zakresie według planu; odłożone zmiany z iteracji 6 poza zakresem. |
| D8 | Iteracja 7 wprowadza Gotenberga, port `DocumentRenderer` i zadanie; raporty i eksport list w iteracji 8. |

## Do sprawdzenia przed ADR-ami
Wersje starsze niż 3 dni; nic nie instalujemy przed akceptacją ADR.
- **ADR 0066 (Gotenberg):**
  - aktualna linia i tag obrazu (ADR 0029 zakłada 9.x), obraz na arm64 (Mac autora) i amd64 (VPS);
  - trasy LibreOffice (DOCX → PDF) i Chromium (HTML → PDF), limity czasu, kontrola błędów, healthcheck;
  - instalacja czcionki Inter (własny `Dockerfile` na bazie obrazu albo zamontowany katalog), polskie znaki w PDF;
  - opcje blokujące pobieranie zasobów zewnętrznych przez LibreOffice i Chromium (szablon wgrany przez operatora nie może sięgać do sieci);
  - przy okazji: `eclipse-mosquitto:2` i `postgis/postgis:16-3.4` w `infra/` to tagi ruchome, choć `CLAUDE.md` mówi o przypiętych obrazach (do decyzji autora, poza zakresem).
- **ADR 0067 (docxtemplater):** wersja, licencja, `pizzip`, import w ESM pod NestJS 12, API modułu inspekcji (lista znaczników z pętlami), format błędów (wiele błędów z miejscem), łączenie znaczników rozbitych przez Worda, ochrona przed bombą ZIP; darmowe moduły obrazów (D5).
- **ADR 0063 (Markdown):** własny parser podzbioru w `packages/shared` albo biblioteka do drzewa (`mdast-util-from-markdown`/micromark, `marked` z lekserem); działanie w React Native; jeśli gdziekolwiek powstanie HTML, biblioteka sanityzacji (DOMPurify albo `sanitize-html`).
- **ADR 0065 (Next.js 16.4.6):** Cache Components (`use cache`, `cacheTag`, `revalidateTag`/`updateTag`) albo `revalidate` segmentu, zachowanie `next build` bez API, `next/image` z adresem API (`remotePatterns`, `sharp`) albo zwykłe `<img>`, `generateMetadata`, `sitemap`. Poprawki `use cache` z 16.4.5 są już w projekcie.
- **ADR 0062 i 0068 (aplikacja):** z `expo install` dla SDK 58: pamięć treści (`expo-sqlite/kv-store` albo `@react-native-async-storage/async-storage`), `expo-file-system` i `expo-sharing` do pobrania i udostępnienia PDF; zachowanie w wersji web.
- **ADR 0064 (media):** odczyt wymiarów z nagłówków JPEG, PNG i WebP bez biblioteki (albo `image-size`); nagłówki cache dla Fastify.

## Poza zakresem (świadomie)
- Raporty, ExcelJS, eksport list, wykresy na pulpicie: iteracja 8.
- Wielojęzyczność, WYSIWYG, HTML w treściach, wersje bloków w osobnych tabelach, podgląd szkicu na publicznej stronie.
- Obrazy zmienne w DOCX (zdjęcia zgłoszeń), podpis elektroniczny, e-mail z dokumentem, wydruk masowy.
- Odłożone zmiany z iteracji 6 (D7).

## Kolejność kroków
1. ~~Odpowiedzi autora na pytania 1–14 i decyzje D1–D8; aktualizacja tego planu.~~ Zrobione 18 listopada 2026.
2. ~~Makiety brakujących stanów w `28-panel-tresci`, `29-panel-wydruki`, `30-strona-tresci` i `31-mobile-tresci`, PNG obejrzane przed implementacją, wpis w [spisie makiet](../projekt/README.md).~~ Zrobione 18 listopada 2026: 30 plansz w `28-panel-tresci`, `29-panel-wydruki`, `30-strona-tresci`, `31-mobile-tresci`.
3. ~~Sprawdzenia z sekcji „Do sprawdzenia przed ADR-ami”~~ zrobione 18 listopada 2026 (wyniki z datami w ADR 0062–0069 i w [dzienniku](../dziennik.md)); ADR 0062–0069 przyjęte przez autora 18 listopada 2026.
4. ~~Gotenberg w `infra/` (obraz z Inter), sprawdzenie konwersji przykładowego DOCX i HTML.~~ Zrobione 19 listopada 2026: 9.5.1 z Inter 4.1, zmienne blokujące sprawdzone na żywo, test integracyjny.
5. ~~Migracja 0011, `pnpm db:pull`, testy bazy (aktywacja wersji, usunięcie używanej grafiki, stan aktualności, widoki wydruków); seed z mediami i szablonami.~~ Zrobione 19 listopada 2026: 57 tabel, 64 widoki, 24 funkcje, 22 procedury; poprawki w 0012.
6. ~~`packages/core` i `packages/shared`: sekcje, Markdown, media, katalog dokumentów, walidacja szablonów, z testami; szablony startowe przechodzą walidację.~~ Zrobione 19 listopada 2026.
7. ~~API: treści, media, dane firmy, `ETag` i `content.updated`; wydruki z zadaniem i atrapą renderera; paragon PDF klienta; eksport danych; testy API; `pnpm api:openapi`.~~ Zrobione 19 listopada 2026 (moduły Treści, Dokumenty i Eksport danych).
8. ~~Strona promocyjna, panel i aplikacja (równolegle, każdy w swoim katalogu); teksty merytoryczne usunięte z plików tłumaczeń.~~ Zrobione 19 listopada 2026; odstępstwa od makiet w [dzienniku](../dziennik.md#iteracja-7-implementacja-19-listopada-2026).
9. Domknięcie: arc42, model danych, wymagania uczelni (17 i 19), spis makiet, dziennik; scenariusz demo krok po kroku; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; zielone CI. Dokumentacja zrobiona 19 listopada 2026; CI czeka na commit.

## Scenariusz demo
Według faktycznej implementacji (19 listopada 2026). Wymaga:
- infrastruktury z Gotenbergiem (`pnpm infra:up`; pierwszy start buduje obraz `hulajnogi-gotenberg:9.5.1-inter4.1`), migracji i danych startowych (`pnpm db:migrate`, `pnpm db:seed`: bloki, FAQ, aktualności, grafiki i szablony startowe; seed zapisuje pliki w SeaweedFS);
- API na 3001 z `DOCUMENT_RENDERER=gotenberg` (domyślnie) i `GOTENBERG_URL=http://localhost:3010`; do odświeżenia strony na żądanie `SITE_REVALIDATE_URL=http://localhost:3002/api/revalidate` i ten sam `SITE_REVALIDATE_SECRET` (co najmniej 32 znaki) w `.env` (bez nich strona pokazuje zmianę po 5 min);
- panelu i strony na `WEB_PORT=3002` z `PUBLIC_SITE_URL=http://localhost:3002` (adres w kodzie QR);
- aplikacji w wersji web z `EXPO_PUBLIC_API_URL=http://localhost:3001` (konfiguracja `mobile-web-local`);
- kont operatorów z rolami Redaktor, Dyspozytor i Serwisant (Klienci i dostęp → Operatorzy → „Zaproś operatora”; seed zakłada tylko Administratora).

1. **Treść strony.** Panel (Redaktor) → Konfiguracja → Treści → Bloki treści → Strona → „Hero”: nowy nagłówek, grafika z okna wyboru (co najmniej 760 px), błąd Markdown pokazuje wiersz i blokuje zapis → „Zapisz sekcję”. Strona główna na 3002 pokazuje zmianę po odświeżeniu, bez nowego buildu (`site.revalidate`). „Historia” → „Przywróć” wczytuje poprzednią wersję do edytora.
2. **Media.** Treści → Media → „Dodaj grafiki”: plik SVG odrzucony (typ), plik ponad 5 MB odrzucony (rozmiar), poprawny PNG z tekstem alternatywnym trafia do biblioteki. Grafika użyta w hero ma listę „Użycia”, a usunięcie jest zablokowane („Nie można usunąć: grafika jest używana…”); grafika `scooter.*` ma klucz systemowy. „Zastąp plik…” zachowuje użycia.
3. **FAQ.** Treści → FAQ → „Nowe pytanie”: kategoria, odpowiedź, widoczność na stronie i w aplikacji → „Opublikuj”; zmiana kolejności → „Zapisz kolejność”. Pytanie widać na stronie (sekcja „Pytania”) i w aplikacji (Profil → Pomoc i zgłoszenia). Aplikacja bez sieci pokazuje „Brak połączenia z internetem” i FAQ z pamięci z czasem ostatniej aktualizacji.
4. **Aktualność zaplanowana.** Treści → Aktualności → „Nowa aktualność”: tytuł, zajawka, treść, data „od” za 2 minuty → „Zaplanuj”. Lista pokazuje stan „Zaplanowana”, a `/aktualnosci` pokazuje artykuł o czasie (`content.news-boundary`); wcześniej `/aktualnosci/{slug}` daje 404.
5. **Dane firmy.** Panel (Administrator, `company.write`) → Treści → Dane firmy: telefon pomocy → „Zapisz 1 zmianę”. Zmiana jest w stopce strony, w aplikacji (Pomoc → Kontakt → „Zadzwoń”) i na ekranie „Hulajnoga nie odpowiada”; następny paragon ma nowe dane sprzedawcy (paragon kopiuje je w chwili wystawienia). Redaktor widzi formularz tylko do odczytu.
6. **Szablon.** Panel (Administrator) → Analiza → Wydruki → Szablony → Protokół serwisowy → „Pobierz aktywną”, zmiana w Wordzie z literówką w znaczniku → „Wgraj nową wersję” → „Wgraj i sprawdź”: okno „Szablon ma 1 błąd” z „Nieznane pole”, miejscem w dokumencie (część, tabela, wiersz albo akapit) i listą dostępnych pól. Poprawiony plik daje wersję „Do aktywacji” → „Podgląd PDF” na danych przykładowych → „Aktywuj wersję N”. „Instrukcja i lista pól” → „Lista pól (DOCX)” pobiera listę pól rodzaju.
7. **Wydruk z procesu.** Serwis → Zadania → zakończone zadanie → „Drukuj” → format PDF → „Generuj PDF”: stany „w kolejce wydruków”, „trwa wypełnianie szablonu”, „Gotowe” (`document.ready`) → „Pobierz PDF”; stopka ma identyfikator wydruku, szablon z wersją, datę i operatora. Wydruki → Wygenerowane pokazuje rodzaj, zadanie, wersję szablonu i zlecającego, a wyszukiwanie po 8 znakach identyfikatora ze stopki znajduje wiersz. „Przywróć” starszą wersję szablonu i ponowny wydruk.
8. **Przejazd i hulajnoga.** Przejazdy → przejazd → „Drukuj” → „DOCX do edycji w Wordzie” → „Generuj DOCX”. Flota → #0007 → „Naklejka z kodem QR” → układ (60 × 80 mm albo A4, 6 sztuk) → „Generuj PDF”: skan telefonem otwiera `/h/0007` (strona pokazuje numer i model, „Mam aplikację, otwórz hulajnogę” prowadzi do `APP_SCOOTER_LINK`); `/h/7` przekierowuje na `/h/0007`.
9. **Klient.** Aplikacja → Profil → Portfel → paragon → „Pobierz PDF”: „Przygotowujemy PDF…”, arkusz „PDF gotowy” → „Otwórz” (wersja web: nowa karta); drugie dotknięcie zwraca ten sam plik bez nowego wydruku. Profil → Ustawienia → „Pobierz moje dane” → „Przygotuj plik”: „Przygotowujemy plik”, potem plik JSON ważny 7 dni i baner `data_export_ready`; ponowne zlecenie tego samego dnia pokazuje „Kolejny plik zlecisz …”.
10. **Uprawnienia.** Redaktor edytuje treści i ogląda szablony, ale nie wgra wersji (`templates.write`) i nie zmieni danych firmy (`company.write`); Serwisant drukuje protokół, nie widzi Treści, a bez `users.read` ma w wydruku „Klient” zamiast imienia i nazwiska i nie pobierze wydruku Dyspozytora z danymi klienta (w Wygenerowanych „Dane klienta” zamiast „Pobierz”); Dyspozytor nie zmieni szablonu.
