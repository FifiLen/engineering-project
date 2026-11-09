# 8. Koncepcje przekrojowe

## 8.1. Uwierzytelnianie i autoryzacja
Użytkownicy logują się kodem SMS i dostają krótki token dostępowy (15 min) oraz długi token odświeżający (30 dni), przechowywany w bazie jako skrót. Operatorzy logują się e-mailem, hasłem (argon2) i kodem TOTP. Role operatorów: `ADMIN`, `DISPATCHER`, `SERVICE`. Szczegóły: [ADR 0019](../adr/0019-uwierzytelnianie.md).

## 8.2. Idempotencja
Każde działanie, które może zostać powtórzone, ma unikalny klucz: `commandId` dla komend MQTT, `idempotency_key` dla płatności, `provider_event_id` dla webhooków. Powtórzenie nie zmienia stanu.

## 8.3. Spójność danych
Reguły biznesowe, które muszą być zawsze prawdziwe, są pilnowane przez bazę: indeksy częściowe (jeden otwarty przejazd na hulajnogę i użytkownika, jedno obciążenie za przejazd), klucze obce i ograniczenia `CHECK`. Logika aplikacji ich nie zastępuje, tylko uzupełnia.

## 8.4. Pieniądze
Kwoty to liczby całkowite w groszach. Ruch środków to wpis w księdze portfela ([ADR 0014](../adr/0014-kwoty-w-groszach-portfel-ksiega.md)). Przejazd pamięta wersję cennika z chwili startu ([ADR 0015](../adr/0015-wersjonowany-cennik.md)).

## 8.5. Czas
Czas zapisujemy w UTC (`timestamptz`), prezentujemy w strefie Europe/Warsaw. Czas przejazdu liczymy od potwierdzenia odblokowania przez hulajnogę.

## 8.6. Geometria
Układ WGS 84 (SRID 4326). Pozycje jako `Point`, strefy jako `MultiPolygon` z indeksem GiST.

## 8.7. Zdarzenia na żywo
Socket.IO z pokojami: `user:{id}` dla aplikacji użytkownika, `rental:{id}` dla przejazdu, `fleet` dla panelu. Format zdarzeń opisuje pakiet `shared`.

## 8.8. Obsługa błędów
API zwraca błędy w jednym formacie: kod maszynowy (np. `OUTSIDE_PARKING`), komunikat i szczegóły. Klienci reagują na kod, nie na treść komunikatu.

## 8.9. Logowanie i obserwowalność
Logi strukturalne w JSON z identyfikatorem żądania, przejazdu i komendy. Metryki symulatora i brokera (wiadomości na sekundę, opóźnienie komend) są widoczne w panelu.

## 8.10. Prywatność
Pełne numery kart nie trafiają do systemu. Usunięcie konta anonimizuje dane osobowe, przejazdy i płatności zostają ze względów księgowych. Telemetria starsza niż ustalony okres jest usuwana razem z partycjami.

## 8.11. Język interfejsu
Interfejs po polsku. Teksty są wydzielone do plików tłumaczeń, żeby dodanie kolejnego języka nie wymagało zmian w kodzie.
