# ADR 0055: Zgłoszenia i proces serwisowy

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

Od iteracji 0 baza ma tabele zgłoszeń i serwisu: `tickets`, `ticket_photos`, `service_tasks` z jednym otwartym zadaniem danego typu na hulajnogę, `spare_parts`, `service_task_parts`. Nikt jednak ich nie używa. Stany `MAINTENANCE` i `RETIRED` hulajnogi ustawia tylko formularz floty w panelu.

Iteracja 6 ([plan](../iteracje/iteracja-06-operacje-serwis.md)) zamyka obieg: zgłoszenie od klienta albo z systemu, zadanie serwisowe, części z magazynu i powrót hulajnogi do floty. Autor przyjął rekomendacje (18 listopada 2026):
- **pytanie 3:** zgłoszenia automatyczne przy braku łączności dłuższym niż 5 min, przy baterii poniżej 10% po przejeździe i przy hulajnodze poza strefą po zdalnym zakończeniu; najwyżej jedno otwarte zgłoszenie danego rodzaju;
- **pytanie 4:** hamulce, koło i kierownica to usterki pilne, które wyłączają hulajnogę z ruchu;
- **pytanie 5:** hulajnoga wraca do floty automatycznie po ostatnim zadaniu, jeśli spełnia warunki;
- **pytanie 6:** reklamacje opłat jako kategoria „Rozliczenie”;
- **pytanie 11:** części z magazynem;
- **pytanie 12:** Dyspozytor dostaje `service.manage`;
- **D5:** zgłoszenie w trakcie przejazdu go nie kończy;
- **D6:** historia z dziennika audytu;
- **D7:** jedno pole odpowiedzi dla klienta.

Makiety (`26-mobile-operacje`, `27-panel-serwis`) ujawniły luki w schemacie:
- brak numeru zgłoszenia;
- brak kategorii „Rozliczenie” i „Poza strefą”;
- `audit_log.staff_id NOT NULL`, więc system nie zapisze własnych zmian;
- brak przyczyny stanu hulajnogi, celu przewiezienia i historii ruchów magazynowych.

Do rozstrzygnięcia zostały też uprawnienia: magazyn w `service.manage`, „Wyłącz z ruchu”, reklamacje u Serwisanta.

## Rozważane opcje

Historia zgłoszenia i zadania:

1. **Osobne tabele historii statusów.** Proste zapytania, ale druga kopia tego, co już zapisuje dziennik audytu w tej samej transakcji ([ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md)).
2. **Oś czasu z dziennika audytu i zdarzeń systemowych** (D6). Jedno źródło. Wymaga jednak, żeby dziennik przyjmował wpisy systemu bez operatora.

Jedno otwarte zgłoszenie automatyczne danego rodzaju:

1. **Indeks na tablicy kategorii.** Niemożliwy: indeks częściowy nie wyrazi „kategoria `CONNECTION` jest w tablicy” jako klucza unikalności.
2. **Kolumna `auto_kind`** z indeksem częściowym `(scooter_id, auto_kind) WHERE status <> 'RESOLVED'`. Baza pilnuje reguły, a dwa równoległe zadania w tle nie założą duplikatu.

Ruchy magazynowe:

1. **Stan w `spare_parts` i historia z dziennika audytu.** Bez nowej tabeli, ale historia przyjęć zależy od treści `audit_log.data`, a zużycie z `service_task_parts` nie ma daty.
2. **Tabela ruchów `spare_part_movements`** (przyjęcie, korekta, użycie, zwrot) zapisywana przez procedury razem ze zmianą stanu. Raport awaryjności w iteracji 8 liczy z niej zużycie i koszt w czasie.

## Decyzja

Opcja 2 we wszystkich trzech sprawach. Szczegóły:

### Zgłoszenia

- **Numer:** `tickets.number` z sekwencji `ticket_number_seq`, pokazywany jako `Z-1042` (zadania mają już `S-…`).
- **Kategorie** (`ticket_category`):
  - nowe wartości `BILLING` („Rozliczenie”) i `OUT_OF_ZONE` („Poza strefą”);
  - klient wybiera spośród `BRAKES`, `LIGHTS`, `WHEEL`, `HANDLEBAR`, `QR_CODE`, `BATTERY`, `OTHER`, a `BILLING` tylko przy zgłoszeniu z przejazdu;
  - `CONNECTION` i `OUT_OF_ZONE` są tylko dla zgłoszeń automatycznych i operatora;
  - opis jest wymagany przy `BILLING` i `OTHER`, najwyżej 3 zdjęcia (`ticket_photos.position`).
