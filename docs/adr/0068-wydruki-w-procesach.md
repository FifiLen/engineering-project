# ADR 0068: Wydruki w procesach

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0030](0030-wydruki-z-szablonow-docx.md) opisuje wydruki jako dokumenty jednego obiektu z szablonów, [ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md) silnik i zadanie, a [ADR 0067](0067-szablony-wydrukow-docx.md) szablony i katalog pól. Zostało ustalić, skąd operator i klient drukują i jakie dane trafiają do dokumentu. [ADR 0052](0052-paragony.md) odłożył PDF paragonu do tej iteracji. [ADR 0041](0041-kod-qr-hulajnogi.md) zapowiedział naklejkę z kodem QR jako wydruk z szablonu.

Migracja 0002 ma tabelę `generated_documents`:
- rodzaj (`document_type`), `entity_ref` jako tekst bez klucza obcego;
- `template_version_id NOT NULL`;
- pliki DOCX i PDF;
- operator albo klient, `job_status`;
- `CHECK`: `SUCCEEDED` wymaga DOCX.

Odpowiedzi autora z 18 listopada 2026:
- **pytanie 1:** cztery wydruki z szablonem startowym;
- **pytanie 2:** paragon PDF klienta z tą samą wersją szablonu nie generuje się drugi raz;
- **pytanie 3:** pliki usuwane po 30 dniach;
- **pytanie 4:** bez własnej numeracji wydruków. Dokument nosi numer obiektu, a stopka podaje identyfikator wydruku, szablon z wersją, datę i operatora;
- **pytanie 5:** podpis jako linia z imieniem i nazwiskiem;
- **D5:** naklejka QR to PDF z HTML (Chromium, biblioteka `qrcode`), a karta hulajnogi DOCX podaje adres tekstem;
- **D6:** „Drukuj” w nagłówku kart przejazdu, zadania, hulajnogi, zgłoszenia i paragonu; Wydruki (Analiza) z zakładkami Szablony i Wygenerowane.

Plansze `wydruki-drukuj`, `wydruki-wygenerowane`, `wydruki-naklejka-qr` i `31-mobile-tresci/paragon-pdf*` pokazują:
- okno z wyborem szablonu, formatem i parametrami, stany generowania, gotowego wydruku i błędu;
- dopisek „Zgłaszający jako »Klient«: Twoja rola nie ma podglądu danych klientów”;
- listę z filtrem „wszystkie oprócz paragonów klientów”, stanami „W toku”, „Gotowe”, „Błędy” i „Pliki usunięte” oraz akcjami „Ponów” i „Wygeneruj ponownie”;
- naklejkę 60 × 80 mm albo arkusz A4 z sześcioma naklejkami, zapisaną jako „Układ wbudowany, bez szablonu”;
- w aplikacji przycisk u dołu ekranu, zadanie trwające po wyjściu z ekranu i wersję web otwierającą PDF w nowej karcie.

Do rozstrzygnięcia zostały:
- `generated_documents` dla naklejki (rodzaj bez szablonu przy `template_version_id NOT NULL`);
- uprawnienia `documents.generate` przy danych klienta.

Sprawdzone 18 listopada 2026:
- **Moduły Expo:** `bundledNativeModules.json` dla Expo 58.0.23 podaje `expo-file-system` ~58.0.13 (28 października) i `expo-sharing` ~58.0.22 (3 listopada). `minimumReleaseAge: 4320` w `pnpm-workspace.yaml` dobierze w zakresie wersję starszą niż 3 dni.
- **Dokumentacja SDK 58:** `File.downloadFileAsync(url, cel)` pobiera plik do `Paths.cache`. `expo-sharing` w przeglądarce opiera się na Web Share API, wymaga HTTPS i nie udostępnia plików lokalnych.
- **`qrcode`** 1.5.4 (5 sierpnia 2024, MIT) jest już w panelu i ma wyjście SVG.

## Rozważane opcje

Naklejka w `generated_documents`:

1. **Bez zapisu:** API zwraca PDF w odpowiedzi. Proste, ale naklejki nie ma na liście Wygenerowane, a przy błędzie silnika nie ma śladu.
2. **Osobna tabela wydruków wbudowanych.** Dwie listy z tym samym przebiegiem.
3. **Ten sam wiersz z rodzajem `SCOOTER_LABEL` i pustą wersją szablonu,** dopuszczoną tylko dla rodzaju bez szablonu. Jedna lista, to samo zadanie i ta sama retencja.

Paragon PDF klienta:

