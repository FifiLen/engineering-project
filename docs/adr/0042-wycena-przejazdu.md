# ADR 0042: Wycena przejazdu

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

Autor zdecydował (D1 w planie iteracji 3), że wycena przejazdu powstaje w iteracji 3, a obciążenie portfela, minimalne saldo, stan `UNPAID` i paragony w iteracji 5. Ekran jazdy pokazuje bieżący koszt, a podsumowanie i panel kwotę przejazdu. Odpowiedzi autora: każda rozpoczęta minuta jazdy i osobno pauzy, naliczanie kończy się w chwili żądania zakończenia, jeśli blokada zostanie potwierdzona, pauza bez limitu, przy zdalnym zakończeniu klient płaci do chwili zakończenia, bez opłaty za parkowanie poza strefą. Cennik jest wersjonowany, a przejazd pamięta wersję z chwili startu ([ADR 0015](0015-wersjonowany-cennik.md)). Kwoty są w groszach ([ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md)).

## Rozważane opcje

Gdzie liczyć:

1. **Funkcja SQL** w bazie. Jedno miejsce dla zapisu i raportów, ale aplikacja i panel potrzebują tej samej wyceny na żywo (licznik na ekranie jazdy), a reguły biznesowe mają być w `packages/core` ([ADR 0025](0025-logika-biznesowa-packages-core.md)).
2. **Czysta funkcja w `packages/core`**, wywoływana przy zakończeniu (zapis `total_amount`) i przy budowie widoku przejazdu (koszt bieżący). Aplikacja liczy koszt między odświeżeniami z tych samych danych, które dostaje w widoku (stawki z wersji cennika i czasy).

Z czego liczyć czas:

1. **Z liczników aktualizowanych w trakcie jazdy.** Wymaga zapisu co chwilę i jest wrażliwe na przerwy w działaniu API.
2. **Z osi czasu przejazdu:** `started_at` (potwierdzone odblokowanie), potwierdzone pauzy i wznowienia z `rental_events`, chwila żądania zakończenia (`END_REQUESTED`) albo zdalnego zakończenia.

## Decyzja

- **Funkcja:** `priceRental(tariff, counters)` w `packages/core/src/rentals/pricing.ts`, bez wejścia-wyjścia, zwraca pozycje i sumę w groszach: `unlockFee`, `rideMinutes × minuteRate`, `pauseMinutes × pauseMinuteRate`, `total`. Przejazd bez potwierdzonego odblokowania (`EXPIRED`, `UNLOCK_FAILED`) kosztuje 0.
- **Minuty:** `rideMinutes = max(1, ⌈rideSeconds / 60⌉)` dla przejazdu, który się zaczął, `pauseMinutes = ⌈pauseSeconds / 60⌉` (pauza krótsza niż sekunda się nie liczy). Każda rozpoczęta minuta jest płatna, a jazda i pauza są liczone osobno.
- **Czas:** funkcja `rentalCounters(timeline, now)` w core liczy `rideSeconds` i `pauseSeconds` z osi czasu. Jazda trwa od potwierdzonego odblokowania, pauza od potwierdzonej blokady do potwierdzonego odblokowania przy wznowieniu, a koniec naliczania to `END_REQUESTED` (zakończenie przez klienta) albo `ENDED_REMOTELY` (operator). Pauza w trakcie oczekiwania na potwierdzenie liczy się jeszcze jako jazda, a wznowienie w trakcie oczekiwania jeszcze jako pauza, bo hulajnoga jest w poprzednim stanie. Nieudana blokada (`LOCK_FAILED`) unieważnia `END_REQUESTED`, więc naliczanie biegnie dalej.
- **Zapis:** przy przejściu do `ENDED` repozytorium zapisuje `ride_seconds`, `pause_seconds`, `distance_m` (`fn_rental_distance_m`), trasę i `total_amount` w tej samej transakcji. Kwota nie zmienia się po zakończeniu; korekty to iteracja 5 (księga portfela).
- **Bez obciążenia:** w tej iteracji `ENDED` nie tworzy wpisu w `wallet_ledger` ani płatności. Widok przejazdu ma pole `settlement: 'PENDING'`, a podsumowanie i panel pokazują kwotę z adnotacją, że rozliczenie przyjdzie później (nowa makieta podsumowania).
- **Opłata poza strefą** (`out_of_zone_fee`) nie występuje w wycenie: zakończenie poza strefą jest niemożliwe dla klienta, a przy zdalnym zakończeniu autor ją wyłączył.

## Konsekwencje

Pozytywne:

- Ta sama funkcja liczy koszt na ekranie jazdy, w podsumowaniu, w panelu i przy zapisie, więc kwoty się nie rozjeżdżają.
- Iteracja 5 dodaje obciążenie na gotowej kwocie, bez zmiany reguł wyceny.

Negatywne i ryzyka:

- Przejazdy zakończone w iteracji 3 nie mają obciążenia; iteracja 5 musi zdecydować, czy rozliczyć je wstecz, czy zostawić jako przejazdy deweloperskie.
- Aplikacja liczy koszt lokalnie między zdarzeniami; po pauzie albo zmianie stanu wartość wyrównuje się do widoku z API.

## Powiązane

[ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md), [ADR 0015](0015-wersjonowany-cennik.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0036](0036-proces-wypozyczenia-w-api.md), [plan iteracji 3](../iteracje/iteracja-03-wypozyczenie.md)
