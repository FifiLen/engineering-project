# Model danych

PostgreSQL 16 z PostGIS. Źródłem prawdy o schemacie są migracje w [`packages/db/migrations`](../../packages/db/migrations) ([ADR 0021](../adr/0021-migracje-sql-schemat-drizzle-z-bazy.md)):

- `0001_init.sql`: schemat początkowy, 24 tabele. Jego projekt z komentarzami to [`schema.sql`](schema.sql) (wersja 1, sprawdzona na PostgreSQL 16 i PostGIS 3.4).
- `0002_admin_modules.sql`: role i uprawnienia, treści, raporty, wydruki, serwis i paragony oraz widoki, funkcje i procedury ([ADR 0026](../adr/0026-logika-w-bazie-widoki-funkcje-procedury.md)–[0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md)).
- `0003_fleet_lists.sql` (iteracja 1): status floty widoczny dla operatora (`fn_fleet_status`, `fn_low_battery_threshold`), listy floty i modeli w panelu (`v_fleet_list`, `v_scooter_models`), indeksy sortowania po ostatnim sygnale i komend bez potwierdzenia ([ADR 0033](../adr/0033-telemetria-i-status-floty.md)).
- `0004_accounts_access.sql` (iteracja 2): sesje i zaproszenia operatorów (`staff_sessions`, `staff_invitations`), TOTP potwierdzony kodem i blokada po nieudanych logowaniach, blokada klienta z powodem, rodziny tokenów odświeżających, „najważniejsze zmiany” wersji dokumentu, listy ról, klientów, zgód i dziennika audytu, strażnik ostatniego operatora z `roles.manage` ([ADR 0019](../adr/0019-uwierzytelnianie.md), [ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md)).
- `0005_rentals.sql` (iteracja 3): nowe zdarzenia osi czasu (`END_REQUESTED`, `PAUSE_FAILED`, `RESUME_FAILED`, `LOCK_FAILED`, `ENDED_REMOTELY`, `LATE_UNLOCK_LOCKED`), termin ważności i powód odmowy komendy, najwyżej jedna komenda w toku na przejazd, portfel zakładany wyzwalaczem przy rejestracji (i uzupełniony dla istniejących klientów), preferencje powiadomień klienta, saldo różne od 0 blokujące usunięcie konta, widoki przejazdów w panelu, osi czasu, historii i statystyk klienta, trasa przejazdu z telemetrii, czyszczenie sesji i zaproszeń ([ADR 0036](../adr/0036-proces-wypozyczenia-w-api.md)–[0042](../adr/0042-wycena-przejazdu.md)).

- `0006_zones.sql` (iteracja 4): reguły geometrii stref pilnowane wyzwalaczem `zones_rules` (strefa w jedynym aktywnym obszarze działania, strefy parkowania bez części wspólnej, typ niezmienny, obszaru działania nie można wyłączyć), limit tylko w strefie wolnej jazdy, bieżące strefy i stan sterowania hulajnogą w przejeździe (`scooter_zone_presence`, `scooter_zone_control`), komenda `RELEASE_STOP`, jedna oczekująca komenda przejazdu tylko dla `LOCK` i `UNLOCK`, hulajnogi w strefie zakazu i poza obszarem poza mapą klienta, widoki edytora stref i zajętości parkowania, funkcje stref w promieniu, najbliższego parkowania i skutków zmiany strefy, usunięcie tylko nieużytej strefy ([ADR 0043](../adr/0043-wykrywanie-zmian-stref.md), [0044](../adr/0044-komendy-stref-dla-hulajnogi.md), [0047](../adr/0047-edytor-geometrii-w-panelu.md)).

- `0007_payments.sql` (iteracja 5): klient u operatora płatności (`payment_customers`), zwroty (`refunds`), typ wpisu `PAYOUT` i powód korekty w księdze, zapis do księgi z blokadą portfela (`sp_wallet_post`) i wyzwalacz salda po operacji, karta przejazdu, jedna płatność za przejazd w toku, webhooki z wynikiem i liczbą dostarczeń, paragony z rodzajem, korektą, sposobem zapłaty i sprzedawcą, stawka VAT w wersji cennika, wersje cennika nieedytowalne z najwyżej jedną zaplanowaną, stan rozliczenia przejazdu w widoku, listy płatności w panelu i historia portfela ([ADR 0049](../adr/0049-rozliczenie-przejazdu.md)–[0054](../adr/0054-zwroty-i-korekty-salda.md)).

- `0008_operations.sql` (iteracja 6): zgłoszenia z numerem z sekwencji, rodzajem zgłoszenia automatycznego (jedno otwarte danego rodzaju na hulajnogę), odpowiedzią dla klienta z czasem odczytu i pilnością z kategorii; nowe kategorie `BILLING` i `OUT_OF_ZONE`; aktor `SYSTEM` w dzienniku audytu; przyczyna i czas zmiany stanu hulajnogi z wyzwalaczem `MAINTENANCE` po przejeździe; przejścia zadań serwisowych w bazie, cel przewiezienia i powód anulowania; ruchy magazynowe (`spare_part_movements`) przez procedury; powrót do floty (`fn_scooter_return_blockers`); tryb zakończenia przejazdu i opłata za odholowanie (`TOWING_FEE`) w rozliczeniu; stan, SHA-256 i usunięcie pliku bez usuwania wiersza; powiadomienia z kodem szablonu, kanałem, stanem wysyłki i kluczem idempotencji, tokeny push z sesją, wersje szablonów (`notification_template_versions`); komenda `BATTERY_SWAPPED`; `service.manage` dla Dyspozytora; widoki list panelu, oś czasu zgłoszenia i pulpit „Wymaga uwagi” ([ADR 0055](../adr/0055-zgloszenia-i-proces-serwisowy.md)–[0060](../adr/0060-oplata-za-odholowanie.md)).
- `0009_operations_fixes.sql` (iteracja 6, poprawki po przeglądzie): wyzwalacz `scooters_status` dopasowuje przyczynę stanu do nowego stanu, gdy zmiana stanu nie podaje przyczyny (`OTHER` przy wejściu do `MAINTENANCE` albo `RETIRED` z niepasującą przyczyną albo bez niej); `fn_scooter_return_blockers` z przeszkodą `URGENT_TICKET` (otwarte pilne zgłoszenie); unikalne indeksy `rentals_parking_photo_unique` i `ticket_photos_file_unique` (plik przypięty w jednym miejscu) zamiast zwykłych z 0008; `notifications.claimed_at` (przejęcie przed wysyłką); szablony wszystkich kodów z rejestru, żeby baza po samym `db:migrate` wysyłała SMS z kodem logowania.
- `0010_towing_fee_outside_vat.sql` (iteracja 6, [ADR 0061](../adr/0061-oplata-za-odholowanie-jako-kara-umowna.md)): opłata za odholowanie jako kara umowna poza VAT. `receipt_items.vat_rate` dopuszcza `NULL` („nie podlega VAT”, w dokumencie „np.”); `v_receipt_list` liczy `vat_amount` osobno dla każdej stawki (`fn_vat_from_gross` na sumie brutto grupy, pozycje `NULL` bez VAT), a `vat_rate` to stawka pozycji z VAT, gdy jest jedna; `sp_issue_receipt` odrzuca korektę, po której któraś grupa stawek paragonu (sprzedaż plus korekty) byłaby ujemna, także korektę ze stawką spoza paragonu (`RECEIPT_CORRECTION_EXCEEDS`). Paragony sprzed migracji zostają bez zmian.

