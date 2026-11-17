# ADR 0037: Zadania w tle w pg-boss: konfiguracja i zadania

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

[ADR 0016](0016-zadania-w-tle-pg-boss.md) wybiera pg-boss i wymaga planowania zadania w tej samej transakcji co zmiana stanu. Do iteracji 2 zadania w tle działały na licznikach `setInterval` w procesie API: limit potwierdzenia komend (`commands.service.ts`, co 2 s) i partycje telemetrii (`telemetry.service.ts`), co [ADR 0033](0033-telemetria-i-status-floty.md) zapowiadał jako rozwiązanie tymczasowe. Iteracja 3 dodaje wygaszanie rezerwacji, limit potwierdzenia przy przejściach przejazdu, retencję telemetrii i czyszczenie kodów SMS i sesji (dług z iteracji 2).

## Rozważane opcje

Schemat kolejki:

1. **Tabele pg-boss w migracjach SQL projektu** ([ADR 0021](0021-migracje-sql-schemat-drizzle-z-bazy.md)). Jedno źródło schematu, ale pg-boss zmienia swój schemat między wersjami i sam go migruje; przepisywanie jego migracji to praca bez wartości.
2. **pg-boss zarządza własnym schematem `pgboss`** w tej samej bazie. Nasze migracje i `drizzle-kit pull` dotyczą tylko schematu `public`.

Planowanie w transakcji:

1. **Zapis „zadania do wysłania” w tabeli projektu** (wzorzec outbox) i przenoszenie do pg-boss. Dodatkowa tabela i proces.
2. **`boss.send(..., { db })`** z adapterem wykonującym SQL na połączeniu bieżącej transakcji. pg-boss ma tę opcję właśnie do tego celu.

## Decyzja

- **Wersja:** `pg-boss` 12.38.2 (wydana 10 listopada 2026, sprawdzona przed instalacją według zasady z `CLAUDE.md`), tylko w `apps/api`.
- **Schemat:** `pgboss` w bazie projektu, tworzony i migrowany przez pg-boss przy starcie (`migrate: true`). `drizzle.config.ts` czyta tylko `public`, a testy bazy liczą obiekty w `public`.
- **Proces:** jeden proces API uruchamia pg-boss (wysyłanie i obsługę). W testach API pg-boss działa na bazie testowej, a testy mogą też wywołać obsługę zadania bezpośrednio.
- **Planowanie w transakcji:** `send(..., { db: fromDrizzle(tx, sql) })` z adapterem transakcji Drizzle wbudowanym w pg-boss (`executeSql` na połączeniu bieżącej transakcji). pg-boss zna tylko serwis zadań w `apps/api`; core i repozytoria nic o nim nie wiedzą.
- **Zadania jednorazowe:**

| Zadanie | Kiedy | Co robi |
|---|---|---|
| `rental.reservation-expire` | `startAfter = reservation_expires_at` | wygasza jedną rezerwację, jeśli dalej jest `RESERVED` |
| `command.ack-timeout` | `startAfter = sent_at + 10 s` | komenda `SENT` → `TIMEOUT` i przejście przejazdu według [ADR 0036](0036-proces-wypozyczenia-w-api.md) |

- **Zadania cykliczne** (`boss.schedule`, rozdzielczość minuty, czas UTC):

| Zadanie | Harmonogram | Co robi |
|---|---|---|
| `rentals.expire-sweep` | co minutę | zabezpieczenie: wygasza przez repozytorium (z powiadomieniami) rezerwacje, których zadanie się zgubiło; `sp_expire_reservations` zostaje narzędziem bazy bez zdarzeń dla klientów |
| `commands.timeout-sweep` | co minutę | zabezpieczenie dla komend `SENT` starszych niż 10 s |
| `telemetry.partitions` | codziennie 00:05 i przy starcie | `sp_ensure_telemetry_partitions` na 7 dni naprzód |
| `telemetry.purge` | codziennie 03:00 | `sp_purge_telemetry(90)` |
| `auth.purge` | codziennie 03:15 | `sp_purge_expired_otp` i `sp_purge_expired_sessions(30)` |

- Każda obsługa jest idempotentna: sprawdza stan po zablokowaniu wiersza, więc powtórzenie zadania (pg-boss gwarantuje dostarczenie co najmniej raz) nic nie zmienia. Liczniki `setInterval` dla limitu potwierdzeń (`commands.service.ts`) i partycji (`telemetry.service.ts`) znikają; zostaje okno zbierania telemetrii z ADR 0033, bo to buforowanie zapisu, a nie zadanie w tle.

## Konsekwencje

Pozytywne:

- Zadania przetrwają restart API, a zadanie powstaje tylko wtedy, gdy zmiana stanu się zatwierdziła.
- Retencja i czyszczenie danych technicznych działają same, bez ręcznych procedur.

Negatywne i ryzyka:

- Limit potwierdzenia zależy od odpytywania kolejki (domyślnie co 2 s, ustawiamy 1 s), więc `UNLOCK_FAILED` pojawia się po 10–11 s, nie dokładnie po 10 s.
- Schemat `pgboss` jest poza naszymi migracjami; aktualizacja pg-boss wymaga sprawdzenia jego migracji na kopii bazy.
- Dwa procesy API na jednej bazie podzieliłyby się zadaniami poprawnie, ale MQTT ma stały `MQTT_CLIENT_ID` (`CLAUDE.md`), więc dalej uruchamiamy jeden.

## Powiązane

[ADR 0016](0016-zadania-w-tle-pg-boss.md) (uzupełnia), [ADR 0033](0033-telemetria-i-status-floty.md) (zastępuje liczniki w procesie), [ADR 0021](0021-migracje-sql-schemat-drizzle-z-bazy.md), [ADR 0036](0036-proces-wypozyczenia-w-api.md), [arc42 §8](../arc42/08-koncepcje-przekrojowe.md)
