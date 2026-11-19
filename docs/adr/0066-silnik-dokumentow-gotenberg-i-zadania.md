# ADR 0066: Silnik dokumentów: Gotenberg i zadania

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0029](0029-raporty-pdf-xlsx.md) wybrał Gotenberga (Chromium i LibreOffice za API HTTP) jako silnik PDF dla raportów i wydruków. Przewiduje obraz 9.x przypięty do wersji, sieć wewnętrzną i port `DocumentRenderer` w core. [ADR 0030](0030-wydruki-z-szablonow-docx.md) zakłada konwersję DOCX na PDF przez LibreOffice i czcionkę Inter w kontenerze. W `infra/docker-compose.yml` Gotenberga jeszcze nie ma.

Odpowiedzi autora z 18 listopada 2026:
- **pytanie 2:** zadanie pg-boss ze zdarzeniem `document.ready`, a odpytywanie jest zapasem;
- **pytanie 3:** wiersz `generated_documents` zostaje na zawsze, pliki DOCX i PDF znikają po 30 dniach (`DELETED`), a ponowne wygenerowanie bierze bieżące dane i aktywną wersję;
- **D5:** naklejka QR to PDF z HTML przez Chromium;
- **D8:** iteracja 7 wprowadza kontener, port i zadanie, a iteracja 8 użyje ich do raportów.

Plansza `wydruki-drukuj` pokazuje, że:
- zawsze powstaje DOCX;
- przy błędzie PDF zostaje DOCX, a komunikat brzmi „Silnik dokumentów nie odpowiedział w [30] s” (`RENDER_TIMEOUT`);
- „Spróbuj ponownie” tworzy nowy wiersz.

Szablon wgrywa operator, więc silnik musi być odcięty od sieci.

