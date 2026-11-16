# System wypożyczania hulajnóg elektrycznych (projekt inżynierski)

Projekt jednoosobowy. Priorytet: jakość i dokumentacja pomocna przy obronie. Komunikacja i dokumentacja po polsku, kod i identyfikatory po angielsku.

## Wymagania uczelni (nadrzędne)
Projekt musi spełnić 19 wymagań z `docs/wymagania-uczelni.md` (m.in. min. 30 tabel z widokami, procedurami i funkcjami; osobne projekty bazy i logiki biznesowej; zarządzanie użytkownikami i grupami uprawnień; CRUD z filtrowaniem i sortowaniem dla wszystkich tabel; min. 50 widoków; treści sterowane z panelu, bez tekstów na sztywno; raporty PDF/Excel; wydruki z szablonów Word). Przed każdą większą decyzją sprawdź ten plik. Nie zaczynaj iteracji 1 przed wykonaniem sekcji „Plan dostosowania”.

## Najważniejsze zasady
- Klienci znają tylko API, hulajnogi znają tylko broker MQTT, cała logika biznesowa jest w backendzie.
- Backend to monolit modularny (NestJS 12, ESM, Fastify). Moduł nie czyta tabel innego modułu bezpośrednio.
- Hulajnogi są symulowane (`apps/simulator`) i mówią protokołem z `docs/kontrakty/asyncapi-mqtt.yaml`.
- Każda decyzja architektoniczna = ADR w `docs/adr/` (szablon 0000). Zmiana decyzji = nowy ADR, starych nie edytujemy.
- Nie zgadujemy danych geograficznych ani wersji pakietów: sprawdzamy je. Instalujemy tylko wersje starsze niż 3 dni.

## Dokumentacja (czytaj przed większą zmianą)
- `docs/arc42/` architektura, `docs/adr/` decyzje, `docs/model-danych/` schemat, `docs/kontrakty/` AsyncAPI.
- `docs/iteracje/` plan iteracji 0–9 i definicja „zrobione”; `docs/dziennik.md` dziennik prac.
- Definicja „zrobione”: kod + testy + aktualne diagramy i kontrakty + ADR + wpis w dzienniku + scenariusz demo.

## Struktura
- `apps/api` NestJS, `apps/web` Next.js (strona + /admin), `apps/mobile` Expo, `apps/simulator` Node + mqtt.js
- `packages/core` logika biznesowa i porty repozytoriów, bez NestJS, Drizzle, `pg` i `node:*` (pilnuje lint; ADR 0025)
- `packages/shared` schematy Zod (kontrakt MQTT), formatowanie kwot; `packages/db` migracje SQL, schemat Drizzle, repozytoria, dane startowe
- `apps/api` sięga do danych tylko przez `@hulajnogi/db` (import `pg` w `src` blokuje lint); reguły biznesowe tylko w `packages/core`
- `infra/` Docker Compose: PostGIS, Mosquitto, SeaweedFS (S3), OSRM (woj. śląskie)

## Polecenia
- `pnpm infra:up` infrastruktura; `pnpm db:migrate`, `pnpm db:places`, `pnpm db:seed`
- `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (testy bazy wymagają DATABASE_URL)
- Po każdej migracji: `pnpm db:pull` (regeneruje `packages/db/src/schema`, nie edytować ręcznie; wyjątek: `telemetry.ts`).
- Zależności Expo: `pnpm --filter @hulajnogi/mobile exec expo install <pakiet>`.

## Zasady danych
- Kwoty w groszach (liczby całkowite); portfel jako księga `wallet_ledger` tylko do dopisywania.
- Cennik wersjonowany; przejazd pamięta wersję z chwili startu. Rezerwacja to pierwszy stan przejazdu.
- Spójność pilnuje baza (indeksy częściowe). Idempotencja: commandId, idempotency_key, provider_event_id.
- Czas w UTC, geometria SRID 4326. Błędy API: `{ code, message, details }`.
- Migracje piszemy ręcznie w SQL w `packages/db/migrations`; wykonanej migracji nie zmieniamy.

## Kierunek wizualny
Styl produktowy (Apple/Tesla). Paleta: #F6F6F3, #16181D, kobalt #2B3FF5 (jedyny kolor akcji), #E3E3DE, #6B6E75; ostrzeżenia #8F5500, błędy #C62F2F. Inter; liczby zawsze Medium.
- Makiety: `docs/projekt/` (spis w `docs/projekt/README.md`). Każdy ekran jako PNG (obejrzyj przed implementacją) i HTML (dokładne wartości CSS). Implementuj ekrany wiernie według makiety; odstępstwa zapisuj w dzienniku.
- Tokeny: `docs/projekt/tokens.json`; zasady i komponenty: `docs/projekt/design-system.md`. Rendery: `docs/projekt/rendery/`, ikona: `docs/projekt/ikona/`.
- `docs/projekt/ekrany/00-eksploracja/` to archiwum odrzuconych kierunków, nie implementować.
- Kanwa w claude.ai jest archiwum; źródłem prawdy jest repozytorium. Nowe makiety można tworzyć jako HTML w `docs/projekt/ekrany/` według design systemu.

## Stan: iteracja 0 zakończona lokalnie (2026-11-10)
Gotowe: monorepo, Docker Compose (PostGIS, Mosquitto, SeaweedFS, OSRM), migrator i migracja 0001, schemat Drizzle, dane startowe ze sprawdzonymi współrzędnymi Rybnika, pakiet shared, szkielety api/web/mobile/simulator, CI, README, ADR 0021–0024. Pełny przebieg lint/typecheck/test/build przechodzi.
Do zrobienia przed iteracją 1:
- [x] Wymagania uczelni: „Plan dostosowania” z `docs/wymagania-uczelni.md` (ADR 0025–0031, migracja 0002, `packages/core`, plan iteracji 0–9, makieta wzorca widoku tabeli w `docs/projekt/ekrany/17-panel-wzorce/`). Makiety ról i uprawnień przed iteracją 2, pozostałych nowych ekranów przed iteracjami 7–8.
- [ ] Wypchnąć repozytorium na GitHuba i potwierdzić zielony przebieg `.github/workflows/ci.yml`; scalić gałąź `iteracja-0-domkniecie` z `main`
- [ ] Autor: obejrzeć strefy na mapie (współrzędne w `packages/db/seed/rybnik-places.json`, wyniki OSM w dzienniku)

## Uwagi środowiskowe
- `.env` w katalogu głównym czytają API, symulator, CLI bazy, testy (Vitest) i `pnpm infra:*`; zmienne z powłoki mają pierwszeństwo.
- Porty: `POSTGRES_PORT`, `OSRM_PORT` (macOS: 5000 zajmuje AirPlay), `WEB_PORT` (zmienna powłoki). Obrazy kontenerów przypięte do wersji; OSRM z `ghcr.io/project-osrm`.
- `drizzle-kit pull` losowo zamienia klasy operatorów w indeksach wielokolumnowych; po `db:pull` cofnij takie różnice, jeśli migracja nie dotyczyła tych indeksów.
- `apps/mobile` ma własny `eslint.config.js` (eslint-config-expo) i ESLint 9; reszta repo ESLint 10.

## Otwarte decyzje
Nazwa marki ([nazwa]); wartości biznesowe (ceny, czas rezerwacji, minimalne saldo, próg baterii, limit w wolnej strefie, wiek, opłata za parkowanie poza strefą, zwrot salda; w seedzie są wartości deweloperskie); naliczanie czasu przy utracie łączności.