Po migracji 0008 baza ma **54 tabele** (bez partycji telemetrii i bez schematu `pgboss` kolejki zadań, [ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)), **42 widoki**, **21 funkcji** i **18 procedur**; migracje 0009 i 0010 tych liczb nie zmieniają (zastępują funkcje, procedurę, widok i indeksy, dodają kolumnę, zdejmują `NOT NULL`). Liczby sprawdza test w `packages/db/src/db.test.ts`. Kluczowe zasady opisują też [ADR 0010](../adr/0010-postgresql-postgis-drizzle.md), [ADR 0013](../adr/0013-rezerwacja-jako-stan-przejazdu.md), [ADR 0014](../adr/0014-kwoty-w-groszach-portfel-ksiega.md) i [ADR 0015](../adr/0015-wersjonowany-cennik.md).

## Obszary

| Obszar | Tabele |
|---|---|
| Konta | `users`, `consents`, `otp_codes`, `sessions`, `push_tokens`, `saved_places`, `staff`, `staff_sessions`, `staff_invitations` |
| Role i uprawnienia | `permissions`, `roles`, `role_permissions`, `staff_roles` |
| Przejazdy | `rentals`, `rental_events`, `tariffs` |
| Flota i strefy | `scooters`, `scooter_models`, `telemetry` (partycje dzienne), `scooter_commands`, `zones`, `scooter_zone_presence`, `scooter_zone_control` |
| Płatności | `wallets`, `wallet_ledger`, `payments`, `payment_methods`, `payment_webhook_events`, `receipts`, `receipt_items` |
| Operacje | `tickets`, `ticket_photos`, `files`, `notifications`, `audit_log` |
| Serwis | `service_tasks`, `spare_parts`, `service_task_parts`, `spare_part_movements` (0008) |
| Treści | `content_pages`, `content_page_versions`, `content_blocks`, `faq_items`, `news`, `notification_templates`, `notification_template_versions` (0008), `media_assets` |
| Raporty i wydruki | `report_definitions`, `report_runs`, `document_templates`, `document_template_versions`, `generated_documents` |

Konwencje: identyfikatory `uuid`, kwoty w groszach (`bigint`), czas `timestamptz` w UTC, geometria SRID 4326. Tabele edytowalne w panelu mają kolumnę `version` do blokady optymistycznej ([ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md)); numery wersji biznesowych to `version_no` (dokumenty, szablony) albo `tariffs.version` (cennik).

## Diagram relacji: przejazdy, flota i płatności

```mermaid
erDiagram
    users ||--o{ rentals : "wypożycza"
    users ||--|| wallets : "ma"
    users ||--o{ payments : "płaci"
    users ||--o{ payment_methods : "zapisuje"
    users ||--o{ receipts : "otrzymuje"
    users ||--o{ payment_customers : "klient u operatora"
    users ||--o{ refunds : "otrzymuje zwrot"
    scooter_models ||--o{ scooters : "model"
    scooters ||--o{ rentals : "jest wypożyczana"
    scooters ||--o{ telemetry : "raportuje"
    scooters ||--o{ scooter_commands : "otrzymuje"
    scooters ||--o{ tickets : "dotyczą"
    scooters ||--o{ service_tasks : "serwisowana"
    tickets |o--o{ service_tasks : "prowadzi do"
    service_tasks ||--o{ service_task_parts : "zużywa"
    spare_parts ||--o{ service_task_parts : "pozycja"
    tariffs ||--o{ rentals : "wycenia"
    rentals ||--o{ rental_events : "ma oś czasu"
    rentals ||--o{ payments : "opłacany"
    payment_methods |o--o{ rentals : "karta przejazdu"
    payment_methods |o--o{ payments : "obciążana"
    payments |o--o| receipts : "paragon"
    payments ||--o{ payment_webhook_events : "zdarzenia operatora"
    rentals |o--o{ refunds : "zwrot za przejazd"
    payments |o--o{ refunds : "zwrot u operatora"
    refunds |o--o| receipts : "korekta"
    receipts |o--o{ receipts : "korygowany przez"
    receipts ||--o{ receipt_items : "pozycje"
    wallets ||--o{ wallet_ledger : "księga"
    refunds |o--o{ wallet_ledger : "zwrot i zwrot salda"
    zones |o--o{ rentals : "strefa zakończenia"
```

## Diagram relacji: operacje, serwis i powiadomienia (iteracja 6)