1. **Nowy wydruk przy każdym kliknięciu.** Prosto, ale każde kliknięcie obciąża silnik, a pliki się mnożą.
2. **Ponowne użycie wydruku tego paragonu z bieżącą aktywną wersją szablonu,** pilnowane indeksem częściowym. Paragon się nie zmienia, więc ten sam plik jest poprawny.

## Decyzja

Opcja 3 dla naklejki i opcja 2 dla paragonu klienta.

### Rodzaje, źródła i dane

Dane pochodzą z widoków `v_doc_*` (migracja 0011). Widok jest kontraktem modułu, do którego należą dane, jak widoki raportów w [ADR 0029](0029-raporty-pdf-xlsx.md), więc moduł Dokumenty nie czyta cudzych tabel ([ADR 0003](0003-monolit-modularny.md)).

| Rodzaj | Skąd „Drukuj” | Dane | Parametry | Uprawnienie odczytu |
|---|---|---|---|---|
| `RECEIPT` | karta paragonu (Płatności), aplikacja | `v_doc_receipt`: pozycje, grupy VAT ([ADR 0061](0061-oplata-za-odholowanie-jako-kara-umowna.md)), korekta i dokument korygowany, sprzedawca i nabywca z chwili wystawienia | — | `payments.read` |
| `RENTAL_CONFIRMATION` | karta przejazdu | `v_doc_rental`: oś czasu z `v_rental_timeline`, czas, dystans, kwoty z wyceny, numer paragonu; początek i koniec jako adres | `includeTimeline` | `rentals.read` |
| `SERVICE_PROTOCOL` | karta zadania | `v_doc_service_task`: części z kosztem z chwili użycia, notatka, wykonawca, zgłoszenie, skutek dla hulajnogi | `includeTimeline` | `service.read` |
| `SCOOTER_CARD` | karta hulajnogi | `v_doc_scooter`: dane, model, przebieg, zadania i zgłoszenia z okresu, adres `/h/{numer}` | `historyDays` (30, 90, 365) | `scooters.read` |
| `INCIDENT_REPORT` | karta zgłoszenia (po wgraniu szablonu) | `v_doc_ticket`: przebieg z `v_ticket_timeline`, odpowiedź dla klienta, liczba i daty zdjęć | — | `tickets.read` |
| `WALLET_ADJUSTMENT` | wpis korekty w portfelu klienta (po wgraniu szablonu) | `v_doc_wallet_adjustment` | — | `payments.read` |
| `SCOOTER_LABEL` | karta hulajnogi, „Naklejka z kodem QR” | numer, `PUBLIC_SITE_URL` | `layout` (`single`, `a4x6`) | `scooters.read` |

Adres początku i końca przejazdu daje odwrotne wyszukiwanie Photon (`/reverse`, moduł Geo, [ADR 0045](0045-wyszukiwanie-miejsc-photon.md)) w zadaniu, z limitem 3 s. Bez odpowiedzi dokument podaje strefę i współrzędne. Dzięki temu „trasa jako adres” z pytania 1 nie zależy od dostępności Photon.

Rodzaje z szablonem startowym to pierwsze cztery (pytanie 1). `INCIDENT_REPORT` i `WALLET_ADJUSTMENT` pokazują „Drukuj” dopiero po wgraniu i aktywacji szablonu.

### „Drukuj” w panelu

- **Widoczność:** przycisk widzi operator z `documents.generate` i uprawnieniem odczytu rodzaju, gdy rodzaj ma szablon z aktywną wersją. Listę daje `GET /admin/document-types`.
- **Okno:**
  - szablon (domyślny zaznaczony, do wyboru aktywne szablony rodzaju);
  - format PDF albo DOCX;
  - parametry z katalogu;
  - podsumowanie danych;
  - dopisek o ukryciu klienta.
- **Zlecenie:** `POST /admin/documents { documentType, entityId, templateId?, format, params }` daje `202` z widokiem wydruku. Okno czeka na `document.ready`, a w zapasie pyta `GET /admin/documents/{id}` co 2 s. Komunikat błędu pojawia się po 30 s, a zadanie działa dalej.
- **Wynik:**
  - DOCX powstaje zawsze, a PDF przez Gotenberga;
  - przy błędzie PDF zostaje DOCX, stan `FAILED` i kod (np. `RENDER_TIMEOUT`);
  - „Spróbuj ponownie” (`POST /admin/documents/{id}/retry`) tworzy nowy wiersz z `retry_of`.
- **Dane klienta (rozstrzygnięcie):** pola katalogu oznaczone `customer` (imię i nazwisko, telefon) operator bez `users.read` dostaje jako „Klient”, jak w listach zgłoszeń ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)). Samo `documents.generate` nie daje więc dostępu do danych osobowych, a wydruk wymaga uprawnienia odczytu rodzaju.