Sprawdzone 18 listopada 2026 (Docker Hub, GitHub Releases, kod źródłowy wydania i [dokumentacja 9.x](https://gotenberg.dev/docs)):
- **Linie wydań:**
  - linia 8 skończyła się na 8.40.0 (5 listopada 2026);
  - 9.0.0 wyszła tego samego dnia. Zastąpiła pdfcpu, QPDF i pdftk silnikiem litho, a `soffice` procesem LibreOfficeKit (`lok`). Makra są domyślnie wyłączone;
  - kolejne wydania wychodzą co 1–2 dni: 9.6.0 (16 listopada), 9.7.0 (17 listopada) i 9.8.0 (18 listopada) są za świeże.
- **Najnowsza wersja starsza niż 3 dni** to **9.5.1** (14 listopada 2026):
  - indeks wieloplatformowy `sha256:a0f596c2aeee6391c24ccf2953737971f13976b14d4240525a447f209185e2c8`;
  - obrazy dla `amd64` (VPS) i `arm64` (Mac autora), a także `386`, `arm/v7`, `ppc64le`;
  - około 640 MB po kompresji.
- **Trasy:** `POST /forms/libreoffice/convert` (pole `files`) i `POST /forms/chromium/convert/html` (plik `index.html` i pliki obok, `paperWidth`, `paperHeight`, marginesy, `preferCssPageSize`, `printBackground`). `GET`/`HEAD /health` zwraca stan obu silników (`503`, gdy któryś nie działa) i nie wymaga uwierzytelnienia.
- **Nagłówki:** `Gotenberg-Trace` (identyfikator w logach) i `Gotenberg-Output-Filename`.
- **Limity:**
  - `--api-timeout` (30 s, liczony razem z kolejką; po nim `503`);
  - `--api-body-limit`;
  - `--chromium-max-queue-size` i `--libreoffice-max-queue-size` (po przekroczeniu `429`);
  - `--libreoffice-start-timeout` (20 s).

  Limity pamięci `--libreoffice-max-memory` i `--chromium-max-memory` pojawiły się dopiero w 9.6.0, a w kodzie 9.5.1 ich nie ma.
- **Ruch wychodzący:**
  - `--chromium-deny-private-ips`, `--chromium-deny-public-ips`, `--chromium-deny-list` (domyślnie `^file:(?!//\/tmp/).*`) i `--chromium-disable-javascript`;
  - `--libreoffice-deny-private-ips` i `--libreoffice-deny-public-ips`; według dokumentacji LibreOffice nigdy nie pobiera obrazów ani treści podlinkowanych w dokumencie, tylko arkusze stylów HTML i adresy z makr;
  - `API_DISABLE_DOWNLOAD_FROM`, `WEBHOOK_DISABLE`, `PDF_DISABLE_ROUTES` i `PDF_DISABLE_STAGES`.
- **Obraz:** działa jako użytkownik `gotenberg` (UID 1001), ma `curl` do sprawdzania stanu i czcionki Liberation, Carlito, Caladea, DejaVu i Noto. Nie ma Inter.
- **Inter:** 4.1 (16 listopada 2024, [rsms/inter](https://github.com/rsms/inter)), licencja SIL OFL 1.1, która pozwala dołączyć pliki czcionki do repozytorium z licencją.

## Rozważane opcje

Wariant obrazu:

1. **Dwa obrazy (`-libreoffice` i `-chromium`).** Mniejsze osobno, ale dwa kontenery i dwa adresy, a raporty w iteracji 8 i tak potrzebują Chromium.
2. **Pełny obraz `gotenberg/gotenberg`** z oboma silnikami. Jeden kontener i jeden adres.

Czcionka Inter:

1. **Zamontowany katalog czcionek.** Bez budowania obrazu, ale bez `fc-cache` przy budowie. Ścieżka zależy też od środowiska.
2. **Własny `Dockerfile` na bazie przypiętego obrazu** z czcionkami w repozytorium. Powtarzalne lokalnie i na VPS.

Wywołanie:

1. **Synchronicznie w żądaniu panelu.** Proste, ale żądanie trwa kilka sekund, a przy przekroczeniu limitu czasu operator traci wynik.
2. **Zadanie pg-boss z wierszem `generated_documents`** (pytanie 2). Wynik przetrwa zamknięcie okna i restart API.

## Decyzja

Opcja 2 we wszystkich trzech sprawach.

### Kontener (`infra/`)

- **Obraz:** `infra/gotenberg/Dockerfile`:

  ```dockerfile
  FROM gotenberg/gotenberg:9.5.1@sha256:a0f596c2aeee6391c24ccf2953737971f13976b14d4240525a447f209185e2c8
  USER root
  COPY fonts/inter/ /usr/local/share/fonts/inter/
  RUN fc-cache -f
  USER gotenberg
  ```

  W `infra/gotenberg/fonts/inter/` są statyczne pliki TTF Inter 4.1 z `OFL.txt`: Regular, Italic, Medium, SemiBold i Bold. Skład archiwum wydania sprawdzamy przy kroku 4 planu.
- **Usługa `gotenberg`** w `docker-compose.yml`:
  - `build: ./gotenberg`;
  - port tylko na pętli zwrotnej, `127.0.0.1:${GOTENBERG_PORT:-3010}:3000`, bo API w środowisku deweloperskim działa poza Compose. Na VPS port nie jest publikowany, a API łączy się przez sieć Compose;
  - `mem_limit: 1536m` i `GOMEMLIMIT=1200MiB`, bo 9.5.1 nie ma limitów pamięci silników;
  - healthcheck `curl -fsS http://localhost:3000/health` co 10 s, z `start_period: 30s`.
- **Zmienne środowiskowe** (szablon pochodzi od operatora, a HTML naklejki z kodu API):

| Zmienna | Wartość | Po co |
|---|---|---|
| `API_TIMEOUT` | `30s` | limit żądania razem z kolejką |
| `API_BODY_LIMIT` | `20MB` | DOCX do 5 MB z zapasem na HTML |
| `API_DISABLE_DOWNLOAD_FROM`, `WEBHOOK_DISABLE` | `true` | silnik nie pobiera i nie wysyła niczego na wskazany adres |
| `PDF_DISABLE_ROUTES`, `PDF_DISABLE_STAGES` | `true` | tylko konwersja; iteracja 8 zmieni to, jeśli raport będzie potrzebował etapów |
| `CHROMIUM_DISABLE_JAVASCRIPT` | `true` | HTML naklejki i raportów nie potrzebuje skryptów |
| `CHROMIUM_DENY_PRIVATE_IPS`, `CHROMIUM_DENY_PUBLIC_IPS` | `true` | strona ładuje tylko pliki wysłane razem z nią (`file:///tmp/`) |
| `LIBREOFFICE_DENY_PRIVATE_IPS`, `LIBREOFFICE_DENY_PUBLIC_IPS` | `true` | żadnych żądań z dokumentu, także arkuszy stylów |
| `LIBREOFFICE_AUTO_START`, `CHROMIUM_AUTO_START` | `true` | pierwszy wydruk nie czeka na start silnika, a `/health` mówi prawdę od początku |
| `LIBREOFFICE_MAX_QUEUE_SIZE`, `CHROMIUM_MAX_QUEUE_SIZE` | `10` | przeciążenie daje `429` zamiast serii przekroczeń czasu |

  Makr nie włączamy (`LIBREOFFICE_ENABLE_MACROS` nieustawione), a domyślna lista zakazów Chromium zostaje. Uwierzytelnianie Gotenberga (`API_ENABLE_BASIC_AUTH`) nie jest potrzebne, dopóki silnik słyszy tylko pętlę zwrotną albo sieć wewnętrzną.
- **Aktualizacja wersji:** wydania wychodzą co kilka dni, więc obraz zmieniamy świadomie: nowa wersja starsza niż 3 dni, test integracyjny i wpis w dzienniku. Przejście na 9.6 albo nowszą pozwoli dodać `LIBREOFFICE_MAX_MEMORY` i `CHROMIUM_MAX_MEMORY`.

### Port `DocumentRenderer`

- **Port w `packages/core/src/documents`** ([ADR 0025](0025-logika-biznesowa-packages-core.md)):

  ```ts
  interface DocumentRenderer {
    fillDocx(template: Uint8Array, data: TemplateData): Uint8Array;
    docxToPdf(docx: Uint8Array, opts: { trace: string; fileName: string }): Promise<Uint8Array>;
    htmlToPdf(html: string, opts: { trace: string; fileName: string; assets?: { name: string; bytes: Uint8Array }[] }): Promise<Uint8Array>;
  }
  ```
- **Adaptery w `apps/api`:**
  - `fillDocx` wypełnia DOCX przez docxtemplater ([ADR 0067](0067-szablony-wydrukow-docx.md)), w procesie API;
  - `GotenbergRenderer` dla `docxToPdf` i `htmlToPdf` wysyła `multipart/form-data` przez `fetch` z `AbortSignal.timeout(GOTENBERG_TIMEOUT_MS)` i nagłówkiem `Gotenberg-Trace` równym identyfikatorowi wydruku. HTML naklejki ma `preferCssPageSize=true` i `printBackground=true`;
  - `FakeRenderer` do testów API: DOCX naprawdę z docxtemplater, a PDF to stały, poprawny plik z identyfikatorem w treści.
- **Konfiguracja:**
  - `DOCUMENT_RENDERER=gotenberg|fake` (domyślnie `gotenberg`, w testach `fake`; `fake` przy `NODE_ENV=production` zatrzymuje start, jak `FILE_STORAGE=memory`);
  - `GOTENBERG_URL` (domyślnie `http://localhost:3010`, w `.env.example`);
  - `GOTENBERG_TIMEOUT_MS=30000`.
- **Jeden test integracyjny** uruchamia się tylko przy dostępnym `GOTENBERG_URL`. Zamienia szablon startowy z polskimi znakami na PDF i sprawdza, że PDF ma osadzoną czcionkę Inter.
- **Błędy silnika na kody** (core):

| Sytuacja | Kod | Ponowienie |
|---|---|---|
| przekroczony limit klienta HTTP albo `503` | `RENDER_TIMEOUT` | nie; operator ponawia |
| brak połączenia albo `429` | `RENDERER_UNAVAILABLE` | tak, zadanie do 2 razy z rosnącym odstępem |
| `4xx` (np. uszkodzony dokument) | `RENDER_FAILED` | nie |
| błąd wypełnienia szablonu | `TEMPLATE_RENDER_FAILED` | nie |

### Zadanie `document.generate`

- **Zlecenie:** wiersz `generated_documents` (`QUEUED`) i zadanie powstają w jednej transakcji (`sendInTransaction`, [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)), z kluczem singletonu równym identyfikatorowi wydruku.
- **Obsługa zadania:**
  1. blokuje wiersz i kończy pracę, jeśli stan nie jest `QUEUED`; ustawia `RUNNING` i `started_at`;
  2. buduje dane z katalogu rodzaju dokumentu (ADR 0067);
  3. wypełnia DOCX i zapisuje plik (`GENERATED_DOCUMENT`, klucz `generated-document/{rrrr}/{mm}/{uuid}.docx`). Naklejka nie ma DOCX ([ADR 0068](0068-wydruki-w-procesach.md));
  4. przy formacie PDF zamienia dokument przez `DocumentRenderer` i zapisuje PDF;
  5. ustawia `SUCCEEDED` i `finished_at`, a przy błędzie `FAILED` z `error_code`. DOCX zapisany przed błędem PDF zostaje do pobrania.
- **Parametry kolejki:** `localConcurrency: 2` (zgodnie z kolejką Gotenberga), `expireInSeconds: 120`, `retryLimit: 2` i `retryBackoff` tylko dla `RENDERER_UNAVAILABLE`.
- **„Spróbuj ponownie”** tworzy nowy wiersz z `retry_of`.
- **Zdarzenie `document.ready`** (kontrakt Socket.IO 1.5.0) po stanie końcowym: `{ id, documentType, status, format, errorCode?, files: { docx?, pdf? } }` z adresami z podpisem HMAC na 10 min ([ADR 0057](0057-pliki-zdjecia.md)).
  - Do operatora trafia przez nowy pokój `staff:{staffId}`, do którego gniazdo operatora dołącza przy połączeniu.
  - Do klienta trafia przez pokój `user:{userId}`.
- **Odpytywanie jako zapas:** `GET /admin/documents/{id}` i `GET /me/documents/{id}`. Panel i aplikacja pytają co 2 s i po 30 s pokazują błąd, a zadanie działa dalej.
- **Stan silnika:** `GET /health` w API raportuje `documents: up|down` ze stanu Gotenberga, ale nie zmienia przez to stanu całego API.

### Przechowywanie (pytanie 3)

- **Pliki wydruków** czyta się tylko przez adres z podpisem, wystawiany temu, kto ma dostęp do wydruku (ADR 0068).
- **Zadanie dobowe `documents.retention`** (03:30):
  - usuwa z magazynu DOCX i PDF wydruków starszych niż 30 dni i ustawia `files.status = DELETED`;
  - ustawia `generated_documents.files_deleted_at`; wiersz zostaje.
- **Ponowne wygenerowanie** to nowy wiersz z bieżących danych i aktywnej wersji szablonu.

### Granica z iteracją 8 (D8)

Raporty użyją `htmlToPdf` tego samego portu i tego samego kontenera. ExcelJS dostanie osobny adapter, a `report_runs` własne zadanie. Konfiguracja Gotenberga zmienia się tylko, jeśli raport będzie potrzebował etapów PDF.

## Konsekwencje

Pozytywne:

- Jeden kontener zamienia DOCX i HTML na PDF dla wydruków teraz i raportów później, bez przeglądarki w procesie API.
- Silnik nie sięga do sieci, nie wykonuje skryptów ani makr i ma limit czasu, więc szablon od operatora nie otworzy drogi do usług wewnętrznych.
- Wydruk przetrwa zamknięcie okna i restart API, a operator dostaje wynik przez Socket.IO albo listę Wygenerowane.
- Testy API działają bez kontenera dzięki atrapie, a DOCX powstaje w nich naprawdę.

Negatywne i ryzyka:

- Obraz ma około 640 MB, a z własną warstwą czcionek buduje się przy pierwszym `pnpm infra:up`.
- Linia 9 ma dwa tygodnie i wydania co 1–2 dni. Przypięta wersja może mieć błędy poprawione później, a zmiana wersji wymaga testu integracyjnego.
- 9.5.1 nie ma limitów pamięci silników. Pamięć ogranicza tylko `mem_limit` kontenera, więc uszkodzony dokument może zrestartować cały kontener zamiast jednej konwersji.
- LibreOffice może rozmieścić tekst inaczej niż Word (ryzyko w arc42 §11). Szablony startowe przygotowujemy z Inter i sprawdzamy w PDF.

## Powiązane

[ADR 0029](0029-raporty-pdf-xlsx.md) (realizuje część infrastrukturalną; zmienia: wersja 9.5.1 z własną warstwą czcionek, kształt portu `DocumentRenderer`), [ADR 0030](0030-wydruki-z-szablonow-docx.md), [ADR 0016](0016-zadania-w-tle-pg-boss.md), [ADR 0024](0024-magazyn-plikow-seaweedfs.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0057](0057-pliki-zdjecia.md), [ADR 0067](0067-szablony-wydrukow-docx.md), [ADR 0068](0068-wydruki-w-procesach.md), [kontrakt realtime](../kontrakty/asyncapi-realtime.yaml), arc42 §7 i §11, [plan iteracji 7](../iteracje/iteracja-07-tresci-wydruki.md) (pytania 2 i 3, D5, D8), makieta `wydruki-drukuj`
