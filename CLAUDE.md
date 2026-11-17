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

## Stan: iteracja 4 zakończona (2026-11-17)
Iteracja 0: monorepo, Docker Compose, migracje 0001–0002, `packages/core`, dane startowe Rybnika, CI, ADR 0001–0031 (repozytorium github.com/FifiLen/engineering-project, gałąź `main`).
Iteracja 1 (`docs/iteracje/iteracja-01-symulator-telemetria.md`): symulator z własnym połączeniem MQTT na hulajnogę i przejazdami pokazowymi (ADR 0034), telemetria partiami i status floty w core i w bazie (ADR 0033, migracja 0003), Socket.IO pokój `fleet`, wspólny mechanizm list i definicje zasobów (`scooters`, `scooter-models`), panel: mapa floty, lista i formularz floty i modeli, etykiety w plikach tłumaczeń z regułą lintera (ADR 0032).
Iteracja 2 (`docs/iteracje/iteracja-02-konta-dostep.md`): migracja 0004 (sesje i zaproszenia operatorów, blokada klienta, strażnik ostatniego `roles.manage` w bazie), reguły kont w core, repozytoria kont, logowanie klientów kodem SMS i operatorów z TOTP (ADR 0035), strażnik dostępu na każdym punkcie, dziennik audytu w transakcji z historią rekordu, panel: logowanie, operatorzy, role z macierzą, użytkownicy, dziennik, dokumenty prawne; aplikacja: rejestracja, zgody, blokada; OpenAPI w `docs/kontrakty/openapi.json`.
Iteracja 3 (`docs/iteracje/iteracja-03-wypozyczenie.md`, ADR 0036–0042): decyzje autora D1–D8 i odpowiedzi 1–10 w planie, makiety `20-mobile-wypozyczenie` i `21-panel-przejazdy`, migracja 0005, reguły przejazdu i wycena w core, moduł Wypożyczenia w API (rezerwacja, przejazd z komendami MQTT z `expiresAt`, zdalne zakończenie, profil, usunięcie konta), pg-boss (schemat `pgboss`), symulator jadący do strefy po odblokowaniu (`control offline|silent|online`), panel: przejazdy, aplikacja: mapa, wypożyczenie, profil.
Iteracja 4 (`docs/iteracje/iteracja-04-strefy.md`, ADR 0043–0048): makiety `22-mobile-strefy` i `23-panel-strefy`, migracja 0006 (reguły geometrii stref w bazie, `scooter_zone_presence`, `scooter_zone_control`, `RELEASE_STOP`), walidacja stref, wykrywanie zmian z histerezą i sterowanie hulajnogą w core, moduł Strefy w API (edytor w panelu, śledzenie stref w przejeździe, komendy stref uzgadniane ze stanem), moduł Geo (trasy z OSRM rower i pieszo, Photon), kontrakt MQTT 1.2.0, symulator ze strefami z API (`control goto`), panel: edytor stref (Terra Draw), aplikacja: legenda, wyszukiwanie, trasy, komunikaty stref, prowadzenie do strefy.
Do zrobienia:
- [x] Wypchnąć iterację 3 i potwierdzić zielone CI (2026-11-17, commit `f010476`).
- [ ] Development build aplikacji z natywną mapą i aparatem (Xcode jest już zainstalowany) i sprawdzenie ekranów awarii w aplikacji (`control silent`).
- [x] Przed iteracją 4: plan iteracji 4 (2026-11-17, `docs/iteracje/iteracja-04-strefy.md`).
- [x] Przed iteracją 4: odpowiedzi autora na pytania 1–10 i decyzje D1–D8 (2026-11-17, wszystkie rekomendacje; strefa zakazu: Park im. św. Jana Sarkandra).
- [x] Przed iteracją 4: makiety brakujących stanów (2026-11-17, `22-mobile-strefy`, `23-panel-strefy`, 14 plansz).
- [x] Przed iteracją 4: ADR 0043–0048 (2026-11-17, zaakceptowane).
- [x] Iteracja 4: implementacja według planu (2026-11-17).
- [x] Wypchnąć iterację 4 i potwierdzić zielone CI (2026-11-17, commit `ca1f68e`).
- [x] Przed iteracją 5: plan iteracji 5 (2026-11-17, `docs/iteracje/iteracja-05-platnosci.md`).
- [x] Przed iteracją 5: odpowiedzi autora na pytania 1–12 i decyzje D1–D8 (2026-11-17, wszystkie rekomendacje).
- [x] Przed iteracją 5: makiety brakujących stanów (2026-11-17, `24-mobile-platnosci`, `25-panel-platnosci`, 18 plansz).
- [x] Przed iteracją 5: ADR 0049–0054 (2026-11-17, zaakceptowane).
- [ ] Iteracja 5: implementacja według planu.
- [ ] Konto Stripe w trybie testowym z kluczami w `.env` i Stripe CLI (autor; bez nich działa atrapa operatora).