### Stopka, numeracja, podpis (pytania 4 i 5)

- **Stopka:** `{document.footer}` = „Wydruk {pierwsze 8 znaków identyfikatora} · {szablon} v{n} · {dd.MM.yyyy, HH:mm} · {operator}” i pola Worda „strona X z Y” w szablonie.
- **Numer:** dokument nosi numer obiektu (`PAR/2026/…`, `R-…`, `S-…`, `Z-…`, `#0007`). Własnej numeracji nie ma, a listę Wygenerowane da się przeszukać po identyfikatorze.
- **Podpis i pieczęć:**
  - linia „Podpis: {staff.name}”; pieczęć i logo są stałymi grafikami szablonu;
  - dokument zlecony przez klienta ma w stopce „aplikacja” i nie ma linii podpisu;
  - bez podpisu elektronicznego.

### Paragon PDF klienta

- **`POST /me/receipts/{id}/pdf`** (`@CustomerAuth()`, tylko własny paragon, także korekta):
  - szuka wiersza `RECEIPT` tego paragonu z wersją aktywną domyślnego szablonu, formatem PDF, stanem innym niż `FAILED` i nieusuniętymi plikami;
  - jeśli jest, zwraca go (`200`) bez nowego zadania;
  - w przeciwnym razie wstawia wiersz i zadanie (`202`).
- **Równoległe kliknięcia:** wyścig rozstrzyga indeks unikalny częściowy `(entity_ref, template_version_id) WHERE document_type = 'RECEIPT' AND format = 'PDF' AND requested_by_user IS NOT NULL AND status <> 'FAILED' AND files_deleted_at IS NULL` z `INSERT … ON CONFLICT DO NOTHING`.
- **Po 30 dniach** i po aktywacji nowej wersji powstaje nowy plik, z niezmienionych danych paragonu.
- **Stan i adres:** `GET /me/documents/{id}` zwraca stan i adres z podpisem na 10 min ([ADR 0057](0057-pliki-zdjecia.md)).
- **Aplikacja:**
  - wersja natywna pobiera plik przez `File.downloadFileAsync` do `Paths.cache` (`PAR-2026-000126.pdf`) i otwiera arkusz udostępniania (`Sharing.shareAsync`, `mimeType: application/pdf`, `UTI: com.adobe.pdf`);
  - wersja web otwiera adres w nowej karcie;
  - moduły z `expo install`: `expo-file-system` ~58.0.13 i `expo-sharing` ~58.0.22.
- **Wydruk paragonu z panelu** zawsze tworzy nowy wiersz, bo stopka podaje operatora.

### Naklejka z kodem QR (D5)

- **Układ:** wbudowany HTML w API, poza szablonami DOCX.
  - Kod `qrcode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 })` (`qrcode` 1.5.4 dodany do `apps/api`) dla `${PUBLIC_SITE_URL}/h/{numer}` ([ADR 0041](0041-kod-qr-hulajnogi.md)).
  - Numer czcionką Inter z kontenera; CSS `@page { size: 60mm 80mm; margin: 0 }` albo arkusz A4 z siatką 2 × 3.
  - Bez obrazów zewnętrznych i skryptów, a Gotenberg dostaje `preferCssPageSize=true`.
- **Tekst naklejki** („Zeskanuj w aplikacji albo aparatem”) to sekcja `admin.scooter-label` z rejestru treści ([ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md)), więc nie jest wpisany w kod.
- **Zapis:** wiersz `generated_documents` z `document_type = SCOOTER_LABEL`, bez wersji szablonu, z formatem PDF i parametrem `layout`. Lista pokazuje „Układ wbudowany, bez szablonu”.
- **Karta hulajnogi DOCX** podaje ten sam adres tekstem.

### Schemat (migracja 0011, tabela jest pusta)

- **Rodzaj naklejki:** `ALTER TYPE document_type ADD VALUE 'SCOOTER_LABEL'`.
  - Wartość nie jest użyta w tej samej transakcji ([jak w 0002](../../packages/db/migrations/0002_admin_modules.sql)).
  - Warunek porównuje tekst: `CHECK ((document_type::text = 'SCOOTER_LABEL') = (template_version_id IS NULL))`, a `template_version_id` traci `NOT NULL`.
- **Format:** nowy typ `document_format` (`DOCX`, `PDF`) i kolumna `format NOT NULL`.
- **Nowe kolumny:**
  - `entity_label` (numer obiektu z chwili zlecenia, do listy i wyszukiwania);
  - `started_at`;
  - `error_code` (`CHECK '^[A-Z_]+$'`);
  - `files_deleted_at`;
  - `retry_of`.
