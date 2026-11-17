# ADR 0036: Proces wypożyczenia w API

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

Iteracja 3 wprowadza pierwszy proces, w którym jedna operacja klienta zmienia trzy rzeczy naraz: stan przejazdu, status hulajnogi i komendę MQTT, na którą trzeba poczekać. [ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md) ustala maszynę stanów, a [ADR 0011](0011-mqtt-dla-hulajnog.md) komendy z potwierdzeniem. Otwarte są cztery sprawy: jak zachować spójność przy równoległych żądaniach (klient klika dwa razy, rezerwacja wygasa w chwili odblokowania, operator kończy przejazd zdalnie), jak modelować pauzę i wznowienie, które też czekają na potwierdzenie, a w typie `rental_state` nie mają stanu przejściowego, jak uniknąć drugiego przejazdu przy ponowionym żądaniu i jak klient dowiaduje się o zmianach.

Odpowiedzi autora (plan iteracji 3): nieudana blokada przy kończeniu przywraca jazdę, naliczanie kończy się w chwili żądania zakończenia, operator kończy przejazd niezależnie od strefy.

## Rozważane opcje

Spójność:

1. **Blokada optymistyczna** (`version` na przejeździe). Działa dla formularzy, ale przy wyścigu jedno z żądań klienta kończy się błędem `CONFLICT`, którego aplikacja nie ma jak sensownie pokazać.
2. **Transakcja z `SELECT … FOR UPDATE` na hulajnodze i przejeździe**, w stałej kolejności (najpierw hulajnoga, potem przejazd). Równoległe żądania czekają na siebie, a druga transakcja widzi już nowy stan i dostaje błąd domeny albo wynik pierwszej.

Pauza i wznowienie:

1. **Nowe stany `PAUSING` i `RESUMING`** w typie `rental_state`. Czytelny diagram, ale migracja typu, zmiana indeksów częściowych i więcej przejść.
2. **Stan zmienia się dopiero po potwierdzeniu**, a oczekiwanie wynika z komendy przejazdu w statusie `SENT`. Przejazd jest w `ACTIVE`, dopóki hulajnoga nie potwierdzi blokady, i to odpowiada rzeczywistości: hulajnoga jeszcze jedzie.

Idempotencja startu:

1. **Nagłówek `Idempotency-Key`** z tabelą kluczy. Ogólne, ale wymaga nowej tabeli i logiki wygasania kluczy.
2. **Otwarty przejazd jako wynik**: indeksy `rentals_one_open_per_user` i `rentals_one_open_per_scooter` z migracji 0001 już gwarantują jeden otwarty przejazd. Ponowione żądanie startu tej samej hulajnogi przez tego samego klienta zwraca istniejący przejazd.

## Decyzja

**Przejście w jednej transakcji.** Każda operacja (rezerwacja, anulowanie, start, pauza, wznowienie, zakończenie, zdalne zakończenie, potwierdzenie i brak potwierdzenia komendy, wygaśnięcie) to jedna transakcja w repozytorium przejazdów `packages/db`:

1. `SELECT … FOR UPDATE` na hulajnodze, potem na przejeździe (stała kolejność, bez zakleszczeń).
2. Reguły z `packages/core` (`rentals`) na zablokowanym stanie: warunki klienta i hulajnogi, maszyna stanów, strefa parkowania, wycena ([ADR 0042](0042-wycena-przejazdu.md)).
3. Zapis przejazdu, zdarzenia w `rental_events` (`STATE_CHANGED` z `from_state`, `to_state` i powodem w `data` albo zdarzenie informacyjne), zmiana `scooters.status` (`RESERVED`, `IN_USE`, `AVAILABLE`) i zapis komendy w `scooter_commands` z `rental_id`.
4. Zaplanowanie zadania pg-boss (wygaśnięcie rezerwacji, limit potwierdzenia) w tej samej transakcji ([ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)).
5. Po zatwierdzeniu: publikacja komendy w MQTT i zdarzeń Socket.IO. Komenda zapisana, ale nieopublikowana (awaria procesu) kończy się brakiem potwierdzenia, tak jak komenda zgubiona w sieci.

**Stany i komendy.**

| Operacja | Przejście | Komenda | Po potwierdzeniu | Bez potwierdzenia w 10 s albo odmowa |
|---|---|---|---|---|
| Rezerwacja | `∅ → RESERVED` | brak | | wygaśnięcie po `free_reservation_minutes`: `RESERVED → EXPIRED` (`reservation_timeout`) |
| Anulowanie | `RESERVED → EXPIRED` (`cancelled_by_user`) | brak | | |
| Start | `∅ → UNLOCKING` albo `RESERVED → UNLOCKING` | `unlock` | `ACTIVE`, `started_at` | `UNLOCK_FAILED`, bez kosztu |
| Pauza | `ACTIVE` bez zmiany | `lock` | `PAUSED` | zostaje `ACTIVE`, zdarzenie `PAUSE_FAILED` |
| Wznowienie | `PAUSED` bez zmiany | `unlock` | `ACTIVE` | zostaje `PAUSED`, zdarzenie `RESUME_FAILED` |
| Zakończenie | `ACTIVE`/`PAUSED → ENDING` (zdarzenie `END_REQUESTED`) | `lock` | `ENDED`, `ended_at`, `total_amount`, trasa | powrót do stanu sprzed żądania, zdarzenie `LOCK_FAILED` |
| Zdalne zakończenie | `ACTIVE`/`PAUSED`/`ENDING → ENDED` | `lock` | tylko status komendy | tylko status komendy |