- **Pilność:** `BRAKES`, `WHEEL` i `HANDLEBAR` ustawiają `urgent`. Reguła jest w core, a baza ją sprawdza (`CHECK`).
- **Statusy:**
  - `NEW` i `IN_PROGRESS` ustawia operator;
  - `AT_SERVICE` ustawia system: przy pierwszym otwartym zadaniu ze zgłoszenia. Po zakończeniu ostatniego zadania zgłoszenie dostaje `RESOLVED`;
  - `RESOLVED` ustawia też operator ręcznie. Zgłoszenie od klienta wymaga wtedy odpowiedzi;
  - `RESOLVED` jest stanem końcowym: nowy problem to nowe zgłoszenie. Reklamacja nieuznana też kończy się `RESOLVED` z odpowiedzią, bez osobnego stanu „odrzucone”.
- **Odpowiedź dla klienta** (D7): `customer_reply`, `customer_reply_at` i `customer_reply_read_at`.
  - Nowa odpowiedź zastępuje poprzednią, a poprzednie zostają w dzienniku audytu.
  - Zapis odpowiedzi wysyła powiadomienie `ticket_status_changed` ([ADR 0058](0058-powiadomienia-push-z-szablonow.md)).
  - Klient widzi tylko statusy i odpowiedź, bez notatek wewnętrznych i nazwisk.
- **Reklamacja:** zgłoszenie nie zwraca pieniędzy. Zwrot robi operator w oknie zwrotu przejazdu ([ADR 0054](0054-zwroty-i-korekty-salda.md)) z `refunds.ticket_id`, a zwrot trafia na oś zgłoszenia.
- **Zgłoszenia automatyczne** (`source = AUTO`, `auto_kind`):
  - **`OFFLINE`:** po utracie łączności (Last Will) zadanie pg-boss `tickets.offline-check` po 5 min, z kluczem singletonu na hulajnogę, sprawdza, czy hulajnoga nadal jest offline. Po powrocie łączności zgłoszenie bez zadania w stanie `NEW` albo `IN_PROGRESS` zamyka się samo z notatką systemu;
  - **`BATTERY_CRITICAL`:** przy `ENDED` z ostatnią baterią poniżej 10%. Od razu powstaje zadanie `BATTERY_SWAP`;
  - **`OUT_OF_ZONE`:** przy zdalnym zakończeniu z ostatnią pozycją poza strefą parkowania ([ADR 0060](0060-oplata-za-odholowanie.md)). Od razu powstaje zadanie `RELOCATION` do najbliższej strefy parkowania;
  - duplikat odrzuca indeks; zadanie w tle traktuje konflikt jako „już jest”.
- **Zgłoszenie w trakcie przejazdu** (D5) zapisuje `rental_id` i nie zmienia przejazdu.

### Zadania serwisowe

- **Przejścia:**
  - `OPEN → IN_PROGRESS` („Rozpocznij” przypisuje nieprzypisane zadanie do operatora);
  - `IN_PROGRESS → DONE` z wymaganą notatką;
  - `OPEN | IN_PROGRESS → CANCELLED` z powodem.

  Reguły są w core, a baza pilnuje warunków (istniejące `CHECK` i wyzwalacz przejść).
- **Utworzenie:** ze zgłoszenia albo z karty hulajnogi („Utwórz zadanie” i „Wyślij do serwisu” to jedno okno). Rodzaj podpowiada kategoria zgłoszenia. Rodzaj już otwarty na hulajnodze jest niedostępny (`service_tasks_one_open_per_type`).
- **`RELOCATION`** ma cel: `target_zone_id` albo `target_point` (SRID 4326).
- **Wymiana baterii:** zakończenie `BATTERY_SWAP` wysyła do hulajnogi komendę `battery_swapped` (kontrakt MQTT 1.3.0, [ADR 0059](0059-symulator-sterowany-z-panelu.md)).

### Stan hulajnogi

- **Kolumny:** `scooters.status_reason` (`URGENT_TICKET`, `SERVICE_TASK`, `BATTERY_BELOW_THRESHOLD`, `OFFLINE`, `THEFT`, `DAMAGE`, `END_OF_LIFE`, `OTHER`) i `status_changed_at`. Panel pokazuje przyczynę przy `MAINTENANCE` i `RETIRED`.
- **Wyłączenie z ruchu** (do `MAINTENANCE`) przy pilnym zgłoszeniu albo otwartym zadaniu:
  - wolna hulajnoga przechodzi od razu;
  - hulajnoga w rezerwacji albo przejeździe przechodzi przy jego zakończeniu. Przejście przejazdu do stanu końcowego sprawdza otwarte pilne zgłoszenia i zadania i wybiera `MAINTENANCE` zamiast `AVAILABLE`. Nie trzeba osobnej flagi „do serwisu”.