```mermaid
erDiagram
    users ||--o{ tickets : "zgłasza"
    scooters ||--o{ tickets : "dotyczą"
    rentals |o--o{ tickets : "zgłoszenie z przejazdu"
    staff |o--o{ tickets : "przypisany"
    tickets ||--o{ ticket_photos : "zdjęcia (pozycja 1–3)"
    files ||--o{ ticket_photos : "plik"
    files |o--o{ rentals : "zdjęcie parkowania"
    tickets |o--o{ refunds : "zwrot z reklamacji"
    tickets |o--o{ service_tasks : "prowadzi do"
    scooters ||--o{ service_tasks : "serwisowana"
    zones |o--o{ service_tasks : "cel przewiezienia"
    staff |o--o{ service_tasks : "wykonawca, anulował"
    service_tasks ||--o{ service_task_parts : "zużywa"
    spare_parts ||--o{ service_task_parts : "pozycja"
    spare_parts ||--o{ spare_part_movements : "ruchy"
    service_tasks |o--o{ spare_part_movements : "użycie i zwrot"
    staff |o--o{ spare_part_movements : "operator"
    users ||--o{ notifications : "otrzymuje"
    rentals |o--o{ notifications : "dotyczy"
    tickets |o--o{ notifications : "dotyczy"
    notification_templates ||--o{ notification_template_versions : "wersje"
    users ||--o{ push_tokens : "urządzenia"
    sessions |o--o{ push_tokens : "sesja"
    staff |o--o{ audit_log : "autor (NULL dla SYSTEM)"
```

Powiadomienie wskazuje szablon kodem (`template_code`) i wersją z chwili wysyłki, a nie kluczem obcym, bo kody wyznacza rejestr w `packages/shared` ([ADR 0058](../adr/0058-powiadomienia-push-z-szablonow.md)).

## Diagram relacji: panel (uprawnienia, treści, raporty, wydruki)

```mermaid
erDiagram
    staff ||--o{ staff_roles : "ma"
    staff ||--o{ staff_sessions : "loguje się"
    staff ||--o{ staff_invitations : "zaproszony"
    staff ||--o{ audit_log : "autor"
    roles ||--o{ staff_roles : "przypisana"
    roles ||--o{ role_permissions : "nadaje"
    permissions ||--o{ role_permissions : "w roli"
    permissions ||--o{ report_definitions : "wymagane do"
    report_definitions ||--o{ report_runs : "uruchomienia"
    content_pages ||--o{ content_page_versions : "wersje"
    content_page_versions |o--o{ consents : "zaakceptowana"
    files ||--o| media_assets : "plik"
    media_assets |o--o{ content_blocks : "grafika"
    media_assets |o--o{ news : "grafika"
    document_templates ||--o{ document_template_versions : "wersje"
    files ||--o| document_template_versions : "plik DOCX"
    document_template_versions ||--o{ generated_documents : "użyta do"
    files |o--o{ report_runs : "eksport"
```

## Reguły pilnowane przez bazę

- Jeden otwarty przejazd na hulajnogę i na użytkownika (`rentals_one_open_per_scooter`, `rentals_one_open_per_user`).
- Jedno obciążenie portfela za przejazd (`wallet_ledger_one_charge_per_rental`).
- Jedna domyślna metoda płatności na użytkownika.
- Unikalne `idempotency_key` i `provider_payment_id` płatności oraz `provider_event_id` webhooków.
- Usunięte konto nie ma telefonu ani e-maila (`CHECK` w `users`).
- Jedna obowiązująca wersja dokumentu (`content_page_versions_one_published`) i jedna aktywna wersja szablonu wydruku (`document_template_versions_one_active`); jeden szablon domyślny na rodzaj dokumentu.
- Najwyżej jedno otwarte zadanie serwisowe danego rodzaju na hulajnogę (`service_tasks_one_open_per_type`); zadanie w toku ma wykonawcę, zakończone ma datę zakończenia.
- Roli przypisanej operatorom nie da się usunąć (klucz obcy w `staff_roles` bez kaskady).
- Jeśli istnieje konto operatora, co najmniej jeden aktywny operator ma `roles.manage`: odroczone wyzwalacze ograniczeń na `staff`, `staff_roles` i `role_permissions` wywołują `fn_check_role_manager` przy zatwierdzeniu transakcji (błąd `LAST_ROLE_MANAGER`). W jednej transakcji można więc nadać rolę następcy i odebrać własną.
- Zablokowany klient ma datę i powód blokady, a niezablokowany nie ma żadnego z nich (`users_block_consistent`).
- Zastąpiona sesja (klienta i operatora) jest unieważniona (`replaced_by` wymaga `revoked_at`); następca dziedziczy `family_id`, więc ponowne użycie starego tokenu pozwala unieważnić całą rodzinę.
- Operator ma najwyżej jedno otwarte zaproszenie (`staff_invitations_one_open`); TOTP potwierdzony wymaga zapisanego sekretu.
- Zgoda na tę samą wersję dokumentu jest zapisana najwyżej raz (`consents_one_active_per_version`); dla dokumentów z modułu treści `document_version` to numer wersji, a `page_version_id` wskazuje wersję.
- Raport zakończony sukcesem ma plik, a zakończony błędem ma opis błędu (`report_runs`, `generated_documents`).
- Strefy (0006): każda aktywna strefa leży w jedynym aktywnym obszarze działania (`zones_one_active_service_area`, wyzwalacz `zones_rules`), aktywne strefy parkowania nie mają części wspólnej, typ strefy się nie zmienia, limit prędkości ma tylko strefa wolnej jazdy (`zones_speed_limit_only_slow`), a strefę użytą w przejazdach można tylko dezaktywować (`sp_delete_zone`).
- Komenda w toku blokująca kolejną komendę przejazdu to tylko `LOCK` albo `UNLOCK` (`scooter_commands_one_pending_per_rental` od 0006); komendy stref (`SPEED_LIMIT`, `STOP_GRADUALLY`, `RELEASE_STOP`) mają `rental_id`, ale nie blokują pauzy ani zakończenia.
- Plik ma najwyżej jednego autora: klienta albo operatora (`files_one_uploader`).
- Płatności (0007):
  - księga tylko do dopisywania, a saldo po operacji to poprzednie saldo z księgi plus kwota (wyzwalacz `wallet_ledger_rules`: `LEDGER_APPEND_ONLY`, `LEDGER_BALANCE_MISMATCH`); jedno uznanie za doładowanie (`wallet_ledger_one_topup_per_payment`) i jeden wpis zwrotu salda z odwróceniem na zwrot (`wallet_ledger_one_entry_per_refund`);
  - jedna płatność za przejazd w toku (`payments_one_pending_per_rental`); przejazd kartą ma kartę (`rentals_card_source_method`);
  - suma zwrotów nie większa niż zapłacona kwota przejazdu albo doładowania (`sp_record_refund` z blokadą: `REFUND_EXCEEDS_PAYMENT`); zwrot z powodem „inny” ma notatkę, zwrot salda nie ma przejazdu;
  - jeden paragon sprzedaży za przejazd (`receipts_one_sale_per_rental`); korekta ma kwotę ujemną i paragon korygowany, a suma paragonu i korekt nie jest ujemna (`sp_issue_receipt`: `RECEIPT_CORRECTION_EXCEEDS`); od 0010 także w każdej grupie stawek VAT, a stawka `NULL` pozycji znaczy „nie podlega VAT”;
  - wersji cennika nie zmienia się, a zaplanowana może być najwyżej jedna i dopóki jest, nie powstaje nowa (wyzwalacz `tariffs_rules`: `TARIFF_IMMUTABLE`, `TARIFF_ALREADY_SCHEDULED`); zakresy rezerwacji, wieku, salda i VAT w `CHECK`.
