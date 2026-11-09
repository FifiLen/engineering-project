# System wypożyczania hulajnóg elektrycznych

Projekt inżynierski: aplikacja mobilna, panel operatora, backend i symulator floty w Rybniku. Dokumentacja: [`docs/`](docs/README.md).

## Wymagania
Node 24 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.

## Uruchomienie
```bash
cp .env.example .env
pnpm install
pnpm infra:up          # PostGIS, Mosquitto, MinIO, OSRM (pierwsze uruchomienie OSRM trwa kilka minut)
pnpm db:migrate
pnpm db:places         # współrzędne miejsc z OpenStreetMap; sprawdź wypisane adresy
pnpm db:seed
pnpm dev               # api :3001 (/docs), web :3000, symulator
pnpm --filter @hulajnogi/mobile dev   # aplikacja mobilna w Expo
```

## Testy
```bash
DATABASE_URL=postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi pnpm test
```
