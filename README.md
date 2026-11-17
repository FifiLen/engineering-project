# System wypożyczania hulajnóg elektrycznych

Projekt inżynierski: aplikacja mobilna, panel operatora, backend i symulator floty w Rybniku. Dokumentacja: [`docs/`](docs/README.md) (architektura arc42, decyzje ADR, model danych, kontrakt MQTT, plan iteracji).

## Struktura

| Katalog | Zawartość |
|---|---|
| `apps/api` | Backend: NestJS 12 z Fastify, REST i dokumentacja OpenAPI |
| `apps/web` | Next.js: strona promocyjna i panel operatora (`/admin`) |
| `apps/mobile` | Aplikacja mobilna w Expo |
| `apps/simulator` | Symulator floty, klient MQTT |
| `packages/core` | Logika biznesowa bez frameworka: maszyna stanów przejazdu, reguły stref, uprawnienia, porty repozytoriów ([ADR 0025](docs/adr/0025-logika-biznesowa-packages-core.md)) |
| `packages/shared` | Schematy Zod kontraktu MQTT, formatowanie kwot |
| `packages/db` | Migracje SQL, schemat Drizzle, repozytoria (implementacje portów z core), dane startowe dla Rybnika |
| `infra/` | Docker Compose: PostGIS, Mosquitto, SeaweedFS (S3), OSRM |

## Wymagania

- Node 24 (`.nvmrc`; z nvm: `nvm install && nvm use`)
- pnpm 10 (`corepack enable` albo instalacja pnpm; wersję wskazuje `packageManager` w `package.json`)
- Docker Desktop, około 3 GB miejsca na dane tras OSRM

## Pierwsze uruchomienie

```bash
cp .env.example .env
pnpm install
pnpm infra:up          # pierwsze uruchomienie pobiera wycinek OSM woj. śląskiego i przygotowuje trasy (kilka minut)
pnpm db:migrate        # schemat bazy
pnpm db:seed           # strefy Rybnika, cennik, flota, konto operatora
pnpm dev               # api :3001 (dokumentacja: /docs), web :3000, symulator
```

Aplikacja mobilna działa osobno: `pnpm --filter @hulajnogi/mobile dev`.

Plik `.env` czytają skrypty infrastruktury, API, symulator i polecenia bazy. Zmienne ustawione w powłoce mają pierwszeństwo przed plikiem.

### Zajęte porty

| Usługa | Port | Zmienne w `.env` |
|---|---|---|
| PostgreSQL | 5432 | `POSTGRES_PORT` i port w `DATABASE_URL` |
| OSRM | 5000 | `OSRM_PORT` i `OSRM_URL` (na macOS port 5000 zajmuje Odbiornik AirPlay) |
| Mosquitto | 1883, 9001 (WebSocket) | |
| SeaweedFS (S3) | 8333 | `S3_ENDPOINT` |
| Next.js (web) | 3000 | zmienna powłoki `WEB_PORT`, np. `WEB_PORT=3002 pnpm dev` |
| API | 3001 | `API_PORT` |

Jeżeli inny projekt używa już portu 5432, ustaw `POSTGRES_PORT=5433` i `DATABASE_URL=postgres://hulajnogi:hulajnogi@localhost:5433/hulajnogi`, a potem uruchom `pnpm infra:up` ponownie.

## Sprawdzenie

```bash
curl http://localhost:3001/health
curl "http://localhost:3001/zones/lookup?lat=50.095541&lon=18.542034"
curl "http://localhost:3001/admin/scooters?facets=fleetStatus&pageSize=3"
```

Punkt na Rynku zwraca strefę parkowania `P-01`, strefę wolnej jazdy `S-01`, obszar działania i `"canPark": true`. Lista floty po uruchomieniu symulatora ma 40 hulajnóg online.

Panel operatora: `http://localhost:3000/admin` (mapa floty na żywo, flota, modele hulajnóg). Logowanie operatorów powstaje w iteracji 2, do tego czasu panel i API uruchamiamy tylko lokalnie. Pełny scenariusz demo: [iteracja 1](docs/iteracje/iteracja-01-symulator-telemetria.md#scenariusz-demo).

### Symulator floty

Każda wirtualna hulajnoga ma własne połączenie MQTT i jeździ trasami rowerowymi z OSRM ([ADR 0034](docs/adr/0034-symulator-floty.md)). Ustawienia w `.env`: `SIM_FLEET_SIZE` (domyślnie 40, numery jak w danych startowych), `SIM_TELEMETRY_INTERVAL_MS` (5000), `SIM_RIDES_PER_HOUR` (przejazdy pokazowe, domyślnie 0). Od iteracji 3 hulajnoga odblokowana przez klienta sama jedzie trasą z OSRM do losowej strefy parkowania i tam czeka na blokadę ([ADR 0039](docs/adr/0039-symulator-w-trakcie-przejazdu.md)). Komendy po terminie `expiresAt` są odrzucane ([ADR 0038](docs/adr/0038-wygasanie-komend-mqtt.md)). Stan hulajnóg zapisuje się w `apps/simulator/.state/fleet.json`; usunięcie pliku przywraca pozycje z danych startowych.

Awarie do demo: `pnpm --filter @hulajnogi/simulator control offline 0142` rozłącza hulajnogę (broker publikuje Last Will), `control silent 27` zostawia ją połączoną, ale bez potwierdzeń komend, `control online 0142 27` przywraca obie, a `control` bez argumentów wypisuje stan (plik `apps/simulator/.state/control.json`).

## Polecenia

| Polecenie | Działanie |
|---|---|
| `pnpm dev` | Wszystkie aplikacje w trybie deweloperskim |
| `pnpm lint`, `pnpm typecheck` | ESLint i kontrola typów w całym repozytorium |
| `pnpm test` | Testy; testy bazy i API wymagają `DATABASE_URL` i są bez niej pomijane |
| `pnpm build` | Build wszystkich pakietów |
| `pnpm infra:up`, `pnpm infra:down` | Start i zatrzymanie kontenerów |
| `pnpm db:migrate` | Migracje SQL z `packages/db/migrations` |
| `pnpm db:pull` | Regeneracja schematu Drizzle z bazy, po każdej nowej migracji ([ADR 0021](docs/adr/0021-migracje-sql-schemat-drizzle-z-bazy.md)) |
| `pnpm db:places [--force]` | Współrzędne miejsc z OpenStreetMap (Nominatim) do `packages/db/seed/rybnik-places.json`; sprawdź wypisane adresy |
| `pnpm db:seed` | Dane startowe |

## Testy

```bash
pnpm test
```

Testy bazy tworzą tymczasową bazę, wykonują na niej migracje i usuwają ją na końcu. Bazę wskazuje `DATABASE_URL` z `.env` albo ze zmiennej środowiskowej. Ten sam przebieg (lint, typy, migracje, testy, build) wykonuje CI w GitHub Actions na kontenerze `postgis/postgis:16-3.4` (`.github/workflows/ci.yml`).