- Operacje i serwis (0008):
  - najwyżej jedno otwarte zgłoszenie automatyczne danego rodzaju na hulajnogę (`tickets_one_open_auto_per_scooter`); `RESOLVED` jest stanem końcowym, a data rozwiązania ustawia się sama (wyzwalacz `tickets_rules`: `INVALID_TICKET_TRANSITION`);
  - pilność wynika z kategorii (hamulce, koło, kierownica); zgłoszenie automatyczne ma rodzaj i jego kategorię; klient nie zgłasza łączności ani „poza strefą”; reklamacja `BILLING` ma przejazd; odpowiedź dla klienta ma czas, a odczyt wymaga odpowiedzi (`CHECK` w `tickets`); zdjęcia zgłoszenia na pozycjach 1–3;
  - przyczyna stanu hulajnogi pasuje do stanu (`MAINTENANCE` albo `RETIRED`); koniec rezerwacji albo przejazdu przy otwartym pilnym zgłoszeniu albo zadaniu daje `MAINTENANCE` z przyczyną i wpisem systemu w dzienniku audytu (wyzwalacz `scooters_status`); od 0009 zmiana stanu bez jawnej przyczyny dostaje przyczynę zgodną z nowym stanem (`OTHER` albo `NULL` poza serwisem), a jawna niezgodna przyczyna daje `VALIDATION_FAILED` (`scooters_status_reason_matches`);
  - przejścia zadań serwisowych `OPEN → IN_PROGRESS → DONE`, `OPEN | IN_PROGRESS → CANCELLED`, notatka przy zakończeniu i powód przy anulowaniu (wyzwalacz `service_tasks_rules`: `INVALID_TASK_TRANSITION`, `TASK_RESULT_NOTE_REQUIRED`, `TASK_CANCEL_REASON_REQUIRED`); anulowanie zwraca części do magazynu (wyzwalacz `service_tasks_cancel_parts`);
  - stan części zmienia się tylko razem z ruchem w procedurze z blokadą wiersza i nie spada poniżej zera (`PART_OUT_OF_STOCK`); ruchy magazynowe tylko do dopisywania (wyzwalacz `spare_part_movements_append_only`);
  - wpis dziennika audytu ma operatora wtedy i tylko wtedy, gdy aktorem jest `STAFF` (`audit_log_actor_staff`);
  - tryb zakończenia tylko w `ENDING`, `ENDED` i `UNPAID`, opłata za odholowanie tylko przy zdalnym zakończeniu; najwyżej jeden wpis obciążenia danego typu na przejazd (`wallet_ledger_one_fee_per_rental`: `RIDE_CHARGE`, `TOWING_FEE`);
  - plik usunięty ma czas usunięcia (`files_deleted_at`), suma kontrolna to 64 znaki szesnastkowe; od 0009 plik jest zdjęciem parkowania najwyżej jednego przejazdu (`rentals_parking_photo_unique`) i zdjęciem najwyżej jednego zgłoszenia (`ticket_photos_file_unique`), naruszenie daje `FILE_ALREADY_ATTACHED`;
  - jedno powiadomienie na klucz idempotencji (`dedupe_key` unikalny); od 0009 wysyłka przejmuje wiersz `QUEUED` przez `claimed_at` (ponowne przejęcie po 5 min), więc zadanie i `notifications.sweep` nie wyślą go dwa razy; `SENT` wymaga czasu wysłania, `FAILED` błędu; długość szablonu: tytuł 50, push 240, SMS 160 znaków; zmiana treści szablonu zapisuje wersję (wyzwalacz `notification_templates_version`).

## Widoki, funkcje i procedury

Podział pracy między bazą a `packages/core` opisuje [ADR 0026](../adr/0026-logika-w-bazie-widoki-funkcje-procedury.md): baza odczytuje, liczy na danych i wykonuje operacje na zbiorach wierszy, decyzje biznesowe podejmuje core.

