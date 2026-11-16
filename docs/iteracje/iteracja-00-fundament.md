# Iteracja 0: fundament

**Status:** zakończona lokalnie (10 listopada 2026); czeka na pierwszy przebieg CI w GitHub Actions i scalenie z `main`

## Cel
Przygotować repozytorium, infrastrukturę lokalną i dokumentację tak, żeby kolejne iteracje mogły skupić się wyłącznie na funkcjach.

## Zakres
- [x] Monorepo pnpm + Turborepo ze strukturą z [§5.3](../arc42/05-widok-blokow.md)
- [x] Wspólna konfiguracja TypeScript, ESLint, Prettier
- [x] Docker Compose: PostgreSQL z PostGIS, Mosquitto, SeaweedFS (S3, [ADR 0024](../adr/0024-magazyn-plikow-seaweedfs.md)), OSRM (województwo śląskie)
- [x] Pakiet `db`: schemat Drizzle odpowiadający [schema.sql](../model-danych/schema.sql), pierwsza migracja
- [x] Ręczna migracja dla elementów spoza Drizzle: partycje telemetrii, indeksy częściowe
- [x] Skrypt danych startowych: obszar działania Rybnika, pierwsze strefy, cennik, flota, konto operatora
- [x] Szkielety aplikacji `api`, `web`, `mobile`, `simulator` uruchamiane jednym poleceniem
- [x] GitHub Actions: lint, typy, testy, build
- [x] Dokumentacja: arc42, ADR 0001–0024, AsyncAPI dla MQTT, README z instrukcją uruchomienia

## Dostosowanie do wymagań uczelni (16 listopada 2026)
- [x] Analiza 19 wymagań i odpowiedzi na pytania do prowadzącego ([wymagania uczelni](../wymagania-uczelni.md))
- [x] ADR 0025–0031
- [x] Migracja 0002: role i uprawnienia, treści, raporty, wydruki, serwis, paragony; widoki, funkcje, procedury
- [x] `packages/core` i dostęp do danych tylko przez `packages/db`
- [x] Plan iteracji 0–9
- [x] Makieta wzorca widoku tabeli: lista, filtry, formularz, stany ([projekt](../projekt/README.md#panel-operatora-wzorzec-widoku-tabeli)); makiety ról i uprawnień przed iteracją 2, treści, mediów, raportów i szablonów przed iteracjami 7 i 8

## Scenariusz demo
1. `cp .env.example .env && pnpm install`.
2. `pnpm infra:up` uruchamia infrastrukturę.
3. `pnpm db:migrate && pnpm db:seed` tworzy schemat i dane Rybnika.
4. `pnpm dev` uruchamia wszystkie aplikacje.
5. `curl "http://localhost:3001/zones/lookup?lat=50.095541&lon=18.542034"` zwraca dla punktu na Rynku strefę parkowania `P-01`, strefę wolnej jazdy `S-01` i `"canPark": true`.

## Ryzyka
- Drizzle nie obsługuje partycjonowania deklaratywnie, stąd ręczna migracja SQL i ręczny `telemetry.ts`.
- Obrazy kontenerów potrafią zniknąć z rejestru (MinIO, stary OSRM); wersje są przypięte, a zamiany opisuje dziennik.

## Wynik
Opis wykonanych prac, weryfikacji i długu technicznego: [dziennik](../dziennik.md#iteracja-0-fundament-10-listopada-2026).
