# 8. Koncepcje przekrojowe

## 8.1. Uwierzytelnianie i autoryzacja
Użytkownicy logują się kodem SMS i dostają krótki token dostępowy (15 min) oraz długi token odświeżający (30 dni), przechowywany w bazie jako skrót; w aplikacji leży w `expo-secure-store`. Każde odświeżenie wydaje nowy token, a ponowne użycie zastąpionego unieważnia całą rodzinę sesji. Operatorzy logują się e-mailem, hasłem (argon2) i kodem TOTP (sekret szyfrowany AES-256-GCM); token odświeżający panelu jest w ciasteczku `httpOnly` `SameSite=Strict`. Uprawnienia operatora wynikają z ról zarządzanych w panelu (RBAC, [ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md)); każdy punkt API deklaruje dostęp (`@Public`, `@CustomerAuth`, `@StaffAuth`, `@RequirePermission`), a punkt bez deklaracji jest odrzucany. Każdy zapis operatora trafia do `audit_log` w tej samej transakcji. Szczegóły: [ADR 0019](../adr/0019-uwierzytelnianie.md), [ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md).

## 8.2. Idempotencja
Każde działanie, które może zostać powtórzone, ma unikalny klucz: `commandId` dla komend MQTT, `idempotency_key` dla płatności, `provider_event_id` dla webhooków. Powtórzenie nie zmienia stanu. Ponowione żądanie startu albo rezerwacji tej samej hulajnogi zwraca otwarty przejazd zamiast drugiego (indeksy jednego otwartego przejazdu, [ADR 0036](../adr/0036-proces-wypozyczenia-w-api.md)). Komenda ma termin `expiresAt` (kontrakt MQTT 1.1.0), po którym hulajnoga jej nie wykona, a potwierdzenie zmienia stan tylko komendy w statusie `SENT` ([ADR 0038](../adr/0038-wygasanie-komend-mqtt.md)). Zadania pg-boss są dostarczane co najmniej raz, więc ich obsługa sprawdza stan po zablokowaniu wiersza ([ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)).

## 8.3. Spójność danych
Reguły biznesowe, które muszą być zawsze prawdziwe, są pilnowane przez bazę: indeksy częściowe (jeden otwarty przejazd na hulajnogę i użytkownika, jedno obciążenie za przejazd), klucze obce i ograniczenia `CHECK`. Logika aplikacji ich nie zastępuje, tylko uzupełnia.

## 8.4. Pieniądze
Kwoty to liczby całkowite w groszach. Ruch środków to wpis w księdze portfela ([ADR 0014](../adr/0014-kwoty-w-groszach-portfel-ksiega.md)). Przejazd pamięta wersję cennika z chwili startu ([ADR 0015](../adr/0015-wersjonowany-cennik.md)).

## 8.5. Czas
Czas zapisujemy w UTC (`timestamptz`), prezentujemy w strefie Europe/Warsaw. Czas przejazdu liczymy od potwierdzenia odblokowania przez hulajnogę do żądania zakończenia, z osi czasu przejazdu ([ADR 0042](../adr/0042-wycena-przejazdu.md)). Czas zdarzeń i komend pochodzi z zegara bazy (`now()` transakcji), żeby kolejność na osi czasu była jednoznaczna.

## 8.6. Geometria
Układ WGS 84 (SRID 4326). Pozycje jako `Point`, strefy jako `MultiPolygon` z indeksem GiST; edytor w panelu pracuje na jednym wielokącie (`Polygon`) z dokładnością 6 miejsc po przecinku ([ADR 0047](../adr/0047-edytor-geometrii-w-panelu.md)). Reguły geometrii mają trzy poziomy, a rozstrzyga baza: panel nie pozwala zamknąć wielokąta, który przecina sam siebie; core sprawdza liczbę punktów, samoprzecięcia i najmniejszą powierzchnię 100 m²; baza pilnuje `ST_IsValid`, położenia w jedynym aktywnym obszarze działania, rozłączności stref parkowania i niezmiennego typu (wyzwalacz `zones_rules`, migracja 0006). Strefy w punkcie zwracają funkcje bazy (`fn_zones_at_point`, `fn_zones_near_point` z promieniem histerezy), a reguły pozycji (`canRide`, `canPark`, limit) liczy core (`evaluatePosition`).

## 8.7. Zdarzenia na żywo
Socket.IO z pokojami: `user:{id}` dla aplikacji klienta (dołącza od razu po połączeniu z tokenem klienta), `fleet` i `rentals` dla panelu (po sprawdzeniu uprawnienia). Pokój `rental:{id}` z ADR 0012 okazał się zbędny ([kontrakt Socket.IO 1.1.0](../kontrakty/asyncapi-realtime.yaml)). Format zdarzeń opisuje pakiet `shared` (`realtime.ts`). Od iteracji 3: `rental.updated` (pełny widok przejazdu klienta z licznikami na chwilę `asOf`) i `rentals.changed` (wiersz listy przejazdów w panelu). Od iteracji 1: `fleet.updates` (paczka zmian pozycji, baterii i statusu floty z jednego okna telemetrii) i `fleet.command` (wysłanie i każda zmiana statusu komendy). Panel pobiera stan początkowy przez REST (`GET /admin/fleet/map`) i po każdym ponownym połączeniu pobiera go od nowa.

## 8.8. Obsługa błędów
API zwraca błędy w jednym formacie: kod maszynowy (np. `OUTSIDE_PARKING`), komunikat i szczegóły. Klienci reagują na kod, nie na treść komunikatu.

## 8.9. Logowanie i obserwowalność
Logi strukturalne w JSON z identyfikatorem żądania, przejazdu i komendy. Metryki symulatora i brokera (wiadomości na sekundę, opóźnienie komend) są widoczne w panelu.

## 8.10. Prywatność
Pełne numery kart nie trafiają do systemu. Usunięcie konta anonimizuje dane osobowe, przejazdy i płatności zostają ze względów księgowych. Telemetria starsza niż 90 dni jest usuwana razem z partycjami, a wygasłe sesje, zaproszenia i kody SMS 30 dni po wygaśnięciu (zadania pg-boss, [ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)). Usunięcie konta wymaga braku otwartego przejazdu i salda 0.

## 8.11. Język interfejsu
Interfejs po polsku. Etykiety interfejsu (przyciski, pola, menu, komunikaty błędów) są wydzielone do plików tłumaczeń, żeby dodanie kolejnego języka nie wymagało zmian w kodzie; w komponentach są tylko klucze. Mechanizm: wspólny tłumacz z `packages/shared` na `intl-messageformat` (format ICU, polskie liczebniki), pliki `apps/web/messages/pl.json` i `apps/mobile/src/i18n/pl.json`, reguła lintera zakazująca tekstów w JSX ([ADR 0032](../adr/0032-etykiety-w-plikach-tlumaczen.md)). Treści merytoryczne (regulamin, FAQ, aktualności, bloki strony i ekranów powitalnych, szablony powiadomień, grafiki) są w bazie i edytuje je operator w panelu ([ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md)).