| Widok | Zastosowanie |
|---|---|
| `v_fleet_status` | lista floty: model, bieżący przejazd, strefa parkowania, otwarte zgłoszenia i zadania, przejazdy z 30 dni |
| `v_rental_details` | lista i szczegóły przejazdów z użytkownikiem, hulajnogą, wersją cennika, strefą i płatnością; od 0005 także czas od odblokowania, flaga problemu (nieudane odblokowanie, hulajnoga offline, niepotwierdzona komenda) i komenda w toku; od 0008 tryb zakończenia, opłata za odholowanie, zdjęcie parkowania (wymagane, usunięte), zatrzymanie naliczania i ruch po zakończeniu |
| `v_rental_timeline` | oś czasu przejazdu: zdarzenia i komendy z wynikiem w jednej kolejności (panel, szczegóły) |
| `v_user_rental_history` | historia przejazdów klienta w aplikacji (tylko przejazdy, które się odbyły) |
| `v_user_ride_stats` | statystyki profilu: liczba przejazdów, dystans, czas w drodze |
| `v_wallet_balances` | saldo z pamięci podręcznej porównane z księgą (`out_of_sync`) |
| `v_daily_revenue` | raport przychodów: przejazdy, doładowania i zwroty według dnia (Europe/Warsaw) |
| `v_ticket_queue` | kolejka otwartych zgłoszeń z ostatnim zadaniem serwisowym |
| `v_staff_permissions` | uprawnienia aktywnych operatorów jako suma ról |
| `v_staff_overview` | lista operatorów z rolami, statusem (aktywny, zaproszony, dezaktywowany), ostatnim logowaniem, liczbą sesji i zaproszeniem; bez skrótu hasła i sekretu TOTP |
| `v_zone_usage` | raport przejazdów zakończonych w strefach według dnia |
| `v_scooter_reliability` | raport awaryjności: zgłoszenia, zadania, średni czas naprawy, koszt części |
| `v_user_activity` | lista klientów i raport użytkowników: przejazdy, wydatki, saldo, blokada, aktywne sesje, ostatnia aktywność |
| `v_current_documents` | obowiązujące wersje regulaminu i innych dokumentów |
| `v_published_news` | aktualności w okresie publikacji |
| `v_low_stock_parts` | części poniżej stanu minimalnego |
| `v_fleet_list` | lista floty i mapa w panelu: `v_fleet_status` ze statusem floty, współrzędnymi, zasięgiem modelu i wersją rekordu; od 0008 z przyczyną i czasem zmiany stanu |
| `v_scooter_models` | lista modeli z liczbą hulajnóg (wszystkich i nie wycofanych) |
| `v_roles_overview` | lista ról z liczbą uprawnień i aktywnych operatorów |
| `v_user_consents` | ostatnia zgoda klienta każdego rodzaju i to, czy dotyczy obowiązującej wersji dokumentu |
| `v_audit_log` | dziennik audytu z nazwą i e-mailem operatora; od 0008 z aktorem (`STAFF`, `SYSTEM`) |
| `v_zone_list` | lista stref w edytorze panelu: powierzchnia, liczba punktów, hulajnogi i przejazdy w strefie, użycie w przejazdach, autor zmiany (0006) |
| `v_parking_occupancy` | zajętość aktywnych stref parkowania względem pojemności (0006) |
| `v_payment_list` | płatności u operatora w panelu: klient, cel, metoda i karta, przejazd, suma zwrotów, paragon, liczba webhooków (0007) |
| `v_wallet_ledger` | księga w panelu i historia portfela w aplikacji: przejazd, płatność, karta, powód, operator korekty, paragon (0007); od 0008 paragon także przy `TOWING_FEE` |
| `v_receipt_list` | paragony i korekty z VAT i netto (`fn_vat_from_gross`), przejazdem, kartą i dokumentem korygowanym (0007); od 0010 VAT liczony grupami stawek, pozycje bez stawki poza VAT, `vat_rate` tylko przy jednej stawce |
| `v_tariff_versions` | wersje cennika ze stanem z `valid_from` (obowiązuje, zaplanowana, archiwalna), końcem obowiązywania, autorem i liczbą przejazdów (0007) |
| `v_payment_methods` | karty klientów ze stanem ważności (aktywna, wygasa, wygasła, usunięta) (0007) |
| `v_payment_webhook_events` | webhooki operatora z wynikiem przetworzenia, liczbą dostarczeń i płatnością (0007) |
| `v_refund_list` | zwroty za przejazdy i zwroty salda z operatorem, stanem u operatora i korektą paragonu (0007) |
| `v_unpaid_rentals` | zaległości klientów: przejazdy `UNPAID` z kwotą, kartą, ostatnią odmową i liczbą prób (0007) |
| `v_ticket_list` | zgłoszenia w panelu: hulajnoga, zgłaszający, przypisany, zdjęcia, otwarte i ostatnie zadanie, suma zwrotów, odpowiedź dla klienta (0008) |
| `v_ticket_timeline` | oś czasu zgłoszenia (D6): utworzenie, wpisy dziennika audytu zgłoszenia i jego zadań (także systemu), zwroty i powiadomienia w jednej kolejności (0008) |
| `v_service_task_list` | zadania serwisowe: hulajnoga, wykonawca, autor, zgłoszenie, cel przewiezienia, termin, liczba i koszt części (0008) |
| `v_service_task_parts` | części w zadaniu z kosztem z chwili użycia i bieżącym stanem magazynu (0008) |
| `v_spare_part_list` | magazyn: stan względem minimum (`<`), zużycie z 30 dni i ostatni ruch (0008) |
| `v_spare_part_movements` | ruchy magazynowe z częścią, zadaniem, hulajnogą i operatorem (0008) |
| `v_notification_templates` | szablony powiadomień z autorem zmiany, liczbą wersji, ostatnią wysyłką i liczbą wysłanych z 30 dni (0008) |
| `v_notification_template_versions` | wersje szablonu do historii i przywrócenia w edytorze (0008) |
| `v_notification_list` | wysłane powiadomienia ze stanem, błędem, klientem, przejazdem i zgłoszeniem (0008) |
| `v_push_tokens` | tokeny push z klientem i stanem sesji (0008) |
| `v_file_list` | pliki z autorem, stanem i miejscem użycia (przejazd albo zgłoszenie) (0008) |

