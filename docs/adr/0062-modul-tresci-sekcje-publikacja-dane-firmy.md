# ADR 0062: Moduł treści: sekcje, publikacja i dane firmy

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0027](0027-tresci-sterowane-z-panelu.md) oddziela treści (baza, panel) od etykiet (pliki tłumaczeń) i zakłada bloki z kluczem, FAQ, aktualności, licznik `content_revision`, `ETag`, zdarzenie `content.updated` i pamięć treści w aplikacji. Tabele są od migracji 0002, ale stoją puste i nie mają punktów API. Wyjątkiem są dokumenty prawne z iteracji 2. Strona i aplikacja biorą dziś teksty z `messages/pl.json` i `apps/mobile/src/i18n/pl.json`, a kontakt pomocy to `[e-mail pomocy]` w pliku tłumaczeń.

Odpowiedzi autora z 18 listopada 2026 ([plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md#odpowiedzi-autora-18-listopada-2026)):
- **D1:** rejestr sekcji w `packages/shared`. Panel edytuje treść i elementy sekcji-list, ale nie tworzy sekcji;
- **pytanie 7:** bloki, FAQ i aktualności mają stan szkic, opublikowany albo archiwum. Zmiana opublikowanego wpisu działa od zapisu, historia pochodzi z dziennika audytu i ma „Przywróć”. Aktualności planuje się od–do. Dokumenty prawne zostają bez zmian;
- **pytanie 6:** nowa rola „Redaktor” (`content.read`, `content.write`, `templates.read`, `dashboard.read`);
- **pytanie 8:** tylko język polski. ADR ma opisać drogę do kolejnych języków;
- **pytanie 12:** aplikacja bierze z bazy ekran startowy, kontakt pomocy, Pomoc z FAQ i zasady jako sekcję-listę z ikonami. Aktualności są tylko na stronie;
- **pytanie 13:** dane firmy w jednej tabeli zamiast `SELLER_*`. Paragon kopiuje je w chwili wystawienia.

Makiety `28-panel-tresci` i `31-mobile-tresci` ([spis](../projekt/README.md#panel-operatora-treści-i-wydruki-iteracja-7)) dodały ustalenia:
- sekcja wymagana (hero) nie schodzi do szkicu ani archiwum;
- sekcja-lista ma limit elementów, a kolejność zapisuje się razem z sekcją;
- element listy ma własny stan i ikonę z zamkniętej listy;
- FAQ ma kolejność kategorii i osobne przełączniki „Strona” i „Aplikacja”;
- dane firmy mają wersję i historię;
- Pomoc bez sieci pokazuje treść z pamięci i czas ostatniego pobrania.

Do rozstrzygnięcia z makiet zostały:
- ikona elementu w schemacie;
- kolejność kategorii FAQ;
- KRS i REGON;
- kontakt pomocy przy pierwszym uruchomieniu bez sieci;
- uprawnienia Redaktora do szablonów powiadomień i danych firmy;
- pulpit Redaktora.

Sprawdzone 18 listopada 2026:
- **Moduły Expo:** `apps/mobile/node_modules/expo/bundledNativeModules.json` (Expo 58.0.23) podaje `@react-native-async-storage/async-storage` 2.2.0 (wydana 5 czerwca 2025) i `expo-sqlite` ~58.0.15.
- **`expo-sqlite` w wersji web** wymaga, według [dokumentacji SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/), pliku WASM w Metro i nagłówków `Cross-Origin-Embedder-Policy` i `Cross-Origin-Opener-Policy`. Async Storage działa w przeglądarce na `localStorage`.
- **Socket.IO:** połączenie bez tokenu jest rozłączane (`fleet.gateway.ts`), więc zdarzenie dociera tylko do zalogowanych.
- **Szablony powiadomień:** rejestr ma już parametry wymagane (`TEMPLATE_MISSING_PARAM`), więc szablon `login_code` bez `{code}` nie przejdzie walidacji.

## Rozważane opcje

Sekcje (D1):

1. **Dowolne klucze bloków w panelu.** Elastyczne, ale kod strony szuka klucza, którego może nie być, a operator może utworzyć blok, którego nic nie pokaże.
2. **Rejestr sekcji w kodzie.** Rejestr opisuje, które sekcje istnieją, jakie mają pola i limity, i czy są pojedynczym blokiem, czy listą. Baza trzyma tylko treść.

Historia zmian (pytanie 7):

1. **Tabele wersji bloków, FAQ i aktualności.** Działa jak szablony powiadomień, ale daje trzy tabele, które powielają dziennik audytu.
2. **Dziennik audytu z pełną treścią przed zmianą i po niej.** Jedno źródło, zapisywane w tej samej transakcji ([ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md)).

Kategorie FAQ:

1. **Kategoria jako tekst, a kolejność kategorii z najmniejszego `sort_order` pytania.** Nie wymaga tabeli. Przeniesienie jednego pytania zmienia jednak kolejność całych kategorii, a literówka tworzy nową kategorię.
2. **Tabela `faq_categories`** z nazwą i kolejnością. Kolejność kategorii jest jawna, a nazwę zmienia się w jednym miejscu.

Pamięć treści w aplikacji:

1. **`expo-sqlite/kv-store`.** Ma API synchroniczne, ale w wersji web wymaga WASM i nagłówków COOP/COEP na serwerze Metro i hostingu.
2. **`@react-native-async-storage/async-storage`.** Asynchroniczna, bez dodatkowej konfiguracji w wersji web.
3. **`expo-secure-store`.** Szyfrowana, ale przeznaczona na małe sekrety (ostrzeżenie przy wartościach powyżej 2 KB).

## Decyzja

Opcja 2 dla sekcji, historii i kategorii FAQ, a dla pamięci treści Async Storage.

### Rejestr sekcji (`packages/shared/src/content/sections.ts`)

- **Wpis rejestru:**
  - klucz (`web.hero`, `mobile.rules`) i klient (`WEB`, `MOBILE`, `ADMIN`);
  - rodzaj: `single` albo `list` z liczbą elementów (`min`, `max`);
  - `required`: sekcja zawsze opublikowana;
  - pola nagłówka i elementu: tytuł z limitem znaków, treść z profilem Markdown ([ADR 0063](0063-markdown-w-tresciach.md)) i limitem, grafika (wymagana, minimalna szerokość, [ADR 0064](0064-biblioteka-mediow.md)), przycisk, ikona;
  - źródło danych dołączanych przez kod (np. `web.pricing` z cennika, `web.design` z modelu).
- **Rejestr startowy** według plansz `tresci-bloki` i `tresci-sekcja-lista`:
  - strona: `web.meta`, `web.notice` (opcjonalna), `web.hero` (wymagana, grafika co najmniej 1200 px), `web.steps` (lista 3–4), `web.design`, `web.pricing`, `web.zones` (lista 3), `web.app`, `web.stores` (lista 1–2), `web.faq`, `web.footer`;
  - aplikacja: `mobile.start` (wymagana, render), `mobile.rules` (lista 3–6 z ikoną), `mobile.help`, `mobile.notice` (opcjonalna);
  - panel: `admin.scooter-label` (tekst naklejki z kodem QR, [ADR 0068](0068-wydruki-w-procesach.md)).

  `web.meta` (tytuł i opis strony dla wyszukiwarek, [ADR 0065](0065-strona-promocyjna-z-tresci.md)) to sekcja spoza planszy z dziesięcioma sekcjami. Odstępstwo trafi do dziennika.
- **Reguły w `packages/core/src/content`:** wymagane pola, limity, liczba elementów, przejścia stanu, sekcja wymagana i schematy adresu przycisku. Core dostaje definicję sekcji jako argument, bo nie zależy od `packages/shared`, tak jak walidacja szablonów powiadomień. Test API porównuje rejestr z bazą (klucze bloków i lista ikon).
- **Ikony:**
  - zamknięta lista `CONTENT_ICONS` w `packages/shared`, około 12 rysunków w obu klientach (`rider-single`, `bike-lane`, `parking`, `helmet`, `no-alcohol`, `map`, `scan`, `wallet`, `battery`, `zone-slow`, `zone-no-ride`, `phone`);
  - w bazie `CHECK` z tą samą listą;
  - nowa ikona to rysunek w kliencie i migracja.

### Schemat treści (migracja 0011)

- **`content_blocks`** (tabela pusta, więc zmiany nie wymagają przenoszenia danych):
  - `key` przestaje być unikalny i staje się kluczem sekcji z rejestru. Kolumna `position` (0 to blok pojedynczy albo nagłówek listy, od 1 elementy) zastępuje `sort_order`;
  - unikalność `(key, position)` jest `DEFERRABLE INITIALLY DEFERRED`, więc zmiana kolejności mieści się w jednej transakcji;
  - nowa kolumna `icon` z `CHECK` listy;
  - `CHECK` zgodności klucza z klientem (`web.` dla `WEB`, `mobile.` dla `MOBILE`, `admin.` dla `ADMIN`);
  - `CHECK` adresu przycisku: `https:`, `mailto:`, `tel:`, ścieżka zaczynająca się od jednego `/` albo kotwica `#`. To ta sama reguła co w Markdown (ADR 0063).
- **`faq_categories`** (nowa tabela):
  - kolumny: nazwa unikalna bez względu na wielkość liter, `sort_order`, `version`;
  - `faq_items.category` zamienia się na `category_id`;
  - `faq_items` dostaje `show_on_web` i `show_in_app` z `CHECK (show_on_web OR show_in_app)`;
  - nową kategorię tworzy zapis pytania z nazwą, której jeszcze nie ma;
  - kategorię bez pytań można usunąć, a widoki publiczne jej nie pokazują.
- **`news`:** `lead` staje się wymagany (do 280 znaków). Widok `v_news_list` liczy stan: `DRAFT`, `SCHEDULED` (opublikowana z `publish_from` w przyszłości), `PUBLISHED`, `EXPIRED` (po `publish_to`) i `ARCHIVED`. Slug powstaje z tytułu tą samą funkcją co kotwice nagłówków i nie zmienia się po pierwszej publikacji, żeby odnośniki nie przestały działać.
- **`company_profile`** (nowa tabela z jednym wierszem, `id boolean PRIMARY KEY DEFAULT true CHECK (id)`):
  - **sprzedawca:** nazwa, ulica, kod pocztowy (`CHECK '^\d{2}-\d{3}$'`), miejscowość, NIP (10 cyfr w `CHECK`, sumę kontrolną sprawdza core);
  - **pomoc:** e-mail, telefon, godziny (do 60 znaków);
  - **rejestr (opcjonalnie):** `regon` (9 albo 14 cyfr), `krs` (10 cyfr), `registry_court`, `share_capital_grosze`;
  - `version`, `updated_by`, `updated_at`.
- **Widoki:**
  - listy panelu: `v_content_blocks`, `v_faq_list`, `v_news_list`;
  - publiczne: `v_public_content_blocks`, `v_public_faq` (tylko opublikowane pytania z kolejnością kategorii), `v_company_public`.
- **Licznik treści:** wyzwalacz `trg_content_revision` obejmuje też `faq_categories`, `company_profile` i `scooter_models` (parametry i zdjęcie modelu są na stronie). Procedura `sp_content_bump_revision()` zwiększa licznik bez zmiany wiersza, na potrzeby zadań publikacji aktualności o czasie.

### Stany, publikacja i historia

- **Przejścia stanu:** `DRAFT ↔ PUBLISHED ↔ ARCHIVED` w obie strony. Zmiana opublikowanego wpisu działa od zapisu, a panel pokazuje podgląd przed zapisem. Sekcja wymagana zostaje opublikowana (`CONTENT_SECTION_REQUIRED`). Opublikowany wpis trzeba zarchiwizować, a usunąć da się tylko szkic albo wpis z archiwum.
- **Blokada optymistyczna:** każdy zapis podaje `version` jak w zasobach z [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md). Niezgodna wersja daje `409 CONFLICT` z `details.currentVersion`.
  - Sekcja-lista zapisuje nagłówek i elementy jednym żądaniem (`PUT /admin/content-sections/{key}`), a blokadą sekcji jest wersja nagłówka.
  - Dług z iteracji 2: wersja robocza dokumentu prawnego dostaje kolumnę `content_page_versions.version`, a zapis wymaga zgodnej wersji.
- **Historia:** wpisy dziennika audytu `content_block.*`, `faq_item.*`, `news.*` i `company_profile.updated` mają w `data` pełny stan `before` i `after` oraz `version: [n, n+1]`.
  - Panel czyta historię z `GET /admin/<zasób>/{id}/history`.
  - „Przywróć” wczytuje stan z wybranego wpisu do edytora. Zapis tworzy nową wersję z `restoredFrom` (identyfikator wpisu dziennika).
  - Seed zapisuje wpis systemu (`actor = SYSTEM`), więc historia zaczyna się od „Dane startowe”.
- **FAQ:** kolejność pytań w kategorii i kolejność kategorii zapisuje się jawnie (`PUT /admin/faq/order`, `PUT /admin/faq-categories/order`), z blokadą wersji wszystkich przestawianych wierszy.
- **Aktualności o czasie:** zapis opublikowanej aktualności planuje w transakcji (`sendInTransaction`, [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)) zadanie `content.news-boundary`:
  - uruchamia się na `startAfter = publish_from` i na `publish_to`, z kluczem singletonu `news:{id}:{granica}:{czas}`;
  - zwiększa licznik (`sp_content_bump_revision()`), wysyła `content.updated` i odświeża stronę (`site.revalidate`, ADR 0065);
  - zadanie po zmianie dat nic nie psuje, bo tylko zwiększa licznik;
  - zgubione zadanie zastępuje czas zapasowy strony (5 min), a aplikacja nie pokazuje aktualności.

### Dane firmy

- **Zastępują `SELLER_*`:** paragon w chwili wystawienia kopiuje nazwę, adres i NIP do `receipts.seller`, jak dotąd ([ADR 0052](0052-paragony.md)). Moduł Płatności dostaje je przez port `CompanyProfileProvider` modułu Treści, nie z tabeli ([ADR 0003](0003-monolit-modularny.md)). Zmienne `SELLER_*` znikają z `config.ts` i `.env.example`.
- **Zasilają:**
  - stopkę strony;
  - Pomoc w aplikacji i przycisk „Zadzwoń” przy „Nadal nie działa?”;
  - pola `{company.*}` wydruków ([ADR 0067](0067-szablony-wydrukow-docx.md)).
- **KRS i REGON (rozstrzygnięcie):** pola opcjonalne.
  - Gdy są wypełnione, stopka strony pokazuje KRS, sąd rejestrowy i kapitał zakładowy. Art. 206 § 1 KSH wymaga ich na stronie internetowej spółki z o.o.; formę spółki i wymóg sprawdza autor, jak stawkę VAT.
  - Paragon zostaje przy nazwie, adresie i NIP.
- **Marka `[nazwa]`** nie jest daną firmy, tylko etykietą do decyzji o nazwie.
- **Uprawnienia (rozstrzygnięcie):**
  - nowe uprawnienie `company.write` ma tylko Administrator, bo dane trafiają na dokumenty sprzedaży;
  - podgląd wymaga `content.read`.

### Rola Redaktor i uprawnienia

- **Migracja 0011:** zakłada rolę „Redaktor” (`content.read`, `content.write`, `templates.read`, `dashboard.read`) i uprawnienie `company.write` (Administrator).
- **Szablony powiadomień (rozstrzygnięcie):** zostają przy `content.write` ([ADR 0058](0058-powiadomienia-push-z-szablonow.md) bez zmian). Ich treść to tekst dla klienta, a parametry wymagane z rejestru (`TEMPLATE_MISSING_PARAM`) chronią `login_code` przed utratą kodu.
- **Dokumenty prawne:** zostają przy `content.write` (pytanie 7: bez zmian), więc Redaktor może opublikować regulamin. Ryzyko jest opisane niżej.
- **Pulpit Redaktora (rozstrzygnięcie):** grupy „Wymaga uwagi” wymagają uprawnień list docelowych ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)), więc Redaktor ich nie widzi. Dostaje grupę „Treści” (szkice, zaplanowane aktualności, grafiki bez użycia) z `content.read`.
- **Nawigacja:** „Treści” wymaga `content.read`. Zakładka „Dane firmy” jest widoczna z `content.read`, a zapis wymaga `company.write`.

### API

- **Panel:**
  - zasoby list ([ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md)): `content-blocks`, `faq`, `faq-categories`, `news`;
  - formularz `company` (`GET` i `PATCH /admin/company`);
  - sekcje: `GET` i `PUT /admin/content-sections/{key}`;
  - historia każdego wpisu.

  Każdy zapis ma wpis w dzienniku audytu w tej samej transakcji.
- **Publiczne `GET /content/{client}`** (`web` albo `mobile`) zwraca jedną odpowiedzią:
  - opublikowane sekcje z elementami;
  - FAQ widoczne dla klienta;
  - publiczne dane firmy;
  - opisy grafik (adres, tekst alternatywny, wymiary) użytych w sekcjach i klucze systemowe (`scooter.*`);
  - dla strony także aktywne modele z parametrami.

  Nagłówki to `ETag: "content-{fn_content_revision()}"` i `Cache-Control: no-cache`, a `If-None-Match` daje `304`. Licznik jest wspólny dla obu klientów, więc zmiana na stronie wymusza zbędne, tanie odświeżenie w aplikacji.
- **Osobny `GET /faq` z planu jest zbędny,** bo FAQ jest w `GET /content/{client}`. Aktualności mają `GET /news` i `GET /news/{slug}` ([ADR 0065](0065-strona-promocyjna-z-tresci.md)).
- **Zdarzenie `content.updated { revision, clients, at }`** (kontrakt Socket.IO 1.5.0) idzie do wszystkich połączonych po zatwierdzeniu transakcji, jak `zones.changed`. Strona dostaje odświeżenie wywołaniem HTTP (ADR 0065), nie przez Socket.IO.

### Pamięć treści w aplikacji

- **Zapis:** `@react-native-async-storage/async-storage` 2.2.0 (`expo install`), klucz `content:mobile:v1` z `{ etag, revision, fetchedAt, data }`.
- **Odświeżanie:** przy starcie, przy powrocie na pierwszy plan i po `content.updated` z wyższą rewizją. Żądanie wysyła `If-None-Match`, a `304` tylko aktualizuje `fetchedAt`.
- **Bez sieci:**
  - ekrany korzystają z pamięci, a Pomoc pokazuje „pobrane {czas}”;
  - grafiki zostają w pamięci dyskowej `expo-image`, bo ich adresy się nie zmieniają (ADR 0064);
  - rendery mają kopię w paczce na pierwsze uruchomienie (wyjątek w ADR 0064).
- **Pierwsze uruchomienie bez sieci (rozstrzygnięcie):** kontakt pomocy nie ma kopii w paczce. Aplikacja pokazuje istniejący ekran „Brak internetu”, bo bez sieci i tak nie da się zalogować ani wypożyczyć. Kopia w paczce byłaby treścią wpisaną w kod, sprzeczną z wymaganiem 17.

### Języki (pytanie 8)

Tylko polski, bez kolumny języka. Droga do kolejnego języka:
- kolumna `locale` w `content_blocks`, `faq_items`, `faq_categories`, `news` i `content_page_versions`;
- unikalność `(key, position, locale)`;
- `GET /content/{client}?locale=` z wyborem po `Accept-Language`;
- rejestr sekcji bez zmian, a etykiety przez drugi plik tłumaczeń ([ADR 0032](0032-etykiety-w-plikach-tlumaczen.md)).

## Konsekwencje

Pozytywne:

- Kod renderuje znane miejsca, a operator nie utworzy sekcji, której nic nie pokaże. Rejestr i baza są sprawdzane testem zgodności.
- Historia i „Przywróć” bez nowych tabel wersji. Dziennik audytu jest jednym źródłem dla bloków, FAQ, aktualności i danych firmy.
- Dane sprzedawcy, kontakt pomocy i stopka mają jedno źródło edytowane w panelu (wymaganie 17), a paragony zachowują dane z chwili wystawienia.
- Trzy nowe tabele (`faq_categories`, `company_profile` i `data_exports` z [ADR 0069](0069-eksport-danych-klienta.md)) i nowe widoki wzmacniają wymagania 8 i 12.

Negatywne i ryzyka:

- „Przywróć” zależy od treści `audit_log.data`. Zmiana kształtu wpisu w przyszłości wymaga obsługi starych wpisów w panelu.
- Jeden licznik dla wszystkich treści daje zbędne odświeżenia w aplikacji po zmianach strony. Przy małej liczbie zmian to nieistotne.
- Redaktor z `content.write` może opublikować nową wersję regulaminu, co wymusza ponowną akceptację u wszystkich klientów. Jeśli autor uzna to za zbyt szerokie, publikację dokumentów prawnych przeniesie do osobnego uprawnienia nowy ADR.
- Wymóg danych rejestrowych w stopce zależy od formy prawnej operatora. Pola są opcjonalne, a ocenę zostawiamy autorowi.
- Nowa ikona albo sekcja wymaga zmiany kodu i migracji. To świadoma cena D1.

## Powiązane

[ADR 0027](0027-tresci-sterowane-z-panelu.md) (rozwija), [ADR 0052](0052-paragony.md) (zmienia: dane sprzedawcy z `company_profile` zamiast `SELLER_*`), [ADR 0003](0003-monolit-modularny.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [ADR 0032](0032-etykiety-w-plikach-tlumaczen.md), [ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0058](0058-powiadomienia-push-z-szablonow.md), [ADR 0063](0063-markdown-w-tresciach.md), [ADR 0064](0064-biblioteka-mediow.md), [ADR 0065](0065-strona-promocyjna-z-tresci.md), [kontrakt realtime](../kontrakty/asyncapi-realtime.yaml), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytania 6–8, 12, 13; D1, D6, D7), makiety `28-panel-tresci` i `31-mobile-tresci`