- **Powrót do floty** (pytanie 5):
  - core `returnToFleetBlockers({ openTasks, online, batteryPct, minBatteryPct })` zwraca listę przeszkód;
  - funkcja SQL `fn_scooter_return_blockers(scooter_id)` liczy to samo, a test zgodności porównuje obie;
  - przy zakończeniu ostatniego zadania hulajnoga bez przeszkód wraca do `AVAILABLE` w tej samej transakcji. W przeciwnym razie zostaje w `MAINTENANCE` z przyczyną, a okno proponuje zadanie `BATTERY_SWAP`;
  - „Przywróć do floty” na karcie hulajnogi sprawdza tę samą regułę.
- **„Wyłącz z ruchu”** ustawia `RETIRED` z powodem `THEFT`, `DAMAGE`, `END_OF_LIFE` albo `OTHER`. Wymaga `scooters.write` (dziś tylko Administrator). Jest niedostępne w przejeździe i przy otwartych zadaniach.

### Magazyn części

- **Tabela** `spare_part_movements`: rodzaj (`RECEIPT`, `ADJUSTMENT`, `USE`, `RETURN`), zmiana ilości, koszt jednostkowy, zadanie, operator, dokument albo powód, czas.
- **Procedury:** `sp_part_receive`, `sp_part_adjust`, `sp_task_use_part` i `sp_task_return_part` blokują wiersz części (`FOR UPDATE`) i zmieniają `stock_qty` razem z ruchem. `CHECK (stock_qty >= 0)` odrzuca zużycie ponad stan.
- **Zużycie:** stan maleje przy dodaniu części do zadania, nie przy zakończeniu. Usunięcie pozycji albo anulowanie zadania zwraca części ruchem `RETURN`. Koszt w `service_task_parts` to koszt z chwili użycia.
- **Przyjęcie dostawy** może zmienić `unit_cost` dla kolejnych użyć. Korekta stanu wymaga powodu.

### Dziennik audytu i oś czasu

- **Aktor systemu:** `audit_log.staff_id` dopuszcza `NULL`, a nowa kolumna `actor` (`STAFF`, `SYSTEM`) z `CHECK ((actor = 'STAFF') = (staff_id IS NOT NULL))` przyjmuje wpisy systemu. Wpisy systemu to:
  - zgłoszenia automatyczne;
  - automatyczne `MAINTENANCE`;
  - powrót do floty;
  - automatyczne zamknięcie zgłoszenia.
- **Oś czasu zgłoszenia i zadania** to wpisy dziennika audytu dla zgłoszenia, jego zadań i zwrotów oraz wpis o utworzeniu z samego zgłoszenia (klient). Widok `v_ticket_timeline` łączy je w jednej kolejności.

### Uprawnienia (macierz w migracji 0008)

- **Dyspozytor** dostaje `service.manage`, w tym przyjęcia i korekty magazynu. Przy trzech rolach osobne uprawnienie magazynu nie daje korzyści.
- **Serwisant** nie dostaje `rentals.manage` ani `payments.read`, więc reklamacje „Rozliczenie” obsługuje Dyspozytor. Bez `users.read` API zamienia imię i nazwisko klienta na „Klient” w widokach zgłoszeń.
- **Grupy pulpitu „Wymaga uwagi”** wymagają `dashboard.read` i uprawnienia listy docelowej.

## Konsekwencje

Pozytywne:

- Reguły wyłączenia i powrotu do floty są w jednym miejscu (core) z kopią w bazie, sprawdzaną testem zgodności, tak jak reguły stref i płatności.
- Baza wyklucza duplikaty zgłoszeń automatycznych i ujemny stan części także przy równoległych zadaniach w tle.
- Oś czasu z dziennika audytu nie wymaga osobnej historii, a wpisy systemu są odróżnione od działań operatorów.
- Ruchy magazynowe dają raportowi awaryjności (iteracja 8) dane o zużyciu w czasie.

Negatywne i ryzyka:

- Zmiana `audit_log.staff_id` na `NULL` dotyka widoków i ekranu dziennika z iteracji 2: muszą pokazać „System” zamiast operatora.
- Przejście do `MAINTENANCE` przy zakończeniu przejazdu dokłada zapytanie do transakcji `ENDED`, która już obciąża portfel.
- Automatyczne zamknięcie zgłoszenia `OFFLINE` po powrocie łączności może ukryć hulajnogę, która często traci sieć. Raport awaryjności (iteracja 8) liczy więc także zamknięte zgłoszenia.

## Powiązane

[ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0054](0054-zwroty-i-korekty-salda.md), [ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md), [ADR 0057](0057-pliki-zdjecia.md), [ADR 0058](0058-powiadomienia-push-z-szablonow.md), [ADR 0059](0059-symulator-sterowany-z-panelu.md), [ADR 0060](0060-oplata-za-odholowanie.md), [plan iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) (pytania 3–6, 11, 12; D5–D7), makiety `26-mobile-operacje` i `27-panel-serwis`