| Funkcja | Wynik |
|---|---|
| `fn_zones_at_point(lon, lat)` | aktywne strefy w punkcie, od najbardziej restrykcyjnej |
| `fn_nearest_scooters(lon, lat, radius_m, limit, min_battery)` | dostępne hulajnogi w promieniu, od najbliższej; próg baterii przekazuje core |
| `fn_wallet_balance(user_id)` | saldo jako suma księgi |
| `fn_staff_has_permission(staff_id, code)` | czy operator ma uprawnienie |
| `fn_rental_distance_m(rental_id)` | długość trasy z telemetrii w metrach |
| `fn_rental_route(rental_id)` | trasa przejazdu z telemetrii (`LineString`), zapisywana w `rentals.route` przy zakończeniu |
| `fn_content_revision()` | licznik zmian treści (ETag) |
| `fn_low_battery_threshold()` | próg niskiej baterii: minimalna bateria do wypożyczenia z obowiązującej wersji cennika |
| `fn_fleet_status(status, online, battery_pct, threshold)` | status floty dla operatora; ta sama reguła co `deriveFleetStatus` w `packages/core` (zgodność sprawdza test bazy) |
| `fn_user_pending_documents(user_id)` | obowiązujące dokumenty ze zgodą, których aktualnej wersji klient nie zaakceptował (z „najważniejszymi zmianami”) |
| `fn_check_role_manager()` | funkcja wyzwalacza: odrzuca zmianę, po której żaden aktywny operator nie ma `roles.manage` |
| `fn_zones_near_point(lon, lat, radius_m)` | aktywne strefy w promieniu z flagą „punkt w strefie” (histereza wyjazdu, 0006) |
| `fn_nearest_parking(lon, lat)` | najbliższa aktywna strefa parkowania: odległość do granicy, punkt na granicy (cel prowadzenia) i punkt wewnątrz (0006) |
| `fn_zone_change_impact(zone_id, geom)` | przejazdy w trakcie w strefie albo w proponowanej geometrii (ostrzeżenie przed zapisem w panelu, 0006) |
| `fn_scooter_can_ride(position)` | pozycja w obszarze działania i poza strefą zakazu; ta sama reguła co `canRide` w core (0006) |
| `fn_rental_paid_amount(rental_id)` | zapłacona kwota przejazdu: obciążenie portfela albo udana płatność kartą (0007) |
| `fn_rental_settlement(rental_id)` | stan rozliczenia: `NONE`, `WALLET_PAID`, `CARD_PENDING`, `CARD_PAID`, `FAILED` (0007, ADR 0049) |
| `fn_vat_from_gross(gross, rate)` | VAT „w stu” od brutto z zaokrągleniem połowy w górę; ta sama reguła co `vatFromGross` w core (0007, ADR 0052) |
| `fn_scooter_service_hold(scooter_id)` | powód zatrzymania w serwisie: `URGENT_TICKET`, `SERVICE_TASK` albo `NULL` (0008, ADR 0055) |
| `fn_scooter_return_blockers(scooter_id)` | przeszkody powrotu do floty: `URGENT_TICKET` (od 0009), `OPEN_TASKS`, `OFFLINE`, `BATTERY_BELOW_THRESHOLD`; ta sama reguła co `returnToFleetBlockers` w core (0008, test zgodności) |
| `fn_dashboard_attention(critical_battery_pct)` | liczby pulpitu „Wymaga uwagi”: offline w przejeździe, zatrzymane naliczanie, krytyczna bateria, nowe pilne zgłoszenia bez przypisania, nieudane płatności z dziś, zaległości (0008, D1) |

Od 0008 `fn_rental_paid_amount` i `fn_rental_settlement` liczą też wpis `TOWING_FEE`, więc limit zwrotu w `sp_record_refund` obejmuje opłatę za odholowanie.

| Procedura | Działanie | Uruchamia |
|---|---|---|
| `sp_expire_reservations(OUT expired_count)` | `RESERVED → EXPIRED`, zdarzenie na osi czasu, zwolnienie hulajnogi | narzędzie bazy; aplikacja wygasza rezerwacje zadaniem pg-boss przez repozytorium, żeby klient i panel dostali zdarzenie ([ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)) |
| `sp_anonymize_user(user_id)` | usunięcie danych osobowych; odmowa przy otwartym przejeździe i (od 0005) przy saldzie różnym od 0 | `DELETE /me` w aplikacji, panel |
| `sp_ensure_telemetry_partitions(from, days, OUT created_count)` | dzienne partycje telemetrii (UTC) z przeniesieniem wierszy z partycji domyślnej | moduł Telemetria przy starcie API i zadanie cykliczne pg-boss `telemetry.partitions` (7 dni naprzód) |
| `sp_purge_telemetry(keep_days, OUT dropped_count)` | retencja telemetrii | zadanie cykliczne pg-boss |
| `sp_purge_expired_otp(OUT deleted_count)` | usunięcie przeterminowanych kodów SMS | zadanie cykliczne pg-boss `auth.purge` |
| `sp_purge_expired_sessions(keep_days, OUT deleted_count)` | usunięcie całych rodzin sesji klientów i operatorów bez ważnego tokenu oraz nieprzyjętych zaproszeń, wygasłych dawniej niż `keep_days` | zadanie cykliczne pg-boss `auth.purge` (30 dni) |
| `sp_rebuild_wallet_balances(OUT fixed_count)` | naprawa pamięci podręcznej salda według księgi | panel, w razie rozjazdu |
| `sp_revoke_user_sessions(user_id, OUT revoked_count)` | wylogowanie klienta ze wszystkich urządzeń | blokada konta, panel |
| `sp_revoke_staff_sessions(staff_id, OUT revoked_count)` | wylogowanie operatora ze wszystkich urządzeń | dezaktywacja, zmiana e-maila, reset TOTP |
| `sp_delete_zone(zone_id)` | usunięcie strefy bez przejazdów, zdarzeń i hulajnóg w przejeździe; inaczej `ZONE_IN_USE` (0006) | edytor stref w panelu |
| `sp_wallet_post(user_id, type, amount, rental_id, payment_id, refund_id, staff_id, reason, note, OUT entry_id, OUT balance_after)` | wpis w księdze z blokadą portfela, saldo po operacji z księgi, pamięć podręczna salda (0007) | rozliczenie przejazdu, doładowanie po webhooku, spłata, zwrot, korekta, zwrot salda |
| `sp_record_refund(user_id, rental_id, payment_id, source, amount, reason, note, staff_id, status, OUT refund_id)` | zwrot z blokadą przejazdu albo płatności; suma zwrotów nie większa niż zapłata (0007) | zwrot za przejazd i zwrot salda w panelu |
| `sp_issue_receipt(user_id, kind, rental_id, payment_id, refund_id, corrects_receipt_id, payment_source, seller, items, OUT receipt_id, OUT receipt_number)` | paragon albo korekta z pozycjami, nabywca z chwili wystawienia, numer z sekwencji (0007) | rozliczenie przejazdu, spłata, udany zwrot |
| `sp_delete_scheduled_tariff(tariff_id)` | usunięcie zaplanowanej wersji cennika przed jej datą, gdy żaden przejazd jej nie wskazuje (0007) | „Cennik i zasady” w panelu |
| `sp_part_receive(part_id, quantity, unit_cost, document, staff_id, OUT movement_id, OUT stock_after)` | przyjęcie dostawy z blokadą części, opcjonalna nowa cena dla kolejnych użyć, ruch `RECEIPT` (0008) | „Przyjęcie dostawy” w magazynie, dane startowe |
| `sp_part_adjust(part_id, new_quantity, reason, note, staff_id, OUT movement_id, OUT stock_after)` | korekta do stanu bezwzględnego z powodem, ruch `ADJUSTMENT`; bez zmiany `PART_ADJUST_NO_CHANGE` (0008) | „Korekta stanu” w magazynie |
| `sp_task_use_part(task_id, part_id, quantity, staff_id, OUT line_quantity, OUT stock_after)` | użycie części w zadaniu w toku z kosztem z chwili użycia, ruch `USE`; `TASK_NOT_IN_PROGRESS`, `PART_INACTIVE`, `PART_OUT_OF_STOCK` (0008) | „Dodaj część” w zadaniu |
| `sp_task_return_part(task_id, part_id, quantity, staff_id, OUT line_quantity, OUT stock_after)` | zwrot części z zadania (całej pozycji przy `NULL`), ruch `RETURN`; `PART_RETURN_EXCEEDS`, `TASK_PART_NOT_FOUND` (0008) | usunięcie pozycji z zadania |

