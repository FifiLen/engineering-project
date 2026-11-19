# ADR 0076: Domknięcie macierzy operacji

- **Status:** zaakceptowana
- **Data:** 2026-11-19

## Kontekst

Punkt 12 wymagań uczelni wymaga dodawania, edycji, usuwania, wyświetlania, filtrowania i sortowania dla wszystkich tabel. Prowadzący zgodził się na ograniczone operacje w tabelach tylko do dopisywania (pytanie 4). [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md) dzieli tabele na klasy. Macierz w [modelu danych](../model-danych/README.md#operacje-w-panelu-dla-każdej-tabeli) mówi, jak działa każda operacja.

Po iteracji 7 32 zasoby mają listę wzorca widoku tabeli. Część tabel jest tylko w szczegółach rekordu nadrzędnego, bez filtrów i sortowania: zgody i sesje klienta, sesje i zaproszenia operatora, zdarzenia przejazdu. Część nie ma miejsca w panelu: `otp_codes`, `saved_places`, `telemetry`, `scooter_commands`, `scooter_zone_presence`, `scooter_zone_control`, `payment_customers`, `report_definitions`, `report_runs`. Autor przyjął pytanie 11 (tabela „Pokrycie tabel w panelu” w planie iteracji 8) i D7 (nowe listy jako zakładki obszarów domenowych).

Plansze `34-panel-domkniecie` wskazały:
- brakujące kolumny;
- uprawnienia inne niż w macierzy;
- telemetrię, która nie mieści się w kontrakcie list (miliony wierszy, brak sensownej liczby wszystkich).

Sprawdzone w kodzie 19 listopada 2026:
- tabela `telemetry` nie zapisuje pól `locked` i `buffered` z kontraktu MQTT (`locked` jest w nim wymagane);
- procedura `sp_purge_telemetry(p_keep_days)` istnieje od migracji 0002, ale żadne zadanie jej nie woła;
- partycje dzienne zakłada `sp_ensure_telemetry_partitions`.

## Rozważane opcje

1. **Osobna lista dla każdej tabeli**, także łączących i pozycji. Formalnie pełne, ale lista `role_permissions` albo `receipt_items` bez rekordu nadrzędnego nie ma znaczenia dla operatora.
2. **Lista dla każdej tabeli, której wiersz ma znaczenie sam w sobie; tabele łączące, pozycje i wersje w szczegółach rekordu nadrzędnego** z sortowaniem. Każda tabela ma udokumentowane miejsce w panelu, a operator widzi dane tam, gdzie pracuje.

## Decyzja

Opcja 2.

### Miejsca w panelu

| Obszar | Zakładki (nowe pogrubione) |
|---|---|
| Flota | Hulajnogi, **Telemetria**, **Komendy**; na karcie hulajnogi **Historia stanów** ([ADR 0074](0074-historia-stanow-hulajnogi.md)) |
| Przejazdy | Przejazdy, **Zdarzenia** (`rental_events`) |
| Strefy | Strefy, **Obecność i komendy stref** (`scooter_zone_presence`, `scooter_zone_control`) |
| Płatności | dotychczasowe listy, **Klienci operatora** (`payment_customers`) |
| Użytkownicy | Klienci, **Zgody**, **Sesje**, **Kody SMS**; na karcie klienta **Zapisane miejsca** (`saved_places`) |
| Operatorzy i role | Operatorzy, **Zaproszenia**, **Sesje**, Role, **Uprawnienia**, Dziennik audytu |
| Raporty | Raporty, **Historia** (`report_runs`), **Definicje** (`report_definitions`) ([ADR 0071](0071-modul-raportow.md)) |
| Wydruki | Szablony z **edycją nazwy i opisu oraz dezaktywacją**, Wygenerowane |

W szczegółach rekordu nadrzędnego, z sortowaniem kolumn, zostają:
- tabele łączące: `role_permissions`, `staff_roles`;
- pozycje: `receipt_items`, `service_task_parts`, `ticket_photos`;
- wersje: `content_page_versions`, `notification_template_versions`, `document_template_versions`.

Model danych dostaje kolumnę „Miejsce w panelu” dla każdej tabeli.

### Telemetria

- Wyjątek od kontraktu list: `GET /admin/telemetry?scooterId&from&to&cursor&direction`. Hulajnoga i zakres są wymagane, zakres najwyżej 24 h w oknie retencji.
- Stronicowanie kursorem po kluczu `(scooter_id, recorded_at)` („Nowsze”, „Starsze”), bez liczby wszystkich wierszy.
- Filtry: bateria poniżej progu, tylko w przejeździe. Przerwa między odczytami liczona `lag()`.
- Eksport zakresu ([ADR 0073](0073-eksport-list-do-xlsx-i-csv.md)) ma najwyżej 17 280 wierszy.
- Migracja 0013 dodaje kolumny `locked` i `buffered`. Moduł telemetrii zapisuje je z wiadomości (stare wiersze `NULL`).
- Retencja: zadanie `telemetry.retention` raz na dobę woła `sp_purge_telemetry(90)`.

### Kolumny w migracji 0013

| Tabela | Kolumny | Po co |
|---|---|---|
| `consents` | `source` (rejestracja, aplikacja, panel), `revoked_by_staff` | źródło zgody i operator wycofania |
| `sessions` | `platform`, `app_version` | urządzenie na liście sesji (z żądania logowania, opcjonalne) |
| `otp_codes` | `purpose` (`LOGIN`, `REGISTER`) | cel kodu na liście |
| `scooter_commands` | `source` (`STAFF`, `RENTAL`, `ZONE`, `SYSTEM`), `zone_id` | źródło komendy; stare wiersze: `STAFF` przy operatorze, `RENTAL` przy przejeździe, reszta `SYSTEM` |
| `staff_invitations` | `replaced_by` | odróżnienie ponownego wysłania od unieważnienia |
| `staff_sessions` | `remembered` | „Zapamiętaj to urządzenie” (12 h albo 7 dni) |
| `permissions` | `updated_at`, `updated_by`, `version` | blokada optymistyczna opisu; synchronizacja katalogu nie nadpisuje opisu zmienionego w panelu |
| `document_templates` | `deactivated_at` | data dezaktywacji |

Szablon wydruku:
- procedura dezaktywacji szablonu daje błąd `TEMPLATE_IS_DEFAULT` dla domyślnego szablonu z aktywną wersją;
- domyślny szablon bez aktywnej wersji traci rolę domyślnego (`CHECK active OR NOT is_default` już to wymusza);
- zmiana nazwy na zajętą daje `TEMPLATE_NAME_TAKEN` (unikalność `(document_type, name)`).

### Uprawnienia (zmiany względem macierzy)

- lista komend: `scooters.read` (macierz: `scooters.command`, które zostaje do wysyłki);
- lista kodów SMS: `users.read`, a „Usuń wygasłe kody” (`sp_purge_expired_otp`): `users.manage`;
- wycofanie zgody: `users.manage` (macierz: `users.read`), tylko zgoda marketingowa, z powodem; regulamin, polityka i wiek są warunkami konta i operator ich nie wycofuje;
- sesje klienta: lista `users.read`, unieważnienie `users.manage`; sesje i zaproszenia operatorów: lista `staff.read`, polecenia `staff.manage`;
- opis uprawnienia: `roles.manage`; obecność i komendy stref: `zones.read`; zdarzenia przejazdu: `rentals.read`; klienci operatora płatności: `payments.read`; historia stanów: `scooters.read`.

Nowe wpisy w dzienniku audytu: `consent.revoked`, `session.revoked`, `staff.invitation_revoked`, `permission.updated`, `otp.purged`, `document_template.updated`, `document_template.deactivated`.

### Sesje

- Listy sesji klientów i operatorów pokazują jeden wiersz na rodzinę tokenów (`family_id`), bo rotacja tokenu odświeżającego dopisuje wiersz. Unieważnienie obejmuje całą rodzinę.
- Token dostępu działa do wygaśnięcia, najwyżej 15 min ([ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md)). Okno unieważnienia mówi o tym wprost.
- Sprawdzanie sesji przy każdym żądaniu operatora rozważy przegląd bezpieczeństwa w iteracji 9.

### Macierz roli

Macierz pokazuje krótką etykietę uprawnienia z `pl.json`. Opis z bazy (do 160 znaków) pojawia się po najechaniu i na zakładce Uprawnienia.

## Konsekwencje

Pozytywne:

- Każda tabela ma udokumentowane miejsce w panelu z filtrowaniem i sortowaniem albo uzasadnienie, dlaczego jest w rekordzie nadrzędnym (punkt 12, do pokazania na obronie).
- Brakujące kolumny poprawiają też dane dla operatora: źródło komendy, cel kodu, urządzenie sesji.
- Telemetria ma retencję, która była zaplanowana, ale nieuruchomiona.

Negatywne i ryzyka:

- Telemetria łamie kontrakt list (kursor, brak liczby), więc potrzebuje osobnego komponentu w panelu.
- Kolumny dodane do istniejących tabel mają `NULL` w starych wierszach albo wartości uzupełnione z założeń (źródło komendy), co lista musi pokazać jako „brak danych”.
- Uprawnienia list różnią się od pierwotnej macierzy; macierz w modelu danych trzeba poprawić razem z migracją.

## Powiązane

[ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [ADR 0033](0033-telemetria-i-status-floty.md), [ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md), [ADR 0067](0067-szablony-wydrukow-docx.md), [ADR 0071](0071-modul-raportow.md), [ADR 0073](0073-eksport-list-do-xlsx-i-csv.md), [ADR 0074](0074-historia-stanow-hulajnogi.md), [model danych](../model-danych/README.md), makiety `34-panel-domkniecie`
