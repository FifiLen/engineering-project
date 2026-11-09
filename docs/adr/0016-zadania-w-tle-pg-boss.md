# ADR 0016: Zadania w tle w pg-boss

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Kilka działań musi nastąpić po czasie: limit 10 s na potwierdzenie odblokowania, wygasanie rezerwacji, awaryjne sprawdzenie płatności, powiadomienie o końcu rezerwacji.

## Rozważane opcje

1. **Timery w pamięci procesu**. Proste, ale znikają przy restarcie.
2. **BullMQ z Redisem**. Popularne i wydajne, ale dodatkowy element infrastruktury.
3. **pg-boss w PostgreSQL**. Kolejka zadań w istniejącej bazie, trwała i transakcyjna.

## Decyzja

Zadania opóźnione i cykliczne realizuje pg-boss na tej samej bazie PostgreSQL. Zadanie jest planowane w tej samej transakcji co zmiana stanu, która je wywołuje.

## Konsekwencje

Pozytywne:

- Brak dodatkowej infrastruktury.
- Zadania przetrwają restart backendu.

Negatywne i ryzyka:

- Mniejsza przepustowość niż Redis, wystarczająca w skali projektu.