Wyzwalacz `trg_zone_rules` (0006) pilnuje reguł geometrii stref przy każdym zapisie. Wyzwalacz `trg_content_revision` zwiększa licznik `content_revision_seq` przy każdej zmianie w tabelach treści. Wyzwalacz `trg_user_wallet` (0005) zakłada portfel z saldem 0 przy każdym nowym kliencie. Wyzwalacze `trg_wallet_ledger_rules` i `trg_tariff_rules` (0007) pilnują księgi i wersji cennika. Od 0008: `trg_ticket_rules` (stan końcowy zgłoszenia), `trg_scooter_status` (czas zmiany, przyczyna, `MAINTENANCE` po przejeździe z wpisem systemu; od 0009 przyczyna zgodna z nowym stanem przy zmianie stanu bez przyczyny), `trg_service_task_rules` i `trg_service_task_cancel_parts` (przejścia zadań, zwrot części), `trg_spare_part_movements_append_only` i `trg_notification_template_version` (wersja szablonu przy zmianie treści).

## Operacje w panelu dla każdej tabeli

Realizacja wymagania 12 według [ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md). Każda tabela ma w panelu listę z filtrowaniem, sortowaniem i stronicowaniem oraz widok szczegółów; kolumny poniżej mówią, jak działa dodawanie, edycja i usuwanie. Uprawnienia: [ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md).

