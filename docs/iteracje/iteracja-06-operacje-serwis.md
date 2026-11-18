# Iteracja 6: operacje i serwis

**Status:** plan (17 listopada 2026); decyzje autora przyjęte 18 listopada 2026 ([odpowiedzi](#odpowiedzi-autora-18-listopada-2026)); makiety gotowe 18 listopada 2026; ADR 0055–0060 przyjęte 18 listopada 2026; zrealizowana 18 listopada 2026 (bez zielonego CI); Expo Push na atrapie (`PUSH_PROVIDER=fake`) do czasu projektu EAS autora

## Cel
Flota ma obieg serwisowy: klient zgłasza usterkę z aplikacji (kategorie, opis, zdjęcie), system sam zakłada zgłoszenie, gdy hulajnoga długo nie odpowiada albo ma krytyczną baterię, a dyspozytor w panelu przypisuje zgłoszenie i zakłada zadanie serwisowe. Serwisant wykonuje zadanie (naprawa z częściami z magazynu, wymiana baterii, przegląd, przewiezienie), a hulajnoga wraca do floty, gdy nie ma otwartych zadań. Przejazd ma jasne reguły przy utracie łączności i niskiej baterii ([ADR 0042](../adr/0042-wycena-przejazdu.md) zostawił naliczanie przy utracie łączności jako otwartą decyzję). Klient dostaje powiadomienia push z szablonów edytowanych w panelu ([ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md)): koniec rezerwacji, przejazd zakończony z paragonem, nieudana płatność, niska bateria, status zgłoszenia. Operator steruje symulatorem z panelu zamiast pliku `control.json` ([ADR 0039](../adr/0039-symulator-w-trakcie-przejazdu.md)).

Granice z sąsiednimi iteracjami:
- **Iteracja 7:** pełny moduł treści (dokumenty, bloki, FAQ, aktualności, media) i wydruki DOCX/PDF, w tym protokół zadania serwisowego i paragon PDF. W tej iteracji z modułu treści powstają tylko szablony powiadomień.
- **Iteracja 8:** raporty (awaryjność `v_scooter_reliability`, części poniżej stanu, przychody) z eksportem PDF i XLSX; pulpit z wykresami.
- **Poza projektem:** Live Activity na iOS i stałe powiadomienie przejazdu na Androidzie (wymagają kodu natywnego i development build), SMS do klientów poza kodem logowania.

Wymagania uczelni:
- **12:** w panelu `tickets` z `ticket_photos`, `service_tasks` z `service_task_parts`, `spare_parts`, `notification_templates`, `notifications`, `push_tokens` i `files` według [macierzy operacji](../model-danych/README.md#operacje-w-panelu-dla-każdej-tabeli).
- **13:** proces serwisowy (zgłoszenie → zadanie → naprawa albo wymiana baterii → powrót do floty) i proces zgłoszenia klienta ze zmianą statusu widoczną w aplikacji.
- **14:** ekrany zgłoszeń, zadań, magazynu, szablonów powiadomień i symulatora w panelu; zgłoszenie usterki, moje zgłoszenia, zdjęcie parkowania, utrata łączności i niska bateria w aplikacji.
- **17:** treść powiadomień z bazy (szablony ICU MessageFormat edytowane w panelu), bez tekstów na sztywno w API.
- **3c:** reguły zgłoszeń, zadań, powrotu do floty, naliczania przy utracie łączności i progów baterii w `packages/core`.

## Stan wyjściowy
- **Baza (migracje 0001 i 0002):**
  - `tickets` (źródło `USER|AUTO|STAFF`, kategorie jako tablica, status `NEW → IN_PROGRESS → AT_SERVICE → RESOLVED`, pilność, wykonawca), `ticket_photos`, `files` (`PARKING_PHOTO`, `TICKET_PHOTO`), `rentals.parking_photo_id`;
  - `service_tasks` (typy `REPAIR`, `BATTERY_SWAP`, `INSPECTION`, `RELOCATION`, statusy, priorytet, numer z sekwencji, wersja rekordu, jedno otwarte zadanie danego typu na hulajnogę), `spare_parts` ze stanem i minimum, `service_task_parts` z kosztem z chwili użycia;
  - `notifications` (typ, treść jako `jsonb`, czas wysłania), `push_tokens` (token Expo, platforma), `notification_templates` (kod, kanał `PUSH|SMS`, tytuł, treść ICU, wersja);
  - widoki `v_ticket_queue`, `v_scooter_reliability`, `v_low_stock_parts`; uprawnienia `tickets.read|manage`, `service.read|manage`, `simulator.manage`, `content.write`.
- **Braki w schemacie** (do migracji 0008, rozstrzygają ADR-y):
  - zgłoszenie bez notatki rozwiązania i historii zmian statusu (`updated_at` i `version` dodała migracja 0002); brak powiązania z płatnością (reklamacja);
  - `notifications` bez kanału, statusu dostarczenia, odczytu i powiązania z szablonem;
  - stany części nie zmieniają się przy użyciu w zadaniu (brak procedury);
  - brak typu wpisu w księdze dla opłaty za odholowanie (pytanie 7 iteracji 5).
- **API i core:**
  - zdarzenia `CONNECTION_LOST` i `CONNECTION_RESTORED` na osi czasu przejazdu bez wpływu na naliczanie; `BATTERY_LOW` jest w typie zdarzeń, ale nikt go nie zapisuje;
  - statusy floty `MAINTENANCE` i `RETIRED` ustawia tylko formularz hulajnogi w panelu;
  - brak przyjmowania plików (SeaweedFS stoi w `infra/` od iteracji 0, [ADR 0024](../adr/0024-magazyn-plikow-seaweedfs.md)).
- **Symulator:** stan i liczniki na `simulator/status` (retained), sterowanie plikiem `control.json` (`offline`, `silent`, `goto`); bateria tylko spada ([ADR 0034](../adr/0034-symulator-floty.md)).
- **Aplikacja:** ekran jazdy pokazuje komunikat o utracie łączności tylko z osi czasu; `expo-camera` jest już zainstalowane (skan QR), `expo-notifications` nie ma.
- **Długi z poprzednich iteracji:**
  - kolory parkowania i wolnej jazdy w `map-layers.ts` mapy floty są odwrotne niż w makietach stref (iteracja 4);
  - plansza `profil-dane` obiecuje potwierdzenia płatności e-mailem, a D7 iteracji 5 wyklucza e-mail;
  - aktualizacja Next.js 16.4.4 (komunikat o znanej podatności przy co drugim buildzie) czeka na decyzję autora;
  - `disableSPM: true` we wtyczce Stripe w `app.json` do potwierdzenia przy development build.

## Warunek wstępny: decyzje i makiety
Zanim zacznie się implementacja:
- autor odpowiada na pytania i decyzje poniżej;
- brakujące stany dostają makiety w `docs/projekt/ekrany/` według [design systemu](../projekt/design-system.md). Proponowane katalogi: `26-mobile-operacje` i `27-panel-serwis`.

Istniejące makiety, z których korzysta iteracja:

| Obszar | Makiety |
|---|---|
| Aplikacja | `06-mobile-profil/profil-usterka` (zgłoś usterkę), `05-mobile-przejazd/przejazd-zdjecie`, `przejazd-lacznosc`, `przejazd-bateria`, `10-ikona-powiadomienia/powiadomienia` (lista zdarzeń push), `06-mobile-profil/profil-ustawienia` (preferencje powiadomień) |
| Panel | `13-panel/admin-zgloszenia` (tablica zgłoszeń, styl sprzed wzorca listy), `admin-hulajnoga` („Wyślij do serwisu”, „Wyłącz z ruchu”), `admin-symulator`, `admin-pulpit` („Wymaga uwagi”) |
| Techniczne | `15-techniczne/tech-lacznosc` (Last Will, zgłoszenie po 5 min, uzupełnienie trasy z bufora) |

Brakujące makiety (propozycja):
- [x] **Panel: zgłoszenia na wzorcu listy** z szybkimi filtrami statusu, pilności i źródła, panelem bocznym (zdjęcia, przejazd, historia statusów, przypisanie) i szczegółami; `admin-zgloszenia` jako tablica to wariant widoku, jeśli autor go zachowa (D3).
- [x] **Panel: zadania serwisowe** (lista „moje zadania” serwisanta i wszystkie), szczegóły z częściami, rozpoczęcie, zakończenie z notatką i skutkiem dla hulajnogi („wraca do floty” albo „zostaje w serwisie”), anulowanie.
- [x] **Panel: magazyn części** (lista ze stanem, poniżej minimum, przyjęcie dostawy jako korekta stanu z dziennikiem audytu).
- [x] **Panel: karta hulajnogi** z zakładką „Serwis” (zgłoszenia, zadania, przebieg) i oknami „Wyślij do serwisu” i „Wyłącz z ruchu”.
- [x] **Panel: szablony powiadomień** (lista kodów, edytor ICU z podglądem na przykładowych parametrach i błędami składni, wersja i historia zmian).
- [x] **Panel: symulator** w obecnej nawigacji i ze scenariuszami z pytania 10 (wybór hulajnogi z listy, stan scenariusza, liczniki).
- [x] **Panel: zdalne zakończenie poza strefą z opłatą za odholowanie** (wariant `21-panel-przejazdy/przejazd-zakoncz-zdalnie`).
- [x] **Aplikacja: wysłane zgłoszenie i „Moje zgłoszenia”** w profilu ze statusem i odpowiedzią.
- [x] **Aplikacja: zgłoszenie z podsumowania przejazdu i z karty hulajnogi** (hulajnoga podstawiona, bez wyboru).
- [x] **Aplikacja: zdjęcie parkowania** po zakończeniu: podgląd, ponowienie, wysyłanie, błąd wysyłki, brak zgody na aparat (wersja web: wybór pliku).
- [x] **Aplikacja: zgoda na powiadomienia** (prośba przed systemowym oknem) i stan „powiadomienia wyłączone” w ustawieniach.
- [x] **Aplikacja: zakończenie przy hulajnodze offline** według pytania 1 (czekanie na blokadę, zakończenie z ostatnią pozycją).

## Zakres
- [x] **Migracja 0008** (`0008_operations.sql`, testy w `packages/db/src/db.test.ts`):
  - zgłoszenia: notatka rozwiązania, powiązanie z płatnością albo przejazdem przy reklamacji (pytanie 6), historia statusów z dziennika audytu (D6), indeks jednego otwartego zgłoszenia automatycznego danego rodzaju na hulajnogę;
  - zadania: przejścia statusu z warunkami w bazie, zużycie części zmniejszające stan w tej samej transakcji (procedura z blokadą, stan nie spada poniżej zera), zwrot części przy anulowaniu;
  - powrót do floty: funkcja albo procedura sprawdzająca otwarte zadania i baterię (ta sama reguła co w core, test zgodności);
  - powiadomienia: kanał, kod szablonu, status (`QUEUED`, `SENT`, `FAILED`, `SKIPPED`), błąd, czas odczytu; indeks idempotencji (jedno powiadomienie danego rodzaju na zdarzenie);
  - pliki: rozmiar, suma kontrolna, stan przesłania (`PENDING`, `READY`), autor operator albo klient (jest od 0002);
  - księga: typ `TOWING_FEE` albo opłata jako płatność według pytania 7 i ADR;
  - widoki list w panelu: zgłoszenia ze zdjęciami i hulajnogą, zadania z częściami i kosztem, magazyn, powiadomienia, szablony, pliki; widok „Wymaga uwagi” dla pulpitu (D1);
  - luki wykryte przy makietach (18 listopada 2026):
    - numer zgłoszenia dla klienta i panelu z sekwencji (Z-1042), jak `service_task_number_seq`;
    - kategorie `BILLING` („Rozliczenie”, pytanie 6) i „Poza strefą” dla zgłoszeń automatycznych (pytanie 3); rodzaj zgłoszenia automatycznego jako osobna kolumna, bo indeksu częściowego nie da się oprzeć na tablicy kategorii;
    - „Odpowiedź dla klienta” z czasem odpowiedzi i czasem odczytu przez klienta (D7), powiązanie zwrotu ze zgłoszeniem (`refunds.ticket_id`);
    - aktor „system” w dzienniku audytu (`audit_log.staff_id` jest dziś `NOT NULL`), bo oś czasu z D6 musi pokazać zgłoszenia automatyczne, automatyczne `MAINTENANCE` i powrót do floty;
    - przyczyna i czas zmiany stanu hulajnogi (`MAINTENANCE`, `RETIRED`), cel zadania `RELOCATION` (strefa albo punkt), powód anulowania zadania;
    - ruchy magazynowe (przyjęcie, korekta, użycie, zwrot) z datą zamiast odtwarzania historii z dziennika audytu;
    - wersje szablonów powiadomień (tabela wersji albo historia z dziennika audytu, ADR 0058) i rejestr parametrów szablonu w `packages/shared`;
    - pliki: znacznik usunięcia po 30 dniach bez łamania `rentals.parking_photo_id`, kolejność i limit zdjęć zgłoszenia;
    - przejazd: tryb zakończenia bez łączności (zdjęcie wymagane), zdarzenie żądania zakończenia na osi czasu, limit 10 min dla `ENDING` zamiast 10 s;
    - powiadomienia: kod szablonu, cel otwarcia w `payload`, `push_tokens.last_seen_at` i powiązanie z sesją;
    - opłata za odholowanie w paragonie `SALE` przejazdu w tej samej transakcji; przejazd płacony kartą (ADR 0060);
  - dane startowe: części zamienne z wartościami deweloperskimi, szablony powiadomień w języku polskim, kilka zgłoszeń i zadań przykładowych;
  - po migracji `pnpm db:pull` i aktualizacja liczb w teście bazy oraz w [modelu danych](../model-danych/README.md).
- [x] **`packages/core`:**
  - zgłoszenie: walidacja (kategorie, opis, liczba zdjęć), pilność z kategorii (pytanie 4), przejścia statusu, automatyczne zgłoszenia bez duplikatów (pytanie 3);
  - zadania serwisowe: przejścia, wymagany wykonawca, części, skutek dla hulajnogi (pytanie 5);
  - powrót do floty: brak otwartych zadań, bateria co najmniej próg z cennika, hulajnoga online;
  - przejazd przy utracie łączności: naliczanie i zakończenie według pytania 1, zmiana liczników z [ADR 0042](../adr/0042-wycena-przejazdu.md) (nowy ADR, bo zmienia decyzję);
  - niska bateria w trakcie jazdy: progi i komunikat (pytanie 2);
  - powiadomienia: wybór zdarzeń i preferencje klienta (`notify_reservation_end`, `notify_receipts`), renderowanie ICU z parametrami, walidacja szablonu przy zapisie;
  - opłata za odholowanie (pytanie 7).
- [x] **`packages/shared`:** zasoby panelu (`tickets`, `service-tasks`, `spare-parts`, `notification-templates`, `notifications`, `push-tokens`, `files`), schematy zgłoszenia, zadania, przyjęcia części, szablonu, scenariusza symulatora; kontrakt symulatora (MQTT albo REST, D4); zdarzenia Socket.IO zgłoszeń dla panelu i klienta.
- [x] **Kontrakty:** OpenAPI; AsyncAPI Socket.IO (zgłoszenia, zadania, alerty); AsyncAPI MQTT, jeśli zmienia się sterowanie symulatorem albo dochodzi komenda wymiany baterii (pytanie 8). Zrobione: [OpenAPI](../kontrakty/openapi.json) (`pnpm api:openapi`), [Socket.IO 1.4.0](../kontrakty/asyncapi-realtime.yaml), [MQTT 1.3.0](../kontrakty/asyncapi-mqtt.yaml) (`battery_swapped`) i nowy [kontrakt symulatora 1.0.0](../kontrakty/asyncapi-symulator.yaml).
- [x] **API:**
  - **Pliki (ADR 0024):** przesyłanie przez podpisany adres S3 albo przez API (ADR), limit rozmiaru i typu, miniatury nie; dostęp do zdjęć tylko dla właściciela i operatora z uprawnieniem;
  - **Zgłoszenia:** klient (`POST /tickets`, `GET /me/tickets`), panel (lista, szczegóły, przypisanie, zmiana statusu, odpowiedź dla klienta, założenie zadania), zgłoszenia automatyczne z modułu Telemetria (offline, bateria krytyczna);
  - **Serwis:** zadania (lista, „moje”, rozpoczęcie, zużycie części, zakończenie, anulowanie), magazyn (przyjęcie dostawy, korekta stanu), „Wyślij do serwisu” i „Wyłącz z ruchu” z karty hulajnogi; każdy zapis z wpisem w dzienniku audytu;
  - **Przejazd:** reguła utraty łączności, `BATTERY_LOW` na osi czasu z komunikatem, zdjęcie parkowania po zakończeniu (pytanie 9), opłata za odholowanie przy zdalnym zakończeniu poza strefą;
  - **Powiadomienia:** rejestracja tokenu (`POST /me/push-tokens`, usuwanie przy wylogowaniu), wysyłka zadaniem pg-boss przez bramkę za adapterem (Expo Push albo atrapa z logiem, D2), szablony w panelu z podglądem, lista wysłanych powiadomień;
  - **Symulator:** stan, scenariusze i polecenia z panelu (`simulator.manage`, D4).
- [x] **Symulator:** polecenia z panelu zamiast pliku (D4), scenariusze z pytania 10, wymiana baterii po zadaniu `BATTERY_SWAP` (pytanie 8), bufor punktów trasy w czasie braku łączności i wysyłka po powrocie (jest w kontrakcie, do sprawdzenia).
- [x] **Panel:** zgłoszenia, zadania serwisowe, magazyn, karta hulajnogi z zakładką „Serwis”, szablony powiadomień, powiadomienia wysłane, symulator, pulpit z „Wymaga uwagi” (D1), zdalne zakończenie z opłatą za odholowanie; długi z iteracji 4 (kolory warstw mapy floty).
- [x] **Aplikacja:** zgłoś usterkę (z profilu, z podsumowania, z karty hulajnogi), moje zgłoszenia, zdjęcie parkowania, utrata łączności i niska bateria na ekranie jazdy, rejestracja push i preferencje, otwarcie aplikacji z powiadomienia na właściwym ekranie; dług z iteracji 5 (tekst `profil-dane` o e-mailu). Bez wejścia „zgłoś w trakcie jazdy” (D5) i bez sprawdzenia w development build ([dziennik](../dziennik.md#iteracja-6-implementacja-18-listopada-2026)).
- [x] **Dokumentacja:** arc42 §6.6 (utrata łączności z nową regułą naliczania), nowy przebieg procesu serwisowego i powiadomień, §5.2 (moduły Operacje i Powiadomienia), §8 (pliki, powiadomienia), §11 (ryzyka: Expo Push bez urządzenia, pliki w S3); model danych; wymagania uczelni; spis makiet.

## ADR-y do napisania

| Nr | Temat | Co rozstrzyga |
|---|---|---|
| 0055 | Zgłoszenia i proces serwisowy | Statusy zgłoszenia i zadania, zgłoszenia automatyczne bez duplikatów, przejście hulajnogi do `MAINTENANCE` i powrót do floty (reguła w core i w bazie), historia statusów, zużycie części z magazynu w transakcji, reklamacje (pytanie 6), uprawnienia Dyspozytora i Serwisanta. |
| 0056 | Przejazd przy utracie łączności i niskiej baterii | Zmienia [ADR 0042](../adr/0042-wycena-przejazdu.md) w części naliczania: od kiedy i do kiedy liczymy czas bez łączności, czy i jak klient kończy przejazd przy hulajnodze offline (pytanie 1), co robi komenda `lock` po powrocie łączności, progi baterii i zdarzenie `BATTERY_LOW` (pytanie 2). |
| 0057 | Pliki: zdjęcia zgłoszeń i parkowania | Przesyłanie do SeaweedFS przez podpisany adres albo przez API, limity, dostęp, retencja (pytanie 9), wersja web aplikacji bez aparatu. Uzupełnia [ADR 0024](../adr/0024-magazyn-plikow-seaweedfs.md). |
| 0058 | Powiadomienia push z szablonów | Bramka za adapterem (Expo Push API i atrapa, D2), tokeny i ich unieważnianie, zadanie pg-boss z idempotencją, szablony ICU MessageFormat z walidacją i wersją, preferencje klienta, otwarcie aplikacji z powiadomienia, wersja web. |
| 0059 | Symulator sterowany z panelu | Kontrakt poleceń (MQTT `simulator/control` albo REST, D4), scenariusze, bezpieczeństwo (tylko `simulator.manage`, tylko środowisko deweloperskie), stan na `simulator/status`. Zmienia sterowanie plikiem z [ADR 0039](../adr/0039-symulator-w-trakcie-przejazdu.md). |
| 0060 | Opłata za odholowanie | Według pytania 7: kiedy powstaje, jak trafia do księgi albo płatności i paragonu, zadanie `RELOCATION`, uprawnienie. Uzupełnia [ADR 0049](../adr/0049-rozliczenie-przejazdu.md) i [ADR 0053](../adr/0053-wersje-cennika-w-panelu.md). |

## Pytania do autora: wartości biznesowe
Otwarte decyzje z `CLAUDE.md` i nowe pytania tej iteracji. Seed ma wartości deweloperskie, a makiety pokazują nawiasy.

1. **Naliczanie i zakończenie przy utracie łączności** (otwarte od iteracji 3, `przejazd-lacznosc`). Rekomendacja:
   - naliczanie trwa (klient może jechać dalej, hulajnoga działa bez sieci);
   - klient może zakończyć przejazd, gdy ostatnia znana pozycja (nie starsza niż 2 min) jest w strefie parkowania; naliczanie kończy się przy żądaniu, a komenda `lock` czeka na powrót łączności;
   - gdy hulajnoga nie wróci w 10 min, przejazd kończy się automatycznie z końcem naliczania przy żądaniu klienta i zgłoszeniem automatycznym;
   - bez żądania klienta naliczanie zatrzymuje się po 30 min braku łączności (przejazd przechodzi do zakończenia przez operatora).
2. **Niska bateria w trakcie jazdy** (`przejazd-bateria`). Rekomendacja: komunikat przy 15% (minimalna bateria z cennika) z prowadzeniem do strefy; przy 5% hulajnoga zwalnia do 10 km/h (komenda `speed_limit`); push „Niska bateria”, gdy aplikacja jest w tle.
3. **Zgłoszenia automatyczne.** Rekomendacja: hulajnoga offline dłużej niż 5 min (`tech-lacznosc`), bateria poniżej 10% po zakończeniu przejazdu (zadanie `BATTERY_SWAP` od razu), hulajnoga poza strefą parkowania po zdalnym zakończeniu (zadanie `RELOCATION`). Jedno otwarte zgłoszenie danego rodzaju na hulajnogę.
4. **Pilność i wyłączenie z ruchu.** Rekomendacja: hamulce, koło i kierownica są pilne i od razu zmieniają wolną hulajnogę na `MAINTENANCE` (hulajnoga w przejeździe po jego zakończeniu); pozostałe kategorie zostawiają decyzję dyspozytorowi.
5. **Powrót do floty.** Rekomendacja: automatycznie po zakończeniu ostatniego otwartego zadania, gdy hulajnoga jest online i ma baterię co najmniej progu z cennika; inaczej zostaje w `MAINTENANCE` z przyczyną widoczną w panelu.
6. **Reklamacje.** Czy klient zgłasza też problem z opłatą (np. „naliczono za dużo”)? Rekomendacja: tak, kategoria „Rozliczenie” w zgłoszeniu z przejazdu; dyspozytor odpowiada w zgłoszeniu i robi zwrot z okna z iteracji 5 (ADR 0054), a odpowiedź trafia do klienta pushem.
7. **Opłata za odholowanie** (`out_of_zone_fee`, seed 20 zł, pytanie 7 iteracji 5). Zakończenie poza strefą przez klienta jest zablokowane, więc hulajnoga zostaje poza strefą tylko po zdalnym zakończeniu albo zakończeniu przy utracie łączności. Rekomendacja: przy zdalnym zakończeniu poza strefą operator zaznacza „Pobierz opłatę za odholowanie”; opłata obciąża portfel (może dać ujemne saldo) osobnym wpisem i pozycją na paragonie przejazdu, a system zakłada zadanie `RELOCATION`.
8. **Wymiana baterii w symulatorze.** Rekomendacja: zakończenie zadania `BATTERY_SWAP` wysyła do hulajnogi komendę MQTT `battery_swapped` (kontrakt 1.3.0), a symulator ustawia baterię na 100%. Alternatywa: tylko polecenie symulatora z panelu.
9. **Zdjęcie parkowania** (D2 iteracji 3). Rekomendacja: opcjonalne po każdym zakończeniu (przycisk „Pomiń”), wymagane po zakończeniu przy utracie łączności; przechowywane 30 dni, potem usuwane zadaniem, chyba że jest w zgłoszeniu.
10. **Scenariusze symulatora w panelu** (`admin-symulator`). Rekomendacja: rozłączenie i powrót wybranej hulajnogi, milczenie na komendy, rozładowanie do 5% w 30 s, jazda do strefy albo punktu (`goto`), wjazd w strefę zakazu; bez zmiany liczby hulajnóg i tempa w locie (zmiana konfiguracji to restart symulatora). „Wygeneruj 50 przejazdów” odpada, bo przejazdy pokazowe już działają.
11. **Części zamienne i koszty.** Rekomendacja: lista części i ceny w seedzie jako wartości deweloperskie; przyjęcie dostawy zwiększa stan, użycie w zadaniu zmniejsza; koszt części widoczny w zadaniu i w raporcie awaryjności (iteracja 8).
12. **Uprawnienia.** Dziś (migracja 0002): Dyspozytor ma `tickets.read|manage` i `service.read`, ale nie `service.manage`; Serwisant ma `tickets.read|manage` i `service.read|manage`; `simulator.manage` ma tylko Administrator. Rekomendacja: Dyspozytor dostaje `service.manage` (zakłada zadania ze zgłoszenia i przypisuje serwisanta), a symulator zostaje przy Administratorze. Zmiana macierzy ról w migracji 0008.

## Decyzje do potwierdzenia
- **D1. Zakres pulpitu i raportów.** Rekomendacja: w tej iteracji tylko pozycje „Wymaga uwagi” na pulpicie (hulajnogi offline w przejeździe, krytyczna bateria, nowe pilne zgłoszenia, nieudane płatności) z liczbami; wykresy i raporty w iteracji 8.
- **D2. Push w środowisku deweloperskim.** Expo Push wymaga projektu EAS i urządzenia z development build. Rekomendacja: bramka za adapterem jak SMS ([ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md)): atrapa zapisuje powiadomienie i wypisuje je w logu API, a aplikacja w wersji web pokazuje je jako baner w aplikacji (Socket.IO); Expo Push po skonfigurowaniu projektu przez autora.
- **D3. Widok zgłoszeń w panelu.** Makieta `admin-zgloszenia` to tablica kolumn statusów, a reszta panelu używa wzorca listy (ADR 0031). Rekomendacja: lista na wzorcu z szybkimi filtrami statusów jako podstawa (wymaganie 12), tablica jako przełącznik widoku tylko, jeśli zostanie czas.
- **D4. Sterowanie symulatorem.** Rekomendacja: polecenia przez MQTT (`simulator/control`, tylko backend ma prawo publikacji według ACL brokera), API przyjmuje je z panelu z `simulator.manage` i zapisuje w dzienniku audytu; plik `control.json` zostaje dla CLI.
- **D5. Zgłoszenie a przejazd w toku.** Rekomendacja: zgłoszenie w trakcie przejazdu jest możliwe (np. „hamulce”), ale nie kończy przejazdu; aplikacja podpowiada zakończenie w najbliższej strefie.
- **D6. Historia statusów zgłoszenia i zadania.** Rekomendacja: z dziennika audytu i zdarzeń systemowych w jednej osi czasu (jak oś przejazdu), bez osobnej tabeli historii.
- **D7. Odpowiedź dla klienta w zgłoszeniu.** Rekomendacja: jedno pole „Odpowiedź dla klienta” ustawiane przy zmianie statusu i wysyłane pushem; bez czatu.
- **D8. Długi z poprzednich iteracji w tej iteracji:** kolory warstw mapy floty, tekst `profil-dane` o e-mailu. Aktualizacja Next.js i `disableSPM` zostają decyzjami autora poza planem.

## Do rozstrzygnięcia w ADR 0055 i 0058 (z makiet, 18 listopada 2026)
Propozycje z projektowania plansz; ADR 0055 i 0058 przyjmują je wszystkie, a autor zatwierdza je razem z ADR-ami.
- `service.manage` obejmuje zadania i magazyn, więc Dyspozytor dostanie też przyjęcia i korekty stanu części. Propozycja: tak, bez osobnego uprawnienia magazynu (projekt jednoosobowy, mało ról).
- „Wyłącz z ruchu” (`RETIRED`, powód z listy) wymaga `scooters.write`; „Wyślij do serwisu” i „Przywróć do floty” wymagają `service.manage`.
- Serwisant nie ma `rentals.manage` ani `payments.read`, więc nie zrobi zwrotu z reklamacji; reklamacje „Rozliczenie” obsługuje Dyspozytor. Serwisant nie ma `users.read`, więc w listach zgłoszeń widzi „Klient” zamiast imienia i nazwiska.
- Grupy pulpitu wymagają też uprawnienia listy docelowej, nie tylko `dashboard.read`.
- Kod SMS (`login_code`) jako szablon z panelu (wymaganie 17); dziś tekst jest w API.
- Push „Otrzymaliśmy zgłoszenie” (`ticket_received`) jako dodatkowe zdarzenie.

## Odpowiedzi autora (18 listopada 2026)
Autor przyjął wszystkie rekomendacje D1–D8 i odpowiedzi na pytania 1–12. Wartości w seedzie (części, ceny części, opłata za odholowanie 20 zł) zostają deweloperskie; wartości docelowe są w otwartych decyzjach `CLAUDE.md`.

| Pytanie | Odpowiedź |
|---|---|
| 1. Utrata łączności | Naliczanie trwa. Klient kończy przejazd, gdy ostatnia znana pozycja (nie starsza niż 2 min) jest w strefie parkowania; naliczanie kończy się przy żądaniu, a `lock` czeka na powrót łączności. Bez powrotu w 10 min przejazd kończy się automatycznie z końcem naliczania przy żądaniu i zgłoszeniem automatycznym. Bez żądania klienta naliczanie zatrzymuje się po 30 min braku łączności, a przejazd kończy operator. |
| 2. Niska bateria w jeździe | Komunikat przy progu z cennika (15%) z prowadzeniem do strefy; przy 5% `speed_limit` 10 km/h; push „Niska bateria”, gdy aplikacja jest w tle. |
| 3. Zgłoszenia automatyczne | Offline dłużej niż 5 min; bateria poniżej 10% po zakończeniu (od razu zadanie `BATTERY_SWAP`); poza strefą parkowania po zdalnym zakończeniu (zadanie `RELOCATION`). Jedno otwarte zgłoszenie danego rodzaju na hulajnogę. |
| 4. Pilność | Hamulce, koło i kierownica są pilne i od razu przełączają wolną hulajnogę na `MAINTENANCE` (w przejeździe po jego zakończeniu); pozostałe kategorie zostawiają decyzję dyspozytorowi. |
| 5. Powrót do floty | Automatycznie po zakończeniu ostatniego otwartego zadania, gdy hulajnoga jest online i ma baterię co najmniej progu z cennika; inaczej zostaje w `MAINTENANCE` z przyczyną w panelu. |
| 6. Reklamacje | Kategoria „Rozliczenie” w zgłoszeniu z przejazdu; dyspozytor odpowiada w zgłoszeniu i robi zwrot z okna z iteracji 5 (ADR 0054); odpowiedź trafia do klienta pushem. |
| 7. Odholowanie | Przy zdalnym zakończeniu poza strefą operator zaznacza „Pobierz opłatę za odholowanie”; osobny wpis w portfelu (saldo może spaść poniżej zera), pozycja na paragonie przejazdu, zadanie `RELOCATION`. |
| 8. Wymiana baterii | Zakończenie zadania `BATTERY_SWAP` wysyła komendę MQTT `battery_swapped` (kontrakt 1.3.0), a symulator ustawia baterię na 100%. |
| 9. Zdjęcie parkowania | Opcjonalne po każdym zakończeniu („Pomiń”), wymagane po zakończeniu przy utracie łączności; przechowywane 30 dni, potem usuwane zadaniem, chyba że jest w zgłoszeniu. |
| 10. Scenariusze symulatora | Rozłączenie i powrót hulajnogi, milczenie na komendy, rozładowanie do 5% w 30 s, `goto` do strefy albo punktu, wjazd w strefę zakazu; bez zmiany liczby hulajnóg i tempa w locie. |
| 11. Części | Lista i ceny w seedzie jako wartości deweloperskie; przyjęcie dostawy zwiększa stan, użycie w zadaniu zmniejsza; koszt części w zadaniu i w raporcie awaryjności (iteracja 8). |
| 12. Uprawnienia | Dyspozytor dostaje `service.manage` w migracji 0008; `simulator.manage` zostaje tylko przy Administratorze. |

| Decyzja | Rozstrzygnięcie |
|---|---|
| D1 | Pulpit: tylko pozycje „Wymaga uwagi” z liczbami; wykresy i raporty w iteracji 8. |
| D2 | Push za adapterem: atrapa zapisuje powiadomienie i wypisuje je w logu API, wersja web pokazuje baner przez Socket.IO; Expo Push po skonfigurowaniu projektu EAS przez autora. |
| D3 | Zgłoszenia na wzorcu listy z szybkimi filtrami statusów; tablica kolumn tylko, jeśli zostanie czas. |
| D4 | Symulator przez MQTT `simulator/control` (publikuje tylko backend), polecenia z panelu z `simulator.manage` w dzienniku audytu; `control.json` zostaje dla CLI. |
| D5 | Zgłoszenie w trakcie przejazdu nie kończy przejazdu; aplikacja podpowiada zakończenie w najbliższej strefie. |
| D6 | Historia zgłoszenia i zadania z dziennika audytu i zdarzeń systemowych w jednej osi czasu, bez osobnej tabeli. |
| D7 | Jedno pole „Odpowiedź dla klienta” przy zmianie statusu, wysyłane pushem; bez czatu. |
| D8 | W zakresie: kolory warstw mapy floty i tekst `profil-dane` o e-mailu. Aktualizacja Next.js i `disableSPM` zostają decyzjami autora. |

## Poza zakresem (świadomie)
- Wydruki protokołów serwisowych i paragon PDF: iteracja 7.
- Raporty awaryjności, części i przychodów z eksportem, wykresy na pulpicie: iteracja 8.
- Live Activity i stałe powiadomienie przejazdu, SMS do klientów, czat w zgłoszeniu, planowanie tras serwisantów, zamówienia części u dostawców.

## Kolejność kroków
1. ~~Odpowiedzi autora na pytania 1–12 i decyzje D1–D8; aktualizacja tego planu.~~ Zrobione 18 listopada 2026.
2. ~~Makiety brakujących stanów z PNG obejrzanymi przed implementacją i wpisem w [spisie makiet](../projekt/README.md).~~ Zrobione 18 listopada 2026: 22 plansze w `26-mobile-operacje` i `27-panel-serwis`.
3. ~~ADR 0055–0060 zaakceptowane przed kodem~~ Przyjęte 18 listopada 2026 ([spis](../adr/README.md)); przy ADR 0058 sprawdzenie wersji `expo-notifications` (`expo install`) i API Expo Push, przy ADR 0057 klienta S3 (wersja starsza niż 3 dni).
4. ~~Migracja 0008, `pnpm db:pull`, testy bazy: przejścia, zużycie części, powrót do floty, idempotencja powiadomień.~~ Zrobione 18 listopada 2026: 54 tabele, 42 widoki, 21 funkcji, 18 procedur.
5. ~~`packages/core`: zgłoszenia, zadania, powrót do floty, utrata łączności, bateria, powiadomienia, opłata za odholowanie, z testami.~~ Zrobione 18 listopada 2026, razem ze schematami `packages/shared`.
6. ~~API: pliki, zgłoszenia, serwis, zgłoszenia automatyczne z telemetrii, reguły przejazdu; testy API.~~ Zrobione 18 listopada 2026 (moduły Pliki i Operacje).
7. ~~API: powiadomienia z szablonów, symulator z panelu; `pnpm api:openapi`; symulator.~~ Zrobione 18 listopada 2026 (moduły Powiadomienia i Symulator, scenariusze w symulatorze).
8. ~~Panel i aplikacja (równolegle, każdy w swoim katalogu).~~ Zrobione 18 listopada 2026; odstępstwa od makiet w [dzienniku](../dziennik.md#iteracja-6-implementacja-18-listopada-2026).
9. Domknięcie: arc42, model danych, wymagania uczelni, spis makiet, dziennik; scenariusz demo krok po kroku; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; zielone CI. Dokumentacja zrobiona 18 listopada 2026; CI czeka na commit.

## Scenariusz demo
Według faktycznej implementacji (18 listopada 2026). Wymaga:
- infrastruktury (`pnpm infra:up`), migracji i danych startowych (`pnpm db:migrate`, `pnpm db:seed`: części, szablony powiadomień, przykładowe zgłoszenia na #0037–#0040);
- API na 3001 z `PUSH_PROVIDER=fake` (domyślnie; treść powiadomienia w logu API) i `NODE_ENV=development` (wtedy `SIMULATOR_CONTROL_ENABLED` jest domyślnie włączone);
- symulatora (`pnpm --filter @hulajnogi/simulator dev`) i panelu na `WEB_PORT=3002`;
- aplikacji w wersji web z `EXPO_PUBLIC_API_URL=http://localhost:3001`: bez tokenu push powiadomienia pokazuje baner na górze ekranu przez 6 s (`notification.created`).

Wartości z danych startowych: minimalna bateria 15%, opłata za odholowanie 20 zł.

1. **Utrata łączności.** Aplikacja: przejazd hulajnogą #0007; symulator po odblokowaniu jedzie do strefy parkowania. Panel → Analiza → Symulator: hulajnoga #0007, scenariusz „Rozłącz”, „Uruchom dla #0007”. Aplikacja pokazuje „Hulajnoga nie odpowiada” z wiekiem ostatniej pozycji; naliczanie trwa.
2. **Zakończenie bez łączności.** W ciągu 2 min od rozłączenia (pozycja w strefie parkowania): „Zakończ” → „Naliczanie zakończone”, „Blokada czeka na łączność”, „Zrób zdjęcie hulajnogi” (wymagane; w wersji web „Wybierz zdjęcie z pliku”, potem „Wyślij”). Później niż po 2 min zakończenia nie ma („Nie znamy aktualnej pozycji hulajnogi”). Po 5 min w panelu → Serwis → Zgłoszenia pojawia się zgłoszenie automatyczne „Brak łączności”.
3. **Powrót łączności.** Symulator → Aktywne scenariusze → „Przywróć” (przed upływem 10 min): `lock` dochodzi z sesji trwałej, przejazd przechodzi do `ENDED` z kwotą do chwili żądania, trasa uzupełnia się z bufora, a zgłoszenie „Brak łączności” zamyka się samo (oś czasu: „Zamknięte automatycznie”). Bez „Przywróć” po 10 min przejazd kończy się `END_UNCONFIRMED`.
4. **Zgłoszenie klienta.** Aplikacja: podsumowanie → „Zgłoś problem” → „Hamulce”, opis, „Dodaj zdjęcie” → „Wyślij zgłoszenie”. Ekran „Zgłoszenie wysłane” ma numer Z-… i „Hulajnoga #0007 wyłączona z ruchu”; baner „Otrzymaliśmy zgłoszenie” (`ticket_received`). Panel: licznik nowych zgłoszeń w nawigacji, hulajnoga w stanie Serwis z przyczyną.
5. **Zadanie.** Panel (Dyspozytor) → Zgłoszenia → zgłoszenie (szybki filtr „Otwarte”, pilne) → „Przypisz mnie” → „Utwórz zadanie”: rodzaj Naprawa, wykonawca serwisant → „Utwórz zadanie”. Zgłoszenie dostaje „W serwisie”.
6. **Naprawa i powrót do floty.** Panel (Serwisant) → Serwis → Zadania → „Moje zadania” → „Rozpocznij” → „Dodaj część”: „Klocki hamulcowe tylne (para)”, 1 → „Dodaj” (stan w Serwis → Części spada o 1, ruch „Użycie”) → „Zakończ zadanie” z „Notatka z naprawy”; skutek „Hulajnoga #0007 wróci do floty jako dostępna”. Zgłoszenie dostaje „Rozwiązane”, aplikacja baner „Twoje zgłoszenie”, a Profil → Pomoc i zgłoszenia → Moje zgłoszenia pokazuje „nowa odpowiedź”.
7. **Szablon.** Panel → Konfiguracja → Powiadomienia → Szablony → `ride_ended`: zmiana treści, podgląd z parametrami, błąd składni z wierszem i znakiem, „Zapisz jako wersję 2”. Kolejny zakończony przejazd pokazuje nową treść w banerze i w zakładce „Wysłane”; „Historia” → „Przywróć” tworzy wersję 3.
8. **Niska bateria.** Przejazd hulajnogą #0012; Symulator → „Rozładuj do 5% w 30 s” → „Uruchom dla #0012”. Aplikacja: „Niski poziom baterii” z prowadzeniem do strefy (próg 15%), potem „Bateria prawie pusta” (limit 10 km/h). Po zakończeniu (bateria poniżej 10%) powstaje zgłoszenie „Bateria” z zadaniem Wymiana baterii; jego zakończenie wysyła `battery_swapped`, symulator ustawia baterię na 100%, a hulajnoga wraca do floty.
9. **Odholowanie.** Przejazd, w trakcie Symulator → „Jedź do strefy albo punktu” z punktem poza strefą parkowania. Panel → Przejazdy → przejazd → „Zakończ przejazd”, powód → pole „Pobierz opłatę za odholowanie” (zaznaczone) → „Zakończ i pobierz 20,00 zł”. Księga ma wpis `TOWING_FEE`, paragon pozycję „Opłata za odholowanie”, a Serwis zgłoszenie „Poza strefą” z zadaniem Przewiezienie do najbliższej strefy parkowania.
10. **Uprawnienia.** Serwisant nie widzi Przejazdów, Płatności ani Powiadomień i widzi „Klient” zamiast nazwiska; Dyspozytor nie zapisze szablonu (`content.write`) i nie widzi Symulatora (`simulator.manage`).