## Uwagi środowiskowe
- `.env` w katalogu głównym czytają API, symulator, CLI bazy, testy (Vitest) i `pnpm infra:*`; zmienne z powłoki mają pierwszeństwo.
- Porty: `POSTGRES_PORT`, `OSRM_PORT` (macOS: 5000 zajmuje AirPlay; na komputerze autora 5001), `OSRM_FOOT_PORT` (5002, profil pieszy), `WEB_PORT` (zmienna powłoki). Obrazy kontenerów przypięte do wersji; OSRM z `ghcr.io/project-osrm`.
- `drizzle-kit pull` losowo zamienia klasy operatorów w indeksach wielokolumnowych; po `db:pull` cofnij takie różnice, jeśli migracja nie dotyczyła tych indeksów.
- `apps/mobile` ma własny `eslint.config.js` (eslint-config-expo) i ESLint 9; reszta repo ESLint 10. Reguła tekstów w JSX jest w obu plikach (kopia).
- Teksty w JSX tylko przez `t('klucz')` z `apps/web/messages/pl.json` lub `apps/mobile/src/i18n/pl.json` (ADR 0032); nowe pole zasobu panelu = klucz `resource.<zasób>.fields.<pole>`.
- Nowy zasób panelu: definicja w `packages/shared/src/admin`, `ListSource` w repozytorium `packages/db`, kontroler z `ListQueryPipe`, komponenty `ResourceList`/`ResourceForm` w `apps/web/components/admin`.
- MapLibre 6: wątek roboczy kopiuje `apps/web/scripts/maplibre-worker.mjs` (i `apps/mobile/scripts/maplibre-worker.mjs` w `dev`, `start`, `web`) do `public/`; plik jest w `.gitignore`.
- Symulator trzyma stan w `apps/simulator/.state/fleet.json` (usunięcie = pozycje z danych startowych). Backend łączy się z MQTT ze stałym `MQTT_CLIENT_ID`: nie uruchamiaj dwóch API naraz na tym samym brokerze.
- Panel: `NEXT_PUBLIC_API_URL` (domyślnie http://localhost:3001); na komputerze autora port 3000 jest zajęty: `WEB_PORT=3002`.
- Aplikacja: `EXPO_PUBLIC_API_URL` (domyślnie http://localhost:3001); token odświeżający w `expo-secure-store`, w wersji web w `localStorage`. Typy tras Expo Router (`.expo/types`) odświeża `expo start`, nie `expo export`. Podgląd w przeglądarce: konfiguracje `api-preview` (API na 3005 bez MQTT, kod SMS w logu) i `mobile-web` (8082) w `.claude/launch.json`.
- Strefy (ADR 0043, 0044): Telemetria po zapisie partii woła `ZoneTracker`, przejścia zapisuje i komendy stref uzgadnia `RentalsService`; komendy stref mają `rental_id`, ale nie blokują pauzy (indeks tylko dla `LOCK`/`UNLOCK`). Testy API ustawiają `OSRM_URL` na nieużywany port, żeby trasy były linią prostą niezależnie od lokalnego OSRM.
- Zadania w tle: pg-boss w API (`JOBS_ENABLED`, testy API wyłączają kolejkę i wołają `JobsService.run`); zadanie planowane w transakcji przez `sendInTransaction` (ADR 0037).
- Każdy punkt API deklaruje dostęp: `@Public()`, `@CustomerAuth()`, `@StaffAuth()` albo `@RequirePermission('…')` (ADR 0035); punkt bez deklaracji kończy się `403 PERMISSION_NOT_DECLARED`. Kod SMS w środowisku deweloperskim jest w logu API. Testy panelu: pomocnik `staffToken` w `apps/api/test/helpers.ts`.

## Otwarte decyzje
Nazwa marki ([nazwa]); wartości biznesowe (ceny, czas rezerwacji, minimalne saldo, próg baterii, wiek, wysokość opłaty za odholowanie; w seedzie są wartości deweloperskie); stawka VAT (robocza 23%, do sprawdzenia przez autora); naliczanie czasu przy utracie łączności.