| Tabela | Klasa | Źródło listy | Dodaj | Edytuj | Usuń | Uprawnienia |
|---|---|---|---|---|---|---|
| `users` | encja | `v_user_activity` | rejestracja w aplikacji | dane, blokada i odblokowanie | anonimizacja (`sp_anonymize_user`) | `users.read`, `users.manage` |
| `consents` | proces | `consents` | akceptacja w aplikacji | wycofanie zgody | nie | `users.read` |
| `otp_codes` | techniczna | `otp_codes` (bez skrótu kodu) | nie | nie | `sp_purge_expired_otp` | `users.manage` |
| `sessions` | techniczna | `sessions` (bez skrótu tokenu) | nie | nie | unieważnienie | `users.manage` |
| `staff_sessions` | techniczna | sesje w karcie operatora (bez skrótu tokenu) | logowanie | nie | unieważnienie | `staff.manage` |
| `staff_invitations` | proces | zaproszenie w karcie operatora | zaproszenie | ponowne wysłanie (nowy wiersz) | unieważnienie | `staff.manage` |
| `push_tokens` | techniczna | `v_push_tokens` (od iteracji 6) | z aplikacji (`POST /me/push-tokens`) | nie | wylogowanie, `DeviceNotRegistered` (system) | `users.read` |
| `saved_places` | encja klienta | `saved_places` | w aplikacji | w aplikacji | tak | `users.read`, `users.manage` |
| `staff` | encja | `v_staff_overview` | zaproszenie | dane, role, reset TOTP | dezaktywacja | `staff.read`, `staff.manage` |
| `permissions` | słownik z kodu | `permissions` | z katalogu w core | opis | nie | `roles.manage` |
| `roles` | słownik | `roles` | tak | tak | tak, jeśli nieprzypisana i nie systemowa | `roles.manage` |
| `role_permissions` | słownik | macierz w edycji roli | tak | — | tak | `roles.manage` |
| `staff_roles` | encja | edycja operatora | tak | — | tak | `staff.manage` |
| `tariffs` | wersjonowana | `v_tariff_versions` (od iteracji 5) | nowa wersja od teraz albo od daty | nie (nowa wersja) | tylko zaplanowana i nieużyta (`sp_delete_scheduled_tariff`) | `tariffs.read`, `tariffs.write` |
| `rentals` | proces | `v_rental_details` | przez proces wypożyczenia | polecenia: zakończenie zdalne, zwrot | nie | `rentals.read`, `rentals.manage` |
| `rental_events` | tylko do dopisywania | `rental_events` | system | nie | nie | `rentals.read` |
| `scooters` | encja | `v_fleet_list` (od iteracji 1) | tak | tak, komendy przez `scooter_commands` | wycofanie (`RETIRED`) | `scooters.read`, `scooters.write` |
| `scooter_models` | słownik | `v_scooter_models` (od iteracji 1) | tak | tak | archiwizacja, jeśli używany | `scooters.write` |
| `telemetry` | tylko do dopisywania | `telemetry` (kursor, zakres czasu) | system | nie | retencja (`sp_purge_telemetry`) | `telemetry.read` |
| `scooter_commands` | proces | `scooter_commands` | wysłanie komendy | nie | nie | `scooters.command` |
| `zones` | słownik | `v_zone_list` (edytor z mapą, od iteracji 4) | tak | tak, z wersją; typ niezmienny | dezaktywacja, jeśli używana; usunięcie nieużytej | `zones.read`, `zones.write` |
| `scooter_zone_presence` | techniczna | przejazdy w strefie w szczegółach strefy | system (wykrywanie stref) | nie | z końcem przejazdu | `zones.read` |
| `scooter_zone_control` | techniczna | komendy stref na osi czasu przejazdu | system (uzgadnianie komend) | nie | z końcem przejazdu | `rentals.read` |
| `wallets` | encja | `v_wallet_balances` | z kontem klienta | tylko przez księgę; naprawa `sp_rebuild_wallet_balances` | nie | `payments.read` |
| `wallet_ledger` | tylko do dopisywania | `v_wallet_ledger` (od iteracji 5) | polecenia: korekta salda, zwrot salda (`sp_wallet_post`) | nie | nie | `payments.read`, `wallet.adjust` |
| `payments` | proces | `v_payment_list` (od iteracji 5) | przez proces płatności | polecenie: zwrot za przejazd | nie | `payments.read`, `rentals.manage` |
| `payment_customers` | techniczna | szczegóły płatności | system przy pierwszej karcie albo płatności | nie | nie | `payments.read` |
| `payment_methods` | encja klienta | `v_payment_methods` (tylko do odczytu, D5) | w aplikacji (SetupIntent) | domyślna w aplikacji | w aplikacji (`removed_at`) | `payments.read` |
| `payment_webhook_events` | tylko do dopisywania | `v_payment_webhook_events` | system | nie | nie | `payments.read` |
| `refunds` | proces | `v_refund_list` | polecenia: zwrot za przejazd, zwrot salda (`sp_record_refund`) | stan u operatora (system) | nie | `payments.read`, `rentals.manage`, `wallet.adjust` |
| `receipts` | tylko do dopisywania | `v_receipt_list` | system przy rozliczeniu i zwrocie (`sp_issue_receipt`) | nie | nie | `payments.read` |
| `receipt_items` | tylko do dopisywania | szczegóły paragonu | system | nie | nie | `payments.read` |
| `tickets` | encja | `v_ticket_list` (od iteracji 6), oś czasu `v_ticket_timeline` | z aplikacji, system (automatyczne), operator (źródło `STAFF`) | przypisanie, status z odpowiedzią dla klienta, zadanie ze zgłoszenia | nie: `RESOLVED` jest stanem końcowym | `tickets.read`, `tickets.manage` |
| `ticket_photos` | encja | szczegóły zgłoszenia | z aplikacji i z panelu (najwyżej 3) | — | tak, w panelu | `tickets.manage` |
| `files` | techniczna | `v_file_list` (od iteracji 6) | `POST /files` z modułu, który używa pliku | nie | tak; nieprzypięte i po retencji usuwa system (`DELETED`) | `rentals.read`, `tickets.read` (według celu) |
| `notifications` | tylko do dopisywania | `v_notification_list` (od iteracji 6) | system (zdarzenia) | nie | nie | `content.read`; dane klienta z `users.read` |
| `audit_log` | tylko do dopisywania | `v_audit_log` (filtry: operator, aktor, rodzaj obiektu, zakres czasu) | system, w transakcji zapisu | nie | nie | `audit.read` |
| `service_tasks` | encja | `v_service_task_list` (od iteracji 6), „Moje zadania” | ze zgłoszenia, z karty hulajnogi, system (wymiana baterii, przewiezienie) | przypisanie, rozpoczęcie, części, zakończenie z notatką | anulowanie (`CANCELLED`) z powodem | `service.read`, `service.manage` |
| `spare_parts` | słownik | `v_spare_part_list` (od iteracji 6) | tak | dane i minimum; stan tylko przez przyjęcie i korektę (procedury) | archiwizacja, jeśli ma ruchy; usunięcie części bez historii | `service.read`, `service.manage` |
| `service_task_parts` | encja | `v_service_task_parts` w szczegółach zadania | użycie części (`sp_task_use_part`) | nie | zwrot (`sp_task_return_part`), dopóki zadanie w toku | `service.manage` |
| `spare_part_movements` | tylko do dopisywania | `v_spare_part_movements` (od iteracji 6) | przyjęcie, korekta, użycie i zwrot przez procedury | nie | nie | `service.read`, `service.manage` |
| `content_pages` | słownik | `content_pages` | tak | tak | tak, jeśli bez opublikowanych wersji | `content.read`, `content.write` |
| `content_page_versions` | wersjonowana | wersje dokumentu | nowa wersja | szkic; publikacja | archiwizacja | `content.write` |
| `content_blocks` | słownik | `content_blocks` | tak | tak | tak | `content.write` |
| `faq_items` | słownik | `faq_items` | tak | tak | tak | `content.write` |
| `news` | słownik | `news` | tak | tak | tak | `content.write` |
| `notification_templates` | słownik | `v_notification_templates` (od iteracji 6) | nie (kody z rejestru w `packages/shared`) | treść jako nowa wersja z podglądem i walidacją ICU | nie | `content.read`, `content.write` |
| `notification_template_versions` | wersjonowana | historia w edytorze szablonu (`v_notification_template_versions`) | system przy zapisie treści | nie; przywrócenie to nowa wersja | nie | `content.read`, `content.write` |
| `media_assets` | słownik | `media_assets` | tak | tak | tak, jeśli nieużywana | `content.write` |
| `report_definitions` | słownik z kodu | `report_definitions` | z katalogu w core | nazwa, opis, aktywność | nie | `content.write` |
| `report_runs` | proces | `report_runs` | uruchomienie raportu | nie | nie | `reports.<kod>` |
| `document_templates` | słownik | `document_templates` | tak | tak | dezaktywacja | `templates.read`, `templates.write` |
| `document_template_versions` | wersjonowana | wersje szablonu | wgranie nowej wersji | aktywacja | nie | `templates.write` |
| `generated_documents` | proces | `generated_documents` | wygenerowanie wydruku | nie | nie | `documents.generate` |