Przy przejazdach `ACTIVE` i `PAUSED` oczekiwanie na potwierdzenie wynika z komendy przejazdu w statusie `SENT`. Indeks częściowy `scooter_commands (rental_id) WHERE status = 'SENT'` (migracja 0005) pozwala mieć najwyżej jedną taką komendę na przejazd, więc pauza w trakcie kończenia albo podwójne „Wznów” kończą się błędem `RENTAL_COMMAND_PENDING`. Nowe typy zdarzeń (`END_REQUESTED`, `PAUSE_FAILED`, `RESUME_FAILED`, `LOCK_FAILED`, `ENDED_REMOTELY`) dodaje migracja 0005 do `rental_event_type`. Potwierdzenie `lock` albo `unlock` z powodem `ALREADY_IN_STATE` jest traktowane jak udane, bo hulajnoga jest w żądanym stanie (kończenie z pauzy, hulajnoga zostawiona odblokowana).

Odpowiedź autora na pytanie 5 („powrót do `ACTIVE`”) doprecyzowujemy dla kończenia z pauzy: przejazd wraca do `PAUSED`, bo hulajnoga dalej stoi zablokowana. Maszyna stanów w core dostaje akcje `CANCEL_RESERVATION`, `LOCK_TIMEOUT` (z `ENDING` do stanu zapisanego w zdarzeniu `END_REQUESTED`) i `END_REMOTELY`. Akcja `COMPLETE_END` w tej iteracji prowadzi do `ENDED`, a `DECLINE_PAYMENT` i `SETTLE_DEBT` czekają na iterację 5.

**Spóźnione i odrzucone potwierdzenia.** Potwierdzenie zmienia stan tylko wtedy, gdy komenda ma status `SENT`, a przejazd jest w stanie, na który ta komenda czeka. W każdym innym przypadku zmienia się tylko status komendy. Spóźnione `ok` dla `unlock` po `UNLOCK_FAILED` albo po zakończeniu uruchamia kompensującą komendę `lock` ([ADR 0038](0038-wygasanie-komend-mqtt.md)).

**Idempotencja startu.** `POST /rentals` dla klienta, który ma już otwarty przejazd na tej samej hulajnodze, zwraca ten przejazd (`200`, nie `201`). Otwarty przejazd na innej hulajnodze kończy się błędem `RENTAL_ALREADY_OPEN`, a hulajnoga zajęta przez kogoś innego błędem `SCOOTER_UNAVAILABLE`. Naruszenie indeksów `rentals_one_open_per_*` w wyścigu, którego blokada wiersza nie wyłapała, repozytorium tłumaczy na te same błędy.

**Zdarzenia dla klienta.** Socket.IO z pokojami z [ADR 0012](0012-socket-io.md): klient łączy się z tokenem dostępowym klienta w `auth.token` ([ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md)) i trafia do pokoju `user:{id}`. Pokój `rental:{id}` dostaje właściciel przejazdu i operator z `rentals.read`. Panel dostaje zmiany przejazdów w nowym pokoju `rentals` (uprawnienie `rentals.read`). Zdarzenie `rental.updated` niesie pełny widok przejazdu, więc klient nie składa stanu ze zdarzeń cząstkowych. Liczniki (czas, koszt) aplikacja liczy lokalnie od czasów z widoku, a REST (`GET /rentals/current`) jest źródłem prawdy po wznowieniu połączenia.

## Konsekwencje

Pozytywne:

- Każda zmiana stanu ma jedno miejsce decyzji (core) i jedno miejsce zapisu (repozytorium), zawsze w transakcji z blokadą.
- Wyścigi wygaśnięcia z odblokowaniem, podwójnego kliknięcia i zdalnego zakończenia z potwierdzeniem rozstrzyga kolejność blokad, a nie przypadek.
- Typ `rental_state` się nie zmienia; oś czasu dalej wynika wprost z `rental_events` i `scooter_commands`.

Negatywne i ryzyka:

- Oczekiwanie na pauzę i wznowienie nie jest widoczne w samym stanie przejazdu; widok przejazdu musi dołączać komendę w toku (`pendingCommand`).
- Blokada wiersza hulajnogi przez czas transakcji spowalnia zapis telemetrii tej hulajnogi; transakcje są krótkie (bez wejścia-wyjścia sieciowego), więc w skali projektu bez znaczenia.

## Powiązane

[ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md), [ADR 0011](0011-mqtt-dla-hulajnog.md), [ADR 0012](0012-socket-io.md), [ADR 0035](0035-sesje-tokeny-i-straznik-uprawnien.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0038](0038-wygasanie-komend-mqtt.md), [ADR 0042](0042-wycena-przejazdu.md), [arc42 §6.1–6.4](../arc42/06-widok-czasu-dzialania.md), [plan iteracji 3](../iteracje/iteracja-03-wypozyczenie.md)
