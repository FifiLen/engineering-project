# Iteracja 0: fundament

**Status:** zaplanowana

## Cel
Przygotować repozytorium, infrastrukturę lokalną i dokumentację tak, żeby kolejne iteracje mogły skupić się wyłącznie na funkcjach.

## Zakres
- [ ] Monorepo pnpm + Turborepo ze strukturą z [§5.3](../arc42/05-widok-blokow.md)
- [ ] Wspólna konfiguracja TypeScript, ESLint, Prettier
- [ ] Docker Compose: PostgreSQL z PostGIS, Mosquitto, MinIO, OSRM (województwo śląskie)
- [ ] Pakiet `db`: schemat Drizzle odpowiadający [schema.sql](../model-danych/schema.sql), pierwsza migracja
- [ ] Ręczna migracja dla elementów spoza Drizzle: partycje telemetrii, indeksy częściowe
- [ ] Skrypt danych startowych: obszar działania Rybnika, pierwsze strefy, cennik, flota, konto operatora
- [ ] Szkielety aplikacji `api`, `web`, `mobile`, `simulator` uruchamiane jednym poleceniem
- [ ] GitHub Actions: lint, typy, testy, build
- [ ] Dokumentacja: arc42, ADR 0001–0020, AsyncAPI dla MQTT

## Scenariusz demo
1. `docker compose up` uruchamia infrastrukturę.
2. `pnpm db:migrate && pnpm db:seed` tworzy schemat i dane Rybnika.
3. `pnpm dev` uruchamia wszystkie aplikacje.
4. Zapytanie o strefę dla punktu na Rynku zwraca strefę parkowania.

## Ryzyka
- Drizzle nie obsługuje partycjonowania deklaratywnie, stąd ręczna migracja SQL.
