# ADR 0025: Osobny projekt logiki biznesowej (`packages/core`) i dostęp do danych tylko przez `packages/db`

- **Status:** proponowana
- **Data:** 2026-11-16

## Kontekst

Wymagania uczelni (punkty 3b, 3c, 4 i 9 w [wymagania-uczelni.md](../wymagania-uczelni.md)) wymagają osobnego projektu operacji na bazie danych i osobnego projektu z klasami logiki biznesowej. Obie aplikacje mają korzystać z tych samych projektów, a dostęp do danych ma iść przez ORM.

Po iteracji 0 logika miała żyć w modułach NestJS w `apps/api` ([ADR 0003](0003-monolit-modularny.md)), a część kodu API (`ZonesService`, `HealthController`) wysyła zapytania przez surowy `pg`, z pominięciem `packages/db` i Drizzle. Przy obronie trudno byłoby wskazać „projekt logiki biznesowej” jako osobną jednostkę, a reguł domeny nie da się testować bez frameworka i bazy.

## Rozważane opcje

1. **Logika w serwisach NestJS w `apps/api`**. Najmniej pracy, ale logika jest związana z frameworkiem, a punkt 3c nie jest spełniony.
2. **`packages/core` zależny od `packages/db`**. Klasy domeny same wywołują zapytania Drizzle. Prosty przepływ, ale reguł nie da się testować bez bazy, a logika miesza się z zapytaniami.
3. **`packages/core` z portami, `packages/db` z ich implementacjami (porty i adaptery)**. Core definiuje klasy domeny i interfejsy repozytoriów; `packages/db` implementuje repozytoria w Drizzle; `apps/api` składa całość i wystawia HTTP, MQTT i Socket.IO.

## Decyzja

Opcja 3. Kierunek zależności:

```
apps/api ──► packages/core ◄── packages/db
    └───────────────────────────────┘
```

- **`packages/core`**: czysty TypeScript bez NestJS, Drizzle, `pg` i wejścia-wyjścia. Zawiera encje i obiekty wartości (np. `Money` w groszach), maszynę stanów przejazdu, wycenę przejazdu według wersji cennika, reguły stref, politykę uprawnień ([ADR 0028](0028-uzytkownicy-role-uprawnienia.md)), katalog pól wydruków ([ADR 0030](0030-wydruki-z-szablonow-docx.md)), a także interfejsy repozytoriów i usług zewnętrznych (SMS, płatności, magazyn plików, zegar). Testy jednostkowe w Vitest bez bazy.
- **`packages/db`**: migracje SQL, schemat Drizzle ([ADR 0021](0021-migracje-sql-schemat-drizzle-z-bazy.md)) i implementacje repozytoriów z core. Repozytoria są pogrupowane według modułów z [§5.2](../arc42/05-widok-blokow.md), więc granica „moduł nie czyta tabel innego modułu” jest widoczna w strukturze katalogów. Zapytania PostGIS, widoki, funkcje i procedury ([ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md)) wywołujemy przez Drizzle (`sql`, `pgView`), a nie przez surowy `pg`. Surowy `pg` zostaje tylko w migratorze i w przygotowaniu baz testowych.
- **`apps/api`**: kontrolery, strażnicy, wstrzykiwanie zależności, transport (HTTP, MQTT, Socket.IO), zadania pg-boss. Serwis aplikacyjny pobiera dane przez repozytorium, wywołuje klasę z core i zapisuje wynik w jednej transakcji. Nie zawiera reguł biznesowych.

Transakcja jest pojęciem `packages/db` (jednostka pracy przekazywana do repozytoriów), żeby core nie znał Drizzle.

Punkt 4 (obie aplikacje używają tych samych projektów) spełniamy przez wspólny backend: aplikacja mobilna i panel korzystają z core i db przez API ([ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md)). Jeśli prowadzący uzna, że to nie wystarcza (pytanie 2), serwerowa część Next.js może importować `packages/core` i `packages/db` bezpośrednio, bo core nie zależy od frameworka.

## Konsekwencje

Pozytywne:

- Punkty 3b, 3c i 9 można pokazać wprost: trzy pakiety o jednej odpowiedzialności.
- Reguły domeny (przejścia stanów, wycena, uprawnienia) mają szybkie testy jednostkowe niezależne od bazy.
- Wzorce do rozdziału o punkcie 6: porty i adaptery, repozytorium, jednostka pracy, maszyna stanów.

Negatywne i ryzyka:

- Więcej kodu pośredniego (interfejsy, mapowanie wierszy na encje) niż przy zapytaniach w serwisach.
- Pokusa, żeby wstawić regułę do zapytania SQL albo serwisu NestJS. Pilnujemy tego w przeglądzie i regułą lintera zakazującą importu `drizzle-orm`, `pg` i `@nestjs/*` w `packages/core`.
- Refaktoryzacja `ZonesService` i `HealthController` przed iteracją 1.

## Powiązane

[ADR 0003](0003-monolit-modularny.md), [ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0010](0010-postgresql-postgis-drizzle.md), [ADR 0021](0021-migracje-sql-schemat-drizzle-z-bazy.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [§5](../arc42/05-widok-blokow.md), [wymagania uczelni](../wymagania-uczelni.md) (punkty 3b, 3c, 4, 6, 9)
