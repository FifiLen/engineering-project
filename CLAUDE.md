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
- `pnpm db:staff:create --email <e-mail> --name "<imię i nazwisko>"` zaprasza administratora (link aktywacji w terminalu, `PANEL_URL`)
- `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (testy bazy wymagają DATABASE_URL)
- `pnpm api:openapi` po zmianie kontrolerów (test API porównuje `docs/kontrakty/openapi.json` z kodem)
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

## Stan: iteracja 2 zakończona (2026-11-16)
Iteracja 0: monorepo, Docker Compose, migracje 0001–0002, `packages/core`, dane startowe Rybnika, CI, ADR 0001–0031 (repozytorium github.com/FifiLen/engineering-project, gałąź `main`).
Iteracja 1 (`docs/iteracje/iteracja-01-symulator-telemetria.md`): symulator z własnym połączeniem MQTT na hulajnogę i przejazdami pokazowymi (ADR 0034), telemetria partiami i status floty w core i w bazie (ADR 0033, migracja 0003), Socket.IO pokój `fleet`, wspólny mechanizm list i definicje zasobów (`scooters`, `scooter-models`), panel: mapa floty, lista i formularz floty i modeli, etykiety w plikach tłumaczeń z regułą lintera (ADR 0032).
Iteracja 2 (`docs/iteracje/iteracja-02-konta-dostep.md`): migracja 0004 (sesje i zaproszenia operatorów, blokada klienta, strażnik ostatniego `roles.manage` w bazie), reguły kont w core, repozytoria kont, logowanie klientów kodem SMS i operatorów z TOTP (ADR 0035), strażnik dostępu na każdym punkcie, dziennik audytu w transakcji z historią rekordu, panel: logowanie, operatorzy, role z macierzą, użytkownicy, dziennik, dokumenty prawne; aplikacja: rejestracja, zgody, blokada; OpenAPI w `docs/kontrakty/openapi.json`.
Do zrobienia:
- [x] Wypchnąć iterację 2 i potwierdzić zielone CI (2026-11-16, commit `63fb0bf`).
- [x] Przed iteracją 3: plan iteracji 3 (wypożyczenie) z profilem, ustawieniami i usunięciem konta w aplikacji razem z nawigacją (2026-11-16, `docs/iteracje/iteracja-03-wypozyczenie.md`).
- [ ] Przed iteracją 3: odpowiedzi autora na pytania i decyzje D1–D8 z planu, makiety brakujących stanów (lista w planie), ADR 0036–0041.

## Uwagi środowiskowe
- `.env` w katalogu głównym czytają API, symulator, CLI bazy, testy (Vitest) i `pnpm infra:*`; zmienne z powłoki mają pierwszeństwo.
- Porty: `POSTGRES_PORT`, `OSRM_PORT` (macOS: 5000 zajmuje AirPlay), `WEB_PORT` (zmienna powłoki). Obrazy kontenerów przypięte do wersji; OSRM z `ghcr.io/project-osrm`.
- `drizzle-kit pull` losowo zamienia klasy operatorów w indeksach wielokolumnowych; po `db:pull` cofnij takie różnice, jeśli migracja nie dotyczyła tych indeksów.
- `apps/mobile` ma własny `eslint.config.js` (eslint-config-expo) i ESLint 9; reszta repo ESLint 10. Reguła tekstów w JSX jest w obu plikach (kopia).
- Teksty w JSX tylko przez `t('klucz')` z `apps/web/messages/pl.json` lub `apps/mobile/src/i18n/pl.json` (ADR 0032); nowe pole zasobu panelu = klucz `resource.<zasób>.fields.<pole>`.
- Nowy zasób panelu: definicja w `packages/shared/src/admin`, `ListSource` w repozytorium `packages/db`, kontroler z `ListQueryPipe`, komponenty `ResourceList`/`ResourceForm` w `apps/web/components/admin`.
- MapLibre 6: wątek roboczy kopiuje `apps/web/scripts/maplibre-worker.mjs` do `public/` (w `dev` i `build`); plik jest w `.gitignore`.
- Symulator trzyma stan w `apps/simulator/.state/fleet.json` (usunięcie = pozycje z danych startowych). Backend łączy się z MQTT ze stałym `MQTT_CLIENT_ID`: nie uruchamiaj dwóch API naraz na tym samym brokerze.
- Panel: `NEXT_PUBLIC_API_URL` (domyślnie http://localhost:3001); na komputerze autora port 3000 jest zajęty: `WEB_PORT=3002`.
- Aplikacja: `EXPO_PUBLIC_API_URL` (domyślnie http://localhost:3001); token odświeżający w `expo-secure-store`, w wersji web w `localStorage`. Typy tras Expo Router (`.expo/types`) odświeża `expo start`, nie `expo export`. Podgląd w przeglądarce: konfiguracje `api-preview` (API na 3005 bez MQTT, kod SMS w logu) i `mobile-web` (8082) w `.claude/launch.json`.
- Każdy punkt API deklaruje dostęp: `@Public()`, `@CustomerAuth()`, `@StaffAuth()` albo `@RequirePermission('…')` (ADR 0035); punkt bez deklaracji kończy się `403 PERMISSION_NOT_DECLARED`. Kod SMS w środowisku deweloperskim jest w logu API. Testy panelu: pomocnik `staffToken` w `apps/api/test/helpers.ts`.

## Otwarte decyzje
Nazwa marki ([nazwa]); wartości biznesowe (ceny, czas rezerwacji, minimalne saldo, próg baterii, limit w wolnej strefie, wiek, opłata za parkowanie poza strefą, zwrot salda; w seedzie są wartości deweloperskie); naliczanie czasu przy utracie łączności.
