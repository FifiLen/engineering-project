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

## Stan: iteracja 6 zakończona (2026-11-18)
Iteracja 0: monorepo, Docker Compose, migracje 0001–0002, `packages/core`, dane startowe Rybnika, CI, ADR 0001–0031 (repozytorium github.com/FifiLen/engineering-project, gałąź `main`).
Iteracja 1 (`docs/iteracje/iteracja-01-symulator-telemetria.md`): symulator z własnym połączeniem MQTT na hulajnogę i przejazdami pokazowymi (ADR 0034), telemetria partiami i status floty w core i w bazie (ADR 0033, migracja 0003), Socket.IO pokój `fleet`, wspólny mechanizm list i definicje zasobów (`scooters`, `scooter-models`), panel: mapa floty, lista i formularz floty i modeli, etykiety w plikach tłumaczeń z regułą lintera (ADR 0032).
Iteracja 2 (`docs/iteracje/iteracja-02-konta-dostep.md`): migracja 0004 (sesje i zaproszenia operatorów, blokada klienta, strażnik ostatniego `roles.manage` w bazie), reguły kont w core, repozytoria kont, logowanie klientów kodem SMS i operatorów z TOTP (ADR 0035), strażnik dostępu na każdym punkcie, dziennik audytu w transakcji z historią rekordu, panel: logowanie, operatorzy, role z macierzą, użytkownicy, dziennik, dokumenty prawne; aplikacja: rejestracja, zgody, blokada; OpenAPI w `docs/kontrakty/openapi.json`.
Iteracja 3 (`docs/iteracje/iteracja-03-wypozyczenie.md`, ADR 0036–0042): decyzje autora D1–D8 i odpowiedzi 1–10 w planie, makiety `20-mobile-wypozyczenie` i `21-panel-przejazdy`, migracja 0005, reguły przejazdu i wycena w core, moduł Wypożyczenia w API (rezerwacja, przejazd z komendami MQTT z `expiresAt`, zdalne zakończenie, profil, usunięcie konta), pg-boss (schemat `pgboss`), symulator jadący do strefy po odblokowaniu (`control offline|silent|online`), panel: przejazdy, aplikacja: mapa, wypożyczenie, profil.
Iteracja 4 (`docs/iteracje/iteracja-04-strefy.md`, ADR 0043–0048): makiety `22-mobile-strefy` i `23-panel-strefy`, migracja 0006 (reguły geometrii stref w bazie, `scooter_zone_presence`, `scooter_zone_control`, `RELEASE_STOP`), walidacja stref, wykrywanie zmian z histerezą i sterowanie hulajnogą w core, moduł Strefy w API (edytor w panelu, śledzenie stref w przejeździe, komendy stref uzgadniane ze stanem), moduł Geo (trasy z OSRM rower i pieszo, Photon), kontrakt MQTT 1.2.0, symulator ze strefami z API (`control goto`), panel: edytor stref (Terra Draw), aplikacja: legenda, wyszukiwanie, trasy, komunikaty stref, prowadzenie do strefy.
Iteracja 5 (`docs/iteracje/iteracja-05-platnosci.md`, ADR 0049–0054): makiety `24-mobile-platnosci` i `25-panel-platnosci`, migracja 0007 (księga przez `sp_wallet_post`, `refunds`, `payment_customers`, paragony z korektą, wersje cennika z VAT, stan rozliczenia), reguły płatności w core, moduł Płatności w API (atrapa i Stripe za portem `PaymentProvider`, webhook z kolejką, sprawdzanie statusu, obciążenie karty po `ENDED`, `UNPAID` i spłata, zwroty, korekty, zwrot salda, `wallet.updated`), panel: płatności, cennik, portfel klienta, zwrot; aplikacja: portfel, karty, doładowanie, zaległość, paragon.
Iteracja 6 (`docs/iteracje/iteracja-06-operacje-serwis.md`, ADR 0055–0060): makiety `26-mobile-operacje` i `27-panel-serwis`, migracja 0008 (zgłoszenia z numerem i zgłoszeniami automatycznymi, aktor `SYSTEM` w dzienniku audytu, `MAINTENANCE` po przejeździe wyzwalaczem, przejścia zadań, `spare_part_movements` przez procedury, `fn_scooter_return_blockers`, `end_mode`, `TOWING_FEE`, powiadomienia z kluczem idempotencji, `notification_template_versions`), reguły zgłoszeń, serwisu, przejazdu bez łączności, baterii, odholowania i szablonów ICU w core, moduły Operacje, Pliki, Powiadomienia i Symulator w API (zgłoszenia, zadania, magazyn, pulpit, pliki przez API, push za portem `PushGateway`, kod SMS z szablonu, polecenia `simulator/control`), kontrakty MQTT 1.3.0 (`battery_swapped`), symulatora 1.0.0 i Socket.IO 1.4.0, symulator ze scenariuszami z panelu, panel: pulpit, zgłoszenia, zadania, części, karta serwisowa hulajnogi, szablony i wysłane powiadomienia, symulator, odholowanie; aplikacja: zgłoś problem, moje zgłoszenia, zdjęcie parkowania, zakończenie bez łączności, niska bateria, powiadomienia z banerem w wersji web.
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
- [x] Iteracja 5: implementacja według planu (2026-11-17, na atrapie operatora).
- [x] Wypchnąć iterację 5 i potwierdzić zielone CI (2026-11-17, commit `c623ac1`).
- [x] Przed iteracją 6: plan iteracji 6 (2026-11-17, `docs/iteracje/iteracja-06-operacje-serwis.md`).
- [x] Przed iteracją 6: odpowiedzi autora na pytania 1–12 i decyzje D1–D8 (2026-11-18, wszystkie rekomendacje).
- [x] Przed iteracją 6: makiety brakujących stanów (2026-11-18, `26-mobile-operacje`, `27-panel-serwis`, 22 plansze).
- [x] Przed iteracją 6: ADR 0055–0060 (2026-11-18, zaakceptowane).
- [x] Iteracja 6: implementacja według planu (2026-11-18).
- [ ] Wypchnąć iterację 6 i potwierdzić zielone CI.
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
- Przejazdy pokazowe symulatora (`SIM_RIDES_PER_HOUR>0`) jadą bez przejazdu w API, więc API blokuje taką hulajnogę przy pierwszym odczycie (reguła hulajnogi odblokowanej bez przejazdu, ADR 0056; od poprawek iteracji 6 także w serwisie). Z działającym API zostaw `SIM_RIDES_PER_HOUR=0` (domyślnie); wyjątek od blokady to tylko `unlock` z panelu.
- Panel: `NEXT_PUBLIC_API_URL` (domyślnie http://localhost:3001); na komputerze autora port 3000 jest zajęty: `WEB_PORT=3002`.
- Aplikacja: `EXPO_PUBLIC_API_URL` (domyślnie http://localhost:3001); token odświeżający w `expo-secure-store`, w wersji web w `localStorage`. Typy tras Expo Router (`.expo/types`) odświeża `expo start`, nie `expo export`. Podgląd w przeglądarce: konfiguracje `api-preview` (API na 3005 bez MQTT, kod SMS w logu) i `mobile-web` (8082) w `.claude/launch.json`.
- Strefy (ADR 0043, 0044): Telemetria po zapisie partii woła `ZoneTracker`, przejścia zapisuje i komendy stref uzgadnia `RentalsService`; komendy stref mają `rental_id`, ale nie blokują pauzy (indeks tylko dla `LOCK`/`UNLOCK`). Testy API ustawiają `OSRM_URL` na nieużywany port, żeby trasy były linią prostą niezależnie od lokalnego OSRM.
- Zadania w tle: pg-boss w API (`JOBS_ENABLED`, testy API wyłączają kolejkę i wołają `JobsService.run`); zadanie planowane w transakcji przez `sendInTransaction` (ADR 0037).
- Płatności (ADR 0050): `PAYMENT_PROVIDER=fake` (domyślnie, atrapa w procesie wysyła webhooki do `/payments/webhooks/stripe` tego samego API) albo `stripe` z kluczami `sk_test_`, `pk_test_`, `whsec_` w `.env` (klucze `live` zatrzymują start) i `stripe listen --forward-to localhost:3001/payments/webhooks/stripe`. Testy API: `FAKE_WEBHOOK_DELIVERY=manual` (webhooki z `takeOutbox()` wysyła test), saldo klienta przez `fundWallet` z `apps/api/test/helpers.ts` (minimalne saldo blokuje start). Ruch środków tylko przez `sp_wallet_post` (wyzwalacz księgi odrzuca ręczny wpis z błędnym saldem). Moduł Płatności zmienia stan przejazdu przez obsługę zarejestrowaną przez `RentalsService` (`attachRentalHandler`). Stripe 23.1.0 ma API `2026-10-28.endive`: pole `allowed_payment_method_types` zamiast `payment_method_types`.
- Pliki (ADR 0057): wysyłka i odczyt tylko przez API (`POST /files`, `GET /files/{id}?exp&sig` z podpisem HMAC na 10 min, adres względny; klienci doklejają adres API), SeaweedFS zostaje w sieci wewnętrznej. `FILE_STORAGE=s3` (domyślnie, `S3_ENDPOINT`, `S3_REGION`, klucze z `infra/seaweedfs/s3.json`) albo `memory` (testy API; w produkcji zatrzymuje start).
- Powiadomienia (ADR 0058): `PUSH_PROVIDER=fake` (domyślnie: wpis `SENT`, treść w logu API, wersja web pokazuje baner z `notification.created`) albo `expo` (`EXPO_ACCESS_TOKEN` opcjonalny; wymaga `projectId` z `eas init` i development build). Nowe powiadomienie = kod w rejestrze `NOTIFICATION_TEMPLATES` (`packages/shared/src/notifications.ts`), szablon w seedzie i wpis `QUEUED` z `dedupe_key` w transakcji zdarzenia. Seed nie nadpisuje istniejących szablonów (zmiana treści przez panel), a bez szablonu `login_code` logowanie kodem SMS kończy się `TEMPLATE_MISSING` (po migracji 0008 uruchom `pnpm db:seed`).
- Symulator z panelu (ADR 0059): `SIMULATOR_CONTROL_ENABLED` puste = włączone tylko przy `NODE_ENV=development`; przy `false` `/admin/simulator/*` zwraca 404. Polecenia idą przez MQTT `simulator/control` (wynik `simulator/control/result`, kontrakt `docs/kontrakty/asyncapi-symulator.yaml`); `control.json` i CLI działają dalej, wygrywa ostatnie polecenie. Wyniki poleceń API trzyma tylko w pamięci.
- Serwis (ADR 0055): koniec rezerwacji albo przejazdu przy otwartym pilnym zgłoszeniu albo zadaniu zmienia `AVAILABLE` na `MAINTENANCE` w wyzwalaczu `scooters_status` (z wpisem systemu w dzienniku audytu), więc po `setScooterStatus` odczytaj stan zamiast zakładać `AVAILABLE` i nie dubluj wpisu. Wpisy bez operatora: `actor = SYSTEM`, `staff_id = NULL` (`AuditScope.system`); komendy systemu bez wpisu przez `CommandsService.sendSystem`. Zgłoszenia automatyczne (`OFFLINE`, `BATTERY_CRITICAL`, `OUT_OF_ZONE`) wstawia się przez `ON CONFLICT (scooter_id, auto_kind) WHERE status <> 'RESOLVED' DO NOTHING`; `OFFLINE` planuje `tickets.offline-check` tylko przy zmianie online → offline. Limit potwierdzenia komend liczy się od `expires_at` (`lock` przy zakończeniu bez łączności ma 10 min). Testy: pomocnik `operationsContext` w `apps/api/test/operations-helpers.ts`.
- Każdy punkt API deklaruje dostęp: `@Public()`, `@CustomerAuth()`, `@StaffAuth()`, `@CustomerOrStaffAuth()` (tylko `POST /files`) albo `@RequirePermission('…')` (ADR 0035); punkt bez deklaracji kończy się `403 PERMISSION_NOT_DECLARED`. Kod SMS w środowisku deweloperskim jest w logu API. Testy panelu: pomocnik `staffToken` w `apps/api/test/helpers.ts`.

## Otwarte decyzje
Nazwa marki ([nazwa]); wartości biznesowe (ceny, czas rezerwacji, minimalne saldo, próg baterii, wiek, wysokość opłaty za odholowanie, ceny części zamiennych; w seedzie są wartości deweloperskie); stawka VAT (robocza 23%, także dla opłaty za odholowanie, do sprawdzenia przez autora; ADR 0060).