- **Zamiana warunków:**
  - `SUCCEEDED` wymaga pliku w żądanym formacie (`pdf_file_id` dla PDF, `docx_file_id` dla DOCX);
  - `FAILED` wymaga `error_code`.
- **Indeksy:**
  - dokumenty klienta `(requested_by_user, created_at DESC) WHERE requested_by_user IS NOT NULL`;
  - retencja `(finished_at) WHERE files_deleted_at IS NULL`;
  - indeks ponownego użycia paragonu.
- **Widok `v_generated_documents`:** stan z `DELETED` liczonym z `files_deleted_at`, szablon i wersja albo „Układ wbudowany”, zlecający (operator albo klient z dopiskiem „aplikacja”), czas trwania.

### Lista Wygenerowane i nawigacja

- **Zasób `generated-documents`** ([ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md)) jest tylko do odczytu, z akcjami:
  - filtry: rodzaj, stan, format, zlecający (`staff` albo `customer`; domyślnie bez paragonów klientów), data;
  - liczniki stanów;
  - akcje: „Pobierz”, „Ponów” (błąd) i „Wygeneruj ponownie” (pliki usunięte; nowy wiersz z bieżących danych i aktywnej wersji).
- **Kto co widzi:**
  - listę widzi `documents.generate`, ale repozytorium zwraca tylko rodzaje, do których operator ma uprawnienie odczytu (Serwisant nie widzi paragonów);
  - dane klienta są ukryte bez `users.read`;
  - pobrać plik może zlecający albo operator z `documents.generate` i uprawnieniem odczytu rodzaju; klient tylko swoje.
- **Nawigacja (rozstrzygnięcie):**
  - pozycja „Wydruki” jest widoczna z `templates.read` albo `documents.generate`;
  - zakładka Szablony wymaga `templates.read`, a Wygenerowane `documents.generate`;
  - Redaktor widzi tylko Szablony, a Dyspozytor i Serwisant obie zakładki.
- **Ślad zlecenia:** wiersz `generated_documents` (kto, kiedy, z której wersji, z jakimi parametrami). Zlecenie operatora ma też wpis `generated_document.requested` w dzienniku audytu, a ponowienia mają `retry_of`.

## Konsekwencje

Pozytywne:

- Wymaganie 19 jest pokazane w procesach: wydruk z karty obiektu w DOCX i PDF z wybranego szablonu i wersji, z parametrami.
- Klient pobiera paragon i korektę jako PDF bez obciążania silnika przy każdym kliknięciu.
- Naklejka, wydruki z szablonów i paragony klientów mają jedną listę, jedno zadanie i jedną retencję.
- `documents.generate` nie otwiera danych, do których rola nie ma dostępu, bo wydruk wymaga uprawnienia odczytu rodzaju i ukrywa klienta bez `users.read`.

Negatywne i ryzyka:

- `entity_ref` bez klucza obcego i `entity_label` z chwili zlecenia mogą się rozjechać z obiektem (np. po anonimizacji klienta). Lista pokazuje stan z chwili wydruku, co jest zgodne z celem śladu.
- Odwrotne wyszukiwanie Photon to zewnętrzne wywołanie w zadaniu. Przy braku sieci adres zastępują strefa i współrzędne.
- Udostępnianie PDF w aplikacji natywnej sprawdzimy w pełni dopiero w development build (otwarte zadanie w `CLAUDE.md`). W wersji web plik otwiera się w karcie.
- Rodzaje bez szablonu startowego (`INCIDENT_REPORT`, `WALLET_ADJUSTMENT`) mają widoki i katalog, ale w demo „Drukuj” pojawi się dopiero po wgraniu szablonu.

## Powiązane

[ADR 0041](0041-kod-qr-hulajnogi.md) (zmienia: naklejka jako PDF z HTML poza szablonami DOCX zamiast wydruku z szablonu), [ADR 0052](0052-paragony.md) (uzupełnia: PDF paragonu i korekty), [ADR 0030](0030-wydruki-z-szablonow-docx.md), [ADR 0003](0003-monolit-modularny.md), [ADR 0029](0029-raporty-pdf-xlsx.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [ADR 0045](0045-wyszukiwanie-miejsc-photon.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0057](0057-pliki-zdjecia.md), [ADR 0061](0061-oplata-za-odholowanie-jako-kara-umowna.md), [ADR 0062](0062-modul-tresci-sekcje-publikacja-dane-firmy.md), [ADR 0066](0066-silnik-dokumentow-gotenberg-i-zadania.md), [ADR 0067](0067-szablony-wydrukow-docx.md), [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytania 1–5, D5, D6), makiety `29-panel-wydruki` i `31-mobile-tresci/paragon-pdf*`
