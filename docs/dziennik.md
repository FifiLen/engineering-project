# Dziennik prac

## Etap projektowy (listopad 2026)

**Co powstało**
- Architektura systemu i wybór stosu technologicznego (ADR 0001–0020).
- Kierunek wizualny: paleta, styl produktowy, design system, rendery hulajnogi.
- Makiety: aplikacja mobilna (ok. 40 ekranów, w tym tryb ciemny i stany awaryjne), panel operatora (11 ekranów), strona promocyjna (desktop i telefon).
- Mapa przepływów użytkownika, diagram architektury, maszyna stanów przejazdu i sześć diagramów sekwencji.
- Model danych: 24 tabele, schemat SQL sprawdzony na PostgreSQL 16 z PostGIS 3.4.
- Ikona aplikacji i ekran startowy.

**Zmiany względem pierwotnego planu**
- Pierwotna propozycja zakładała Vue i Nuxt na webie oraz współdzielenie kodu między klientami. Zrezygnowano z tego na rzecz Reacta po obu stronach i niezależnych klientów ([ADR 0004](adr/0004-niezalezni-klienci-wspolny-kontrakt.md)).
- Rozważano Capacitor zamiast React Native ([ADR 0005](adr/0005-react-native-expo.md)).
- Strona promocyjna i panel w jednym projekcie Next.js zamiast dwóch ([ADR 0006](adr/0006-jedna-aplikacja-nextjs.md)).

**Otwarte kwestie**
- Nazwa marki i wartości biznesowe w nawiasach kwadratowych (ceny, limity, wiek).
- Strona promocyjna traktowana jako pierwsza iteracja projektu graficznego.

## Iteracja 0: fundament (10 listopada 2026)

**Co powstało**
- Monorepo pnpm + Turborepo: `api` (NestJS 12, Fastify), `web` (Next.js 16), `mobile` (Expo SDK 58), `simulator` (mqtt.js), pakiety `shared` i `db`.
- Migracja `0001_init.sql` z całym modelem danych, własny migrator z sumami kontrolnymi i schemat Drizzle generowany z bazy ([ADR 0021](adr/0021-migracje-sql-schemat-drizzle-z-bazy.md)).
- Dane startowe Rybnika: obszar działania, 5 stref parkowania, strefa wolnej jazdy przy Rynku, 40 hulajnóg, konto operatora.
- Endpoint `GET /zones/lookup` i `GET /health`; błędy API w formacie `{ code, message, details }`.
- CI w GitHub Actions: lint, typy, migracje na czystej bazie, testy na `postgis/postgis:16-3.4`, build.
- ADR 0021–0024, README z instrukcją uruchomienia.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` bez cache: 21 testów, w tym 12 na prawdziwej bazie PostGIS 3.4.
- Scenariusz demo: punkt na Rynku (50.095541, 18.542034) zwraca strefy `S-01`, `P-01` i obszar działania, `canPark: true`; punkt poza miastem zwraca pustą listę.
- OSRM (profil rowerowy, wycinek woj. śląskiego): trasa dworzec PKP – Rynek ma 1,16 km.
- `pnpm dev`: API i `/docs`, strona i `/admin`, symulator połączony z Mosquitto, Expo (Metro) uruchamiają się jednym poleceniem.
- SeaweedFS: żądanie bez kluczy dostaje 403; zapis, odczyt i usunięcie obiektu z kluczami działają.

**Współrzędne miejsc (`pnpm db:places`, Nominatim)**

| Kod | Miejsce | Współrzędne | Wynik OSM |
|---|---|---|---|
| P-01, S-01 | Rynek | 50.095541, 18.542034 | Rynek, Śródmieście |
| P-02 | Dworzec PKP | 50.089104, 18.547972 | stacja kolejowa Rybnik, ul. Dworcowa |
| P-03 | Kampus | 50.098812, 18.539634 | ul. Rudzka 13 |
| P-04 | Focus | 50.094315, 18.543295 | Focus Park, ul. Bolesława Chrobrego 1 |
| P-05 | Plaza | 50.096177, 18.537543 | Rybnik Plaza, ul. Raciborska 16 |

Pierwsze zapytania trafiły źle w dwóch miejscach: dla dworca nie było wyniku, a „Plaza, Rybnik” wskazała plażę miejską nad Zalewem Rybnickim. Zapytania poprawiono na „Rybnik railway station” i „Rybnik Plaza”. Autor powinien jeszcze potwierdzić położenie stref na mapie.

**Zmiany względem planu**
- NestJS 12 zamiast 11 i ESM w całym repozytorium ([ADR 0022](adr/0022-nestjs-12-esm.md)); TypeScript 6.0, bo typescript-eslint nie obsługuje jeszcze wersji 7 ([ADR 0023](adr/0023-typescript-6.md)).
- MinIO zastąpione przez SeaweedFS: obrazy `minio/minio` i `minio/mc` zniknęły z Docker Huba ([ADR 0024](adr/0024-magazyn-plikow-seaweedfs.md)).
- Obraz OSRM z GitHub Container Registry (`ghcr.io/project-osrm/osrm-backend:v26.11.0-debian`); tagu `osrm/osrm-backend:v5.27.1` nie ma na Docker Hubie, a tamto repozytorium nie jest aktualizowane od 2021 r.
- Porty PostgreSQL i OSRM konfigurowalne w `.env` (`POSTGRES_PORT`, `OSRM_PORT`), a port aplikacji webowej zmienną `WEB_PORT`: na komputerze autora porty 5432 i 3000 zajmują inne projekty, a port 5000 Odbiornik AirPlay w macOS.
- `.env` jest teraz faktycznie wczytywany przez API, symulator, polecenia bazy, testy i `pnpm infra:*`; wcześniej działały tylko wartości domyślne.

**Dług techniczny**
- `drizzle-kit pull` przypisuje klasy operatorów (`uuid_ops`, `timestamptz_ops`) w indeksach wielokolumnowych niedeterministycznie, więc zwykłe porównanie wygenerowanego schematu z repozytorium nie nadaje się do CI. Różnica dotyczy tylko metadanych indeksów, nie zapytań.
- Aplikacja mobilna używa ESLint 9 (oznaczonego jako przestarzały), bo `eslint-plugin-react` z `eslint-config-expo` nie działa z ESLint 10. Reszta repozytorium używa ESLint 10.
- Wygenerowany `schema.ts` jest wyłączony z lintu (literały `maxValue` sekwencji przekraczają precyzję `number`).


## Dostosowanie do wymagań uczelni (16 listopada 2026)

**Co powstało**
- [Wymagania uczelni](wymagania-uczelni.md): 19 punktów, analiza zgodności, siedem pytań do prowadzącego i plan dostosowania przed iteracją 1.
- Makiety, design system, tokeny, rendery i ikona przeniesione z kanwy claude.ai do [`projekt/`](projekt/README.md); repozytorium jest teraz źródłem prawdy.
- ADR 0025–0031 (zaakceptowane): osobny projekt logiki `packages/core` z portami i adapterami, podział pracy między bazą a core (widoki `v_*`, funkcje `fn_*`, procedury `sp_*`), treści merytoryczne i grafiki sterowane z panelu (etykiety interfejsu w plikach tłumaczeń), role i uprawnienia operatorów, raporty PDF i XLSX, wydruki z szablonów DOCX, wspólny wzorzec widoku tabeli w panelu z kontraktem list w API i klasami tabel (pełny CRUD, wersje, polecenia domenowe, tylko do dopisywania).

**Weryfikacja**
- Analiza zgodna z kodem: migracja 0001 tworzy 24 tabele (plus partycję `telemetry_default`); surowy `pg` poza `packages/db` jest w `ZonesService` i `HealthController`.
- Biblioteki sprawdzone w rejestrze npm 16 listopada 2026: docxtemplater 3.71.1 (MIT, moduł inspekcji szablonu w wersji darmowej), intl-messageformat 12.1.5, ExcelJS 4.4.0 (ostatnie wydanie z października 2023 r., ryzyko opisane w ADR 0029). Gotenberg publikuje obrazy 9.x; konkretny tag wybieramy przy wprowadzeniu modułu.

**Zmiany względem planu**
- Pytania 1–7 rozstrzygnięte (odpowiedzi w [wymagania-uczelni.md](wymagania-uczelni.md)): stos, wspólny backend, Drizzle, ograniczone operacje na tabelach tylko do dopisywania i symulowana flota zaakceptowane.
- Punkt 17 w zakresie treści merytorycznych (pytanie 5). Pierwsza wersja ADR 0027 zakładała wszystkie teksty interfejsu w bazie; po odpowiedzi zawężono ją przed akceptacją. Etykiety zostają w plikach tłumaczeń, jak w arc42 §8.11.
- Typ `staff_role` zostanie zastąpiony tabelami ról i uprawnień w migracji 0002.

**Otwarte kwestie**
- Punkt 14: liczą się wszystkie widoki, także stany i tryb ciemny (pytanie 7); 53 makiety już są, zapas dadzą nowe ekrany panelu.
- Materiały z wykładu Interakcja Człowiek–Komputer do punktu 16.

## Migracja 0002: moduły panelu (16 listopada 2026)

**Co powstało**
- [`0002_admin_modules.sql`](../packages/db/migrations/0002_admin_modules.sql): 22 nowe tabele (role i uprawnienia, treści i media, raporty, szablony i wygenerowane wydruki, modele hulajnóg, zadania serwisowe i części, paragony), 13 widoków `v_*`, 6 funkcji `fn_*`, 6 procedur `sp_*` i wyzwalacz licznika zmian treści. Razem 46 tabel bez partycji telemetrii.
- Typ `staff_role` zastąpiony tabelami ról: migracja przypisuje dotychczasowym operatorom role Administrator, Dyspozytor i Serwisant, istniejące hulajnogi dostają model `BASE`.
- Kolumny `version` (blokada optymistyczna) i `updated_at` w tabelach edytowalnych z migracji 0001.
- Schemat Drizzle wygenerowany na nowo; widoki są w nim jako `pgView`.
- Dokumentacja [modelu danych](model-danych/README.md): obszary, dwa diagramy relacji, reguły bazy, opis widoków, funkcji i procedur oraz macierz operacji w panelu dla każdej z 46 tabel (wymaganie 12).

**Weryfikacja**
- Migracja sprawdzona najpierw na kopii bazy deweloperskiej (40 hulajnóg, administrator), potem wykonana na bazie deweloperskiej; `pnpm db:seed` działa po zmianach.
- 10 nowych testów na PostGIS: przeniesienie ról i modelu na danych w kształcie z 0001, liczba tabel, widoków, funkcji i procedur, kolejność stref w punkcie, wyszukiwanie najbliższych hulajnóg, wygaszanie rezerwacji, rozjazd i naprawa salda, anonimizacja konta, uprawnienia z ról, partycje telemetrii z przeniesieniem wierszy i długością trasy, wersje dokumentów, otwarte zadania serwisowe.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` przechodzi: 31 testów (16 bazy, 6 API, 7 shared, 2 symulatora).

**Zmiany względem planu**
- 46 tabel zamiast szacowanych w ADR 0026 ok. 38: doszły części zamienne (`spare_parts`, `service_task_parts`), pozycje paragonu (`receipt_items`), bloki treści i szablony powiadomień z ADR 0027.
- `pnpm db:pull` nie czytał `.env`, więc na komputerze autora łączył się z bazą innego projektu na porcie 5432 i kończył błędem bez komunikatu. `drizzle.config.ts` wczytuje teraz `.env` jak pozostałe polecenia bazy; filtr tabel pomija partycje `telemetry_*`.
- Po `db:pull` przywrócono klasy operatorów w trzech indeksach z migracji 0001 (`rentals_user_idx`, `rentals_scooter_idx`, `payments_user_idx`), zgodnie z uwagą o niedeterminizmie drizzle-kit.

**Dług techniczny**
- ADR 0026 przewiduje test, że przejścia wykonywane przez procedury (`sp_expire_reservations`) są dozwolone w maszynie stanów z `packages/core`. Test powstanie razem z `packages/core`.
- Katalog uprawnień jest na razie tylko w migracji; po wydzieleniu `packages/core` seed będzie go synchronizował z kodem (ADR 0028).
- `ZonesService` nadal ma własne zapytanie zamiast `fn_zones_at_point`; zmiana w refaktoryzacji dostępu do danych (punkt 4 planu dostosowania).

## Projekt logiki biznesowej `packages/core` (16 listopada 2026)

**Co powstało**
- `packages/core` według [ADR 0025](adr/0025-logika-biznesowa-packages-core.md): maszyna stanów przejazdu zgodna z diagramem w arc42 §6.1, reguły stref (jazda, parkowanie, limit prędkości), katalog i polityka uprawnień (w tym reguła ostatniego operatora zarządzającego rolami), błąd domeny `DomainError` z kodem dla API, port `ZoneRepository`. Pakiet nie ma zależności i kompiluje się bez typów Node.
- `packages/db`: repozytorium `DrizzleZoneRepository` (przez `fn_zones_at_point`), `checkDatabaseHealth`, typy `Transaction` i `DbExecutor` dla jednostki pracy.
- `apps/api`: `ZonesService` składa repozytorium z reguł core, `HealthController` korzysta z `packages/db`; pula `pg` nie jest już eksportowana z modułu bazy. Filtr wyjątków zamienia `DomainError` na odpowiedź `{ code, message, details }` (403 dla `FORBIDDEN`, 409 dla pozostałych).
- Reguły lintera: `packages/core` nie importuje NestJS, Drizzle, `pg`, `@hulajnogi/db` ani `node:*`; `apps/api/src` nie importuje `pg`.

**Weryfikacja**
- 13 testów jednostkowych core bez bazy; 4 nowe testy bazy łączące ją z core: katalog uprawnień w tabeli równy katalogowi w kodzie, typ `rental_state` i indeksy jednego otwartego przejazdu zgodne z maszyną stanów, każde przejście zapisane w `rental_events` (także przez `sp_expire_reservations`) dozwolone w core, repozytorium stref.
- Reguły lintera sprawdzone na próbnych plikach (import `drizzle-orm` i `node:fs` w core, `pg` w API są zgłaszane).
- Odpowiedź `GET /zones/lookup` bez zmian (testy API).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` przechodzi: 48 testów (13 core, 20 bazy, 6 API, 7 shared, 2 symulatora).

**Zmiany względem planu**
- Wycena przejazdu nie weszła do core: wzór (np. naliczanie za rozpoczętą minutę, czas przy utracie łączności) to otwarta decyzja biznesowa. Powstanie w iteracji płatności.
- Katalog pól wydruków (ADR 0030) powstanie razem z modułem wydruków.
- Katalog uprawnień zmienia się migracją z opisem uprawnienia; test pilnuje zgodności z kodem, więc osobna synchronizacja w seedzie nie jest potrzebna.

**Dług techniczny (rozwiązany)**
- Test zgodności przejść w procedurach z maszyną stanów i użycie `fn_zones_at_point` w API z wpisu o migracji 0002.

## Plan iteracji po wymaganiach uczelni (16 listopada 2026)

**Co powstało**
- [Plan iteracji](iteracje/README.md) 0–9 z kolumną wymagań uczelni dla każdej iteracji, tabelą modułów przekrojowych i rozszerzoną definicją „zrobione” (reguły w `packages/core`, etykiety w plikach tłumaczeń, nowe tabele w panelu, tabela zgodności).
- Iteracja 0 obejmuje teraz dostosowanie do wymagań (lista w [planie iteracji 0](iteracje/iteracja-00-fundament.md)).

**Zmiany względem planu**
- Dziesięć iteracji zamiast dziewięciu. Dawna iteracja 7 „Domknięcie klientów” rozdzielona na 7 „Treści i wydruki” i 8 „Raporty i domknięcie panelu”; „Jakość i obrona” to teraz iteracja 9 (odwołania w arc42 §10 i `docs/README.md` poprawione).
- Moduły przekrojowe powstają, gdy są pierwszy raz potrzebne: wzorzec widoku tabeli i pliki tłumaczeń w iteracji 1, role i uprawnienia oraz wersje regulaminu w iteracji 2, silnik dokumentów w iteracji 7.
- Iteracja 6 obejmuje proces serwisowy (zadania i części), a iteracja 5 wycenę w `packages/core` i paragony.

**Otwarte kwestie**
- Makiety nowych ekranów panelu: wzorzec widoku tabeli przed iteracją 1, role i uprawnienia przed iteracją 2.

## Makieta wzorca widoku tabeli (16 listopada 2026)

**Co powstało**
- Cztery plansze 1440×900 w [`projekt/ekrany/17-panel-wzorce/`](projekt/README.md#panel-operatora-wzorzec-widoku-tabeli) (HTML i PNG) według ADR 0031, na przykładzie zadań serwisowych: lista z filtrami, sortowaniem, zaznaczeniem i operacjami grupowymi; panel filtrów; formularz edycji z błędem pola i konfliktem wersji; stany listy (ładowanie, pusta, brak wyników, błąd).
- Spis ekranów w `projekt/README.md` (57 ekranów aplikacji i panelu).

**Weryfikacja**
- PNG wyrenderowane z HTML w Chrome bez interfejsu (1440×900, skala 1) i obejrzane; poprawiono zawijanie tekstu w wyszukiwarce i kartę części wychodzącą poza planszę w formularzu.
- Wartości z `tokens.json` i plansz `13-panel` (tabela, przyciski, pola z Cennika); dane przykładowe spójne między planszami (23 wyniki przy aktywnych filtrach, zadanie S-1042 na liście i w formularzu).

**Zmiany względem planu**
- Nawigacja boczna pogrupowana i rozszerzona o Serwis, Treści, Operatorzy i role, Raporty, Wydruki. Plansze `13-panel` mają jeszcze starą listę; przy implementacji obowiązuje nowa.
- Eksport list domyślnie do XLSX, CSV w menu (makieta Flota: tylko CSV).

**Otwarte kwestie**
- Makiety ról i uprawnień przed iteracją 2; treści, mediów, raportów i szablonów wydruków przed iteracjami 7 i 8.
- Pasek boczny mieści się w wysokości 900 px z niewielkim zapasem; przy kolejnych pozycjach trzeba będzie zwijać grupy.

## Repozytorium na GitHubie i pierwszy przebieg CI (16 listopada 2026)

**Co powstało**
- Repozytorium [FifiLen/engineering-project](https://github.com/FifiLen/engineering-project). Gałąź `iteracja-0-domkniecie` zastąpiła lokalny `main` (zawierała całą jego historię, więc nic nie zostało pominięte) i została wypchnięta jako `main`.

**Weryfikacja**
- Pierwszy przebieg `.github/workflows/ci.yml` dla commitu `bea96ab` ([przebieg 43861513114](https://github.com/FifiLen/engineering-project/actions/runs/43861513114)) zakończony sukcesem: instalacja z zamrożonym lockfile, lint, typy, migracje 0001–0002 na czystej bazie PostGIS 16-3.4, testy, build. `DATABASE_URL` jest ustawiona w zadaniu, więc testy bazy i API nie są pomijane.

**Zmiany względem planu**
- Iteracja 0 zakończona, łącznie z dostosowaniem do wymagań uczelni.
- Autor obejrzał strefy na mapie i potwierdził współrzędne z `packages/db/seed/rybnik-places.json` (Rynek, dworzec PKP, kampus, Focus Park, Rybnik Plaza). Przed iteracją 1 nie zostało nic otwartego.

## Iteracja 1: symulator, telemetria i wzorzec panelu (16 listopada 2026)

Plan i scenariusz demo: [iteracja 1](iteracje/iteracja-01-symulator-telemetria.md).

**Co powstało**
- Symulator ([ADR 0034](adr/0034-symulator-floty.md)): 40 wirtualnych hulajnóg, każda z własnym połączeniem MQTT, sesją trwałą i Last Will; telemetria co 5 s z przesunięciem fazy, bufor dosyłany po odzyskaniu łączności, komendy z potwierdzeniami i idempotencją po `commandId`, przejazdy pokazowe po trasach rowerowych z OSRM (30 na godzinę), stan zapisywany do pliku. Pozycje startowe z tego samego algorytmu co dane startowe bazy, obszar z pliku sprawdzonych współrzędnych.
- `packages/core`: status floty (`deriveFleetStatus`), szacowany zasięg, reguły zmian statusu hulajnogi z panelu, wycofanie zamiast usunięcia, archiwizacja modelu, reguły komend (odblokowanie tylko w serwisie, limit 10 s na potwierdzenie), przyjmowanie telemetrii (kolejność, przebieg bez szumu i skoków GPS), blokada optymistyczna; porty repozytoriów floty, modeli, telemetrii i komend.
- Migracja `0003_fleet_lists.sql`: `fn_low_battery_threshold`, `fn_fleet_status`, widoki `v_fleet_list` i `v_scooter_models`, indeksy po ostatnim sygnale i dla komend bez potwierdzenia. Baza: 46 tabel, 15 widoków, 8 funkcji, 6 procedur.
- `packages/db`: wspólny mechanizm list `runListQuery` (filtry z białej listy, wyszukiwanie, sortowanie z pustymi na końcu i stabilnym kluczem, stronicowanie, liczniki bez filtra własnego pola), repozytoria Drizzle, naruszenie unikalności jako `ALREADY_EXISTS` z nazwą pola, strefy jako GeoJSON.
- `packages/shared`: kontrakt list (`parseListQuery`, `toSearchParams`), definicje zasobów `scooters` i `scooter-models` ze schematami formularzy, zdarzenia Socket.IO, tłumacz etykiet na `intl-messageformat` ([ADR 0032](adr/0032-etykiety-w-plikach-tlumaczen.md)).
- API: moduły MQTT, Realtime (pokój `fleet`), Flota (listy, szczegóły, tworzenie, edycja z wersją, usuwanie jako wycofanie lub archiwizacja, komendy, mapa) i Telemetria (okno 1 s, jedna kolejka z łącznością, partycje 7 dni naprzód) ([ADR 0033](adr/0033-telemetria-i-status-floty.md)); `GET /zones` (GeoJSON), CORS dla panelu, `NOT_FOUND` jako 404.
- Panel: układ z nawigacją boczną, mapa floty na żywo (MapLibre, OpenFreeMap, warstwa stref, szybkie filtry, legenda, karta hulajnogi z komendami i ostatnimi komunikatami), wspólne komponenty listy (wyszukiwarka, szybkie filtry z licznikami, panel filtrów z liczbą wyników, etykiety aktywnych filtrów, sortowanie z `aria-sort`, stronicowanie, zaznaczanie i operacja grupowa z potwierdzeniem, cztery stany listy) i formularza (walidacja schematem Zod z API, błędy przy polach, konflikt wersji z różnicami, karta operacji nieodwracalnej); lista i formularz floty oraz modeli.
- Etykiety panelu i aplikacji mobilnej w plikach tłumaczeń; reguła `no-restricted-syntax` zakazuje tekstów w JSX w obu klientach.
- Kontrakt zdarzeń Socket.IO [`asyncapi-realtime.yaml`](kontrakty/asyncapi-realtime.yaml), ADR 0032–0034, arc42 §5.2, §6.3, §6.8, §8.7, §8.11, §11.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` przechodzi: 126 testów (38 core, 18 shared, 17 symulatora, 33 bazy, 20 API), żaden pominięty. Testy bazy porównują `fn_fleet_status` z regułą z core dla wszystkich kombinacji stanu, łączności i baterii; test API łączy klienta Socket.IO z działającym serwerem Fastify i sprawdza zdarzenia `fleet.updates` i `fleet.command`.
- Na żywo (API, symulator, Mosquitto, OSRM, panel w przeglądarce 1440×900): 40/40 hulajnóg online, telemetria w partycji `telemetry_20261116`, przebieg rośnie z przejazdami pokazowymi; komenda „Dzwonek” z karty na mapie potwierdzona w 10 ms; zatrzymanie symulatora daje 0 hulajnóg online, ponowne uruchomienie 40 w tych samych miejscach; konflikt wersji w formularzu z porównaniem pól; błąd walidacji wagi przy polu.
- Aplikacja mobilna: `expo lint`, `tsc` i paczki `expo export` dla web i iOS (Hermes) z nowym tłumaczem.
- Reguły lintera sprawdzone plikami próbnymi: tekst, literał, szablon i `title`/`accessibilityLabel` z literami są zgłaszane w panelu i aplikacji; szablony w `href` i `id` nie.

**Błędy znalezione w trakcie**
- Backend łączył się z brokerem w `onModuleInit` modułu MQTT, zanim moduł Telemetria zarejestrował obsługę tematów. Przy sesji trwałej broker od razu dosyłał zaległe statusy, które przepadały: wszystkie hulajnogi zostawały „offline”. Połączenie przeniesione do `onApplicationBootstrap`.
- Identyfikator klienta MQTT z numerem procesu nie wznawiał sesji po restarcie i zostawiał w brokerze osierocone sesje z kolejką wiadomości. Teraz stały `MQTT_CLIENT_ID`, a Mosquitto usuwa porzucone sesje po dobie.
- Zapis partii telemetrii czytał stan sprzed równoległej zmiany łączności i wysyłał do panelu status „offline” hulajnogi, która właśnie się połączyła. Status i telemetria idą teraz przez jedną kolejkę (wykryte testem API).
- Repozytoria przekazywały do `INSERT` cały obiekt wejściowy, więc nadmiarowe właściwości (np. `id` ze szczegółów) trafiały do zapytania. Teraz tylko pola z listy.
- MapLibre GL 6 ładuje wątek roboczy jako osobny moduł obok swojego pliku, a Turbopack go nie kopiuje. Skrypt `apps/web/scripts/maplibre-worker.mjs` kopiuje go do `public/` przed `dev` i `build`, a mapa wskazuje go przez `setWorkerUrl`.
- Pierwszy przebieg CI po wypchnięciu ([43900425849](https://github.com/FifiLen/engineering-project/actions/runs/43900425849)) nie przeszedł na kroku Build: `apps/web/public` zawiera tylko ignorowany plik wątku, więc w czystej kopii katalogu nie ma, a skrypt go nie tworzył. Po poprawce przebieg [43900838005](https://github.com/FifiLen/engineering-project/actions/runs/43900838005) dla commitu `30261a9` jest zielony (lint, typy, migracje 0001–0003 na czystej bazie, testy, build).

**Zmiany względem planu**
- Migracja 0003 została poprawiona przed publikacją (dodana kolumna `version` w `v_fleet_list` dla operacji grupowych); w bazie deweloperskiej cofnięta ręcznie i wykonana ponownie. Nigdzie poza tym komputerem nie była wykonana.
- Status floty liczony w dwóch miejscach (core i funkcja bazy) zamiast tylko w core, bo lista filtruje i liczy statusy w SQL ([ADR 0033](adr/0033-telemetria-i-status-floty.md)). Próg niskiej baterii to minimalna bateria do wypożyczenia z cennika, a nie osobna wartość.
- Do iteracji 3 przejazdy pokazowe symulatora nie zmieniają statusu w bazie (licznik „W użyciu” jest 0).
- Kontrakt zdarzeń Socket.IO powstał jako `asyncapi-realtime.yaml`, zgodnie z planem w `kontrakty/README.md`.

**Odstępstwa od makiet** (zgodnie z zasadą z CLAUDE.md)
- Nawigacja boczna pokazuje tylko gotowe ekrany (Mapa floty, Flota, Modele hulajnóg); dolny blok operatora zastępuje „Tryb deweloperski” do czasu logowania.
- Brak przycisku eksportu na liście (iteracja 8) i karty „Historia zmian” w formularzu (iteracja 2).
- Karta hulajnogi na mapie nie ma renderu hulajnogi: zdjęcie modelu to treść z biblioteki mediów (iteracja 7, ADR 0027). „Ostatni przejazd” pokazuje numer otwartego przejazdu (iteracja 3).
- Mapa używa stylu `positron` z OpenFreeMap zamiast stylu w palecie projektu (ADR 0017); własny styl razem z mapą w aplikacji (iteracja 3).
- Filtr strefy jest w panelu filtrów, a nie osobnym przyciskiem „Strefa: wszystkie”, jak we wzorcu z `17-panel-wzorce`.
- Modele hulajnóg nie mają makiety; ekrany zbudowane z wzorca widoku tabeli.

**Dług techniczny**
- Panel i API bez uwierzytelniania i dziennika audytu do iteracji 2.
- Partycje telemetrii zakłada proces API (start i co 6 h), a nie pg-boss; przejdzie do zadania cyklicznego w iteracji 3.
- Panel filtrów pokazuje liczniki wartości z listy przed zmianą filtrów, a nie dla wersji roboczej (liczba wszystkich wyników przycisku jest aktualna).
- Formularz porównuje przy konflikcie tylko pola zmienione przez drugą osobę względem wczytanej wersji.

## Plan i makiety iteracji 2: konta i dostęp (16 listopada 2026)

Plan: [iteracja 2](iteracje/iteracja-02-konta-dostep.md).

**Co powstało**
- Plan iteracji 2: zakres (migracja 0004, reguły kont i RBAC w `packages/core`, moduły `auth` i `staff-auth`, `@RequirePermission` na wszystkich punktach panelu, dziennik audytu, ekrany panelu i aplikacji, OpenAPI), rzeczy świadomie poza zakresem i trzy decyzje potwierdzone przez autora: kod SMS ma 6 cyfr, operator dostaje zaproszenie (pierwszego administratora tworzy polecenie w terminalu), minimalny wiek klienta pochodzi z cennika.
- 12 plansz panelu w [`projekt/ekrany/18-panel-dostep/`](projekt/README.md#panel-operatora-konta-i-dostęp): kod TOTP, konfiguracja TOTP, aktywacja z zaproszenia, lista i formularz operatora, lista ról, macierz uprawnień, dziennik audytu, szczegóły i blokada klienta, wersje dokumentów prawnych i edycja wersji roboczej.
- 3 plansze aplikacji w [`projekt/ekrany/19-mobile-dostep/`](projekt/README.md#aplikacja-konta-i-dostęp): ponowna akceptacja regulaminu, konto zablokowane, wyczerpane próby kodu SMS. Liczba ekranów w spisie: 72.

**Weryfikacja**
- PNG wyrenderowane z HTML w Chrome bez interfejsu (panel 1440×900, skala 1; aplikacja 390×844, skala 2) i obejrzane. Poprawione w trakcie: pozycja aktywna w nawigacji, zbyt ciasne kolumny dziennika audytu obok panelu bocznego, kolejność wpisów w historii klienta.
- Dane na planszach są spójne między sobą (np. Dyspozytor: 17 z 35 uprawnień i 4 operatorów na liście ról, w macierzy i w formularzu operatora; 3 120 + 722 = 3 842 klientów przy dokumentach).

**Zmiany względem planu**
- Makieta `flow-kod` ma już 6 pól kodu (4 wypełnione w trakcie wpisywania), zgodnie z design systemem, więc 6-cyfrowy kod nie jest odstępstwem.
- Z makiet wynikły zmiany zakresu migracji 0004: `content_page_versions.change_summary` („Najważniejsze zmiany” przy ponownej akceptacji) i `users.blocked_reason` jako kategoria widoczna dla klienta. Publikacja wersji dokumentu działa od razu; zrezygnowano z planowania daty publikacji i z porównania wersji akapit po akapicie.
- Dziennik audytu jest zakładką w „Operatorzy i role”, a dokumenty prawne pierwszą zakładką „Treści”, bez nowych pozycji w nawigacji z `17-panel-wzorce`.

## Iteracja 2: migracja 0004 (16 listopada 2026)

**Co powstało**
- [`0004_accounts_access.sql`](../packages/db/migrations/0004_accounts_access.sql): tabele `staff_sessions` i `staff_invitations`; w `staff` hasło opcjonalne do przyjęcia zaproszenia, potwierdzenie TOTP, ostatni użyty krok TOTP, licznik nieudanych logowań i blokada czasowa; w `users` data i powód blokady (typ `block_reason`); w `sessions` rodzina tokenów, następca i ostatnie użycie; `content_page_versions.change_summary`; indeksy dziennika audytu.
- Widoki `v_roles_overview`, `v_user_consents`, `v_audit_log`, rozszerzone `v_staff_overview` i `v_user_activity` (kolumny dopisane na końcu, `CREATE OR REPLACE VIEW`); funkcja `fn_user_pending_documents`; procedury `sp_revoke_user_sessions` i `sp_revoke_staff_sessions`.
- Strażnik ostatniego operatora z `roles.manage` w bazie: odroczone wyzwalacze ograniczeń wywołują `fn_check_role_manager` przy zatwierdzeniu transakcji. Reguła z ADR 0028 zostaje w core (czytelny błąd przed zapisem), a baza chroni przed dwiema równoległymi zmianami.
- Baza: 48 tabel, 18 widoków, 10 funkcji, 8 procedur. Schemat Drizzle zregenerowany (`pnpm db:pull`).

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test`: 132 testy (38 core, 18 shared, 17 symulatora, 39 bazy, 20 API). Nowe testy bazy: strażnik ostatniego zarządzającego rolami (odebranie uprawnienia roli, dezaktywacja, usunięcie przypisania, przekazanie roli w jednej transakcji), zaproszenie i status operatora, rotacja i unieważnianie sesji, spójność blokady klienta, dokumenty do ponownej akceptacji po publikacji nowej wersji, liczniki ról i autor w dzienniku audytu.
- Migracja wykonana na bazie deweloperskiej (dane z iteracji 1 przeniesione bez zmian; sekret TOTP zapisany wcześniej traktowany jako potwierdzony).

**Błędy znalezione w trakcie**
- Pierwsza wersja strażnika sprawdzała tylko aktywnych operatorów, więc pozwalała dezaktywować ostatniego aktywnego administratora (wtedy aktywnych nie było). Teraz warunek dotyczy każdej bazy z co najmniej jednym kontem operatora. Wykryte testem przed wykonaniem migracji na bazie deweloperskiej.
- Sprzątanie w teście migracji usuwało role i konta operatorów dwoma osobnymi zapytaniami; po 0004 robi to w jednej transakcji.
- `drizzle-kit pull` znowu zamienił klasy operatorów w 11 istniejących indeksach; przywrócone, a w nowych indeksach wpisane klasy zgodne z typem kolumny (np. `audit_log_entity_idx`: `text_ops`, `uuid_ops`, `timestamptz_ops`).

**Zmiany względem planu**
- Funkcja `fn_user_missing_consents` z planu nazywa się `fn_user_pending_documents` i zwraca dokumenty do akceptacji z „najważniejszymi zmianami”, bo tego potrzebuje ekran aplikacji.
- Do planu doszedł strażnik ostatniego zarządzającego rolami w bazie (zasada „spójność pilnuje baza”).

## Iteracja 2: reguły kont i dostępu w `packages/core` (16 listopada 2026)

**Co powstało**
- `accounts/otp.ts`: numer telefonu w E.164 (9 cyfr bez prefiksu to numer polski), kod 6 cyfr ważny 5 min, 5 prób, odstęp 60 s między kodami i 5 kodów na numer na godzinę (`RATE_LIMITED` z czasem oczekiwania), ocena wpisanego kodu z informacją, czy próbę trzeba zapisać.
- `accounts/sessions.ts`: token dostępowy 15 min, odświeżający 30 dni (klient) albo 12 h i 7 dni po „Zapamiętaj to urządzenie” (operator); rotacja tokenu, unieważnienie całej rodziny przy ponownym użyciu zastąpionego tokenu, 10 s tolerancji na dwa równoległe odświeżenia.
- `accounts/staff-login.ts`: ten sam błąd dla nieistniejącego, nieaktywnego i zaproszonego konta, blokada na 15 min po 5 nieudanych próbach (hasło i TOTP razem), liczba pozostałych prób tylko przy kodzie TOTP, okno TOTP ±1 krok bez ponownego użycia kroku, wymagania hasła z ekranu aktywacji, zaproszenie ważne 72 h.
- `accounts/customers.ts`: następny ekran klienta po zalogowaniu (dane, zgody, blokada, mapa), wymagane zgody (regulamin, polityka, wiek), warunki wypożyczenia na iterację 3, zakończenie rejestracji, blokada i odblokowanie, akceptacja tylko obowiązującej wersji dokumentu.
- `accounts/legal-documents.ts`: edycja tylko wersji roboczej, jedna wersja robocza na dokument, kolejna wersja dokumentu ze zgodą wymaga „najważniejszych zmian”.
- `access/roles.ts`: usuwanie ról (systemowa i przypisana nie), uprawnienia tylko z katalogu, różnica uprawnień, zakaz zmiany własnych ról i dezaktywacji siebie, liczba zarządzających rolami po planowanej zmianie.
- `audit/audit.ts`: zmienione pola (przed i po) z pominięciem wersji, wartości haseł, sekretów, tokenów i skrótów zastąpione `[REDACTED]`, format akcji `obiekt.czynność`.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test`: 165 testów (71 core, w tym 33 nowe; 18 shared, 17 symulatora, 39 bazy, 20 API). Reguła lintera potwierdza, że core nie używa `node:*`: skróty, HMAC dla TOTP i losowanie kodów zostają w adapterach API.

**Błędy znalezione w trakcie**
- `fleet.test.ts` (iteracja 1) nie miał obsługi błędów puli, więc `DROP DATABASE ... WITH (FORCE)` w `afterAll` raz zgłosił nieobsłużony błąd zamykanego połączenia, choć wszystkie testy przeszły. Dodana obsługa jak w `db.test.ts`.

**Zmiany względem planu**
- Porty repozytoriów kont powstaną razem z repozytoriami w `packages/db`, żeby ich kształt wynikał z zapytań, a nie z założeń.
- Czas sesji operatora (12 h, 7 dni po zapamiętaniu urządzenia) i tolerancja równoległych odświeżeń to decyzje do ADR o sesjach, który powstanie z modułem `staff-auth`.

## Iteracja 2: repozytoria kont i dostępu w `packages/db` (16 listopada 2026)

**Co powstało**
- Porty w `packages/core/src/accounts/ports.ts`: kody SMS, sesje, klienci, zgody, operatorzy, zaproszenia, role, dokumenty, dziennik audytu. Repozytoria przyjmują bazę albo transakcję, więc zapis i wpis audytu będą jedną jednostką pracy w API.
- Repozytoria Drizzle: `DrizzleOtpRepository`, `DrizzleCustomerSessionRepository` i `DrizzleStaffSessionRepository` (wspólna klasa bazowa), `DrizzleCustomerRepository`, `DrizzleConsentRepository`, `DrizzleStaffRepository`, `DrizzleInvitationRepository`, `DrizzleRoleRepository`, `DrizzleAuditLogRepository`, `DrizzleLegalDocumentRepository`.
- Definicje zasobów panelu w `packages/shared/src/admin/access.ts` (`staff`, `roles`, `users`, `audit-log`) ze schematami Zod zaproszenia, edycji operatora, roli, klienta i blokady. Wspólny mechanizm list obsługuje pola tablicowe (`array: true`): filtr `roleIds` wybiera operatorów z którąkolwiek z ról (`&&`).
- `tokens.ts` (token 256 bitów, w bazie skrót SHA-256) i `inviteAdministrator`: polecenie `pnpm db:staff:create --email … --name …` zakłada konto z rolą Administrator albo wysyła nowe zaproszenie i wypisuje link aktywacji (`PANEL_URL`).
- Dane startowe: operatorzy deweloperscy z rolami Dyspozytor i Serwisant (hasło z `SEED_ADMIN_PASSWORD`, TOTP przy pierwszym logowaniu) oraz regulamin, polityka prywatności i zasady jazdy w wersji 1 z plików `packages/db/seed/documents/*.md`. Regulamin i polityka to treść deweloperska oznaczona komentarzem w pliku, nie tekst prawny.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: 173 testy (71 core, 18 shared, 17 symulatora, 47 bazy, 20 API). Nowe testy w `packages/db/src/accounts.test.ts` na osobnej bazie: kody SMS, konto na numer i blokada z wersją rekordu, rotacja sesji z wyścigiem dwóch rotacji, zgody i nowa wersja dokumentu, zaproszenie administratora, filtr ról na liście operatorów, macierz uprawnień z wersją, strażnik ostatniego zarządzającego jako `DomainError`, dziennik audytu bez sekretów.
- `pnpm db:seed` na bazie deweloperskiej: 3 operatorów z rolami, 3 dokumenty w wersji 1. `pnpm db:staff:create` dla aktywnego administratora odmawia (`STAFF_ALREADY_ACTIVATED`) bez zmian w bazie.

**Błędy znalezione w trakcie**
- Drizzle wstawia kolumnę do szablonu `sql` bez nazwy tabeli, więc w podzapytaniu `"id"` wskazywało kolumnę tabeli z podzapytania: liczba akceptacji wersji dokumentu wychodziła 0, a numer obowiązującej wersji na liście dokumentów był błędny. Odwołania do zapytania zewnętrznego mają teraz jawną nazwę tabeli; w kodzie z iteracji 1 takich podzapytań nie ma.
- Rotacja sesji najpierw tworzyła następcę, a potem unieważniała poprzednika: przy dwóch równoległych odświeżeniach zostawałby osierocony token. Teraz najpierw unieważnienie (wygrywa jedno żądanie), potem następca; przegrane żądanie dostaje `null`.
- Zapis macierzy uprawnień jako „usuń wszystko i wstaw” chwilowo odbierałby `roles.manage` roli Administrator i poza transakcją kończył się błędem strażnika. Teraz zapis różnicowy.
- Błąd strażnika przychodził z bazy owinięty w błąd zapytania Drizzle; `rethrowDatabaseRule` zamienia go na `DomainError('LAST_ROLE_MANAGER')`.
- Skrypt `db:staff:create` przekazywał `--` przed argumentami, przez co `parseArgs` traktował `--email` jako tekst. Usunięte.

**Zmiany względem planu**
- Dokumenty prawne nie mają definicji zasobu ze wspólnym mechanizmem list: trzy dokumenty po kilka wersji, bez potrzeby filtrów. Pełny moduł treści z listami: iteracja 7.

## Iteracja 2: uwierzytelnianie w API (16 listopada 2026)

**Co powstało**
- [ADR 0035](adr/0035-sesje-tokeny-i-straznik-uprawnien.md): token dostępowy JWT w nagłówku dla obu klientów; token odświeżający aplikacji w `expo-secure-store`, panelu w ciasteczku `httpOnly` `SameSite=Strict`; sesja panelu 12 h albo 7 dni z „Zapamiętaj to urządzenie” (TOTP przy każdym logowaniu); token drugiego kroku `staff_mfa` zamiast tabeli stanu; strażnik odrzucający punkty bez deklaracji dostępu; Socket.IO z tokenem w `auth.token`.
- Adaptery na `node:crypto`: JWT HS256, TOTP (RFC 6238, base32, adres `otpauth://`), AES-256-GCM dla sekretów TOTP, HMAC kodów SMS z kluczem serwera; argon2id dla haseł (`@node-rs/argon2` 2.2.2). `@fastify/cookie` 11.1.5. Obie wersje sprawdzone w rejestrze npm: wydane ponad 3 dni temu.
- Moduł `AuthModule` (globalny): `CustomerAuthService` i kontroler (kod SMS, sesje, `/me`, rejestracja, akceptacja nowych wersji dokumentów, profil, `GET /legal/{slug}`), `StaffAuthService` i kontroler (hasło, TOTP i jego konfiguracja, zaproszenia, odświeżanie i wylogowanie z ciasteczkiem, `/admin/auth/me`), `StaffPermissionsService` (10 s), `LoggingSmsGateway`, `AuthGuard` jako `APP_GUARD`.
- `@RequirePermission` na 13 punktach floty i modeli z iteracji 1 (odczyt `scooters.read`, zapis `scooters.write`, komendy `scooters.command`); `/health` i `/zones` publiczne. Bramka Socket.IO rozłącza klienta bez tokenu operatora, a `fleet.subscribe` zwraca potwierdzenie z kodem błędu.
- Kontrakt `packages/shared/src/auth.ts` (żądania i odpowiedzi logowania dla API, aplikacji i panelu); konfiguracja `JWT_SECRET`, `TOTP_ENCRYPTION_KEY` (w produkcji wymagane, w środowisku deweloperskim wartości stałe) i `PANEL_URL`.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: 192 testy (71 core, 18 shared, 17 symulatora, 47 bazy, 39 API). Nowe: `crypto.test.ts` (wektory testowe z RFC 6238, podrobiony i wygasły JWT, zmieniony szyfrogram) i `auth.e2e.test.ts` na prawdziwym Fastify i osobnej bazie: punkty publiczne i 401 bez tokenu, 403 z nazwą uprawnienia dla Dyspozytora, 401 dla dezaktywowanego operatora, token klienta w panelu, Socket.IO bez tokenu; kod SMS z limitem i `Retry-After`, błędny kod z liczbą prób, konto i ekran danych, kod jednorazowy, rejestracja (wiek, nieaktualna wersja dokumentu), rezygnacja ze zgody marketingowej, rotacja i wylogowanie; zaproszenie z terminala, słabe hasło, konfiguracja TOTP, ciasteczko `httpOnly`, ponownie użyty kod TOTP, odświeżanie z ciasteczka, wpisy w dzienniku audytu, blokada po 5 pomyłkach i ten sam błąd dla nieistniejącego konta.
- Testy floty z iteracji 1 działają z tokenem operatora (pomocnik `staffToken` podpisuje token kluczem aplikacji; cały przepływ logowania sprawdza osobny test).
- API nie było uruchomione na żywo w tej sesji: w katalogu działał serwer innej sesji, a dwa API na jednym brokerze dzielą `MQTT_CLIENT_ID`.

**Błędy znalezione w trakcie**
- Pusta wartość `JWT_SECRET=` z `.env.example` byłaby pustym napisem i zatrzymywała start (za krótki sekret); pusta wartość oznacza teraz brak zmiennej.
- Zmiana nazwy zaproszonego operatora podawała wersję rekordu o jeden za wysoką (hasło już ją podniosło).
- Pierwsza wersja sprawdzania akceptowanych wersji dokumentów źle wykrywała nieaktualną wersję; teraz każdy identyfikator musi być obowiązującą wersją dokumentu ze zgodą.
- Zmiana kontraktu `fleet.subscribe` (potwierdzenie) wymagała poprawki wywołania w panelu (wykryte przez `tsc` panelu).

**Zmiany względem planu**
- **Panel do czasu ekranu logowania nie działa z API**: wszystkie punkty `/admin` odpowiadają 401. Logowanie w panelu to kolejny krok iteracji.
- Klucz skrótów kodów SMS jest wyprowadzony z `JWT_SECRET` (bez osobnej zmiennej).
- Treść SMS-a jest w kodzie API do czasu szablonów powiadomień w iteracji 6 (ADR 0027).
- Zasoby panelu dla operatorów, ról, klientów, dziennika i dokumentów oraz dziennik audytu dla zapisów floty to następny krok API.

## Iteracja 2: zasoby panelu i dziennik audytu w API (16 listopada 2026)

**Co powstało**
- `AuditedTransaction`: zapis operatora i wpis w `audit_log` w jednej transakcji, autor z tokenu; reguły bazy (strażnik `LAST_ROLE_MANAGER`, unikalność) wracają jako błędy domeny także przy zatwierdzeniu transakcji. `EntityHistory` i punkty `GET …/{id}/history` dla hulajnóg, modeli, operatorów, ról, klientów i dokumentów (uprawnienie jak do odczytu rekordu).
- Zapisy floty z iteracji 1 z dziennikiem: `scooter.created`, `scooter.updated`, `scooter.status_changed`, `scooter.retired`, `scooter.command_sent`, `scooter_model.created/updated/archived/deleted`. Komenda trafia do MQTT dopiero po zatwierdzeniu transakcji z wpisem.
- `/admin/staff`: zaproszenie z rolami i linkiem aktywacji (`PANEL_URL`), zmiana danych i ról (bez własnych ról; zmiana e-maila wylogowuje), dezaktywacja (bez siebie) z wylogowaniem, ponowne zaproszenie, reset TOTP, wylogowanie wszędzie. Reguła ostatniego zarządzającego rolami sprawdzana w core na stanie po zmianie, a w razie wyścigu w bazie.
- `/admin/roles` z macierzą uprawnień i wersją rekordu, `/admin/permissions`, usuwanie roli (systemowej i przypisanej nie). Zmiana ról i uprawnień czyści pamięć podręczną uprawnień, więc działa od następnego żądania.
- `/admin/users`: lista i karta klienta ze zgodami i sesjami, zmiana danych, blokada z powodem (notatka tylko w dzienniku, wylogowanie ze wszystkich urządzeń), odblokowanie, wylogowanie.
- `/admin/audit-log`: lista z filtrami i licznikami, szczegóły wpisu.
- `/admin/legal-documents`: lista, dokument z wersjami i liczbą akceptacji, wersja robocza z treści obowiązującej, edycja, publikacja (od razu, z „najważniejszymi zmianami” dla dokumentu ze zgodą), usunięcie wersji roboczej.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: 201 testów (71 core, 18 shared, 17 symulatora, 47 bazy, 48 API). Nowy `access.e2e.test.ts` na prawdziwym Fastify i osobnej bazie: historia hulajnogi z autorem i polami, brak wpisu przy konflikcie wersji; zaproszenie z linkiem i filtrem ról, ponowne zaproszenie, zmiana ról z nazwami w dzienniku, zakaz zmiany własnych ról i dezaktywacji siebie, dezaktywacja odcinająca dostęp od razu; macierz uprawnień z wersją i nieznanym uprawnieniem, usuwanie roli systemowej, przypisanej i wolnej; `LAST_ROLE_MANAGER` przez macierz i przez dezaktywację jedynego administratora operatorem z samym `staff.manage`; blokada klienta z wylogowaniem, ekranem blokady w `/me` i notatką w dzienniku; nowa wersja regulaminu od wersji roboczej do ponownej akceptacji w aplikacji; 403 dziennika bez `audit.read`.

**Błędy znalezione w trakcie**
- Makiety i pierwsza wersja testu oznaczały role Dyspozytor i Serwisant jako systemowe, a migracja 0002 (wykonana w iteracji 0) oznacza tak tylko rolę Administrator. Test wykazał, że rolę Serwisant da się usunąć (gdy nikt jej nie ma), zgodnie z modelem danych. Poprawione makiety `dostep-role`, `dostep-operator-formularz` i `dostep-rola-uprawnienia` („rola startowa”) oraz test (`ROLE_SYSTEM` dla Administratora, `ROLE_IN_USE` dla przypisanej roli Serwisant).
- `diffForAudit` przyjmował tylko `Record<string, unknown>`, do którego nie pasują interfejsy rekordów; teraz przyjmuje dowolny obiekt.

**Zmiany względem planu**
- Link zaproszenia operatora zwraca API (pokazany raz w panelu), bo nie ma jeszcze wysyłki e-maili; w produkcji potrzebny będzie adapter poczty.
- Wersja robocza dokumentu nie ma blokady optymistycznej (tabela `content_page_versions` nie ma kolumny `version`); edycję wersji roboczej rozstrzyga ostatni zapis. Pełny moduł treści w iteracji 7.

## Iteracja 2: logowanie w panelu (16 listopada 2026)

**Co powstało**
- Trasy panelu w dwóch grupach: `app/admin/(panel)` (nawigacja, wymagana sesja) i `app/admin/(auth)` (`/admin/logowanie`, `/admin/aktywacja`); adresy ekranów z iteracji 1 bez zmian.
- `lib/api.ts`: token dostępowy tylko w pamięci karty, ciasteczko wysyłane wyłącznie do `/admin/auth/*`, przy 401 jedno wspólne odświeżenie i ponowienie żądania. `lib/session.tsx`: odtworzenie sesji z ciasteczka po przeładowaniu, odświeżenie minutę przed wygaśnięciem, przekierowanie do logowania z adresem powrotu (tylko w obrębie `/admin`), `can(uprawnienie)` dla komponentów.
- Ekrany według makiet: hasło (`13-panel/admin-logowanie`), kod TOTP z liczbą pozostałych prób i polską odmianą (`dostep-logowanie-totp`), konfiguracja TOTP z kodem QR (`qrcode` 1.5.4, wydane ponad 3 dni temu) i kluczem do skopiowania (`dostep-totp-konfiguracja`), aktywacja z zaproszenia z listą wymagań hasła (`dostep-aktywacja`). Pole kodu to jedno pole `one-time-code` pod 6 komórkami (wklejanie i autouzupełnianie działają).
- Nawigacja ukrywa ekrany bez uprawnienia; blok operatora (inicjały, imię, role, wylogowanie) zastąpił „Tryb deweloperski”. Lista bez `…write` nie ma przycisku dodawania ani zaznaczania, formularz jest tylko do odczytu, karta hulajnogi na mapie pokazuje komendy tylko z `scooters.command`, a zmianę statusu z `scooters.write`.
- Mapa floty łączy się z Socket.IO z tokenem (funkcja `auth`, więc ponowne połączenie bierze aktualny token) i po rozłączeniu przez serwer odświeża sesję.
- Etykiety ekranów logowania i komunikaty nowych kodów błędów w `messages/pl.json`.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: 201 testów, build panelu przechodzi.
- W przeglądarce (panel `localhost:3002`, API `localhost:3001`, 1440×900): `/admin/mapa` bez sesji przekierowuje do `/admin/logowanie?next=%2Fadmin%2Fmapa`; administrator z danych startowych loguje się hasłem, konfiguruje TOTP (kod QR, klucz) i wraca na mapę, która wczytuje 40 hulajnóg i dołącza do pokoju `fleet`; przeładowanie `/admin/flota` odtwarza sesję z ciasteczka; wylogowanie usuwa sesję, a wejście na `/admin/modele` znów prowadzi do logowania; złe hasło daje „Nieprawidłowy e-mail lub hasło”; Dyspozytor nie widzi „Nowy model” ani zaznaczania, a formularz modelu ma 9 z 9 pól zablokowanych, bez zapisu i usuwania.
- Po weryfikacji TOTP kont administratora i Dyspozytora w bazie deweloperskiej zostało zresetowane, a sesje operatorów unieważnione: przy pierwszym logowaniu autor konfiguruje własną aplikację uwierzytelniającą.

**Błędy znalezione w trakcie**
- Przy szerokości 1024 px kolumna boczna (560 px) i szerokie pole konfiguracji TOTP (520 px) nie mieściły się w oknie, a strona przewijała się w poziomie; kolumna boczna ma teraz `min(560px, 39vw)`, a formularz `max-width: 100%`.
- Znak marki był biały na białym tle ekranu logowania; `BrandMark` przyjmuje kolor (na ekranie logowania `currentColor`, bo zmienna CSS w atrybucie `stroke` nie działała).
- Serwer `next dev` innej sesji na porcie 3002 nie zauważył przeniesienia tras do grup i trzymał w `.next/dev/types` stare ścieżki, przez co lokalny `next build` nie przechodził kontroli typów. Za zgodą autora serwer został zatrzymany i uruchomiony ponownie (konfiguracja `web` z `.claude/launch.json`).

**Zmiany względem planu**
- Formularz bez uprawnienia do zapisu ma nadal tytuł „Edycja …” i przycisk „Anuluj”; tytuł dla trybu tylko do odczytu do poprawki razem z ekranami Operatorów i Ról.

## Iteracja 2: ekrany kont i dostępu w panelu (16 listopada 2026)

**Co powstało**
- Operatorzy (`/admin/operatorzy`): lista z szybkimi filtrami statusu, filtrem ról i TOTP; zaproszenie z rolami i linkiem aktywacji pokazanym raz; karta operatora (dane, role z liczbą uprawnień, sesje, wylogowanie wszędzie, reset TOTP, ponowne zaproszenie, historia, dezaktywacja). Własnych ról nie da się zmienić w formularzu.
- Role (`/admin/role`): lista z paskiem liczby uprawnień; edycja roli jako macierz uprawnień według modułów (opisy uprawnień z tabeli `permissions`, czyli treść z bazy), pole „wszystkie” z trybem częściowym, niezapisane zmiany obramowane i podsumowane przy przycisku, ostrzeżenie o natychmiastowym działaniu, operatorzy z rolą, usuwanie roli własnej bez operatorów.
- Użytkownicy (`/admin/klienci`): lista z saldem, statusem i powodem blokady; karta klienta (statystyki, zgody z wersjami dokumentów i informacją o nowszej wersji, dane, sesje, historia) i okno blokady z powodem widocznym dla klienta i notatką do dziennika; odblokowanie.
- Dziennik audytu (`/admin/dziennik`): lista z licznikami rodzajów obiektów i nazwami akcji z kodem; wpis z polami przed i po, danymi wpisu i odnośnikiem do obiektu.
- Treści (`/admin/tresci`): zakładka Dokumenty prawne z wersjami i liczbą akceptacji; edytor wersji roboczej (tytuł, „najważniejsze zmiany”, Markdown z podglądem), publikacja z potwierdzeniem, usunięcie wersji roboczej.
- Wspólne: karta „Historia zmian” (`HistoryCard`) w formularzach, także hulajnóg i modeli z iteracji 1; formularz bez uprawnienia do zapisu ma tytuł z nazwą rekordu i „Wróć do listy”; zakładki pod tytułem listy; okno potwierdzenia z polami; pozycje Treści, Użytkownicy i „Operatorzy i role” w nawigacji według uprawnień.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: 201 testów, build panelu przechodzi.
- W przeglądarce (1440×900, panel 3002, API 3001): lista operatorów; zaproszenie testowego operatora (link aktywacji, karta ze statusem „Zaproszony”, wpis w historii); macierz roli Dyspozytor (dodanie uprawnienia z podświetleniem i podsumowaniem, zapis, wersja i historia, cofnięcie zmiany); lista i karta testowego klienta ze zgodami, blokada z powodem i notatką (sesje wylogowane, pasek blokady, historia), wpis blokady w dzienniku z notatką; wersja robocza regulaminu z podglądem, publikacja bez „najważniejszych zmian” odrzucona przez API, usunięcie wersji roboczej; karta historii w formularzu hulajnogi.
- Dane testowe usunięte z bazy deweloperskiej (klient, zaproszony operator), uprawnienia roli Dyspozytor przywrócone, TOTP administratora zresetowane, sesje operatorów unieważnione. Wpisy dziennika audytu z weryfikacji zostały (tabela tylko do dopisywania).

**Błędy znalezione w trakcie**
- Akcje dziennika audytu były w pliku tłumaczeń kluczami z kropką (`staff.invited`), a tłumacz traktuje kropkę jako zagnieżdżenie: historia pokazywała kod zamiast nazwy. Klucze są teraz zagnieżdżone (`audit.actions.staff.invited`).
- Moduły uprawnień w bazie (`access`, `accounts`, `documents`, `operations`, …) mają inne nazwy niż zakładane w tłumaczeniach; tłumaczenia według tabeli `permissions`, kolejność jak w nawigacji.
- Odmiana „2 operatorów” poprawiona na „2 operatorzy”; etykiety pól imienia w formularzach operatora i klienta brały nagłówek kolumny („Operator”, „Użytkownik”) zamiast „Imię i nazwisko”.

**Odstępstwa od makiet** (zgodnie z zasadą z CLAUDE.md)
- Szczegóły wpisu dziennika audytu to osobna strona, a nie panel boczny na liście (`dostep-audyt`).
- Treści mają na razie tylko zakładkę Dokumenty prawne (pozostałe w iteracji 7); domyślnie wybrany jest pierwszy dokument alfabetycznie.
- Lista ról ma ostrzeżenie w kolorze bursztynowym zamiast informacyjnego.
- Błąd publikacji bez „najważniejszych zmian” jest komunikatem nad formularzem, bez zaznaczenia pola.
- Link zaproszenia ma adres z `PANEL_URL` API; przy panelu na porcie 3002 trzeba ustawić `PANEL_URL=http://localhost:3002` w `.env`.

## Iteracja 2: konto w aplikacji mobilnej (16 listopada 2026)

**Co powstało**
- Sesja klienta (ADR 0035): token dostępowy w pamięci, token odświeżający w `expo-secure-store` (58.0.3, wydany 11 listopada, dodany przez `expo install`; w wersji web `localStorage`, jak w przewodniku Expo dla SDK 58), jedno wspólne odświeżenie przy 401, odtworzenie sesji po uruchomieniu i bramka kierująca według `nextStep` z `/me` (dane, zgody, blokada, konto). Trasy zabezpieczone `Redirect`, bo `Stack.Protected` nie jest opisany w dokumentacji SDK 58.
- Ekrany według makiet: start (`flow-start`), numer telefonu z akceptacją regulaminu i polityki oraz odnośnikami do ich treści (`flow-telefon`), logowanie (`konto-logowanie`), kod SMS z 6 komórek z odliczaniem, liczbą prób i stanem wyczerpanych prób (`flow-kod`, `konto-kod-proby`), dane z wiekiem z cennika (`konto-dane`), zasady przed pierwszą jazdą z dokumentu `zasady-jazdy` w bazie (`konto-zasady`), ponowna akceptacja z „najważniejszymi zmianami” (`konto-nowa-wersja`), konto zablokowane z powodem (`konto-zablokowane`), pełna treść dokumentu i ekran konta jako zaślepka do iteracji 3.
- Wspólne komponenty (`src/components/ui.tsx`): pasek kroków, pole 60 px, pole kodu z jednym polem `oneTimeCode`, pole wyboru, przyciski, komunikat błędu; tokeny motywu uzupełnione o kolory błędów. Etykiety w `src/i18n/pl.json`.

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: 201 testów; `expo lint` i `tsc` aplikacji czyste; `expo export` dla web (12 tras) i iOS (Hermes, 1280 modułów).
- W przeglądarce (wersja web, 390×844) z własną instancją API na porcie 3005 (bez MQTT, kod SMS w logu): rejestracja numerem z akceptacją dokumentów, błędny kod („Zostały 4 próby”), poprawny kod, ekran danych z wiekiem 18 z cennika, zasady z bazy, konto; przeładowanie odtwarza sesję; blokada konta (ustawiona w bazie) pokazuje ekran blokady z powodem, „Sprawdź ponownie” po odblokowaniu wraca do konta; tymczasowo opublikowana wersja 2 regulaminu prowadzi do ekranu ponownej akceptacji z „najważniejszymi zmianami”, pełną treścią i akceptacją; wylogowanie; 5 błędnych kodów daje stan „Wykorzystano 5 prób”.
- Po weryfikacji: klient testowy, jego kody i sesje usunięte, wersja 2 regulaminu usunięta, wersja 1 znów obowiązuje; serwery podglądu zatrzymane.

**Błędy znalezione w trakcie**
- Plik typów tras Expo Router (`.expo/types/router.d.ts`) był z 10 listopada i nie znał nowych ekranów; odświeża go `expo start` (nie `expo export`).
- Na webie pole tekstowe dostawało ramkę fokusu przeglądarki obok własnego obramowania; wyłączona.
- Numer na ekranie blokady był formatowany jako „+48500 ••• 456”; teraz „+48 500 ••• 456”, a na koncie z odstępami.
- Przycisk „Wyślij nowy kod” po wyczerpaniu prób był nieaktywny bez wyjaśnienia (odstęp 60 s); pod przyciskiem jest teraz odliczanie, a potem liczba kodów, które można jeszcze wysłać (ta poprawka sprawdzona typami i lintem, bez ponownego przejścia w przeglądarce).
- Zmiana `api.ts` przy przeładowaniu na gorąco odtworzyła moduł sesji z nowym kontekstem React („useSession poza SessionProvider”); dotyczy tylko trybu deweloperskiego, pełne przeładowanie działa.

**Odstępstwa od makiet** (zgodnie z zasadą z CLAUDE.md)
- Ekran startowy bez renderu hulajnogi (zdjęcie z biblioteki mediów, iteracja 7), zasady jazdy z numerami zamiast ikon (aplikacja nie ma jeszcze biblioteki ikon), odznaka nowej wersji ze znakiem „§”.
- Brak „Użyj adresu e-mail” i „Zaloguj się adresem e-mail” (ADR 0019); dane kontaktowe pomocy na ekranie blokady jako wartości w nawiasach do czasu bloków treści (iteracja 7).
- Ekran po zalogowaniu to zaślepka z wylogowaniem; mapa w iteracji 3.

## Iteracja 2: domknięcie (16 listopada 2026)

Plan i scenariusz demo: [iteracja 2](iteracje/iteracja-02-konta-dostep.md). Przebieg prac opisują wpisy od „Plan i makiety iteracji 2” powyżej.

**Co powstało przy domknięciu**
- Kontrakt [`openapi.json`](kontrakty/openapi.json) (50 ścieżek) generowany z kontrolerów: `pnpm api:openapi` zapisuje plik w stałej kolejności kluczy, a test API porównuje go z kodem, więc zmiana punktu bez aktualizacji kontraktu jest widoczna w CI. `/docs` korzysta z tego samego dokumentu.
- arc42: §6.7 diagramy logowania klienta (kod SMS, rejestracja, rotacja tokenu) i operatora (hasło, TOTP, ciasteczko, uprawnienia, Socket.IO), §5.2 moduły Uwierzytelnianie, Konta i Dostęp, §8.1 uwierzytelnianie i autoryzacja, §11 ryzyka (brak dostawcy SMS i poczty, pamięć podręczna uprawnień w jednej instancji).
- [Wymagania uczelni](wymagania-uczelni.md): 10 i 11 spełnione, 12, 13, 14 i 17 zaktualizowane o iterację 2.
- Scenariusz demo w 9 krokach (logowanie z TOTP, zaproszenie, zmiana uprawnień na żywo, ostatni administrator, rejestracja w aplikacji, blokada, nowa wersja regulaminu, historia zmian i dziennik).

**Weryfikacja**
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: 202 testy (71 core, 18 shared, 17 symulatora, 47 bazy, 49 API).

**Dług techniczny po iteracji 2**
- Bramka SMS i wysyłka zaproszeń tylko w wersji deweloperskiej (log API, link w panelu); dostawcy produkcyjni za adapterami.
- Treść SMS-a w kodzie API do czasu szablonów powiadomień (iteracja 6); dane kontaktowe pomocy i render na ekranie startowym do czasu modułu treści (iteracja 7).
- Uprawnienia w panelu odświeżają się z nową sesją (przeładowanie strony albo odświeżenie tokenu co 15 min); API stosuje zmianę od następnego żądania.
- Wersja robocza dokumentu bez blokady optymistycznej; szczegóły wpisu dziennika audytu na osobnej stronie zamiast panelu bocznego z makiety.
- Czyszczenie przeterminowanych kodów SMS i sesji zadaniem pg-boss: iteracja 3.
- Iteracja nie jest jeszcze wypchnięta; CI do potwierdzenia.


## Iteracja 2: niestabilne testy API w CI (16 listopada 2026)

Pierwsze dwa przebiegi CI po wypchnięciu iteracji 2 padły w kroku „Testy” (`apps/api`), choć wszystkie asercje przechodziły. Błąd dało się odtworzyć lokalnie mniej więcej w co trzecim przebiegu `pnpm test` na czystej bazie, z równoległymi testami bazy i API, czyli w warunkach CI.

**Przyczyna**
- Vitest zgłaszał nieobsłużony błąd `57P01 terminating connection due to administrator command` z `app.e2e.test.ts`.
- `pool.end()` z `pg` kończy się, zanim serwer zamknie połączenie, a sprzątanie testu od razu wykonuje `DROP DATABASE … WITH (FORCE)`. Serwer kończy wtedy ten backend i wysyła komunikat FATAL.
- Pula API nie miała nasłuchu zdarzenia `error`, a `EventEmitter` bez nasłuchu rzuca wyjątek. W produkcji to samo wywróciłoby proces API przy restarcie bazy.

**Poprawka**
- `createPool` w `packages/db` zawsze rejestruje obsługę błędów bezczynnych połączeń. API zapisuje je w logu jako ostrzeżenie (`Database`), a pula wraca do pracy z nowymi połączeniami.
- Pula pomocnicza w `fleet.e2e.test.ts` dostała ten sam nasłuch co testy uwierzytelniania i dostępu.

**Weryfikacja**
- `pnpm lint`, `pnpm typecheck` oraz 8 kolejnych przebiegów `pnpm test` na świeżo zmigrowanej bazie bez błędów.
- CI w GitHub Actions zielone dla commitu `63fb0bf` ([przebieg 43947452900](https://github.com/FifiLen/engineering-project/actions/runs/43947452900)); iteracja 2 zamknięta.

## Plan iteracji 3: wypożyczenie (16 listopada 2026)

Plan: [iteracja 3](iteracje/iteracja-03-wypozyczenie.md). Etap planowania, bez kodu i bez makiet.

**Co powstało**
- Plan iteracji 3: cel i granice z iteracjami 4 (strefy tylko do odczytu z danych startowych), 5 (portfel i obciążenie) i 6 (utrata łączności, zgłoszenia, push); zakres z migracją 0005, regułami przejazdu w `packages/core`, pg-boss, kontraktami MQTT i Socket.IO, przejazdami w panelu oraz mapą, przejazdem, profilem, historią, ustawieniami i usunięciem konta w aplikacji; kolejność kroków i scenariusz demo w 10 krokach.
- Lista 12 brakujących makiet (10 aplikacji, 2 panelu), m.in. akcja „Zarezerwuj” na karcie hulajnogi, wpisanie numeru hulajnogi, nieudane odblokowanie, kończenie przejazdu z oczekiwaniem na blokadę, szczegóły przejazdu i zdalne zakończenie w panelu.
- Lista ADR-ów do napisania: 0036 proces wypożyczenia w API, 0037 konfiguracja i zadania pg-boss, 0038 wygasanie komend MQTT, 0039 symulator w trakcie przejazdu klienta, 0040 mapa, lokalizacja i aparat w aplikacji, 0041 kod QR hulajnogi; warunkowo wycena przejazdu i zdjęcia parkowania w SeaweedFS.
- 10 pytań o wartości biznesowe (czas rezerwacji, minimalne saldo, ceny i zaokrąglanie, próg baterii, naliczanie przy utracie łączności, parkowanie poza strefą, saldo przy usunięciu konta, skutki zdalnego zakończenia, promień wyszukiwania, retencja) i 8 decyzji zakresu z rekomendacją (D1–D8).
- Dług z iteracji 2 w zakresie: czyszczenie kodów SMS i sesji zadaniem pg-boss (nowa procedura `sp_purge_expired_sessions`), profil, ustawienia i usunięcie konta w aplikacji razem z nawigacją.

**Wnioski z przeglądu kodu, migracji i makiet**
- Rejestracja nie zakłada wiersza w `wallets`, więc profil i reguła minimalnego salda nie mają portfela. Plan: portfel przy rejestracji i uzupełnienie w migracji 0005.
- Komendy MQTT nie wygasają. Przy sesji trwałej i QoS 1 komenda `unlock`, która przekroczyła 10 s (`UNLOCK_FAILED`), dotrze do hulajnogi po jej powrocie online i odblokuje ją bez przejazdu (ADR 0038, kontrakt 1.1.0).
- `sp_expire_reservations` zwraca tylko liczbę wygaszonych rezerwacji, a aplikacja i panel potrzebują identyfikatorów do zdarzeń; nie ma też procedury czyszczenia sesji.
- Makiety nie mają przycisku rezerwacji: `produkt-mapa` ma tylko „Skanuj i jedź”, a `produkt-hulajnoga` ma suwak odblokowania.
- Natywny MapLibre ([ADR 0005](adr/0005-react-native-expo.md), [ADR 0017](adr/0017-uslugi-mapowe.md)) wymaga development build zamiast Expo Go, a wersja web aplikacji potrzebuje MapLibre GL JS (ADR 0040).
- Zdjęcie parkowania (arc42 §6.4) wymagałoby pierwszego użycia SeaweedFS i aparatu, którego nie ma w symulatorze iOS ani w wersji web; rekomendacja: iteracja 6 (D2).
- Próg baterii jest niespójny między seedem (15%), makietą `admin-hulajnoga` (20%) i symulatorem (odmowa poniżej 5%); pytanie do autora.
- Symulator nie ma sposobu na rozłączenie wybranej hulajnogi, potrzebnego w demo nieudanego odblokowania; dopisane do zakresu.

**Do zrobienia przed implementacją**
- Odpowiedzi autora na pytania i decyzje z planu; makiety brakujących stanów; ADR-y 0036–0041.

## Iteracja 3: wypożyczenie (16 listopada 2026)

Plan: [iteracja 3](iteracje/iteracja-03-wypozyczenie.md). Autor przyjął rekomendacje D1–D8 i domyślne odpowiedzi na pytania 1–10 ([odpowiedzi](iteracje/iteracja-03-wypozyczenie.md#odpowiedzi-autora-16-listopada-2026)), a potem ADR 0036–0042.

**Decyzje i makiety**
- Odpowiedzi autora w planie iteracji; wycena przeszła z iteracji 5 do 3 ([plan iteracji](iteracje/README.md)).
- 16 nowych plansz: 13 w [`20-mobile-wypozyczenie`](projekt/README.md#aplikacja-wypożyczenie-iteracja-3) (w tym dodatkowa „rezerwacja anulowana”) i 3 w `21-panel-przejazdy`; ustalenia z plansz są w spisie makiet. Otwarta sprawa z plansz: zmiana numeru telefonu klienta (dziś ukryta, odesłanie do pomocy).
- ADR [0036](adr/0036-proces-wypozyczenia-w-api.md) proces wypożyczenia, [0037](adr/0037-pg-boss-konfiguracja-i-zadania.md) pg-boss, [0038](adr/0038-wygasanie-komend-mqtt.md) wygasanie komend, [0039](adr/0039-symulator-w-trakcie-przejazdu.md) symulator w przejeździe, [0040](adr/0040-mapa-lokalizacja-aparat-w-aplikacji.md) mapa, lokalizacja i aparat, [0041](adr/0041-kod-qr-hulajnogi.md) kod QR, [0042](adr/0042-wycena-przejazdu.md) wycena.

**Baza (migracja 0005)**
- Nowe zdarzenia osi czasu, termin ważności i powód odmowy komendy, indeks jednej komendy w toku na przejazd, portfel zakładany wyzwalaczem (i uzupełniony dla istniejących klientów), preferencje powiadomień, saldo różne od 0 blokujące `sp_anonymize_user`.
- Widoki `v_rental_timeline`, `v_user_rental_history`, `v_user_ride_stats`, rozszerzony `v_rental_details` (czas od odblokowania, flaga problemu, komenda w toku), funkcja `fn_rental_route`, procedura `sp_purge_expired_sessions`. Po migracji: 48 tabel, 21 widoków, 11 funkcji, 9 procedur.
- Nowe wartości typu `rental_event_type` w tej samej transakcji co widoki: widoki porównują `type::text`, bo PostgreSQL nie pozwala użyć nowej wartości wyliczenia przed zatwierdzeniem.
- Dane startowe: 12 przykładowych zakończonych przejazdów trzech klientów deweloperskich (`SEED_SAMPLE_RENTALS`), z osią czasu, komendami i kwotą z wyceny w core.

**Logika (`packages/core`)**
- Maszyna stanów: nowe akcje `CANCEL_RESERVATION`, `ABORT_END`, `ABORT_END_PAUSED`, `END_REMOTELY`.
- Reguły rezerwacji, startu (z idempotencją przez otwarty przejazd), pauzy, wznowienia, zakończenia w strefie parkowania, zdalnego zakończenia z powodem, wyniku komendy przejazdu (z kompensacyjną blokadą po spóźnionym odblokowaniu), dzwonka i usunięcia konta.
- Liczniki z osi czasu i wycena (każda rozpoczęta minuta jazdy i pauzy, co najmniej minuta jazdy, koniec naliczania przy żądaniu zakończenia).

**API**
- Moduł Wypożyczenia: mapa, hulajnoga po numerze, dzwonek, rezerwacja i anulowanie, start, pauza, wznowienie, zakończenie, bieżący przejazd, historia, profil, preferencje, `DELETE /me`; panel: lista, szczegóły z osią czasu i trasą, zdalne zakończenie z dziennikiem audytu.
- pg-boss 12.38.2 (wydany 10 listopada) w schemacie `pgboss`: zadania planowane w transakcji przez adapter `fromDrizzle` wbudowany w pg-boss (zamiast własnego adaptera z ADR 0037, który tylko powtarzałby tę funkcję), harmonogramy w UTC; liczniki `setInterval` limitu komend i partycji usunięte.
- Komendy panelu też mają `expiresAt` i zadanie limitu. Socket.IO: klient łączy się tokenem klienta i trafia do `user:{id}`, panel do pokoju `rentals`.
- Kontrakty: MQTT 1.1.0, Socket.IO 1.1.0, OpenAPI 0.3.0.

**Symulator**
- Komendy po `expiresAt` odrzucane z powodem `EXPIRED`; po odblokowaniu hulajnoga jedzie trasą z OSRM do innej strefy parkowania niż ta, w której stoi, i czeka odblokowana; przejazdy pokazowe domyślnie wyłączone; plik sterujący i polecenie `control` (`offline`, `silent`, `online`).

**Odstępstwa od ADR i planu**
- ADR 0039: „na końcu trasy kolejne `unlock` nic nie robi” doprecyzowane. Blokada po dojechaniu do celu kończy trasę, więc następne odblokowanie planuje nową trasę do innej strefy. Inaczej hulajnoga nie ruszyłaby przy drugim wypożyczeniu (symulator nie odróżnia pauzy od końca przejazdu). Pauza w trakcie trasy zachowuje resztę trasy.
- ADR 0036 i ADR 0012: pokój `rental:{id}` nie powstał. Właściciel dostaje zmiany w `user:{id}`, a panel wszystkie przejazdy w `rentals`, więc osobny pokój nic nie wnosił (kontrakt Socket.IO 1.1.0).
- Odpowiedź na pytanie 5 doprecyzowana w ADR 0036: nieudana blokada przy kończeniu z pauzy wraca do `PAUSED`, nie do `ACTIVE`.
- Wygaszanie rezerwacji przez zadanie zabezpieczające idzie przez repozytorium (z powiadomieniem klienta i panelu), a nie przez `sp_expire_reservations`, które zostaje narzędziem bazy (zmiana opisu w ADR 0037 przed zatwierdzeniem kodu).
- Błąd braku zgód ma kod `CONSENT_REQUIRED` z iteracji 2 zamiast `DOCUMENTS_NOT_ACCEPTED` z planu, a `OUTSIDE_PARKING` zwraca 422 (wcześniej w arc42 §6.4: 409).
- Krok 9 scenariusza demo: Dyspozytor ma `rentals.manage` z migracji 0002, więc brak uprawnienia pokazuje Serwisant.

**Weryfikacja (backend)**
- Testy: core 91, shared 18, db 52, api 68 (w tym 17 przypadków całego przejazdu i test kolejki pg-boss na prawdziwej bazie: zadanie limitu samo przestawia przejazd w `UNLOCK_FAILED` po około 10 s), symulator 27. Typy i lint bez błędów.
- Symulator sprawdzony z działającym Mosquitto: `offline` publikuje Last Will, komenda dostarczona po powrocie z przeterminowanym `expiresAt` dostaje `EXPIRED`, `silent` wykonuje komendę bez potwierdzenia.

**Panel**
- „Przejazdy” w nawigacji (`rentals.read`): lista na wspólnym wzorcu z szybkimi filtrami (W trakcie, Rezerwacje, Zakończone, Problemy) i licznikami, panel boczny z trasą i osią czasu, aktualizacja na żywo z pokoju `rentals`; strona szczegółów z mapą trasy, licznikami, opłatą, komendami MQTT, osią czasu, kartą klienta i hulajnogi; okno zdalnego zakończenia z powodem (`rentals.manage`).
- `ResourceList` dostał zgodne wstecz rozszerzenia: szybkie filtry z kilku pól (`presets`), otwieranie panelu bocznego zamiast przejścia (`onOpen`), listę bez zaznaczania (`selectable={false}`) i aktualizację wierszy na żywo (`subscribe`). Warstwy mapy wydzielone do `map-layers.ts` i używane przez mapę floty i mapę trasy.
- Karta hulajnogi i mapa floty linkują do bieżącego przejazdu (nowe pole `rentalId` w szczegółach hulajnogi).
- Odstępstwa od makiet: brak „Eksportuj XLSX” (iteracja 8); w otwartym przejeździe kolumny Kwota i Dystans na liście pokazują „—” (wartości bieżące są w panelu bocznym i szczegółach); mapa szczegółów bez znaczników pauzy; karta hulajnogi z ikoną zamiast renderu; wersja cennika bez odnośnika (strona cennika w iteracji 5); koszt na stronie szczegółów odświeżany co 20 s, czas co sekundę.

**Aplikacja**
- Mapa jest ekranem głównym po bramce z iteracji 2; otwarty przejazd przejmuje aplikację także po ponownym uruchomieniu. Ekrany: zgoda na lokalizację i stan bez zgody, mapa z hulajnogami i strefami, karta hulajnogi z rezerwacją, odliczanie, anulowanie i wygaśnięcie, skan, wpisanie numeru, brak aparatu, szczegóły z suwakiem, hulajnoga niedostępna, odblokowywanie i nieudane odblokowanie, jazda z pauzą i wznowieniem, poza strefą z najbliższą strefą, kończenie, nieudana blokada, podsumowanie, profil, historia, ustawienia (powiadomienia w bazie, zgoda marketingowa, motyw i strefy na urządzeniu), dane osobowe, usunięcie konta z blokadą.
- Mapa w dwóch implementacjach ze wspólnymi warstwami (ADR 0040). Nowe pakiety przez `expo install` (wszystkie starsze niż 3 dni): `expo-location` 58.0.22, `expo-camera` 58.0.14, `@maplibre/maplibre-react-native` 11.5.1, `maplibre-gl` 6.18.0, `socket.io-client` 4.8.4, `react-native-svg` 15.16.0. Wątek roboczy MapLibre kopiuje `apps/mobile/scripts/maplibre-worker.mjs` (jak w panelu); konfiguracja `mobile-web` uruchamia teraz skrypt `web`.
- Widok przejazdu dostał prędkość z ostatniego punktu telemetrii i trasę, a hulajnoga na mapie wariant (luki zgłoszone przy budowie ekranów). Aplikacja korzysta z nich zamiast szacować prędkość i zbierać trasę sama; miniatura w historii pokazuje tylko punkt końca, bo pozycja historii nie ma trasy.
- Świadomy dług: aplikacja powtarza regułę wyceny z ADR 0042 do wyświetlania bieżącego kosztu między odświeżeniami, bo nie może importować `packages/core` (ADR 0025). Źródłem kwoty jest zawsze widok z API.
- Odstępstwa od makiet: awatar zamiast „wstecz” na karcie rezerwacji; „brak hulajnóg” z promieniem i „Szukaj ponownie” zamiast odległości do najbliższej (API szuka w 2 km); oczekiwanie na pauzę jako wskaźnik na przycisku; nieudana pauza i wznowienie jako karta komunikatu w stylu `przejazd-blokada-nieudana`; „Prowadź do strefy”, „Trasa”, „Zgłoś”, „Metody płatności”, „Pomoc i zgłoszenia”, „Pobierz moje dane” ukryte; „Regulamin” i „Polityka prywatności” jako dwa wiersze; tekst usunięcia konta zgodny z anonimizacją (przejazdy zostają bez powiązania z osobą); odcień ostrzeżenia w trybie ciemnym (#3A2F1F) dobrany, bo nie ma go w `tokens.json`.

**Poprawki po budowie ekranów**
- Odpowiedź `ALREADY_IN_STATE` na `unlock` też jest sukcesem (jak przy `lock` w ADR 0036): hulajnoga zostawiona odblokowana po przejeździe pokazowym kończyła wypożyczenie jako `UNLOCK_FAILED`.
- Zdarzenie `END_REQUESTED` zapisuje strefę parkowania (`zone_id`), więc oś czasu pokazuje „w strefie P-01”.

**Weryfikacja (panel i aplikacja)**
- Panel: zrzuty 1440×900 porównane z trzema makietami na danych z API; zdalne zakończenie od kliknięcia do wpisu na osi czasu; aktualizacja listy na żywo z drugiej karty.
- Aplikacja (Expo web, 375×812, API z MQTT, symulatorem i pg-boss): rejestracja, mapa, rezerwacja z anulowaniem i prawdziwym wygaśnięciem po 10 min przez pg-boss, numer hulajnogi z baterią poniżej progu, dwa pełne przejazdy z pauzą, „Tu nie zakończysz jazdy”, zakończeniem w strefie i podsumowaniem (8,90 zł = 3,00 + 7 × 0,80 + 1 × 0,30 przy cenach deweloperskich), historia, ustawienia, edycja danych, usunięcie konta z blokadą przy rezerwacji, motyw ciemny.

**Niesprawdzone**
- Natywna mapa i aparat (bez Xcode w chwili budowy; tylko typy i lint).
- W aplikacji: ekrany nieudanej blokady, nieudanej pauzy i wznowienia (wymagają `control silent` w symulatorze), stan offline, zdalne zakończenie widziane w aplikacji, brak hulajnóg w pobliżu. W API te przypadki obejmują testy.

**Środowisko**
- Dev server panelu na 3002 zapętlił się w przeładowaniach Turbopacka po zmianach w `node_modules` (wymaga restartu). Panel sprawdzony na tymczasowej kopii.
- W bazie deweloperskiej zostały przejazdy testowe agentów (R-50012–R-50014 zakończone zdalnie oraz dwa przejazdy usuniętego konta testowego).

**Commit i CI**
- Siedem commitów iteracji 3 (`fc47661`–`3bbea14`). Pierwsze CI padło na typach: import `maplibre-gl/dist/maplibre-gl.css` w mapie web potrzebuje deklaracji `*.css` z `expo/types`, którą lokalnie dawał generowany i ignorowany `expo-env.d.ts`. Poprawka: `apps/mobile/src/types/expo.d.ts` (commit `f010476`), sprawdzona na czystej kopii repozytorium; CI zielone.
- Systemowy `git` czekał na akceptację licencji Xcode; commity zrobione `git` z Command Line Tools (`DEVELOPER_DIR=/Library/Developer/CommandLineTools`).

## Plan iteracji 4: strefy (17 listopada 2026)

Plan: [iteracja 4](iteracje/iteracja-04-strefy.md). Etap planowania, bez kodu i bez makiet.

**Co powstało**
- Plan iteracji 4. Cel: edytor stref w panelu, wykrywanie wjazdu i wyjazdu ze strefy z telemetrii, komendy limitu prędkości i zatrzymania, komunikaty stref w aplikacji, prowadzenie do strefy parkowania, trasa do hulajnogi i wyszukiwanie celu. Granice z iteracjami 5, 6 i 8, zakres z migracją 0006, kolejność kroków i scenariusz demo w 10 krokach.
- Stan wyjściowy spisany z kodu: tabela `zones`, `fn_zones_at_point`, `evaluatePosition`, zdarzenia `ZONE_ENTERED` i `ZONE_EXITED` w typie, komendy `speed_limit` i `stop_gradually` w kontrakcie i w symulatorze. Brakuje edytora, wykrywania zmian i komunikatów stref.
- Lista 11 brakujących makiet: 5 panelu i 6 aplikacji, m.in. nowa strefa, formularz według typu, błędy geometrii, dezaktywacja, strefa zakazu w trakcie jazdy, prowadzenie do strefy i wynik wyszukiwania.
- Lista ADR-ów do napisania: 0043 wykrywanie zmian stref, 0044 komendy stref dla hulajnogi, 0045 wyszukiwanie miejsc (Photon), 0046 symulator a strefy, 0047 edytor geometrii w panelu, 0048 trasy dla klienta z OSRM.
- 10 pytań o wartości biznesowe:
  - limit w wolnej strefie;
  - zakaz i wyjazd poza obszar w trakcie jazdy;
  - start w strefie zakazu;
  - pełna strefa parkowania;
  - histereza na granicy;
  - zmiana strefy w trakcie przejazdów;
  - miejsce strefy zakazu w danych startowych;
  - zasięg wyszukiwania;
  - kto edytuje strefy.

  Do tego 8 decyzji zakresu z rekomendacją (D1–D8).

**Wnioski z przeglądu kodu, migracji i makiet**
- Indeks `scooter_commands_one_pending_per_rental` dopuszcza jedną oczekującą komendę na przejazd. Komenda limitu powiązana z przejazdem zablokowałaby pauzę albo zakończenie (`RENTAL_COMMAND_PENDING`), więc ADR 0044 musi to rozstrzygnąć.
- `stop_gradually` nie ma w kontrakcie MQTT odwrotności, więc nie da się wznowić jazdy po wyjeździe ze strefy zakazu bez zmiany kontraktu albo nowej reguły.
- Symulator czyta strefy parkowania z pliku miejsc, a nie z bazy, więc nie zobaczy stref zmienionych w panelu (ADR 0046).
- OSRM ma tylko profil rowerowy, więc trasa piesza do hulajnogi wymaga decyzji D6.
- Dane startowe nie mają strefy zakazu, a strefy to okręgi z `ST_Buffer`. Miejsce strefy zakazu wybierze autor, a współrzędne pobierze `pnpm db:places`.
- Makieta `admin-strefy` pokazuje edycję stref przez Dyspozytora, a migracja 0002 daje `zones.write` tylko Administratorowi (pytanie 10).

**Do zrobienia przed implementacją**
- Odpowiedzi autora na pytania i decyzje z planu; makiety brakujących stanów; ADR-y 0043–0048.

**Odpowiedzi autora (17 listopada 2026)**
- Wszystkie rekomendacje D1–D8 i domyślne odpowiedzi na pytania 1, 4–7, 9 i 10. Strefa zakazu i wyjazd poza obszar działania: hulajnoga staje, a przejazd trwa.
- Strefa zakazu w danych startowych: Park imienia świętego Jana Sarkandra (`way/209433745`), wybrany z czterech kandydatów z OpenStreetMap, czyli parków i skwerów w promieniu 1,5 km od Rynku. Publiczne serwery Overpass były przeciążone, więc kandydatów i ich wielokąty pobrał Nominatim (wyszukiwanie i `lookup` z `polygon_geojson`). Odległości od stref parkowania i od S-01 są przybliżone (rzut płaski).

**Makiety (17 listopada 2026)**
- 14 plansz w [`22-mobile-strefy` i `23-panel-strefy`](projekt/README.md#aplikacja-strefy-iteracja-4): 7 aplikacji (zakaz i wyjazd poza obszar w trakcie jazdy, hulajnoga niedostępna `OUT_OF_AREA`, prowadzenie do strefy, trasa piesza do hulajnogi, wynik wyszukiwania, brak wyników) i 7 panelu (lista z edytorem w nowej nawigacji, nowa strefa, wolna jazda, zakaz z wariantem obszaru, błąd geometrii, dezaktywacja, zmiana w trakcie przejazdów). Spis ekranów: 102.
- Plansze przygotowało dwóch agentów równolegle, a PNG wyrenderował Chrome headless (aplikacja 2×, panel 1×). Wszystkie PNG obejrzane przed wpisem do spisu. Poprawka po przeglądzie: komunikat strefy zakazu w panelu mówi o kliencie („klient nie zakończy tu przejazdu”), a nie w drugiej osobie.
- Ustalenia z plansz są w spisie makiet. Najważniejsze dla implementacji:
  - „Zakończ” w strefie zakazu zostaje aktywny, a o odmowie decyduje API (`OUTSIDE_PARKING`);
  - „Dezaktywuj” zastępuje „Usuń strefę”;
  - pole „Granica” w karcie strefy pokazuje błędy geometrii.
- Otwarte do ADR 0043 i 0047:
  - czy blokować zmianę typu strefy użytej w przejazdach;
  - uproszczenie okręgów z danych startowych (64 punkty);
  - czas wjazdu do strefy w kolumnie „W strefie od”.

**ADR 0043–0048 (17 listopada 2026, zaakceptowane przez autora)**
- **0043 Wykrywanie zmian stref:**
  - moduł Strefy za portem, wołany przez Telemetrię po zapisie partii, tylko dla hulajnóg w przejeździe;
  - stan w `scooter_zone_presence`;
  - histereza w core: wjazd od pierwszego odczytu, wyjazd po dwóch odczytach albo poza 10 m;
  - pierwszy odczyt przejazdu bez zdarzeń; punkty z bufora dają zdarzenia, ale nie komendy.
- **0044 Komendy stref:**
  - indeks jednej oczekującej komendy ograniczony do `LOCK` i `UNLOCK`, więc komendy stref mają `rental_id` i są na osi czasu;
  - kontrakt MQTT 1.2.0 z `release_stop` (`speed_limit` bez `kmh` zdejmuje limit, `lock` kasuje limit i zatrzymanie);
  - uzgadnianie stanu docelowego zamiast komendy na każde przejście.
- **0045 Wyszukiwanie:** API pośredniczy w zapytaniach do publicznego Photon.
  - `bbox` obszaru z zapasem 1 km, `lang=default` (sprawdzone: `pl` nie jest obsługiwany, nazwy lokalne są polskie);
  - pamięć podręczna 24 h i limit 30 zapytań na minutę;
  - przy awarii `503 PLACES_UNAVAILABLE`.
- **0046 Symulator a strefy:**
  - wirtualny klient czyta `GET /zones` z punktem `anchor`, a część hulajnogi zna tylko MQTT;
  - po zatrzymaniu prowadzi hulajnogę pieszo wstecz po trasie;
  - `control goto <numer> <strefa|punkt>` do demo.
- **0047 Edytor geometrii:**
  - `terra-draw` 1.39.0 (1.40.0 z 15 listopada za nowa) i `terra-draw-maplibre-gl-adapter` 1.5.0;
  - walidacja w panelu, w core i w bazie, a rozstrzyga baza;
  - cofanie z własnego stosu;
  - typ strefy niezmienny po utworzeniu, co jest odstępstwem od makiet;
  - okręgi w danych startowych z 16 punktami.
- **0048 Trasy:**
  - drugi kontener OSRM z profilem pieszym; pomiar na wycinku śląskim: 54 s przygotowania, 796 MB, około 500 MiB pamięci (dane testowe usunięte);
  - trasy przez API;
  - przy awarii OSRM linia prosta z `approximate: true`.

## Iteracja 4: strefy (17 listopada 2026)

Plan: [iteracja 4](iteracje/iteracja-04-strefy.md), decyzje w [ADR 0043–0048](adr/README.md). Backend napisałem sam. Symulator, panel i aplikację zrobili równolegle trzej agenci, każdy w swoim katalogu. Ich raporty przejrzałem, a zgłoszone braki API poprawiłem.

**Baza (migracja 0006)**
- Reguły geometrii pilnuje wyzwalacz `zones_rules`:
  - strefa leży w jedynym aktywnym obszarze działania;
  - strefy parkowania nie mają części wspólnej;
  - typ strefy się nie zmienia;
  - obszaru działania nie można wyłączyć ani zmniejszyć tak, by odsłonił inne strefy.
- Wyzwalacz rozpoznaje „inną strefę” także po kodzie. `INSERT … ON CONFLICT (code)` w danych startowych odpala `BEFORE INSERT` z nowym `id` i bez tego warunku zgłaszał nakładanie strefy na samą siebie.
- Nowe tabele `scooter_zone_presence` i `scooter_zone_control`, komenda `RELEASE_STOP`, indeks jednej oczekującej komendy przejazdu tylko dla `LOCK` i `UNLOCK` (także w `v_rental_details`).
- Funkcje `fn_zones_near_point`, `fn_nearest_parking`, `fn_zone_change_impact` i `fn_scooter_can_ride`; ta ostatnia wyklucza hulajnogi w strefie zakazu z `fn_nearest_scooters`.
- Widoki `v_zone_list` i `v_parking_occupancy`, procedura `sp_delete_zone`.
- Okręgi w danych startowych mają 16 punktów zamiast 64 (ADR 0047). Strefa zakazu Z-01 w Parku im. św. Jana Sarkandra ma współrzędne z `pnpm db:places`: 50.099171, 18.543995, zgodne z `way/209433745`.
- Stan bazy: 50 tabel, 23 widoki, 15 funkcji, 10 procedur.

**Core i API**
- **Core:**
  - `validateZoneInput`: limit 5–15 km/h, co najmniej 3 punkty, samoprzecięcia, najmniej 100 m²;
  - `detectZoneChanges`: histereza, pierwszy odczyt bez zdarzeń;
  - `desiredZoneControl` i `zoneControlCommands`: uzgadnianie stanu docelowego hulajnogi;
  - przyczyna `OUT_OF_AREA`.
- **Moduł Strefy:**
  - `ZoneTracker` wołany przez Telemetrię po zapisie partii;
  - edytor w panelu z wersją rekordu i dziennikiem audytu, z geometrią przed i po zmianie;
  - `GET /zones` z `ETag` i punktem `anchor`, `zones.changed` przez Socket.IO;
  - po zapisie ponowna ocena hulajnóg w trwających przejazdach.
- **Moduł Wypożyczenie:** zdarzenia `ZONE_ENTERED` i `ZONE_EXITED` z czasem odczytu, komendy stref z `rental_id`. Pauza zeruje stan zastosowany, a powrót do `ACTIVE` od razu uzgadnia limit. `RentalView` dostał `zones` i `zoneControl`.
- **Moduł Geo:**
  - `RoutePlanner`: OSRM rower i pieszo, przy awarii linia prosta;
  - `PlaceSearch`: Photon z pamięcią podręczną 24 h i limitem 30 zapytań na minutę;
  - punkty `GET /zones/nearest-parking`, `GET /scooters/:id/walk`, `GET /places/search` i `GET /places/destination`.
- `infra/` dostała usługi `osrm-foot-prepare` i `osrm-foot` (port 5002; odstępstwo od ADR 0048, który podaje 5001, ale na macOS 5001 jest zastępczym portem profilu rowerowego) ze skryptem `prepare-foot.sh`. Dane z dowiązania do tego samego wycinka trafiają do `infra/osrm/foot/`.
- Kontrakty: MQTT 1.2.0, Socket.IO 1.2.0, OpenAPI 0.4.0.

**Poprawki po raportach agentów**
- **Pętla ponowień:** `ALREADY_IN_STATE` jest sukcesem także dla `STOP_GRADUALLY` i `RELEASE_STOP` (nie tylko dla `LOCK` i `UNLOCK`). Inaczej zgubione potwierdzenie `release_stop` dawałoby ponowienie przy każdym odczycie, bo symulator odpowiada „już w stanie”. Zasadę zapisałem w kontrakcie MQTT.
- **Najbliższa strefa parkowania:** `fn_nearest_parking` i `nearestParking` z iteracji 3 sortowały po `<->` na geometrii, czyli w stopniach. Ze strefy Z-01 wskazywały P-01 (382 m) zamiast P-03 (265 m). Teraz sortują po odległości na geografii.
- **Zdublowany kod strefy:** daje `409 ALREADY_EXISTS` z polem `code` zamiast 500.
- **Okno dezaktywacji:** `ZoneDetails.endedRentals` podaje liczbę przejazdów zakończonych w strefie, którą okno pokazuje jak w makiecie.
- Plik 0006 i sumę kontrolną w bazie deweloperskiej poprawiłem dwa razy (wyzwalacz, sortowanie). Migracja nie była jeszcze w commicie.

**Symulator (ADR 0046)**
- Komendy:
  - `release_stop`;
  - `stop_gradually` hamuje do 0 w około 3 s;
  - `lock` kasuje limit i zatrzymanie, także na zablokowanej hulajnodze.
- Strefy z `GET /zones` z `ETag`, odpytywane co 60 s. Przed pierwszą udaną odpowiedzią strefy są z pliku miejsc; po niej, gdy API przestanie odpowiadać, zostają ostatnie strefy z API.
- Wirtualny klient prowadzi hulajnogę pieszo wstecz po trasie (stany `walking`, `waiting` i `stuck`) i czeka na `release_stop`.
- Polecenie `control goto`. Przejazdy pokazowe dalej losują cel z pliku miejsc.

**Panel**
- Ekran „Strefy” (`/admin/strefy`):
  - lista na kontrakcie list;
  - mapa z edytorem Terra Draw 1.39.0 i adapterem 1.5.0 (sprawdzone daty publikacji): rysowanie, edycja i usuwanie punktów, przyciąganie, Cofnij i Ctrl+Z;
  - karta z błędami geometrii przy polu „Granica” i paskiem konfliktu wersji;
  - okna dezaktywacji, usunięcia i ostrzeżenia o przejazdach w trakcie;
  - odświeżanie po `zones.changed`, widok tylko do odczytu bez `zones.write`.
- Oś czasu przejazdu i dziennik komend mają etykiety stref i komend stref.
- Odstępstwa od makiet:
  - typ zablokowany w edycji (ADR 0047);
  - stronicowanie 10/25/50/100 z kontraktu;
  - uchwyty punktów są kółkami;
  - przy rysowaniu brak dymka „Zamknij tutaj” i etykiety przy kursorze;
  - błąd „poza obszarem” to czerwone obwódki punktów zamiast kreskowania;
  - brak kolumny „Skutek” w ostrzeżeniu o zmianie granicy (API jej nie daje);
  - podpowiedź „Wybierz strefę” bez zaznaczenia.
- **Dług:** kolory parkowania i wolnej jazdy w `map-layers.ts` mapy floty są odwrotne niż w makietach stref i w edytorze. Do ujednolicenia.
- **Build:** raz zakończył się komunikatem Next.js o znanej podatności z zaleceniem aktualizacji; drugi przebieg przeszedł. Aktualizacja Next.js czeka na decyzję autora.

**Aplikacja**
- Mapa:
  - pasek „Dokąd jedziesz?”, chip „Strefy” z legendą;
  - wyszukiwanie z ostatnimi miejscami na urządzeniu;
  - wynik na mapie z `/places/destination`;
  - trasa piesza po rezerwacji i po „Trasa”, z nowym pobraniem po zejściu z trasy.
- Ekran jazdy:
  - komunikaty wolnej jazdy, zakazu, „poza obszarem” i „Silnik znów działa”;
  - „Tu nie zakończysz jazdy” z podtytułem zależnym od przyczyny;
  - prowadzenie do strefy, które kończy się samo po wjeździe.
- Przyczyna `OUT_OF_AREA`.
- Odstępstwa:
  - lista wyników bez czasu dojazdu (ADR 0045 daje na liście tylko odległość);
  - pinezka celu z kół;
  - pod paskiem wyszukiwania chip „Strefy” i przycisk położenia;
  - przy rezerwacji zostaje pasek wyszukiwania;
  - dodatkowe teksty „Silnik znów działa” i „Koniec strefy wolnej jazdy”;
  - kolejność komunikatów na ekranie jazdy opisana w raporcie.

**Weryfikacja**
- Testy: core 105, shared 18, db 55, api 75 (w tym `zones.e2e.test.ts`: edytor, przejazd przez S-01, Z-01 i P-02 z komendami, pauzą, ponowieniem, punktami z bufora i zmianą limitu w trakcie), simulator 41.
- `pnpm turbo run lint typecheck test build` przechodzi dla wszystkich pakietów oprócz aplikacji mobilnej; ta przechodzi `lint` i `typecheck`.
- **Panel (1440×900):** lista, edycja z cofaniem, nowa strefa, błędy nakładania i wyjścia poza obszar, konflikt wersji w dwóch kartach, dezaktywacja i przywrócenie, usunięcie, widok Dyspozytora. Ostrzeżenie o przejazdach w trakcie i oś czasu sprawdzone na odpowiedziach podstawionych w przeglądarce.
- **Aplikacja (web, 375×812):** wszystkie plansze `22-mobile-strefy` na API 3001. Jazdę dawała tymczasowa hulajnoga #0041 sterowana skryptem MQTT, usunięta po teście. Photon na żywo (zapytanie „Rynek”), OSRM pieszy na żywo.

**Niesprawdzone**
- Natywna mapa.
- Pełny scenariusz demo z symulatorem przez strefę zakazu (symulator sprawdzony testami, aplikacja hulajnogą sterowaną ręcznie).
- Ostrzeżenie o przejazdach w trakcie w panelu na prawdziwym przejeździe.
- `429 RATE_LIMITED` w aplikacji, tryb ciemny nowych ekranów.

**Dane testowe w bazie deweloperskiej**
- Operator `strefy-test@example.test` (Administrator). Hasło i TOTP są tylko w scratchpadzie sesji.
- Wpisy audytu dla testowej strefy T-99 oraz dezaktywacji i przywrócenia P-05 (wersja 3).
- Klientka z danych startowych Karolina Mazur z uzupełnionym profilem i jedną anulowaną rezerwacją #0006.
- Port 3001 zajmuje API w trybie watch z wcześniejszej sesji. Pracuje na nowym kodzie i z działającym symulatorem.

**Commit i CI**
- Sześć commitów iteracji 4 (`ae75a3c`–`ca1f68e`); CI zielone za pierwszym razem (lint, typy, migracje na czystej bazie, testy, build).

## Plan iteracji 5: płatności (17 listopada 2026)

Plan: [iteracja 5](iteracje/iteracja-05-platnosci.md). Etap planowania, bez kodu i bez makiet.

**Co powstało**
- Plan iteracji 5. Cel:
  - karta i doładowanie portfela kartą albo BLIK-iem przez Stripe w trybie testowym;
  - rozliczenie przejazdu z portfela albo kartą, `UNPAID` ze spłatą, paragony;
  - wersje cennika, płatności, korekty salda i zwroty w panelu.

  Do tego granice z iteracjami 6–8, zakres z migracją 0007, kolejność kroków i scenariusz demo w 9 krokach.
- Stan wyjściowy spisany ze schematu: tabele płatności, księgi, paragonów i webhooków są od migracji 0001 i 0002, a stan `UNPAID` jest w typie i na diagramie, ale nie w maszynie stanów.
- Lista 10 brakujących makiet: 6 aplikacji (doładowanie w toku i wynik, metody płatności, paragon, podsumowanie po rozliczeniu, zaległość na mapie, wybór karty przed startem) i 4 panelu (cennik z wersjami, płatności i księga, korekta salda, zwrot).
- ADR-y do napisania: 0049 rozliczenie przejazdu, 0050 integracja ze Stripe, 0051 płatności w aplikacji, 0052 paragony, 0053 wersje cennika w panelu, 0054 zwroty i korekty salda.
- 12 pytań o wartości biznesowe:
  - ceny i minimalne saldo;
  - kwoty doładowań;
  - ujemne saldo;
  - płatność kartą za przejazd i `UNPAID`;
  - opłata poza strefą;
  - VAT i paragony;
  - saldo przy usunięciu konta;
  - korekty i zwroty;
  - przejazdy z iteracji 3 i 4 bez obciążenia.

  Do tego 8 decyzji zakresu z rekomendacją (D1–D8).

**Wnioski z przeglądu schematu, kodu i makiet**
- Makieta `admin-cennik` ma pole „Limit w strefie wolnej jazdy”, a od iteracji 4 limit należy do strefy. Rekomendacja D6: pole wypada z cennika.
- Opłata „poza strefą” jest w makietach opisana jako doliczana przy odholowaniu, a w planie iteracji 3 jako zakończenie poza strefą za opłatą (pytanie 7).
- Konto Stripe i klucze testowe zakłada autor; plan przewiduje atrapę operatora (D1), więc testy, CI i demo bez sieci nie zależą od Stripe.
- Dostępność BLIK w trybie testowym Stripe trzeba sprawdzić przy ADR 0050 (ryzyko z arc42 §11).
- Płatności w aplikacji wymagają tego samego podziału co mapa: Stripe.js w wersji web i natywny SDK w development build (ADR 0051).

**Do zrobienia przed implementacją**
- Odpowiedzi autora na pytania i decyzje z planu; konto Stripe w trybie testowym; makiety brakujących stanów; ADR-y 0049–0054.

**Odpowiedzi autora (17 listopada 2026)**
- Wszystkie rekomendacje D1–D8 i domyślne odpowiedzi na pytania 1–3, 5, 6 i 8–12.
- Ujemne saldo po przejeździe jest dozwolone i blokuje kolejną rezerwację i start do doładowania.
- Opłata „poza strefą” dotyczy odholowania przez serwis w iteracji 6, a zakończenie poza strefą parkowania zostaje zablokowane.
- Stawka VAT 23% jest wartością roboczą do sprawdzenia przez autora (dopisane do otwartych decyzji w `CLAUDE.md`).

**Makiety (17 listopada 2026)**
- 18 plansz w [`24-mobile-platnosci` i `25-panel-platnosci`](projekt/README.md#aplikacja-płatności-iteracja-5):
  - 11 aplikacji: kwota własna, oczekiwanie, sukces i odmowa doładowania, metody płatności, paragon, podsumowanie z portfela i kartą, start z kartą, zaległość na mapie i jej spłata;
  - 7 panelu: wersje cennika, nowa wersja, płatności, paragony, portfel klienta z księgą, korekta salda, zwrot.

  Spis ekranów: 120. Plansze przygotowało dwóch agentów równolegle, a PNG wyrenderował Chrome headless. Wszystkie PNG obejrzane.
- Poprawka po przeglądzie: odrzucona karta na planszach zaległości to karta testowa •••• 0002, a nie •••• 4242. Ta ostatnia w trybie testowym Stripe zawsze przechodzi, a scenariusz demo używa karty z odmową.
- **Luki w schemacie wykryte przy projektowaniu, dopisane do zakresu migracji 0007:**
  - zwroty częściowe i wielokrotne (brak kwoty zwróconej i tabeli zwrotów);
  - powód korekty w księdze;
  - powiązanie webhooka z płatnością i licznik powtórzeń;
  - rodzaj dokumentu i korekta paragonu;
  - stawka VAT poza `receipt_items`.
- **Sprzeczności do rozstrzygnięcia:**
  - macierz operacji pozwala usuwać metody płatności w panelu, a D5 mówi „tylko do odczytu”;
  - plansza `20-mobile-wypozyczenie/profil-dane` obiecuje potwierdzenia płatności na e-mail, a D7 wyklucza e-mail. Do poprawy przy implementacji.

**ADR 0049–0054 (17 listopada 2026, zaakceptowane przez autora)**
- **Sprawdzone przed pisaniem:**
  - wersje: `stripe` 23.1.0, `@stripe/stripe-js` 10.3.0, `@stripe/react-stripe-js` 7.1.0 (wszystkie starsze niż 3 dni), `@stripe/stripe-react-native` 0.81.0 przez `expo install` dla Expo SDK 58 (najnowsza 0.85.1);
  - dokumentacja Stripe:
    - BLIK w PLN dla konta z Polski, w trybie testowym działa każdy 6-cyfrowy kod, klient ma 60 s na potwierdzenie;
    - karty testowe: 4242 sukces, 0002 odmowa, 3220 wymaga 3-D Secure, 0341 zapis tak, obciążenie nie, 9995 brak środków;
    - SetupIntent z `off_session`, błąd 402 przy obciążeniu bez udziału klienta;
    - webhooki z surową treścią, bez gwarancji kolejności, z duplikatami.

  D2 rozstrzygnięte: BLIK przez Stripe działa w trybie testowym.
- **0049 Rozliczenie:**
  - portfel w transakcji `ENDED` przez `sp_wallet_post` z blokadą portfela;
  - karta zadaniem `payment.charge-ride` po `ENDED`;
  - zmiana maszyny stanów z ADR 0013: `DECLINE_PAYMENT` to teraz `ENDED → UNPAID` zamiast `ENDING → UNPAID`, bo przy D4 przejazd kartą kończy się przed wynikiem płatności;
  - stan rozliczenia `NONE`, `WALLET_PAID`, `CARD_PENDING`, `CARD_PAID` albo `FAILED`, liczony w widoku.
- **0050 Stripe:**
  - port `PaymentProvider` z atrapą w procesie (te same zdarzenia, podpis HMAC);
  - `payment_customers`;
  - webhook z `rawBody` i przetwarzaniem w pg-boss;
  - sprawdzanie statusu po 2 min;
  - odrzucenie klucza `sk_live_` przy starcie.
- **0051 Aplikacja:** trzy implementacje modułu płatności (web: Stripe.js, natywnie: SDK, atrapa); klucz publiczny z `GET /payments/config`.
- **0052 Paragony:**
  - potwierdzenie sprzedaży, niefiskalne;
  - VAT „w stu” od sumy brutto;
  - `tariffs.vat_rate`;
  - korekta jako osobny dokument `CORRECTION`;
  - dane sprzedawcy z konfiguracji;
  - opis wymogów fiskalnych do sprawdzenia przez autora.
- **0053 Cennik:** nowa wersja z `valid_from`, najwyżej jedna zaplanowana, usunięcie zaplanowanej bez przejazdów, bez limitu strefy.
- **0054 Zwroty i korekty:**
  - tabela `refunds` z sumą pilnowaną w bazie;
  - `wallet_ledger.reason`;
  - zwrot salda na kartę jako nowy typ księgi `PAYOUT`;
  - uprawnienia: zwrot `rentals.manage`, korekta i zwrot salda `wallet.adjust`.


## Iteracja 5: płatności (17 listopada 2026)

Plan: [iteracja 5](iteracje/iteracja-05-platnosci.md), decyzje w [ADR 0049–0054](adr/README.md). Backend napisałem sam. Panel i aplikację zrobili równolegle dwaj agenci, każdy w swoim katalogu, a trzeci zrobił niezależny przegląd backendu. Raporty przejrzałem, znaleziska przeglądu poprawiłem, a przepływy aplikacji i panelu sprawdziłem w przeglądarce na osobnej bazie podglądu.

**Baza (migracja 0007)**
- Nowe tabele `payment_customers` i `refunds`. Typ wpisu `PAYOUT`, powód korekty `ledger_reason`, rodzaj paragonu `receipt_kind`.
- Księga:
  - każdy ruch środków przez `sp_wallet_post` z blokadą portfela;
  - wyzwalacz `wallet_ledger_rules` odrzuca zmianę i usunięcie wpisu oraz wpis z saldem po operacji innym niż poprzednie plus kwota;
  - jedno uznanie za doładowanie i jeden wpis na zwrot salda (z odwróceniem).
- Zwroty: `sp_record_refund` z blokadą przejazdu albo płatności pilnuje, żeby suma zwrotów nie przekroczyła zapłaty (`REFUND_EXCEEDS_PAYMENT` z kwotą, która została).
- Paragony: `sp_issue_receipt` z pozycjami w `jsonb`, nabywcą z chwili wystawienia i korektą, która nie schodzi poniżej zera. Jeden paragon sprzedaży na przejazd. `fn_vat_from_gross` liczy VAT tą samą regułą co core.
- Cennik: `vat_rate`, zakresy w `CHECK`. Wyzwalacz `tariffs_rules` odrzuca edycję wersji i każdą nową wersję, dopóki jest zaplanowana. `sp_delete_scheduled_tariff` usuwa tylko zaplanowaną i nieużytą.
- Rozliczenie: `fn_rental_settlement` i `fn_rental_paid_amount`, karta przejazdu w `rentals.payment_method_id`, jedna płatność za przejazd w toku (`payments_one_pending_per_rental`).
- Widoki:
  - nowe: `v_payment_list`, `v_wallet_ledger`, `v_receipt_list`, `v_tariff_versions`, `v_payment_methods`, `v_payment_webhook_events`, `v_refund_list` i `v_unpaid_rentals`;
  - zmienione, z rozliczeniem albo z `UNPAID`: `v_rental_details`, `v_user_activity`, `v_daily_revenue`, `v_fleet_status` i `v_zone_usage`.
- Dane startowe: przykładowi klienci dostają doładowanie atrapą, a przykładowe przejazdy są rozliczone z portfela z paragonem. Przejazdy już istniejące w bazie deweloperskiej zostają nierozliczone (pytanie 12).
- Stan bazy: 52 tabele, 31 widoków, 18 funkcji, 14 procedur.
- Plik 0007 i sumę kontrolną w bazie deweloperskiej poprawiłem trzy razy przed commitem (karta w rozliczeniu, karta na paragonie z portfela, widoki z `UNPAID`).

**Core i API**
- **Core (`packages/core/src/payments`):**
  - reguła startu i rezerwacji `ensureCanPay`: zaległość, ujemne saldo, minimalne saldo przy portfelu, ważna karta przy karcie;
  - rozliczenie i spłata;
  - statusy płatności tylko do przodu;
  - doładowanie 10–500 zł w pełnych złotych;
  - stan karty („Wygasa” według miesiąca w Polsce);
  - VAT „w stu” na liczbach całkowitych z zaokrągleniem połowy w górę;
  - pozycje paragonu i korekty;
  - zwroty, korekty i plan zwrotu salda;
  - walidacja wersji cennika z listą pól i różnica do dziennika audytu.

  Maszyna stanów: `DECLINE_PAYMENT` to `ENDED → UNPAID` (ADR 0049).
- **Moduł Płatności:**
  - port `PaymentProvider`: atrapa w procesie (karty testowe Stripe, BLIK `000000` i `999999`, podpis w schemacie `Stripe-Signature`) i Stripe 23.1.0 z API `2026-10-28.endive`;
  - ta wersja API zmieniła nazwę `payment_method_types` na `allowed_payment_method_types` (CHANGELOG biblioteki);
  - webhook z `rawBody`: zapis zdarzenia, odpowiedź od razu, przetwarzanie w zadaniu `payments.webhook`;
  - zadania `payment.charge-ride` (obciążenie po `ENDED`), `payment.retry-ride` (jedno ponowienie po 24 h) i `payments.reconcile` (co minutę dla płatności i zwrotów starszych niż 2 min);
  - zdarzenie `wallet.updated`;
  - konfiguracja odrzuca klucze `live`, niepełną konfigurację Stripe i atrapę w produkcji.
- **Moduł Wypożyczenie:**
  - reguła płatności przy rezerwacji i starcie pod blokadą portfela; start z rezerwacji zachowuje jej źródło;
  - rozliczenie w transakcji `ENDED`;
  - przejścia `DECLINE_PAYMENT` i `SETTLE_DEBT` z wyniku płatności przez zarejestrowaną obsługę, więc moduł Płatności nie zna maszyny stanów;
  - `RentalView.settlement`;
  - usunięcie konta zablokowane przy zaległości i przy pieniądzach w toku.
- **Panel w API:**
  - listy płatności, księgi, portfeli, paragonów, kart, webhooków i zwrotów;
  - szczegóły płatności i paragonu, portfel klienta;
  - korekta i zwrot salda (`wallet.adjust`), zwrot za przejazd (`rentals.manage`);
  - wersje cennika (`tariffs.read`, `tariffs.write`).

  Każda operacja ma wpis w dzienniku audytu w tej samej transakcji.
- Kontrakty: OpenAPI, Socket.IO 1.3.0 (`wallet.updated`, rozliczenie w `rental.updated`).

**Poprawki po przeglądzie backendu**
- **Podwójna zapłata przy równoległej spłacie kartą i z portfela.** Płatność kartą powstaje teraz w tej samej transakcji z blokadą przejazdu, a odmowa nie cofa do `UNPAID` przejazdu opłaconego z portfela.
- **Sukces po odmowie albo porzuceniu.** W Stripe PaymentIntent po odmowie da się potwierdzić ponownie. Odmowę i porzucenie zapisujemy więc dopiero po anulowaniu PaymentIntent u operatora (`cancelPayment`); jeśli zdążył przejść, zapisujemy sukces. Atrapa nie pozwala potwierdzić anulowanej płatności.
- **Trwałe błędy operatora.** Odrzucone żądanie Stripe (np. zwrot po terminie) to `PAYMENT_FAILED`, a nie niedostępność. Zwrot salda dostaje wtedy wpis odwracający. Sprawdzanie statusu bierze rekordy od najdawniej sprawdzanych, więc zawieszony rekord nie blokuje kolejki.
- **Nieudane przetworzenie webhooka** zostaje do ponowienia (pg-boss albo kolejne dostarczenie od operatora), zamiast zapisu jako przetworzone.
- **Usunięcie konta** jest zablokowane przy płatnościach i zwrotach w toku.
- **Drobniejsze:**
  - kolejność blokad przy usuwaniu karty;
  - przejazd opłacony z portfela nie pokazuje odrzuconej karty;
  - `UNPAID` liczy się w statystykach floty i stref;
  - zapytania na kliencie transakcji idą po kolei.
- **Niestabilny test cennika:** wersja „od teraz” brała czas z zegara API, a widok liczy stan zegarem bazy. Teraz walidacja i zapis korzystają z czasu bazy.

**Panel**
- „Płatności” w grupie Operacje z zakładkami Płatności, Księga, Portfele, Paragony, Metody płatności, Webhooki i Zwroty: wzorzec listy, tylko do odczytu, panel boczny płatności ze zdarzeniami operatora, strona paragonu.
- „Cennik i zasady” w grupie Konfiguracja: lista wersji z podglądem, nowa wersja z porównaniem i walidacją przy polu, usunięcie zaplanowanej.
- Karta klienta z zakładką Portfel (saldo, zgodność z księgą, zaległości, karty, księga, korekta i zwrot salda tylko z `wallet.adjust`). Szczegóły przejazdu z kartą „Rozliczenie” i oknem zwrotu. Lista przejazdów z filtrem „Nieopłacone”.
- Odstępstwa od makiet:
  - pole „Stawka VAT” w nowej wersji;
  - zakładki „Przejazdy” i „Płatności” karty klienta to odnośniki do list z filtrem;
  - bez eksportu XLSX (iteracja 8);
  - nagłówek „Kwota” wyrównany do lewej;
  - „Historia zmian” cennika to dziennik audytu z filtrem;
  - zdarzenia operatora z płatności, webhooków i zwrotów, bez wiersza „Przetworzono”;
  - nowe okno „Zwrot salda na kartę”;
  - imię klienta w tytułach okien bez odmiany.
- **Build:** jak w iteracji 4, co drugi `next build` kończy się komunikatem o znanej podatności Next.js 16.4.4, a kolejny przechodzi. Aktualizacja czeka na decyzję autora.

**Aplikacja**
- Moduł `src/lib/payments` (ADR 0051):
  - Stripe.js w wersji web (`@stripe/stripe-js/pure`, więc przy atrapie przeglądarka nie łączy się ze Stripe);
  - `CardField` natywnie;
  - formularz atrapy z oknem 3-D Secure.
- Pakiety z datami publikacji: `@stripe/stripe-react-native` 0.81.0 (6 października 2026, `expo install`), `@stripe/stripe-js` 10.3.0 (12 listopada), `@stripe/react-stripe-js` 7.1.0 (13 listopada).
- Wtyczka w `app.json` z `disableSPM: true`; bez tego SDK 0.81 na iOS wymaga `expo-build-properties`. Do potwierdzenia przy development build.
- Ekrany:
  - portfel z historią, doładowanie kwotą własną, kartą albo BLIK-iem;
  - oczekiwanie, sukces i odmowa;
  - dodanie karty, metody płatności w profilu, cennik;
  - „Za mało środków” i „Płatność kartą” przy starcie i rezerwacji;
  - zaległość na mapie (także ujemne saldo) i spłata;
  - podsumowanie po rozliczeniu, paragon;
  - oznaczenie „Nieopłacony” w historii.

  Do tego `wallet.updated` przez Socket.IO.
- Poprawki po sprawdzeniu w przeglądarce: tekst „Płatność kartą Karta •••• 4242” na mapie i ucięta pigułka „Inna kwota” w portfelu.
- Odstępstwa od makiet:
  - przy Stripe podgląd karty pokazuje kropki;
  - ekran oczekiwania ma „Wróć do portfela” zamiast „Anuluj” i licznik BLIK 60 s;
  - odnośnik „Cennik” w portfelu i w profilu;
  - wpis przejazdu w historii portfela bez dystansu;
  - „Wróć do mapy” na ekranie nieudanej płatności;
  - podsumowanie bez wiersza „Razem”;
  - BLIK ukryty w development build przy Stripe (SDK 0.81 go nie obsługuje).
- Braki API zgłoszone przez agentów (do rozważenia później):
  - `RentalSettlementView.card` bez identyfikatora karty;
  - `ReceiptView` bez hulajnogi i godzin, więc paragon dociąga przejazd;
  - saldo po przejeździe nie jest w `RentalView`;
  - brak anulowania płatności w toku przez klienta.

**Weryfikacja**
- Testy: core 120, shared 18, db 60, api 96 (w tym `payments.e2e.test.ts`, 21 testów). Scenariusze testu płatności:
  - karta i 3-D Secure, doładowanie i powtórzony webhook, BLIK z odmową i ponownym potwierdzeniem;
  - brak webhooka i sprawdzenie statusu;
  - przejazd z portfela z paragonem i VAT;
  - odmowa karty, `UNPAID`, blokada startu, równoległa spłata i spłata kartą;
  - przejazd kartą;
  - zwroty z portfela i na kartę z korektą;
  - korekta salda i uprawnienia ról;
  - zwrot salda i blokada usunięcia konta;
  - wersje cennika;
  - konfiguracja kluczy.
- `pnpm turbo run lint typecheck test build`: 25 z 25 zadań.
- **Przeglądarka, osobna baza podglądu** (API 3006 z własną kolejką pg-boss, bo atrapa trzyma stan w pamięci procesu; baza usunięta po teście):
  - **Aplikacja (375×812):** rejestracja, pusty portfel, dodanie karty 4242 po webhooku, doładowanie 50 zł, odmowa BLIK, zaległość na mapie, spłata kartą, paragon z VAT 2,36 zł od 12,60 zł, podsumowanie po spłacie.
  - **Panel (1440×900):** lista płatności z licznikami, panel boczny ze zdarzeniami operatora, szczegóły przejazdu z rozliczeniem i osią czasu `ENDED → UNPAID → ENDED`, zwrot części 5 zł na kartę zakończony po webhooku.

**Niesprawdzone**
- Stripe w trybie testowym (brak kluczy w `.env`; ścieżka Stripe ma tylko typy i atrapę w tym samym formacie zdarzeń).
- Natywne płatności (development build).
- Przejazd w przeglądarce z symulatorem (podgląd był bez MQTT; przejazd z rozliczeniem sprawdzają testy API).
- Panel w rolach Dyspozytor i Serwisant (sprawdzone testami API), tryb ciemny nowych ekranów.

**Dane testowe**
- W bazie deweloperskiej nie dodałem danych płatności. Agent panelu nie zapisywał nic w panelu.
- Serwer `next dev` na 3002 z innej sesji wpadał w pętlę przeładowań, gdy agent panelu budował panel w tym samym katalogu. Nie ruszałem go.

**Commit i CI**
- Pięć commitów iteracji 5 (`0660b55`–`c623ac1`); CI zielone za pierwszym razem (lint, typy, migracje na czystej bazie, testy, build).

## Plan iteracji 6: operacje i serwis (17 listopada 2026)

Plan: [iteracja 6](iteracje/iteracja-06-operacje-serwis.md). Etap planowania, bez kodu i bez makiet.

**Co powstało**
- Plan iteracji 6. Cel: zgłoszenia klientów i automatyczne, zadania serwisowe z magazynem części i powrotem hulajnogi do floty, reguły przejazdu przy utracie łączności i niskiej baterii, zdjęcie parkowania, powiadomienia push z szablonów edytowanych w panelu, symulator sterowany z panelu, opłata za odholowanie. Granice z iteracjami 7 (wydruki, pełny moduł treści) i 8 (raporty, wykresy na pulpicie), zakres z migracją 0008, kolejność kroków i scenariusz demo w 9 krokach.
- Stan wyjściowy spisany z kodu i migracji:
  - tabele zgłoszeń, zadań, części, plików, powiadomień i szablonów istnieją od migracji 0001–0002, ale nie mają wersji rekordu, historii, statusu dostarczenia ani procedury zużycia części;
  - `BATTERY_LOW` jest w typie zdarzeń, ale nikt go nie zapisuje;
  - symulator sterujemy plikiem `control.json`;
  - `expo-notifications` nie jest zainstalowane.
- Lista 12 brakujących makiet (7 panelu, 5 aplikacji) i 6 ADR-ów do napisania (0055–0060). ADR 0056 zmienia ADR 0042 w części naliczania przy utracie łączności.
- 12 pytań o wartości biznesowe (utrata łączności, niska bateria, zgłoszenia automatyczne, pilność i wyłączenie z ruchu, powrót do floty, reklamacje, opłata za odholowanie, wymiana baterii w symulatorze, zdjęcie parkowania, scenariusze symulatora, części, uprawnienia) i 8 decyzji zakresu z rekomendacją (D1–D8).

**Wnioski z przeglądu kodu, migracji i makiet**
- Dyspozytor nie ma dziś `service.manage`, więc nie założy zadania ze zgłoszenia (pytanie 12).
- Makieta `admin-zgloszenia` to tablica kolumn sprzed wzorca listy (ADR 0031), więc D3 wybiera między listą a tablicą.
- Klient nie zakończy dziś przejazdu przy hulajnodze offline: blokada nie przyjdzie, a po 10 s przejazd wraca do jazdy (`LOCK_FAILED`). Pytanie 1 to rozstrzyga.
- Expo Push wymaga projektu EAS i urządzenia z development build, więc w środowisku deweloperskim potrzebna jest atrapa jak przy SMS (D2).
- Długi z iteracji 4 i 5 (kolory warstw mapy floty, tekst o e-mailu w `profil-dane`) są w zakresie. Aktualizacja Next.js i `disableSPM` zostają decyzjami autora.

**Do zrobienia przed implementacją**
- Odpowiedzi autora na pytania i decyzje; makiety brakujących stanów; ADR-y 0055–0060.

**Odpowiedzi autora (18 listopada 2026)**
- Wszystkie rekomendacje D1–D8 i odpowiedzi na pytania 1–12 ([tabela w planie](iteracje/iteracja-06-operacje-serwis.md#odpowiedzi-autora-18-listopada-2026)).
- Otwarta od iteracji 3 decyzja o naliczaniu przy utracie łączności jest rozstrzygnięta: naliczanie trwa, a klient kończy przejazd na podstawie ostatniej znanej pozycji (nie starszej niż 2 min) w strefie parkowania. Bez powrotu łączności w 10 min przejazd kończy się automatycznie, a bez żądania klienta naliczanie staje po 30 min. Zapisze to ADR 0056.
- Opłatę za odholowanie pobiera operator, zaznaczając ją przy zdalnym zakończeniu poza strefą. Dyspozytor dostaje `service.manage` w migracji 0008.

**Makiety (18 listopada 2026)**
- 22 plansze w [`26-mobile-operacje` i `27-panel-serwis`](projekt/README.md#aplikacja-operacje-iteracja-6):
  - 12 aplikacji: zgłoszenie z przejazdu, potwierdzenie, moje zgłoszenia, zgłoszenie z odpowiedzią, zdjęcie parkowania (podgląd, błąd wysyłki, bez aparatu), zgoda na powiadomienia, ustawienia z wyłączonymi powiadomieniami, zakończenie bez łączności w strefie i poza nią, baner powiadomienia w wersji web;
  - 10 panelu: zgłoszenia z panelem bocznym, reklamacja z odpowiedzią, zadania serwisowe, zakończenie zadania, magazyn części z przyjęciem dostawy, karta hulajnogi z „Wyślij do serwisu”, szablony powiadomień, symulator, zdalne zakończenie z opłatą za odholowanie, pulpit „Wymaga uwagi”.

  Spis ekranów: 142. Plansze przygotowało dwóch agentów równolegle, a PNG wyrenderował Chrome headless (aplikacja 2×, panel 1×). Wszystkie PNG obejrzane.
- Nowe plansze zastępują `13-panel/admin-zgloszenia`, `admin-symulator` i `admin-pulpit`, a w części opłaty także `21-panel-przejazdy/przejazd-zakoncz-zdalnie`. Formularz zgłoszenia nazywa się „Zgłoś problem”, bo obejmuje reklamację opłaty.
- **Luki w schemacie wykryte przy projektowaniu, dopisane do zakresu migracji 0008:**
  - numer zgłoszenia z sekwencji;
  - kategorie `BILLING` i „Poza strefą” oraz rodzaj zgłoszenia automatycznego jako kolumna do indeksu częściowego;
  - odpowiedź dla klienta z czasem odczytu, `refunds.ticket_id`;
  - aktor „system” w dzienniku audytu (`staff_id` jest `NOT NULL`);
  - przyczyna stanu hulajnogi, cel zadania `RELOCATION`, ruchy magazynowe, wersje szablonów;
  - usuwanie zdjęć po 30 dniach bez łamania klucza obcego;
  - tryb zakończenia bez łączności z limitem 10 min dla `ENDING`.
- **Poprawki planu:** migracja 0002 już dodała `tickets.updated_at` i `version`; „Wymaga uwagi” to D1, nie D7.
- **Do rozstrzygnięcia w ADR 0055 i 0058:** magazyn w `service.manage` (Dyspozytor dostanie też przyjęcia), uprawnienie „Wyłącz z ruchu”, reklamacje tylko u Dyspozytora (Serwisant bez `rentals.manage`), dane klienta ukryte przed Serwisantem, kod SMS jako szablon z panelu.
- **Sprzeczności ze starszymi planszami do poprawy przy implementacji:**
  - `przejazd-lacznosc` ma wyszarzony „Zakończ”;
  - `przejazd-zdjecie` nie ma „Pomiń”;
  - `powiadomienia` pokazuje Live Activity i promocje spoza zakresu;
  - `profil-usterka` ma tytuł „Zgłoś usterkę” i „Zmień” przy hulajnodze z podsumowania;
  - `przejazd-konczenie` mówi, że zdjęcia nie ma;
  - `admin-hulajnoga` ma próg baterii 20% zamiast progu z cennika.

**ADR 0055–0060 (18 listopada 2026, zaakceptowane przez autora)**
- **Sprawdzone przed pisaniem:**
  - wersje starsze niż 3 dni: `@aws-sdk/client-s3` 3.1169.0, `@fastify/multipart` 10.1.8 (Fastify 5.x), `intl-messageformat` 12.1.5 z parserem 3.5.23 (12.2.0 z 17 listopada za świeża), `expo-server-sdk` 8.0.0 (Node ≥ 22.12); z `expo install` dla SDK 58: `expo-notifications` ~58.1.8, `expo-image-picker` ~58.0.10, `expo-image-manipulator` ~58.0.16;
  - dokumentacja Expo: token push wymaga `projectId` z EAS i nie działa w przeglądarce, Expo Go na Androidzie nie obsługuje powiadomień zdalnych od SDK 53, symulator iOS (Xcode 14+) je odbiera, potwierdzenia po 15 min (usuwane po 24 h), `DeviceNotRegistered` usuwa token, 100 wiadomości w żądaniu;
  - schemat: `audit_log.staff_id` jest `NOT NULL`, broker deweloperski jest anonimowy, komenda `lock` wygasa po 10 s.
- **0055 Zgłoszenia i serwis:** numer `Z-…` z sekwencji, kategorie `BILLING` i `OUT_OF_ZONE`, `auto_kind` z indeksem częściowym, odpowiedź dla klienta z czasem odczytu, `MAINTENANCE` przy pilnym zgłoszeniu albo zadaniu (w przejeździe przy jego zakończeniu), powrót do floty regułą w core i funkcją SQL z testem zgodności, przyczyna stanu hulajnogi, ruchy magazynowe przez procedury, aktor `SYSTEM` w dzienniku audytu, Dyspozytor z `service.manage`.
- **0056 Utrata łączności i bateria:** zmienia ADR 0042 i 0036. Zakończenie bez łączności z pozycji nie starszej niż 120 s w strefie parkowania, `lock` z ważnością 10 min, `END_UNCONFIRMED` po 10 min ze zgłoszeniem, `end_mode`, odcinki bez łączności liczone najwyżej 30 min, zdarzenie `MOVED_AFTER_END` bez automatycznej korekty, progi baterii z limitem 10 km/h przez uzgadnianie komend stref.
- **0057 Pliki:** wysyłka i odczyt przez API zamiast podpisanego adresu S3 (zmienia założenie z ADR 0024 i arc42 §6.4), sygnatura pliku, SHA-256, adresy odczytu z podpisem HMAC na 10 min, retencja 30 dni bez łamania kluczy obcych.
- **0058 Powiadomienia:** port `PushGateway` (atrapa domyślnie, Expo po konfiguracji), wpis `QUEUED` i zadanie pg-boss w transakcji zdarzenia, klucz idempotencji, tabela wersji szablonów, rejestr kodów i parametrów w `packages/shared`, walidacja ICU w core, kod SMS z szablonu, baner w wersji web przez Socket.IO.
- **0059 Symulator:** osobny kontrakt `asyncapi-symulator.yaml` (`simulator/control`, `simulator/control/result`), punkt API tylko w środowisku deweloperskim z `simulator.manage` i dziennikiem audytu, ACL brokera na demo, komenda urządzenia `battery_swapped` w kontrakcie MQTT 1.3.0.
- **0060 Odholowanie:** opłata jako część rozliczenia przejazdu (`rentals.towing_fee`, wpis `TOWING_FEE`, jedna płatność kartą na sumę, pozycja paragonu). Stawka VAT opłaty do sprawdzenia przez autora, bo może to być kara umowna bez VAT.

## Iteracja 6: implementacja (18 listopada 2026)

Plan: [iteracja 6](iteracje/iteracja-06-operacje-serwis.md), decyzje w [ADR 0055–0060](adr/README.md). Pracowali agenci etapami, każdy z raportem dla następnych: baza, core i shared, API w trzech częściach (A: przejazd, pliki; B: zgłoszenia, serwis; C: powiadomienia, symulator), symulator, a na końcu równolegle panel i aplikacja, każdy w swoim katalogu. Koordynator przeglądał raporty, dopisywał poprawki między etapami i domyka weryfikację techniczną.

**Baza (migracja 0008)**
- Nowe tabele `spare_part_movements` i `notification_template_versions`. Nowe wartości typów: kategorie `BILLING` i `OUT_OF_ZONE`, zdarzenia `BILLING_STOPPED` i `MOVED_AFTER_END`, wpis `TOWING_FEE`, komenda `BATTERY_SWAPPED`. Nowe typy: aktor dziennika, rodzaj zgłoszenia automatycznego, przyczyna stanu hulajnogi, ruch i powód korekty magazynu, tryb zakończenia, stan pliku i stan powiadomienia. Sekwencja numerów zgłoszeń od 1000.
- Nowych wartości typu nie wolno użyć w transakcji, która je dodaje. Widoki, funkcje SQL, indeksy i `CHECK` porównują je więc jako tekst, a procedury i wyzwalacze używają ich dopiero przy wykonaniu.
- Najważniejsze reguły:
  - aktor `SYSTEM` z `staff_id = NULL` w dzienniku audytu;
  - jedno otwarte zgłoszenie automatyczne danego rodzaju (wstawiane przez `ON CONFLICT … DO NOTHING`), pilność z kategorii w `CHECK`, `RESOLVED` jako stan końcowy;
  - wyzwalacz `scooters_status`: koniec rezerwacji albo przejazdu przy pilnym zgłoszeniu albo zadaniu daje `MAINTENANCE` z przyczyną i wpisem systemu `scooter.sent_to_service`. Wolną hulajnogę przełącza API (`fn_scooter_service_hold`), a po zmianie stanu odczytuje wynik, żeby nie dublować wpisu;
  - przejścia zadań w wyzwalaczu; anulowanie zwraca części;
  - magazyn przez cztery procedury z blokadą części, ruchy tylko do dopisywania;
  - `fn_scooter_return_blockers` (powrót do floty), `fn_dashboard_attention` (pulpit);
  - `end_mode`, `towing_fee`, rozliczenie i limit zwrotu z `TOWING_FEE`;
  - pliki ze stanem, SHA-256 i znacznikiem usunięcia;
  - powiadomienia z kodem szablonu, kanałem, stanem, kluczem idempotencji i treścią po renderowaniu; tokeny push z sesją; wersja szablonu zapisywana wyzwalaczem;
  - Dyspozytor z `service.manage`.
- 11 widoków list panelu i oś czasu zgłoszenia `v_ticket_timeline`.
- Dane startowe:
  - 8 części ze stanem przez `sp_part_receive`;
  - 7 szablonów w wersji 1;
  - przykładowe zgłoszenia i zadania na #0037–#0040 (#0038–#0040 w serwisie).
- Stan bazy: 54 tabele, 42 widoki, 21 funkcji, 18 procedur.

**Core i shared**
- **Core:**
  - zakończenie bez łączności (`canEndOffline`, `decideOfflineEnd`), akcja `END_UNCONFIRMED`;
  - liczniki z limitem 30 min na odcinek bez łączności;
  - progi baterii (`LOW` z cennika, `CRITICAL` 5% z limitem 10 km/h przez `desiredZoneControl`);
  - ruch po zakończeniu, blokada hulajnogi bez przejazdu;
  - odholowanie (`decideTowing`, pozycja `TOWING_FEE` w paragonie);
  - zgłoszenia (walidacja, pilność, zgłoszenia automatyczne, decyzja o zmianie statusu i odpowiedzi);
  - zadania, części i magazyn, powrót do floty;
  - szablony ICU (walidacja z wierszem i znakiem, renderowanie `pl`, wybór wysyłki według preferencji i tokenów).
- **Shared:**
  - rejestr szablonów `NOTIFICATION_TEMPLATES` (kanał, parametry z typami, ścieżka w aplikacji, preferencja);
  - schematy zgłoszeń, zadań, magazynu, plików i symulatora;
  - kontrakt MQTT 1.3.0;
  - zdarzenia Socket.IO zgłoszeń, zadań, powiadomień i symulatora;
  - definicje zasobów list (`operations.ts`, `notifications.ts`).
- Biblioteki w wersjach z ADR: `intl-messageformat` 12.1.5 z parserem 3.5.23 (core).

**API**
- **A: przejazd, pliki.**
  - `POST /files` z nowym dekoratorem `@CustomerOrStaffAuth`: operator potrzebuje `tickets.manage` dla zdjęcia zgłoszenia albo `rentals.manage` dla zdjęcia parkowania;
  - `GET /files/{id}?exp&sig` (`@Public`, podpis HMAC);
  - zdjęcie parkowania, zakończenie offline z `POSITION_STALE` i `OUTSIDE_PARKING`, zdalne zakończenie z `collectTowingFee`;
  - zadania `rental.offline-end-timeout`, `rental.offline-billing-stop`, `files.cleanup` (co godzinę), `files.retention` (raz na dobę);
  - `@aws-sdk/client-s3` 3.1169.0 i `@fastify/multipart` 10.1.8.
- **B: zgłoszenia, serwis, magazyn, pulpit.**
  - moduł `operations`: klient (`POST /tickets`, `GET /me/tickets`);
  - panel: zgłoszenia, zadania z „Moje zadania”, karta serwisowa hulajnogi, „Przywróć do floty”, „Wyłącz z ruchu”, magazyn z przyjęciem i korektą, lista plików, `GET /admin/dashboard/attention`;
  - zwrot z `ticketId` (`TICKET_RENTAL_MISMATCH`);
  - zgłoszenia automatyczne z telemetrii i z zakończenia przejazdu;
  - pokoje `tickets` i `service`.
- **C: powiadomienia, symulator.**
  - tokeny push, szablony z podglądem, wersją i przywróceniem, listy wysłanych i tokenów;
  - zadania `notification.send`, `notification.receipts` (15 min), `notifications.sweep` (co 5 min) i `rental.reservation-ending` (2 min przed końcem rezerwacji);
  - kod SMS z szablonu `login_code`;
  - `POST /admin/simulator/commands` (202) i `GET /admin/simulator/status`; pokój `simulator`;
  - `expo-server-sdk` 8.0.0.

  Wpięte kody: `ticket_received`, `ticket_status_changed` (cztery miejsca), `battery_low`, `ride_ended` (portfel przy zakończeniu, karta po paragonie), `payment_failed`, `reservation_ending`.
- Kontrakty: `pnpm api:openapi`, Socket.IO 1.4.0, MQTT 1.3.0, kontrakt symulatora 1.0.0.

**Symulator**
- Kanał `simulator/control` z wynikiem na `simulator/control/result`. Wyniki są zapamiętane po `commandId`, bo QoS 1 może dostarczyć polecenie dwa razy.
- Stan na `simulator/status` co 10 s, a co 2 s, gdy trwa scenariusz z postępem.
- Scenariusze: rozłączenie i powrót z buforem trasy, milczenie, rozładowanie, jazda do strefy albo punktu, wjazd w strefę zakazu, przerwanie.
- Jeden scenariusz na hulajnogę (`SCENARIO_ACTIVE`, `NO_SCENARIO`). Plik `control.json` i MQTT trafiają do tej samej obsługi, a wygrywa ostatnie polecenie.
- Komenda `battery_swapped` ustawia baterię na 100% i przerywa rozładowanie.

**Decyzje podjęte przy implementacji**
- **Limit potwierdzenia komend** liczy się od `expires_at`, nie od `sent_at` (indeks `scooter_commands_pending_expiry_idx`). Inaczej `lock` przy zakończeniu bez łączności (10 min) dostałby `TIMEOUT` po 10 s.
- **Komendy systemu** (`lock` hulajnogi bez przejazdu, `battery_swapped`) idą przez `CommandsService.sendSystem`, bez wpisu w dzienniku audytu.
- **Adres odczytu pliku** jest względny (`/files/{id}?exp=…&sig=…`), a klienci doklejają adres API. Sekret podpisu pochodzi z `JWT_SECRET` z prefiksem `files:`.
- **Zgłoszenie `OFFLINE`:**
  - zadanie `tickets.offline-check` w kolejce `short` z kluczem singletonu na hulajnogę, planowane poza transakcją;
  - planuje je tylko zmiana online → offline, nie powtórzony status po restarcie API.

  `BATTERY_CRITICAL` i `OUT_OF_ZONE` powstają w transakcji zakończenia, przed zwolnieniem hulajnogi.
- **Powrót do floty po `BATTERY_SWAP`** liczy przeszkody z prawdziwej telemetrii (pierwsza wersja zakładała baterię 100%, niezgodnie z ADR 0059; poprawione po przeglądzie, niżej). Hulajnoga z baterią poniżej progu zostaje w serwisie z przyczyną `BATTERY_BELOW_THRESHOLD` i wraca sama po odczycie nowej baterii. Otwarte pilne zgłoszenie bez zadania blokuje powrót (przeszkoda `URGENT_TICKET`).
- **Bez `users.read`** widoki zgłoszeń i powiadomień nie mają imienia ani telefonu klienta (panel pokazuje „Klient”), a filtr i sortowanie po tych polach dają `403`.
- **Socket.IO:** `notification.created` idzie po `SENT` i po `SKIPPED` z `NO_PUSH_TOKEN`, więc wersja web bez tokenu też dostaje baner.
- **Powiadomienia:**
  - `payload` to `{ params, path }`;
  - API formatuje numery (R-51858, #0037, Z-1042) i kwoty (`formatPln`) przed renderowaniem;
  - brak szablonu daje `TEMPLATE_MISSING` (503);
  - `ride_ended` ma w rejestrze i w danych startowych parametry `towingFee` i `hasTowingFee` (ADR 0060 chce opłaty w powiadomieniu).
- **Tokeny push:** wylogowanie usuwa tokeny rodziny sesji, a rotacja tokenu odświeżającego przenosi je na nową sesję.
- **Symulator w API:**
  - przy `SIMULATOR_CONTROL_ENABLED=false` punkty zwracają 404, a subskrypcja `FORBIDDEN`;
  - brak publikacji w 5 s daje `SIMULATOR_UNAVAILABLE` (503);
  - stan podaje 10 ostatnich poleceń z dziennika audytu; wyniki są tylko w pamięci API.
- **Aplikacja:** `expo-notifications` ~58.1.9 z `expo install` (11 listopada, starsza niż 3 dni), a ADR 0058 sprawdzał ~58.1.8.

**Panel**
- **Nawigacja:**
  - Pulpit;
  - grupa Serwis: Zgłoszenia z licznikiem nowych, Zadania, Części;
  - Powiadomienia w Konfiguracji;
  - Symulator w „Analiza”, tylko z `simulator.manage` i przy włączonym sterowaniu;
  - pozycje 36 px.

  Jedno połączenie Socket.IO na kartę z pokojami (`lib/realtime.ts`).
- **Ekrany:**
  - zgłoszenia ze szczegółami i osią czasu;
  - zadania z „Moje zadania”, nowym zadaniem i zakończeniem;
  - części z przyjęciem, korektą i ruchami;
  - karta hulajnogi z zakładkami Przegląd i Serwis, „Wyślij do serwisu”, „Przywróć do floty”, „Wyłącz z ruchu”; przyczyna stanu na liście floty;
  - szablony z edytorem ICU, wysłane powiadomienia, tokeny push;
  - symulator;
  - okno zdalnego zakończenia z opłatą, karta „Zakończenie”, nowe zdarzenia na osi przejazdu, `TOWING_FEE` w księdze i paragonie;
  - `/admin` jako pulpit „Wymaga uwagi” (bez `dashboard.read` przekierowanie na mapę);
  - dziennik audytu z filtrem aktora.
- Dług z iteracji 4: kolory warstw mapy floty poprawione. `pl.json` +1051 kluczy, usunięty `rentals.end.noParkingFee`.
- **Odstępstwa od makiet:**
  - bez „Eksportuj XLSX”, Raportów i Wydruków w nawigacji (iteracje 7–8);
  - wspólna lista: „Wszystkie” zawsze pierwsze, domyślne „Otwarte” i „Do zrobienia” tylko przy pierwszej wizycie bez filtrów, nagłówków nie da się wyrównać do prawej;
  - zgłoszenia: dodatkowe pole „Notatka wewnętrzna”; karta klienta bez salda i liczby przejazdów; bez `staff.read` lista przypisania to „ja” i bieżący przypisany, bez liczby zadań;
  - karta hulajnogi: tylko zakładki Przegląd i Serwis, bez „Dzwonek” i „Zablokuj”, bez „km od ostatniego serwisu”, jeden render dla wszystkich miniatur, cel przewiezienia tylko strefa parkowania (bez punktu na mapie);
  - okno zakończenia zadania: zdanie o zgłoszeniu warunkowe (panel nie wie, czy to ostatnie zadanie);
  - szablony: bez „Porównaj”, szybkie liczby 1, 3, 5 i 22;
  - symulator: bez „tempo 1×” i numeru przejazdu w scenariuszu, punkt celu wpisywany jako szerokość i długość;
  - odholowanie: bez ulicy i odległości do strefy, bez stawki VAT w pozycji paragonu;
  - pulpit: wyszukiwarka tylko przekierowuje, odnośnik krytycznej baterii przez filtr floty, odnośnik nieudanych płatności filtruje po `createdAt`, a baza liczy po `updated_at`.
- **Build:** pierwszy `next build` kończy się kodem 1 tylko przez komunikat Next.js o znanej podatności, jak w iteracjach 4 i 5.

**Aplikacja**
- **Trasy:** `/zglos` (z podsumowania, z karty hulajnogi bez „Rozliczenie”, z Moich zgłoszeń ze „Zmień”), `/zglos/wyslane`, `/zgloszenia`, `/zgloszenie/[id]`, `/zdjecie/[id]`, `/powiadomienia`.
- **Zdjęcie parkowania:** aparat z „Pomiń”, podgląd, błąd wysyłki, bez aparatu i w wersji web wybór pliku, wariant wymagany bez „Pomiń”.
- **Zgoda na powiadomienia:** raz, przed pierwszą rezerwacją albo startem; w wersji web jej nie ma.
- **Ekran jazdy:**
  - offline z aktywnym „Zakończ”, odmowy `OUTSIDE_PARKING` i `POSITION_STALE`, zatrzymane naliczanie;
  - bateria `LOW` i `CRITICAL` z „Prowadź do strefy”;
  - zakończenie bez łączności i panel „Przejazd się kończy” na mapie.
- **Powiadomienia:**
  - token przy starcie, kanał `default`, usunięcie tokenu przy wylogowaniu;
  - dotknięcie otwiera `data.path`, także po zimnym starcie; na ekranie jazdy ukryte;
  - ustawienia z paskiem wyłączonych powiadomień;
  - baner w wersji web na 6 s z `notification.created`.

  Bez `projectId` z EAS aplikacja nie pobiera tokenu i nie zgłasza błędu.
- Odholowanie w podsumowaniu, historii, portfelu i paragonie.
- Dług z iteracji 5: usunięta obietnica e-maili w `profil/dane` i w rejestracji (`profile.lead`).
- Zależności z `expo install`: `expo-notifications` ~58.1.9, `expo-image-picker` ~58.0.10, `expo-image-manipulator` ~58.0.16, wtyczki w `app.json`. `pl.json`: 706 → 880 kluczy.
- **Odstępstwa od makiet:**
  - `zgloszenie-szczegoly`: wiersze zwrotu i korekty paragonu dodał koordynator po zmianie API (niżej);
  - baner bez zamykania gestem i bez oznaczania odczytu (brak punktu API);
  - niska bateria podaje procent zamiast kilometrów;
  - aparat bez latarki;
  - ekrany bez makiety: arkusz „Zmień”, panel na mapie przy kończeniu bez łączności, wybór aparat albo galeria;
  - „Płacisz do HH:MM” liczone z liczników;
  - bez wejścia „zgłoś w trakcie jazdy” (D5) i wariantu potwierdzenia w trakcie przejazdu;
  - kolejność komunikatów na ekranie jazdy: offline, zatrzymanie strefy, dojazd do strefy, chwilowy, bateria, wolna jazda.

**Poprawki koordynatora**
- **Zdjęcie parkowania w `ENDING`:** API przyjmuje je już w `ENDING` przy `CUSTOMER_OFFLINE`, bo klient nie czeka na blokadę (do 10 min). Aplikacja ma jeszcze obejście sprzed tej zmiany, do uproszczenia.
- **Zwrot w zgłoszeniu klienta:** widok zgłoszenia klienta (`CustomerTicketView.refund`) podaje kwotę zwrotu i paragon korygujący, a ekran zgłoszenia w aplikacji pokazuje je w karcie „Odpowiedź”. Etykieta to „Zwrócono” zamiast „Zwrot do portfela” z makiety, bo zwrot za przejazd kartą wraca na kartę.
- **„Poniżej minimum”:** core liczył `<=`, a lista magazynu (`v_spare_part_list`) `<`. Core liczy teraz `<`, jak lista. Starszy widok `v_low_stock_parts` z migracji 0002 liczy `<=` i zostaje (wykonanej migracji nie zmieniamy); ujednolicenie przy raporcie części w iteracji 8 (arc42 §11).

**Poprawki po przeglądzie**

Przegląd kodu iteracji 6 znalazł 16 błędów (A–P). Wszystkie potwierdziły się w kodzie poza M (opis niżej). Zmiany w bazie są w migracji `0009_operations_fixes.sql`, bo 0008 jest już wykonana.
- **A. Hulajnoga odblokowana bez przejazdu w serwisie:**
  - reguła `shouldLockIdleScooter` działa też w `MAINTENANCE` i `RETIRED`, bo zakończenie przejazdu może od razu założyć zadanie `RELOCATION` albo `BATTERY_SWAP`;
  - wyjątek: operator odblokował hulajnogę z panelu. Liczy się ostatnia potwierdzona komenda `lock`/`unlock` bez przejazdu, nowsza niż koniec przejazdu. Panel wysyła `unlock` tylko w `MAINTENANCE`, a komenda z panelu zapisuje teraz `issued_by_staff`;
  - po odrzuconej albo niepotwierdzonej blokadzie systemu kolejna próba najwcześniej po 5 min (`IDLE_LOCK_RETRY_MS`), bez pętli komend;
  - zdalne zakończenie hulajnogi offline wysyła `lock` ważny 10 min, jak zakończenie klienta offline (`decideRemoteEnd` z `commandTtlMs`).
- **B. Formularz floty a przyczyna stanu.** Zmiany stanu w PATCH i DELETE idą przez `fleetFormStatusChange` w core:
  - `MAINTENANCE → AVAILABLE` według reguły powrotu do floty (`RETURN_TO_FLEET_BLOCKED`);
  - `→ MAINTENANCE` z przyczyną z `fn_scooter_service_hold` albo `OTHER`;
  - `→ RETIRED` (także DELETE) jak „Wyłącz z ruchu”: nie przy otwartych zadaniach, z powodem `OTHER`, bo formularz nie pyta o powód.

  Wyzwalacz `scooters_status` (0009) dopasowuje przyczynę, gdy stan zmienia się bez jawnej przyczyny. `scooters_status_reason_matches` daje `VALIDATION_FAILED` zamiast błędu 500.
- **C. Przywrócenie do floty z otwartym pilnym zgłoszeniem:** nowa przeszkoda `URGENT_TICKET` (pierwsza) w core, w `fn_scooter_return_blockers` i w shared. Okno zakończenia zadania pomija zgłoszenie, które to zakończenie rozwiąże.
- **D. Szablon `login_code`:**
  - parametry wymagane w rejestrze (`code`, `ticketNumber`, kwota w `payment_failed`); ich brak daje `TEMPLATE_MISSING_PARAM`;
  - migracja 0009 wstawia szablony wszystkich kodów (`ON CONFLICT DO NOTHING`, wersja 1 z wyzwalacza);
  - treść SMS renderuje się przed zapisem kodu, więc błąd szablonu nie zużywa limitu kodów.
- **E. Wyścig przypięcia pliku:** stan przypięcia sprawdza osobna instrukcja po `FOR UPDATE`. Do tego unikalne indeksy `rentals_parking_photo_unique` i `ticket_photos_file_unique` (`FILE_ALREADY_ATTACHED`).
- **F. Usuwanie pliku a przypięcie:** plik dostaje `DELETED` w transakcji z blokadą i ponownym sprawdzeniem warunku (`claimForDeletion`), a obiekt znika z magazynu po zatwierdzeniu. Dotyczy panelu, `files.cleanup` i `files.retention`. Błąd magazynu zostawia najwyżej osierocony obiekt, nigdy plik przypięty bez obiektu.
- **G. Retencja:** pomija też zdjęcie parkowania przejazdu, który ma zgłoszenie (dowód w reklamacji).
- **H. Podwójny push:** `notifications.claimed_at` i przejęcie wiersza jednym `UPDATE` przed wysyłką; ponowne przejęcie po 5 min, zwolnienie po błędzie. `notifications.sweep` ma `try/catch` na każdy wiersz.
- **I. Wymiana baterii bez założenia 100%:**
  - zakończenie `BATTERY_SWAP` liczy przeszkody z telemetrii;
  - moduł Telemetria po zapisie partii z odczytem bieżącym przywraca hulajnogę z przyczyną `BATTERY_BELOW_THRESHOLD` (bez innych przeszkód) do floty z wpisem systemu `scooter.returned_to_fleet` (`reason: BATTERY_RECOVERED`);
  - okno zakończenia w panelu mówi, że hulajnoga wróci po odczycie nowej baterii.
- **J. Widoki zakończonych przejazdów:** stany końcowe (`ENDED`, `UNPAID`, `EXPIRED`, `UNLOCK_FAILED`) pokazują liczniki i kwotę z wiersza przejazdu (`rentalFigures` w core), nie przeliczone nowymi regułami.
- **K. `MOVED_AFTER_END` po przewiezieniu przez serwis:** odczyty po zakończeniu liczą się do startu zadania serwisowego albo ręcznego przejścia do `MAINTENANCE` po zakończeniu. Przejście do serwisu w transakcji zakończenia granicy nie ustawia.
- **L. Próg `LOW`:** liczy się poniżej `min_battery_pct` (start wymaga baterii co najmniej na progu), a `CRITICAL` zostaje na 5% i poniżej (pytanie 2: „przy 5% zwalnia”).
- **M. Powtórzone `photoIds`:** znalezisko się nie potwierdziło. `uniquePhotos` odrzucał duplikaty przed pętlą (`VALIDATION_FAILED`, 400). Dopisany test i mapowanie `ticket_photos_pkey` na `FILE_ALREADY_ATTACHED`.
- **N. Ręczne `RESOLVED` pilnego zgłoszenia:** ADR 0055 przewiduje automatyczny powrót tylko po ostatnim zadaniu. Hulajnoga zostaje więc w `MAINTENANCE`, ale z przyczyną z reguły powrotu (`reasonAfterUrgentTicketResolved`), a bez przeszkód z `OTHER`. Do tego wpis systemu `scooter.kept_in_service`. „Przywróć do floty” już przechodzi.
- **O. Zdjęcia w widoku klienta:** tylko zdjęcia z `uploaded_by` klienta.
- **P. Dane operatorów i płatności:**
  - `ticket.updated` w pokoju klienta bez `assigneeId` (osobny komunikat `CustomerTicketUpdated` w kontrakcie Socket.IO);
  - bez `payments.read` zgłoszenie nie ma kwoty zwrotów (`refundedAmount: null`) ani wpisów zwrotów na osi czasu, a filtr i sortowanie po kwocie dają `403`.
- **Kolizja z przejazdami pokazowymi symulatora:** przy `SIM_RIDES_PER_HOUR > 0` symulator jedzie bez przejazdu w API, więc reguła z A blokuje taką hulajnogę przy pierwszym odczycie bieżącym (tak było już dla `AVAILABLE`, teraz także w serwisie). Przejazdy pokazowe mają sens tylko bez API albo na osobnym brokerze (uwaga w `CLAUDE.md`).
- **Weryfikacja poprawek:** `pnpm lint` i `pnpm typecheck` czyste; testy core 176, shared 32, symulator 54, db 71, api 185. `pnpm db:migrate` i `pnpm db:pull` wykonane na bazie deweloperskiej.

**Potrzebne zmiany odłożone**
- **Panel (API i shared):**
  - `statusReason` w `TicketAdminDetails`, statystyki klienta w zgłoszeniu;
  - `scooter.sent_to_service` i `scooter.returned_to_fleet` w `v_ticket_timeline`;
  - przebieg i „ostatnie zadanie” w `ServiceTaskDetails`;
  - lista wykonawców bez `staff.read`;
  - sortowanie po zgłaszającym mimo braku `users.read`;
  - ulica, odległość do strefy i VAT przy odholowaniu;
  - tempo i numer przejazdu w stanie symulatora;
  - porównanie wersji szablonów;
  - zdarzenie `payment.updated`.
- **Aplikacja (API i shared):**
  - punkt odczytu powiadomienia (baner i lista);
  - chwila żądania zakończenia i zasięg w `RentalView`;
  - `parkingPhotoRequired` w `RentalHistoryItem`;
  - usunięcie obejścia zdjęcia w `ENDING`.

**Weryfikacja**
- Testy po etapach: core 172, shared 32, db 69, api 177, symulator 54. Nowe testy API:
  - `rental-rules.e2e.test.ts`, `files.e2e.test.ts`;
  - `tickets.e2e.test.ts`, `service.e2e.test.ts` (pomocnik `operations-helpers.ts`);
  - `notifications.e2e.test.ts`, `simulator.e2e.test.ts`.

  Końcowy przebieg po poprawkach z przeglądu (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`): wszystko przechodzi; testy core 176, shared 32, symulator 54, db 71, api 185.
- Panel: lint, typy i build przechodzą. Aplikacja: lint, typy i `expo export --platform web` (39 tras) przechodzą.

**Niesprawdzone**
- Panel i aplikacja w przeglądarce sprawdzone tylko częściowo (koordynator, API z buildu na 3001, panel z `next start` na 3006, wersja web aplikacji na 8082; konfiguracje `api-local`, `web-start`, `mobile-web-local` w `.claude/launch.json`):
  - panel: pulpit „Wymaga uwagi”, lista zgłoszeń z panelem bocznym, „Utwórz zadanie” ze zgłoszenia, zadanie (rozpoczęcie, część z magazynu ze spadkiem stanu, okno zakończenia z przeszkodami powrotu i propozycją wymiany baterii), szablony powiadomień, lista „Wysłane” (powiadomienia `ticket_status_changed` pominięte bez tokenu);
  - aplikacja: logowanie kodem z szablonu `login_code` (log API), „Moje zgłoszenia” i szczegóły zgłoszenia; poprawka: notka „Odpowiemy w powiadomieniu.” znika przy zgłoszeniu rozwiązanym bez odpowiedzi;
  - `next dev` na 3002 z innej sesji przeładowywał się w pętli, dlatego panel z buildu.
- Niesprawdzone w przeglądarce: symulator z panelu (symulator z innej sesji był offline po restarcie Dockera), zakończenie bez łączności, zdjęcie parkowania, baner w wersji web, zdalne zakończenie z opłatą za odholowanie.
- Expo Push na urządzeniu (brak `projectId` i development build), aparat natywny.
- Integracja z SeaweedFS poza testem, który działa przy dostępnym `S3_ENDPOINT`.

**Sprawy dla autora**
- Restart API na 3001 (`nest start --watch` z innej sesji), żeby działały nowe trasy.
- `eas init` dla `projectId`, a dla prawdziwego push także development build i poświadczenia FCM i APNs.
- Aktualizacja Next.js 16.4.4 (komunikat o podatności przy buildzie).
- Konto Stripe w trybie testowym (bez zmian od iteracji 5).
- Stawka VAT opłaty za odholowanie (może to być kara umowna bez VAT, ADR 0060).
- Szablon `ride_ended` w istniejącej bazie deweloperskiej nie używa `towingFee` i `hasTowingFee`, bo dane startowe nie nadpisują szablonów. Treść do zmiany w panelu (Powiadomienia → Szablony) według `packages/db/src/seed.ts`.

**Uwagi**
- Agent panelu uruchomił `pkill -x cat` dla bieżącego użytkownika. Mogło to zamknąć procesy `cat` innych sesji; serwerów API, panelu i symulatora nikt nie restartował.

**Wypchnięcie (18 listopada 2026)**
- Siedem commitów iteracji 6 (`20d0f1f`…`44315da`) na `main`; CI zielone na `44315da`.

## Opłata za odholowanie jako kara umowna (18 listopada 2026)

**Decyzja autora:** opłata za odholowanie może być karą umowną (art. 483 Kodeksu cywilnego), więc nie podlega VAT. ADR 0060 dawał jej stawkę VAT przejazdu i zostawiał to pytanie otwarte; rozstrzyga je [ADR 0061](adr/0061-oplata-za-odholowanie-jako-kara-umowna.md) (zmienia ADR 0060 i 0052). Księga, płatność kartą na całą kwotę i limit zwrotu zostają jak w ADR 0060.

**Zmiany**
- **Baza (migracja `0010_towing_fee_outside_vat.sql`):**
  - `receipt_items.vat_rate` dopuszcza `NULL` („nie podlega VAT”, w dokumencie „np.”);
  - `v_receipt_list` (te same kolumny co w 0007): `vat_amount` to suma VAT liczonego osobno dla każdej stawki (`fn_vat_from_gross` na sumie brutto grupy, `NULL` bez VAT), `vat_rate` to stawka pozycji z VAT, gdy jest jedna;
  - `sp_issue_receipt` odrzuca korektę, po której któraś grupa stawek paragonu (sprzedaż plus wszystkie korekty) byłaby ujemna, także ze stawką spoza paragonu (`RECEIPT_CORRECTION_EXCEEDS`). Wcześniej pilnował tylko sumy dokumentu.
  - Inne widoki i funkcje nie czytają `receipt_items.vat_rate` (sprawdzone w 0007–0009 i w repozytoriach); liczby tabel, widoków, funkcji i procedur bez zmian.
- **Core:** `ReceiptItem.vatRate: number | null`; `rideReceiptItems` daje `TOWING_FEE` bez stawki; nowe `receiptVatGroups` (grupy w kolejności pierwszego wystąpienia stawki); `receiptTotals` sumuje VAT grup; `correctionItems(kwota, pozycje sprzedaży, wcześniejsze korekty)` dzieli zwrot proporcjonalnie do kwot pozostałych w grupach, zaokrąglenie połowa w górę, reszta do ostatniej grupy, jedna pozycja `REFUND` na grupę z niezerowym udziałem. Paragon z jedną stawką daje te same kwoty co wcześniej.
- **Repozytorium i API:** `saleReceipt` blokuje paragon sprzedaży (`FOR UPDATE`) i zwraca kwoty pozycji i wcześniejszych korekt, więc równoległe korekty liczą udziały od aktualnych kwot; `issueCorrection` przekazuje je do `correctionItems`. Widok paragonu (klient i panel) ma `vatGroups` (`{ vatRate, gross, vat }`, kolejność pozycji), a `ReceiptItemView.vatRate` może być `null`. `pnpm api:openapi` bez zmian (odpowiedzi paragonu nie są w kontrakcie).
- **Panel:** pozycja bez VAT ma opis „1 × 20,00 zł · VAT np.”, podsumowanie pokazuje VAT każdej stawki i wiersz „Nie podlega VAT (np.)” z kwotą brutto. Teksty: okno zdalnego zakończenia („jako karę umowną bez VAT”), podpowiedzi cennika i notka VAT w cenniku, podgląd cennika klienta.
- **Aplikacja:** paragon jak w panelu (opis pozycji z „VAT np.”, VAT grupami, wiersz poza VAT), notka paragonu i cennik bez sugestii, że opłata zawiera VAT; usunięty klucz `receipt.vatNoRate`.
- **Paragony sprzed zmiany** (odholowanie ze stawką przejazdu) zostają bez zmian; ich korekty liczą się jedną grupą 23% jak wcześniej.

**Odstępstwa od makiet:** paragon w makietach `paragony-lista` i `paragon` ma jeden wiersz VAT; przy pozycji poza VAT dochodzi wiersz „Nie podlega VAT (np.)”, a opis pozycji ma „VAT np.” zamiast stawki. Lista paragonów nie pokazuje VAT, więc bez zmian.

**Weryfikacja:** `pnpm db:migrate` i `pnpm db:pull` na bazie deweloperskiej (różnica schematu: `receipt_items.vat_rate` bez `notNull`, nowa treść `v_receipt_list`); `pnpm lint`, `pnpm typecheck`, `pnpm test` (core 181, shared 32, symulator 54, db 71, api 185) i `pnpm --filter @hulajnogi/web build` przechodzą. Nowe i zmienione testy: core (VAT grupami, korekta proporcjonalna, kolejne korekty, reszta groszowa, paragon sprzed zmiany), db (widok z grupą 23% i `NULL`, korekta tylko poza VAT, odrzucenie przekroczenia grupy i obcej stawki), api (zdalne zakończenie z opłatą z portfela i kartą: `TOWING_FEE` bez stawki, VAT tylko od przejazdu, zwrot częściowy i pełny z pozycjami korekty w dwóch grupach). Panelu i aplikacji nie oglądano w przeglądarce.

**Po iteracji 6: sprawy autora (18 listopada 2026)**
- Serwery deweloperskie zrestartowane z tej sesji: API (`nest start --watch`, 3001), symulator (strefy z API, 40 z 40 hulajnóg połączonych), panel (`next dev`, 3002). Konfiguracje `api` i `simulator` dopisane do `.claude/launch.json`.
- Aktualizacja Next.js 16.4.4 → 16.4.6 (decyzja autora). Wersje do 16.4.4 mają dwie podatności średniej wagi w `use cache` (GHSA-vc7v-qv4w-wrv8, GHSA-mfr8-8qww-v76h; poprawka od 16.4.5). 16.4.6 ma 9 dni, build panelu przechodzi bez komunikatu o podatności.
- Stawka VAT opłaty za odholowanie rozstrzygnięta: kara umowna poza VAT (ADR 0061, wpis wyżej).
- `eas init` zostaje po stronie autora (interaktywne logowanie do konta Expo); Stripe na koniec projektu.
- `eas init` (18 listopada 2026): projekt EAS `@fifi3303/hulajnogi` założony przez autora. Polecenie uruchomione w katalogu głównym utworzyło tam własny `app.json` z `projectId`; identyfikator i `owner` przeniesione do `apps/mobile/app.json`, a zbędny plik usunięty. `expo config` zwraca `projectId`, więc aplikacja może pobrać token push na development build (nadal potrzebne poświadczenia FCM i APNs).

## Plan iteracji 7: treści i wydruki (18 listopada 2026)

Plan: [iteracja 7](iteracje/iteracja-07-tresci-wydruki.md). Etap planowania, bez kodu i bez makiet.

**Co powstało**
- Plan iteracji 7. Cel: bloki treści w sekcjach strony i aplikacji, FAQ, aktualności z planowaną publikacją, biblioteka mediów i dane firmy w panelu; strona promocyjna z treści z bazy (z dokumentami, aktualnościami i `/h/{numer}`); szablony DOCX z wersjami, walidacją i aktywacją, wydruki DOCX i PDF z kart przejazdu, zadania, hulajnogi i paragonu, paragon PDF w aplikacji; Gotenberg i port `DocumentRenderer`. Granica z iteracją 8 (raporty, ExcelJS, eksport list), zakres migracji 0011, kolejność kroków i scenariusz demo w 10 krokach.
- Stan wyjściowy spisany z kodu i migracji:
  - tabele treści, mediów, szablonów i wygenerowanych dokumentów istnieją od migracji 0002, ale są puste i nie mają punktów API (poza dokumentami prawnymi z iteracji 2);
  - `fn_content_revision()` jest, ale `ETag` treści i zdarzenia `content.updated` nie ma;
  - strona promocyjna to szkielet z dwoma tekstami z `messages/pl.json`.
- 12 brakujących makiet w czterech katalogach: `28-panel-tresci`, `29-panel-wydruki`, `30-strona-tresci`, `31-mobile-tresci`.
- 8 ADR-ów do napisania (0062–0069; 0069 tylko, jeśli eksport danych zostanie w zakresie), 14 pytań do autora i 8 decyzji z rekomendacją (D1–D8), lista sprawdzeń przed ADR-ami.

**Wnioski z przeglądu kodu, migracji i makiet**
- **Kod QR na naklejce a ADR 0030.** ADR 0041 zapowiada naklejkę z kodem QR jako wydruk z szablonu, a ADR 0030 wyklucza obrazy zmienne w DOCX (moduł obrazów docxtemplater jest płatny). D5 proponuje naklejkę jako PDF z HTML przez Chromium w Gotenbergu.
- **Podpisane adresy plików a cache.** Adres odczytu z ADR 0057 jest ważny 10 min, a strona z cache i aplikacja z pamięcią treści potrzebują stałych adresów grafik. D3 proponuje publiczne adresy dla celu `MEDIA` (zmiana ADR 0057 w tej części).
- **Build w CI bez API.** `pnpm build` w CI buduje panel bez działającego API, więc strona czytająca treści z API nie może wymagać ich w czasie budowania (D2, ADR 0065).
- **Wersja Gotenberga.** ADR 0029 zakłada linię 9.x; przed ADR 0066 trzeba sprawdzić, która linia jest aktualna. Gotenberga nie ma jeszcze w `infra/`.
- **Dwa parsery Markdown** (podgląd w panelu i `components/markdown.tsx` w aplikacji) obsługują różne podzbiory składni; strona byłaby trzecim. ADR 0063 proponuje jeden parser do drzewa elementów w `packages/shared`, bez HTML, więc bez sanityzacji.
- **Eksport danych klienta** nie pasuje do `generated_documents`, bo `template_version_id` jest `NOT NULL`; pytanie 14 i migracja 0011 rozstrzygają formę.
- **Dane sprzedawcy** są w konfiguracji API (`SELLER_*`), a kontakt pomocy i marka w `pl.json` aplikacji jako wartości w nawiasach; pytanie 13 proponuje tabelę danych firmy.
- **Seed z plikami.** Media i szablony startowe wymagają zapisu w SeaweedFS przez seed (dziś seed pisze tylko do bazy); testy API czytają szablony z repozytorium do pamięci.
- **Treści w aplikacji bez sieci.** ADR 0027 zakłada pamięć treści na urządzeniu, a aplikacja nie ma modułu do jej przechowania ani modułów do pobrania i udostępnienia PDF.
- **Makiety:** zakładki Treści (Bloki treści, FAQ, Aktualności, Media) i pozycja „Wydruki” w nawigacji są na planszach od iteracji 2, ale bez ekranów. Strona `14-strona` nie ma aktualności, stron dokumentów ani `/h/{numer}`. `konto-zasady` ma ikony przy zasadach, a implementacja numery.
- **Uprawnienia:** zapis treści ma tylko Administrator (Dyspozytor ma `content.read`); pytanie 6 proponuje rolę Redaktor.
- **Drobna niespójność poza zakresem:** `eclipse-mosquitto:2` i `postgis/postgis:16-3.4` w `infra/` to tagi ruchome, choć `CLAUDE.md` mówi o przypiętych obrazach.

**Do zrobienia przed implementacją**
- Odpowiedzi autora na pytania 1–14 i decyzje D1–D8.
- Makiety brakujących stanów w czterech katalogach.
- Sprawdzenia przed ADR-ami (wersje starsze niż 3 dni): Gotenberg (tag, arm64, Inter, blokada zasobów zewnętrznych), docxtemplater (wersja, licencja, ESM, moduł inspekcji, darmowe moduły obrazów), parser Markdown, cache i odświeżanie w Next.js 16.4.6, moduły Expo z `expo install`.
- ADR 0062–0069.

**Odpowiedzi autora (18 listopada 2026)**
- Wszystkie rekomendacje: pytania 1–14 i decyzje D1–D8 ([tabela w planie](iteracje/iteracja-07-tresci-wydruki.md#odpowiedzi-autora-18-listopada-2026)).
- Cztery wydruki z szablonem startowym (paragon z korektą, potwierdzenie przejazdu, protokół serwisowy, karta hulajnogi), nowa rola „Redaktor”, „Pobierz moje dane” w tej iteracji (ADR 0069 powstaje), naklejka QR jako PDF z HTML.

**Makiety (18 listopada 2026)**
- 30 plansz w [`28-panel-tresci`, `29-panel-wydruki`, `30-strona-tresci` i `31-mobile-tresci`](projekt/README.md#panel-operatora-treści-i-wydruki-iteracja-7):
  - 9 plansz treści w panelu (bloki, edycja bloku, sekcja-lista, FAQ, aktualności, media, wysyłka, wybór grafiki, dane firmy) i 6 wydruków (szablony, wersje z walidacją i podglądem, błędy wgrania, okno „Drukuj”, wygenerowane, naklejka QR);
  - 7 plansz strony (dokument na komputerze i telefonie, aktualności, artykuł, `/h/{numer}` na komputerze i telefonie, 404) i 8 aplikacji (Pomoc, Pomoc bez sieci, paragon PDF w trzech stanach, „Pobierz moje dane” w trzech stanach).

  Spis ekranów: 172. Plansze przygotowało dwóch agentów równolegle, a PNG wyrenderował Chrome headless. Wszystkie PNG obejrzane. Poprawka po przeglądzie: pytanie FAQ na `pomoc-offline` mówiło o przycisku „Zakończ bez łączności”, którego aplikacja nie ma (przy hulajnodze offline działa zwykłe „Zakończ”).
- **Luki i decyzje do ADR-ów** (lista w planie, sekcja „Do rozstrzygnięcia w ADR 0062–0069”): ikona elementu sekcji-listy, kolejność kategorii FAQ, `generated_documents` dla naklejki i eksportu, publiczne wersje dokumentów prawnych, publiczny odczyt hulajnogi dla `/h/{numer}`, rozdzielenie uprawnień Redaktora (szablony powiadomień, dane firmy), KRS i REGON, miejsce błędu w DOCX bez numeru strony.
- **Sprzeczności ze starszymi planszami:** `18-panel-dostep/dostep-dokumenty` ma pięć zakładek Treści bez „Dane firmy”; `14-strona` ma w stopce „Zgłoś usterkę” i „Kontakt” zamiast danych pomocy oraz nawigację bez „Aktualności”; `24-mobile-platnosci/paragon` zapowiadał ikonę pobierania w nagłówku (jest przycisk u dołu); `06-mobile-profil/profil` — „Pomoc i zgłoszenia” otwiera teraz Pomoc.

**ADR 0062–0069 (18 listopada 2026, zaakceptowane przez autora)**
- **Sprawdzone przed pisaniem** (wersje starsze niż 3 dni):
  - **Gotenberg** (Docker Hub, GitHub Releases, kod wydania, dokumentacja 9.x):
    - linia 8 skończyła się na 8.40.0 (5 listopada), a 9.0.0 wyszła tego samego dnia (silnik PDF litho, LibreOffice przez LibreOfficeKit). Wydania wychodzą co 1–2 dni: 9.6.0, 9.7.0 i 9.8.0 (16–18 listopada) są za świeże;
    - wybrana **9.5.1** (14 listopada): indeks `sha256:a0f596c2…e2c8`, `amd64` i `arm64`, około 640 MB;
    - trasy `/forms/libreoffice/convert` i `/forms/chromium/convert/html`, `/health` bez uwierzytelnienia, `API_TIMEOUT` 30 s z kolejką;
    - blokada ruchu wychodzącego: `*_DENY_PRIVATE_IPS`, `*_DENY_PUBLIC_IPS`, `CHROMIUM_DISABLE_JAVASCRIPT`, `API_DISABLE_DOWNLOAD_FROM`, `WEBHOOK_DISABLE`, `PDF_DISABLE_ROUTES`;
    - limitów pamięci silników nie ma w 9.5.1 (od 9.6.0);
    - obraz bez Inter, działa jako UID 1001. Inter 4.1 (16 listopada 2024, OFL 1.1).
  - **docxtemplater 3.71.1** (15 października, MIT, CommonJS z `export =`, `@xmldom/xmldom` 0.9.12) i **pizzip 3.3.0** (21 września, MIT albo GPL-3.0, `pako` ^2.1.0). Sprawdzone w kodzie pakietów, bez uruchamiania (tryb automatyczny odmówił wykonania pobranego kodu, więc zachowanie potwierdzi test w kroku 6):
    - `InspectModule` jest w darmowym pakiecie (`docxtemplater/js/inspect-module.js`);
    - błędy to `TemplateError` z `multi_error` i polami `id`, `explanation`, `xtag`, `offset` (w tekście części) i `file`;
    - znaczniki rozbite przez Worda w akapicie łączy lekser;
    - parser domyślny nie zna kropki, a `expressions.js` wymaga `angular-expressions` (wykonuje wyrażenia);
    - pizzip nie limituje rozmiaru po rozpakowaniu;
    - moduły obrazów, QR i położenia błędów są płatne, a `docxtemplater-image-module-free` 1.1.1 jest z 2019 r. i zależy od `xmldom` 0.1.27.
  - **Markdown:** `marked` 18.2.0 (18.2.1 z 16 listopada za świeża), `mdast-util-from-markdown` 2.1.0 z `micromark` 4.0.3, `markdown-it` 15.0.3. Sanityzacja byłaby potrzebna tylko przy HTML (`dompurify` 3.4.18, `sanitize-html` 2.18.2 z Node ≥ 22.12).
  - **Next.js 16.4.6** (dokumentacja w `node_modules/next/dist/docs`):
    - `revalidateTag(tag, profile)`: forma z jednym argumentem jest przestarzała, z Route Handlera `{ expire: 0 }`, a `updateTag` tylko w Server Actions;
    - `cacheTag` wymaga `cacheComponents: true` dla całej aplikacji (z `<Activity>` i zasadami prerenderu także w panelu);
    - w modelu bez Cache Components `fetch` z dodatnim `revalidate` zostaje w Data Cache przy renderowaniu dynamicznym;
    - `next/image` z API na `localhost` wymaga `dangerouslyAllowLocalIP` (ostrzeżenie SSRF); `sharp` 0.35.5 jest zainstalowany.
  - **Expo SDK 58** (`bundledNativeModules.json`, Expo 58.0.23): `expo-file-system` ~58.0.13, `expo-sharing` ~58.0.22, `expo-sqlite` ~58.0.15 (w wersji web wymaga WASM i nagłówków COOP/COEP), `@react-native-async-storage/async-storage` 2.2.0. `minimumReleaseAge: 4320` w `pnpm-workspace.yaml` pilnuje wieku wersji w zakresach `~`.
  - **Pozostałe:** `image-size` 2.1.0 (6 listopada) jako alternatywa własnego odczytu wymiarów; `qrcode` 1.5.4 jest już w panelu.
- **0062 Moduł treści:**
  - rejestr sekcji w `packages/shared` z rodzajem, limitami, profilem Markdown, minimalną szerokością grafiki i sekcjami wymaganymi;
  - `content_blocks.key` jako klucz sekcji z `position` (unikalność odroczona) i ikoną z zamkniętej listy (`CHECK`);
  - tabela `faq_categories` z kolejnością i przełączniki strona i aplikacja; `news.lead` wymagany, a stan aktualności liczy widok;
  - historia z dziennika audytu z pełnym stanem przed zmianą i po niej i „Przywróć” jako nowa wersja; blokada optymistyczna także w wersji roboczej dokumentu;
  - `company_profile` zamiast `SELLER_*`, z KRS, REGON, sądem i kapitałem jako polami opcjonalnymi w stopce (paragon bez zmian);
  - nowe `company.write` tylko dla Administratora; szablony powiadomień zostają przy `content.write`, bo `login_code` chroni parametr wymagany;
  - rola Redaktor, a jej pulpit ma grupę „Treści”;
  - `GET /content/{client}` z `ETag` i `content.updated`; pamięć w aplikacji w Async Storage;
  - przy pierwszym uruchomieniu bez sieci ekran „Brak internetu”, bez kopii kontaktu w paczce.
- **0063 Markdown:**
  - własny parser podzbioru w `packages/shared` do drzewa, bez zależności i bez HTML (więc bez sanityzacji);
  - profile `inline`, `faq` i `document`; błędy z wierszem i kolumną, a błędny wiersz pominięty w podglądzie;
  - odnośniki tylko `https:`, `mailto:`, `tel:`, `/…` i `#…`;
  - kotwice bez znaków diakrytycznych (NFKD i `ł → l`); renderery osobne dla React DOM i React Native.
- **0064 Media:**
  - `POST /files` z `MEDIA` do 5 MB i `content.write`; typ po sygnaturze i wymiary z nagłówka w core (bez `image-size`), limit 8000 px;
  - klucze systemowe `scooter.*` z flagą `is_system`; usunięcie tylko nieużytej grafiki;
  - „Zastąp plik” zachowuje identyfikator; minimalna szerokość według sekcji;
  - publiczny `GET /media/{id}/{sha256}.{ext}` z `immutable` i `308` dla starszej sumy (zmienia ADR 0057 dla `MEDIA`);
  - rendery z kopią w paczce tylko na pierwsze uruchomienie bez sieci.
- **0065 Strona:**
  - Data Cache `fetch` z tagami (`content`, `tariff`, `scooters`) i `connection()` zamiast Cache Components, bo te zmieniałyby panel;
  - `POST /api/revalidate` z sekretem i `revalidateTag(tag, { expire: 0 })`, zadanie API `site.revalidate` po zatwierdzeniu, czas zapasowy 5 min; build bez API;
  - publiczne wersje dokumentów `/{slug}/wersja/{n}`, bez osobnej daty wejścia w życie;
  - `/h/{numer}` z publicznym `GET /public/scooters/{number}` (tylko numer i model);
  - „Mam aplikację” jako `hulajnogi://hulajnoga/{numer}` (`APP_SCOOTER_LINK`);
  - zwykłe `<img>` z wymiarami, `sitemap.ts`, `robots.ts`, `web.meta`; bez ciasteczek.
- **0066 Gotenberg:**
  - własny `Dockerfile` na bazie 9.5.1 z Inter 4.1, port tylko na pętli zwrotnej (`GOTENBERG_PORT`, domyślnie 3010), `mem_limit`;
  - port `DocumentRenderer` (`fillDocx`, `docxToPdf`, `htmlToPdf`) z adapterem Gotenberga i atrapą;
  - kody `RENDER_TIMEOUT`, `RENDERER_UNAVAILABLE`, `RENDER_FAILED`;
  - zadanie `document.generate` (DOCX zawsze, przy błędzie PDF zostaje DOCX), `document.ready` z pokojem `staff:{id}`;
  - retencja `documents.retention` po 30 dniach.
- **0067 Szablony DOCX:**
  - własny parser ścieżek z kropką bez wyrażeń; `{@raw}` zabronione;
  - formatowanie w katalogu w core; katalog pól dla panelu z API (bez kopii w `packages/shared`);
  - ochrona przed bombą ZIP: katalog centralny w core i `inflateRawSync` z `maxOutputLength` w API; odrzucenie `.docm`;
  - miejsce błędu jako część, tabela, wiersz, kolumna albo akapit, **bez numeru strony** (odstępstwo od planszy `wydruki-wgranie-bledy`);
  - stany `PENDING`, `ACTIVE`, `ARCHIVED`, aktywacja i przywrócenie procedurą bez kopiowania pliku;
  - podgląd PDF synchroniczny z pamięcią wyniku; lista pól DOCX z systemowego szablonu.
- **0068 Wydruki:**
  - siedem rodzajów z widokami `v_doc_*`, w tym `SCOOTER_LABEL`;
  - „Drukuj” wymaga `documents.generate` i uprawnienia odczytu rodzaju, a bez `users.read` klient to „Klient”;
  - stopka `{document.footer}`; adres przejazdu z Photon `/reverse` z zapasem;
  - paragon PDF klienta używany ponownie dzięki indeksowi częściowemu; aplikacja zapisuje przez `expo-file-system` i udostępnia przez `expo-sharing`, wersja web otwiera kartę;
  - naklejka z HTML z SVG z `qrcode`, z tekstem z sekcji `admin.scooter-label`;
  - `template_version_id` puste tylko dla naklejki (`CHECK` na tekście rodzaju, bo nowej wartości typu nie wolno użyć w tej samej transakcji);
  - „Wydruki” widoczne z `templates.read` albo `documents.generate`.
- **0069 Eksport danych:**
  - osobna tabela `data_exports` i cel pliku `DATA_EXPORT`;
  - limit 24 h w procedurze z blokadą i w core (test zgodności); jedno zlecenie w toku;
  - `429 DATA_EXPORT_LIMIT` z `nextAllowedAt`;
  - porty eksportu modułów i JSON ze schematem w `packages/shared`;
  - zdjęcia tylko jako metadane;
  - powiadomienie `data_export_ready` i zdarzenie `data-export.ready`; plik ważny 7 dni, usuwany zadaniem `data-exports.purge` i przy usunięciu konta.
- **Odstępstwa od planu i makiet do akceptacji:**
  - sekcja `web.meta` ponad 10 sekcji z planszy;
  - bez osobnego `GET /faq` (FAQ jest w `GET /content/{client}`);
  - katalog pól wydruków z API zamiast kopii w `packages/shared`;
  - bez numeru strony w błędach szablonu;
  - pola rejestrowe w danych firmy spoza planszy `tresci-dane-firmy`.

## Iteracja 7: implementacja (19 listopada 2026)

Plan: [iteracja 7](iteracje/iteracja-07-tresci-wydruki.md), decyzje w [ADR 0062–0070](adr/README.md). Pracowali agenci etapami, każdy z raportem dla następnych: baza, core i shared, API w dwóch częściach (treści; silnik dokumentów, szablony, wydruki i eksport danych), a na końcu równolegle panel i strona (treści), panel (wydruki) i aplikacja (treści; paragon PDF i eksport), każdy w swoim katalogu. Potem przegląd kodu w dwóch częściach (treści i strona; wydruki i eksport) i etap poprawek (niżej). Koordynator przeglądał raporty, dopisywał poprawki między etapami i domyka weryfikację.

**Baza (migracja 0011)**
- Nowe wartości typów: `document_type` `SCOOTER_LABEL`, `file_purpose` `DATA_EXPORT`; nowy typ `document_format` (`DOCX`, `PDF`). Nowych wartości nie wolno użyć w transakcji, która je dodaje, więc `CHECK` i widoki porównują je jako tekst (jak w 0008).
- Uprawnienie `company.write` (tylko Administrator) i rola Redaktor (`content.read`, `content.write`, `templates.read`, `dashboard.read`).
- Nowe tabele `faq_categories`, `company_profile` (jeden wiersz z wartościami w nawiasach) i `data_exports`.
- Zmiany tabel z 0002:
  - `content_blocks`: klucz sekcji z pozycją (unikalność odroczona), ikona z 12 wartości, prefiks klucza według klienta, schemat adresu przycisku;
  - `faq_items` z kategorią i widocznością na stronie i w aplikacji; `news` z wymaganą zajawką i czasem pierwszej publikacji;
  - `media_assets` z nazwą, flagą grafiki systemowej i limitami tekstów, `files.width` i `height`, klucze obce grafik `RESTRICT`;
  - `content_page_versions.version` (blokada optymistyczna wersji roboczej, dług z iteracji 2);
  - `document_template_versions` z aktywacją (czas, autor), ostrzeżeniami, rozmiarami i podglądem PDF; `generated_documents` z formatem, etykietą obiektu, startem, kodem błędu, usunięciem plików i ponowieniem.
- Reguły w wyzwalaczach: niezmienny klucz i poprawny plik grafiki, grafika systemowa bez usunięcia, opublikowany wpis bez usunięcia, stały slug po pierwszej publikacji, wiersz danych firmy bez usunięcia, niezmienne wersje szablonów; licznik treści także przy kategoriach FAQ, danych firmy i modelach.
- Procedury `sp_document_template_activate`, `sp_document_template_set_default`, `sp_data_export_request`, `sp_content_bump_revision`; funkcje `fn_media_path`, `fn_news_state`, `fn_data_export_next_allowed_at`; `sp_anonymize_user` zamyka eksport w toku.
- 22 widoki: 6 publicznych (treści, FAQ, media, dane firmy, wersje dokumentów prawnych, hulajnoga dla `/h/{numer}`), 10 list panelu i 6 danych wydruków `v_doc_*` (wiersz na obiekt, listy jako `jsonb`, grosze i UTC bez formatowania).
- Dane startowe: 28 bloków (wszystkie sekcje poza `mobile.notice`), 4 kategorie i 16 pytań FAQ, 3 aktualności, 5 grafik (4 systemowe `scooter.*`), 4 szablony aktywne i domyślne, dokument „Polityka cookies”, szablon powiadomienia `data_export_ready`. Seed zapisuje pliki przez port `SeedFileStorage` (`@aws-sdk/client-s3` 3.1169.0 jako zależność deweloperska `packages/db`), więc wymaga SeaweedFS.
- Szablony startowe DOCX (`packages/db/seed/templates/`): paragon, potwierdzenie przejazdu, protokół serwisowy, karta hulajnogi i systemowa lista pól, z powtarzalnym `build.mjs` bez zależności i `manifest.json`.
- Stan bazy: 57 tabel, 64 widoki, 24 funkcje, 22 procedury (test bazy).
- **Zmiana wykonanej migracji:** agent etapu bazy poprawiał migrację 0011 już wykonaną na lokalnej bazie (jeszcze bez commita) i ręcznie zaktualizował jej sumę kontrolną w `schema_migrations` lokalnej bazy. Schemat sprawdził `pg_dump` porównany z bazą zbudowaną od zera, więc baza deweloperska odpowiada plikowi 0011. To odstępstwo od zasady „wykonanej migracji nie zmieniamy”; migracja nie trafiła do repozytorium ani na inną bazę. Dalsze poprawki (po przeglądzie) są już w nowej migracji 0012.

**Core i shared**
- **Shared:**
  - parser Markdown `parseMarkdown` (profile `inline`, `faq`, `document`) do drzewa węzłów z błędami z wierszem i kolumną, `isAllowedHref`, kotwice i spis treści; zastępuje parsery panelu i aplikacji;
  - rejestr sekcji `CONTENT_SECTIONS` (16 sekcji), ikony, klucze grafik systemowych, `HERO_MIN_WIDTH`;
  - schematy treści, FAQ, aktualności, mediów i danych firmy, widoki publiczne (`PublicContent`), rodzaje i formaty dokumentów, schemat eksportu danych (`schemaVersion` 1);
  - zdarzenia `content.updated`, `document.ready`, `data-export.ready`, pokój `staff:{id}`; kod powiadomienia `data_export_ready`; definicje zasobów list (`admin/content.ts`, `admin/documents.ts`).
- **Core:**
  - treści: walidacja bloku i sekcji z rejestru, plan elementów sekcji, przejścia statusu, kolejność, stan i granice aktualności, NIP i REGON, sprzedawca z danych firmy; parser Markdown przychodzi z kontekstu, nie z importu;
  - media: typ po sygnaturze i wymiary JPEG, PNG i WebP (z orientacją EXIF), limity, reguły usunięcia, szerokości, klucza i zastąpienia, publiczny adres;
  - dokumenty: port `DocumentRenderer`, lekser znaczników i walidacja względem katalogu, inspekcja archiwum DOCX (rozmiar, rozpakowanie, makra), katalog `DOCUMENT_CATALOG` (6 rodzajów z polami, pętlami, parametrami, uprawnieniem odczytu, budową danych i danymi przykładowymi), maskowanie klienta, stopka, nazwa pliku, reguły wydruku, ponownego użycia paragonu, retencji i ponowienia, dane naklejki;
  - eksport danych: limit 24 h, stan, nazwa pliku, `buildDataExport`, port `DataExportContributor`.

**API: treści**
- Moduł `content` (sekcje, FAQ, aktualności, media, dane firmy, treści publiczne) z repozytoriami `content.repository.ts` i `media.repository.ts`:
  - panel: sekcje (`PUT /admin/content-sections/{key}` z całą sekcją i historią), FAQ i kategorie z kolejnością (`PUT …/order`), aktualności, media z „Zastąp plik”, dane firmy (`PATCH /admin/company` z `company.write`), dokumenty prawne z `version`, model hulajnogi ze zdjęciem z biblioteki;
  - publiczne (`@Public`): `GET /content/{web|mobile}` z `ETag` i `304`, `GET /media/{id}/{sha256}.{ext}` (`immutable`, `308` dla starszej sumy), `GET /news`, `GET /news/{slug}`, `GET /legal/{slug}/versions` i `…/versions/{n}`, `GET /public/scooters/{number}`;
  - `POST /files` z celem `MEDIA` (operator z `content.write`, 5 MB, do 8000 px, ostrzeżenie powyżej 2560 px).
- Zadania `site.revalidate` (`POST {SITE_REVALIDATE_URL}` z sekretem, tagi `content`, `tariff`, `scooters`, singleton na tag, 3 ponowienia) i `content.news-boundary`; `sendInTransaction` przyjmuje opcje singletonu i ponowień. `content.updated` po zatwierdzeniu.
- `SELLER_*` usunięte: paragon bierze dane sprzedawcy z `company_profile` w transakcji wystawienia (`CompanyProfileProvider`). `files.cleanup` nie usuwa plików przypiętych do grafik i wersji szablonów.
- Kontrakty: `openapi.json` odtworzony, Socket.IO 1.5.0.

**API: dokumenty i eksport danych**
- Infrastruktura: `infra/gotenberg/Dockerfile` na `gotenberg/gotenberg:9.5.1` (skrót `sha256`) z Inter 4.1 (5 krojów i `OFL.txt`), usługa w `infra/docker-compose.yml` na `127.0.0.1:${GOTENBERG_PORT:-3010}`, `mem_limit` 1536 MB, `GOMEMLIMIT` 1200 MiB, healthcheck; 16 zmiennych blokujących z ADR 0066 sprawdzonych na żywym kontenerze.
- Konfiguracja: `DOCUMENT_RENDERER=gotenberg|fake` (`fake` w produkcji zatrzymuje start), `GOTENBERG_URL`, `GOTENBERG_TIMEOUT_MS`, `GOTENBERG_PORT`.
- Moduł `documents`:
  - szablony: lista, nowy szablon, wgranie wersji z walidacją (`422 TEMPLATE_INVALID` z miejscem, `413`, `415`), aktywacja i „Przywróć”, szablon domyślny, usunięcie wersji `PENDING`, pobranie pliku, podgląd PDF zapamiętany jako plik `DOCUMENT_TEMPLATE`;
  - rodzaje dokumentów z polem `printable`, lista pól i lista pól DOCX;
  - wydruki: `POST /admin/documents` (`202`), szczegóły, ponowienie, lista Wygenerowanych (wyszukiwanie po 8 znakach identyfikatora ze stopki);
  - klient: `POST /me/receipts/{id}/pdf` (`200` ponowne użycie, `202` nowy), `GET /me/documents/{id}`;
  - adaptery `GotenbergRenderer` i atrapa, `docx-engine.ts` (docxtemplater z `paragraphLoop` i parserem ścieżek), naklejka QR z HTML.
- Moduł `data-export`: `POST /me/data-exports` (`202`, `429 DATA_EXPORT_LIMIT` z `nextAllowedAt`), `GET /me/data-exports/latest`, `GET /admin/data-exports` (`users.read`); porty eksportu w modułach Dostęp, Wypożyczenia, Płatności, Operacje i Powiadomienia (`DataExportRegistry`), zapytania w `packages/db/src/repositories/data-export-sources.ts`.
- Zadania: `document.generate` (współbieżność 2, limit 120 s, 2 ponowienia tylko dla `RENDERER_UNAVAILABLE`), `documents.retention` (03:30 UTC), `data-export.generate`, `data-exports.purge` (03:45 UTC, także po usunięciu konta).
- `GET /health` z `documents: up|down`; `GET /files/{id}` z `Content-Disposition` dla szablonów, wydruków i eksportu (eksport `private, no-store`).
- Socket.IO 1.6.0: operator dołącza do `staff:{id}` przy połączeniu; `document.ready` do `staff:{id}` albo `user:{id}`, `data-export.ready` do `user:{id}`.
- Zależności w wersjach z ADR: `docxtemplater` 3.71.1, `pizzip` 3.3.0, `qrcode` 1.5.4, `@xmldom/xmldom` 0.9.12, `@types/qrcode` 1.5.6.

**Strona promocyjna (`apps/web`)**
- `/` z sekcji `web.*` (także `web.meta` i `web.notice`), cennika i modelu; `/[slug]` i `/[slug]/wersja/[n]` dla regulaminu, polityki prywatności, zasad jazdy i polityki cookies (bieżąca wersja pod adresem wersji przekierowuje `307`); `/aktualnosci?strona=`, `/aktualnosci/[slug]`; `/h/[number]` (`/h/7` → `308` `/h/0007`, zły numer `404`); `error.tsx`, `not-found.tsx`, `sitemap.ts`, `robots.ts`; `POST /api/revalidate` (bez sekretu `401`).
- `lib/site/api.ts` tylko na serwerze: `connection()`, `fetch` z tagami `content`, `tariff`, `scooters`, `revalidate` 300 s, limit 5 s; zwykłe `<img>` z wymiarami. Trasy strony są dynamiczne, panel statyczny, a build przechodzi bez API.
- `APP_SCOOTER_LINK` i `API_INTERNAL_URL` w `.env.example`. Klucze `marketing.*` i `meta.description` usunięte z `messages/pl.json`.

**Panel**
- **Treści** (`/admin/tresci`): zakładki Dokumenty prawne (podgląd `MarkdownView` ze wspólnego parsera), Bloki treści (lista i edytor sekcji `/bloki/[key]` z podglądem i historią), FAQ, Aktualności (z `/aktualnosci/nowy`), Media, Dane firmy; okno wyboru grafiki; zdjęcie modelu z biblioteki w formularzu modelu; grupa „Treści” na pulpicie (liczby z zasobów list).
- **Wydruki** w Analizie (z `templates.read` albo `documents.generate`; bez `templates.read` od razu Wygenerowane): `/admin/wydruki` (szablony według rodzajów, „Nowy szablon”, „Instrukcja i lista pól”, „Wgraj szablon”), `/admin/wydruki/szablony/[id]` (wersje ze stanami, walidacja, podgląd PDF, „Pola (n)”, aktywacja i przywrócenie, wgranie z notatką i oknem błędów), `/admin/wydruki/wygenerowane` (domyślnie zlecający operator, „Pobierz”, „Ponów”, „Wygeneruj ponownie”, odświeżanie po `document.ready`).
- „Drukuj” (`components/admin/prints/print-dialog.tsx`) na zadaniu, przejeździe, hulajnodze, zgłoszeniu, paragonie i wpisach korekty i zwrotu w portfelu, tylko dla rodzaju z `printable`; naklejka QR (`label-dialog.tsx`); karta „Eksporty danych” na profilu klienta (`users.read`).
- `lib/api.ts` (`apiBlob`, `fileUrl`), `lib/realtime.ts` (`documentReady`), `NEXT_PUBLIC_SITE_URL` z `PUBLIC_SITE_URL`. `pl.json`: 2743 → 3850 kluczy (`site.*`, `content.*`, `prints.*`, `dashboard.content.*`, zasoby, błędy).

**Aplikacja**
- Pamięć treści `src/lib/content.tsx`: Async Storage 2.2.0 (w wersji web `localStorage`), najpierw pamięć, potem sieć z `If-None-Match`; odświeżanie przy powrocie na pierwszy plan, po `content.updated`, po ponownym połączeniu gniazda i przy wejściu na Pomoc.
- Ekrany:
  - `/witaj` z sekcji `mobile.start` (tytuł, wstęp, render); bez treści i sieci „Brak internetu” ze „Spróbuj ponownie”;
  - `/zasady` z sekcji-listy `mobile.rules` z ikonami (bez opublikowanej sekcji od razu mapa);
  - nowa `/pomoc`: Moje zgłoszenia z nową odpowiedzią, wstęp, FAQ po kategoriach, kontakt z danych firmy, tryb bez sieci z czasem pobrania; „Pomoc i zgłoszenia” w profilu otwiera Pomoc;
  - kontakt z danych firmy także na ekranie jazdy, przy zdjęciu, blokadzie konta i danych osobowych;
  - `/paragon/[id]` z „Pobierz PDF” (arkusz „PDF gotowy” z „Udostępnij” i „Otwórz”, błąd ze „Spróbuj ponownie”);
  - nowe `/profil/moje-dane` (pusty, przygotowanie, gotowy, błąd, wygasły) i wiersz „Pobierz moje dane” w ustawieniach.
- `components/markdown.tsx` na wspólnym parserze (także dokumenty prawne); rendery z grafik systemowych, kopia z paczki tylko bez treści w pamięci albo przy błędzie wczytania.
- Zależności z `expo install`: `@react-native-async-storage/async-storage` 2.2.0, `expo-file-system` ~58.0.13, `expo-sharing` ~58.0.22 (zainstalowana 58.0.23 z 11 listopada) z wtyczką w `app.json`. `pl.json`: 884 → 941 kluczy; usunięte teksty merytoryczne (`start.headline`, `start.lead`, `rules.title`, `rules.lead`, kontakt pomocy na ekranie blokady).

**Decyzje podjęte przy implementacji**
- **Grafika hero:** minimum 760 px zamiast 1200 px (decyzja autora, [ADR 0070](adr/0070-minimalna-szerokosc-grafiki-hero.md)), bo rendery w repozytorium mają 767–922 px.
- **Bez `InspectModule` docxtemplater:** moduł wymaga `lodash`, którego nie ma w zależnościach pakietu. Znaczniki czyta lekser z core, a miejsce błędu wylicza `@xmldom/xmldom`.
- **Dane wydruków:** przyczyna korekty paragonu zostaje pusta (`v_doc_receipt` nie ma powodu zwrotu), bateria i łączność na karcie hulajnogi z `v_fleet_status`, trasa w eksporcie do 300 punktów. Teksty wyliczeń na wydrukach są w `apps/api/src/documents/document-labels.ts` (kopia z `pl.json` panelu), a tekst naklejki w sekcji `admin.scooter-label`.
- **Szablony startowe** przepisane po etapie API wydruków na pola z katalogu core; usunięte elementy spoza katalogu (stawki cennika, zapłacono i zwrócono, dane modelu i statystyki na karcie, „Lp.”, opis zadania, kolumna „Kto”). Seed podmienia aktywną wersję startową, gdy suma SHA-256 pliku się zmieni (wpis `document_template.starter_updated`), a wersji operatora nie rusza.
- **`entityId` wydruku** to `uuid` albo liczba (wpis księgi portfela).
- **Strona 404 spoza tras** ma stopkę bez danych firmy: odczyt API w głównym `not-found` zrobiłby panel dynamicznym.
- **`content.updated`** dostaje tylko zalogowana aplikacja (gniazdo wymaga tokenu, ADR 0062); niezalogowana odświeża treść przy powrocie na pierwszy plan.

**Odstępstwa od makiet**
- **Panel, treści:** panel ma stały tytuł karty przeglądarki (`title.absolute`), bez szablonu tytułu strony; sekcja „Dane rejestrowe” (KRS, REGON, sąd, kapitał) spoza planszy `tresci-dane-firmy` (zgodnie z ADR 0062).
- **Panel, wydruki:**
  - stany okna „Drukuj” w miejscu formularza zamiast kart obok;
  - wyszukiwarka Wygenerowanych w pasku filtrów, domyślny filtr „Zlecający”;
  - okno wgrania z polem „Co się zmieniło”, „…” w wierszu szablonu otwiera kartę;
  - „W dokumencie” z liczbami tylko dla zadania; podgląd naklejki w panelu różni się od PDF;
  - błąd szablonu bez numeru strony (ADR 0067).
- **Strona:** sekcja stref bez grafiki (rysunek ozdobny), sekcja aplikacji bez makiety telefonu, aktualność bez grafiki na szarym tle, lista aktualności na wspólnym wzorcu, `/h/{numer}` na telefonie z renderem nad numerem i bez „Jak ruszyć”, data „do” wersji dokumentu to publikacja następnej wersji.
- **Aplikacja:**
  - ikony zasad z planszy panelu (nie z `konto-zasady`), ikona `scan` bez planszy, ikona „pobierz” dorysowana, ikony listy zawartości eksportu z zestawu aplikacji;
  - wstęp `mobile.help` między zgłoszeniami a FAQ, kolor odpowiedzi FAQ `theme.ink`;
  - `mobile.notice` niewyświetlana (brak makiety);
  - pasek przycisku paragonu jako stopka `PageScreen` bez gradientu, podtytuł arkusza 15 px;
  - karty błędu i wygaśnięcia eksportu bez plansz (teksty własne); wersja web przy zablokowanym oknie pokazuje arkusz z „Otwórz”.

**Poprawki koordynatora**
- **Grafika hero:** `HERO_MIN_WIDTH` 760 px w `packages/shared` po decyzji autora (ADR 0070); render 857 px przypięty w danych startowych do hero spełnia regułę.
- **CORS w API:** dodane `PUT` w metodach, `if-none-match` w nagłówkach żądania i `exposedHeaders: etag`. Panel zapisuje sekcje i kolejność FAQ przez `PUT`, a wersja web aplikacji czyta `ETag`.
- **Ścieżka `data_export_ready`:** `/profil/moje-dane` zamiast `/profil/dane` z ADR 0069 (to ekran „Dane osobowe”). Odstępstwo od ADR 0069.
- **Szablony startowe:** po etapie API wydruków na polach z katalogu core, a po przeglądzie (D6, D7) z notą firmy w stopce i ścieżkami pól pętli w formacie `parts[].sku`. W bazie deweloperskiej aktywne wersje startowe: paragon v3, potwierdzenie przejazdu v3, protokół serwisowy v4, karta hulajnogi v3.
- **Migracja 0011:** zmiana wykonanej lokalnie migracji z ręczną poprawką sumy kontrolnej (opis w części „Baza”).

**Poprawki po przeglądzie iteracji 7 (18 listopada 2026)**

Migracja `0012_iteration7_fixes.sql` (0011 bez zmian), `pnpm db:pull` z ręczną poprawką klas operatorów w nowych indeksach z 0011 (`content_blocks_client_idx`, `faq_items_category_idx`, `generated_documents_user_idx`, `generated_documents_receipt_reuse`), szablony startowe odtworzone i podmienione przez `pnpm db:seed`, `openapi.json` odtworzony, `asyncapi-realtime.yaml` 1.6.1 (bez zmiany ładunku).

- **D1 (dane klienta w cudzym wydruku):** maskowanie jest wypalone w pliku według zlecającego, więc wiersz pamięta `customer_data_visible` (zapis przy wypełnieniu szablonu, `documentShowsCustomerData` w core). `ensureCanDownloadDocument` wymaga dla takiego wiersza `users.read` od każdego operatora (także zlecającego): szczegóły z adresami plików, pobranie i ponowienie dają 404; lista zostawia wiersz z flagą `customerDataVisible`, a panel zamiast „Pobierz”/„Ponów” pokazuje „Dane klienta” z podpowiedzią. `document.ready` bez adresów, gdy zlecający stracił `users.read`. Test e2e „Serwisant nie pobiera wydruku Dyspozytora z danymi klienta” (z `docrev/e2e/leak.test.ts`) i testy reguły w core.
- **D2 (miejsca podstawiania poza `w:t`):** inspekcja czyta listę części z docxtemplater (`templatedFiles`, po typie zawartości: także nagłówek pod inną nazwą, komentarze, ustawienia, `docProps`, diagramy) i wszystkie elementy tekstu z `tagsXmlTextArray` (`m:t`, `a:t`, `dc:title`, `vt:lpstr`…). Przy wypełnianiu moduł `templateGuardModule` przejmuje `{@…}` i kończy wydruk `TEMPLATE_RENDER_FAILED` (`raw_xml_tag`), a zmiana ograniczników jest wyłączona (`syntax.changeDelimiterPrefix: null`), więc także wersja wgrana wcześniej nie wstawi surowego XML. Testy z `docrev/raw.test.ts` i `math.test.ts` w `documents-engine.test.ts`.
- **D3 (RUNNING na zawsze po restarcie API):** ponowienie zadania przejmuje wiersz `RUNNING` starszy niż limit czasu zadania pg-boss (`DOCUMENT_JOB_EXPIRE_MS` 120 s, `DATA_EXPORT_JOB_EXPIRE_MS` 300 s, te same stałe w opcjach kolejek), a nowe zadania porządkowe `documents.sweep` i `data-exports.sweep` (co 5 min) kończą wiersze w kolejce albo w toku dłużej niż 15 min (wydruk, `RENDER_TIMEOUT` z `document.ready`) albo 30 min (eksport, `DATA_EXPORT_FAILED` z `data-export.ready`). Eksport przestaje blokować klienta (`data_exports_one_open`), paragon klienta powstaje od nowa, retencja widzi `finished_at`. Testy core i e2e.
- **D4 (retencja najwyżej 200 wierszy):** `documents.retention` i `data-exports.purge` przechodzą partie po 200 do wyczerpania kandydatów (partia bez usunięcia kończy przebieg). Test e2e z 205 wygasłymi plikami eksportu.
- **D5 (partia 5 w `data-export.generate`):** kolejki z ponowieniami mają `batchSize: 1` (`workerOptions` w `JobsService`), test w `jobs.e2e.test.ts`.
- **D6 (protokół na dwie strony):** nota firmy przeniesiona do stopki (`footer1.xml` nad `{document.footer}`, na każdej stronie) zamiast ostatniego akapitu treści po pustym akapicie; lista pól jej nie ma. Szablony odtworzone (`build.mjs`), seed podmienił aktywne wersje startowe. Sprawdzone na Gotenbergu 9.5.1 (`http://localhost:3010`): paragon, potwierdzenie przejazdu, protokół serwisowy (wcześniej 2 strony) i karta hulajnogi z danymi przykładowymi mają po 1 stronie; test w `gotenberg.integration.test.ts` liczy strony PDF.
- **D7 (zapis pól wersji startowej):** `build.mjs` zapisuje w `manifest.json` ścieżki jak inspekcja API (`parts[].sku`, warunek w pętli z zakresem pętli, posortowane), więc seed zapisuje w `document_template_versions.fields` ten sam format co wgranie przez API. Test zgodności: pola z manifestu = `usedFields` z `inspectTemplate` dla każdego pliku startowego. Starsze wersje startowe w bazie zostają w dawnym zapisie (wersje są niezmienne).
- **C1 (ETag nowszy niż dane):** `GET /content/{client}` czyta wszystko w jednej transakcji `REPEATABLE READ` tylko do odczytu, a `ETag` to `"content-{hash}"` ze skrótu SHA-256 treści (pole `hash` odpowiedzi, bez `revision`). Aplikacja zapisuje skrót, po każdym `content.updated` wysyła żądanie warunkowe bez porównywania rewizji, a ten sam skrót nie przerysowuje ekranów. Test e2e: zmiana w niezatwierdzonej transakcji podbija licznik, ale ETag i `304` zostają.
- **C2 (dublujące się `content.news-boundary`):** zadanie ma okno singletonu doby bez przesuwania do następnego okna (`singletonNextSlot: false`, `startAfter` zostaje granicą) i czas granicy w danych; obsługa pomija granicę, która już nie obowiązuje (`isNewsBoundaryCurrent`). Poprawiony komentarz w `core/content/news.ts`. Testy core, e2e i na prawdziwym pg-boss (jeden wiersz w `pgboss.job`).
- **C3 (adres przycisku):** `CHECK content_blocks_cta_url` z wzorcem `ALLOWED_HREF_PATTERN` (bez ukośnika wstecznego i znaków sterujących, do 2000 znaków); strona pokazuje przycisk hero, komunikatu i sklepu tylko przy `isAllowedHref`. Test bazy porównuje CHECK z `isAllowedHref` (m.in. `/\evil.com`).
- **C4 (EXIF w grafikach biblioteki):** `stripImageMetadata` w core usuwa z JPEG APP1 (EXIF, XMP), APP13, komentarze, inne APPn i dane po EOI (zostaje JFIF, ICC i Adobe, orientacja w minimalnym APP1), z PNG `eXIf`/`tEXt`/`iTXt`/`zTXt`/`tIME` i dane po `IEND`, z WebP `EXIF`/`XMP ` z flagami `VP8X`; suma SHA-256 i rozmiar z oczyszczonego pliku. Testy core i e2e.
- **C5 (wyścig minimalnej szerokości):** `widths()` blokuje wiersze grafik `FOR SHARE OF m`, więc „Zastąp plik” (`FOR UPDATE`) czeka na zapis sekcji. Test bazy z dwoma połączeniami.
- **C6 (grafika modelu a `/h/{numer}`):** zmiana opisu albo pliku grafiki użytej przez model planuje też `site.revalidate` z tagiem `scooters`. Test e2e.
- **C7 („Przywróć” sekcji a `CONTENT_DELETE_PUBLISHED`):** edytor dokłada elementy opublikowane dziś, których nie ma w przywracanej wersji, jako archiwalne i mówi o tym w komunikacie (`content.history.archivedOnRestore`).

**Potrzebne zmiany odłożone**
- **API i shared (dla panelu):**
  - liczba pól aktywnej wersji i wydruki z 30 dni w `v_document_templates` (dziś osobne zapytania na szablon);
  - etykiety parametrów i opis szablonu w `DocumentTypeView`;
  - punkt pulpitu dla grupy „Treści” (dziś liczby z zasobów list);
  - edycja nazwy i opisu oraz dezaktywacja szablonu wydruku (z macierzy operacji, bez punktu API);
  - przyczyna korekty paragonu w `v_doc_receipt`.
- **Aplikacja:** komunikat `mobile.notice` (makieta i ekran); godziny pomocy w danych startowych zaczynają się wielką literą („Pomoc odpowiada Codziennie …”), do poprawy w tekście albo w danych.
- **Eksport danych:** zdjęcia tylko jako metadane (ADR 0069); pełne pliki zdjęć po ocenie prawnej autora.
- Odłożone zmiany z iteracji 6 (D7) bez zmian.

**Weryfikacja**
- Testy po etapach: db 85 → 86, core 291, shared 136, api 211 (treści) → 242 (dokumenty i eksport). Nowe testy API:
  - `content.e2e.test.ts` (22), `media.e2e.test.ts` (4), pomocnik `content-helpers.ts`;
  - `documents-engine.test.ts` (10), `templates.e2e.test.ts` (7), `documents.e2e.test.ts` (8), `data-export.e2e.test.ts` (4), pomocnik `document-context.ts`;
  - `gotenberg.integration.test.ts` (2), uruchamia się tylko przy odpowiadającym `GOTENBERG_URL`, więc w CI bez Gotenberga jest pomijany.
- Po poprawkach z przeglądu (`pnpm test`, 8 zadań turbo): core 299, shared 136, symulator 54, db 87, api 257. `pnpm --filter @hulajnogi/web build` przechodzi. Panel i aplikacja po swoich etapach: lint, typy, build panelu i `expo export --platform web` przechodzą.
- Końcowy przebieg po poprawkach (koordynator, 19 listopada 2026): `pnpm lint && pnpm typecheck && pnpm test && pnpm build` przechodzi; testy core 299, shared 136, symulator 54, db 87, api 257. Zielone CI: do uzupełnienia przy wypchnięciu.
- Koordynator w przeglądarce na serwerach deweloperskich (API `nest start --watch` na 3001, symulator, `next dev` na 3002): strona główna z treści z bazy, lista bloków treści, ekran Wydruki z czterema szablonami (aktywne wersje startowe po poprawkach) i dwoma rodzajami bez szablonu; przez API zapis sekcji `web.hero` z grafiką startową 857 px przechodzi przy progu 760 px (ADR 0070).
- W przeglądarce (API z buildu na 3001 `api-local`, panel z `next start` na 3006 `web-start`, aplikacja web na 8082 `mobile-web-local`, Gotenberg na 3010):
  - strona: główna, `/regulamin` z wersjami (bieżąca `/regulamin/wersja/1` → `307`), aktualności, `/h/7` → `/h/0007`, `/h/99999` → 404, 404, `sitemap.xml`, `robots.txt`, `/api/revalidate` bez sekretu `401`; kolejne żądania strony nie wołają API (cache);
  - panel, treści: lista bloków, edytor hero z błędem Markdown, wybór grafiki (760 px), sekcja-lista `mobile.rules`, FAQ (szkic, „Przywróć”, zapis), aktualności, media, dane firmy, dokumenty prawne, model ze zdjęciem; po przebudowie API zapis sekcji (`PUT`, 200 dwa razy) i kolejność FAQ (`PUT …/order`, 200);
  - panel, wydruki (Administrator): lista szablonów, podgląd PDF w `<object>`, wgranie błędnego DOCX (422, okno „Szablon ma 2 błędy” z miejscem „Akapit 1: …”) i poprawnego (nowa wersja „Do aktywacji”), aktywacja i „Przywróć”, „Drukuj” protokołu zadania (gotowe 88 KB, stopka z identyfikatorem i wersją, `document.ready` w `staff:{id}`), naklejka QR #0001 (A4, 6 sztuk, 58 KB), Wygenerowane z wyszukiwaniem po 8 znakach, „Drukuj” na przejeździe, karta „Eksporty danych” na profilu klienta;
  - aplikacja: `/witaj`, `/zasady`, `/pomoc` z siecią i bez, pierwsze uruchomienie bez sieci, `/cennik`; `curl` z `If-None-Match` → `304`; eksport danych (`202`, przygotowanie, gotowy 16 KB, limit „Nowy plik zlecisz jutro od …”, wiersz w ustawieniach); paragon PDF (`202`, gotowy 76 KB z Gotenberga, ponowne użycie `200`, brak sieci ze „Spróbuj ponownie”, arkusz z „Otwórz” przy zablokowanym `window.open`).
- Gotenberg 9.5.1: szablony startowe z danymi przykładowymi mają po 1 stronie (po poprawce D6), polskie znaki i osadzony Inter (test integracyjny).

**Niesprawdzone**
- Aplikacja natywna: pamięć treści w Async Storage, pobranie (`File.downloadFileAsync`), `Sharing.shareAsync`, `File.preview`, odnośnik `hulajnogi://hulajnoga/{numer}` z `/h/{numer}`.
- Panel w przeglądarce: stan „Błąd” wydruku, „Ponów” i „Wygeneruj ponownie”, wydruk paragonu i korekty salda (brak danych w bazie deweloperskiej), drugi zapis kolejności FAQ, pulpit Redaktora (brak konta), `/api/revalidate` z poprawnym sekretem (odświeżenie strony na żądanie po zapisie w panelu).
- Aplikacja w przeglądarce: `content.updated` na żywo, błąd zadania PDF po stronie serwera, `429` przez interfejs, dotknięcie powiadomienia `data_export_ready`.
- Poprawki po przeglądzie (C1, C7, D1 w panelu i aplikacji) sprawdzone testami i buildem, bez zapisu o ponownym przeklikaniu w przeglądarce.

**Sprawy dla autora**
- `pnpm infra:up` (buduje obraz Gotenberga) i `pnpm db:migrate`, `pnpm db:seed` w innych środowiskach; seed wymaga SeaweedFS.
- `SITE_REVALIDATE_URL` i `SITE_REVALIDATE_SECRET` w `.env`, żeby strona odświeżała się zaraz po zapisie w panelu (bez nich po 5 min).
- Prawdziwe dane firmy w panelu (Treści → Dane firmy): w bazie deweloperskiej adres i NIP są puste.
- Konto z rolą Redaktor do demo (Operatorzy → „Zaproś operatora”).
- Decyzja, czy Redaktor może publikować dokumenty prawne (ADR 0062: dziś tak, z ponowną akceptacją u klientów), i ocena eksportu danych bez zdjęć (ADR 0069).
- Szersze rendery hero, jeśli próg ma wrócić do 1200 px (ADR 0070).
- Development build aplikacji (bez zmian od iteracji 3), konto Stripe w trybie testowym (bez zmian).

**Uwagi**
- Dane testowe w bazie deweloperskiej po sprawdzeniach w przeglądarce:
  - agent aplikacji wstawił i usunął paragon testowy `PAR/2026/000001`: sekwencja numerów paragonów jest przesunięta o 1, a plik PDF i wiersz `files` zostały;
  - klient testowy z danych startowych ma gotowy eksport danych (limit 24 h);
  - Protokół serwisowy ma archiwalną testową wersję 3, nagłówek sekcji `admin.scooter-label` ma wersję rekordu 3 (dwa zapisy z treścią wersji 1), a operator testowy 3 wydruki.

**Wypchnięcie**
- Iteracja 7 w sześciu commitach `8e63b12`–`66a9ced` na `main`; CI zielone 19 listopada 2026 (przebieg 44475249840).

## Plan iteracji 8: raporty i domknięcie panelu (19 listopada 2026)

Plan: [iteracja 8](iteracje/iteracja-08-raporty-domkniecie-panelu.md). Etap planowania, bez kodu i bez makiet.

**Co powstało**
- Plan iteracji 8. Cel: sześć raportów z ADR 0029 z parametrami, podglądem w panelu i eksportem PDF (Chromium w Gotenbergu) i XLSX (ExcelJS) zadaniem w tle, historia uruchomień i definicje raportów w panelu; pulpit z wykresami; „Eksportuj” do XLSX i CSV na każdej liście; pozostałe tabele z macierzy operacji w panelu. Granice z iteracją 7 (Gotenberg, `DocumentRenderer`, wzór zadań) i 9 (testy obciążeniowe, spis widoków), zakres migracji 0013, kolejność kroków i szkic scenariusza demo w 9 krokach.
- Tabela pokrycia tabel w panelu (wymaganie 12): co ma dziś listę, co jest tylko w szczegółach rekordu nadrzędnego, a co nie ma miejsca w panelu (`otp_codes`, `saved_places`, `telemetry`, `scooter_commands`, `scooter_zone_presence`, `scooter_zone_control`, `payment_customers`, `report_definitions`, `report_runs`).
- 9 brakujących makiet w trzech katalogach: `32-panel-raporty`, `33-panel-pulpit`, `34-panel-domkniecie`.
- 6 ADR-ów do napisania (0071–0076), 15 pytań do autora i 8 decyzji z rekomendacją (D1–D8), lista sprawdzeń przed ADR-ami.

**Wnioski z przeglądu kodu, migracji i makiet**
- **Tabele raportów czekają od migracji 0002.** `report_definitions`, `report_runs`, typ `report_format` i sześć uprawnień `reports.*` z przydziałami ról istnieją, ale są puste i nieużywane; widoki `v_daily_revenue`, `v_zone_usage`, `v_scooter_reliability` nie mają parametrów okresu, więc D1 proponuje funkcje `fn_report_*`.
- **„Przychód” liczony z przejazdów, nie z paragonów.** `v_daily_revenue` sumuje `rentals.total_amount`, a sprzedaż z VAT według stawek, korekty i opłata za odholowanie poza VAT są w paragonach (ADR 0052, 0061). Pytanie 2 proponuje raport z częścią „sprzedaż” i „wpływy”.
- **Brak historii stanów hulajnogi.** `scooters.status` i `online` mają tylko bieżącą wartość, więc raportu wykorzystania floty (czas w serwisie, bez łączności) nie da się policzyć wiarygodnie. D4 proponuje tabelę z wyzwalaczem (ADR 0074).
- **Puste dane deweloperskie.** Baza ma kilka przejazdów z przeklikania; raporty za miesiąc byłyby puste. Pytanie 12 proponuje deterministyczny generator historii przez procedury bazy (ADR 0075), przydatny też w testach obciążeniowych iteracji 9.
- **Uprawnienie do definicji raportów.** Macierz przewiduje `content.write`, przez co Redaktor zmieniałby nazwy raportów, których nie widzi; pytanie 8 proponuje `reports.manage`.
- **Wykresy bez biblioteki.** Panel nie ma biblioteki wykresów, a PDF powstaje z HTML w API. D2 proponuje wspólną geometrię w `packages/shared` i dwa renderery (React SVG, tekst SVG), żeby panel i PDF wyglądały tak samo bez `dangerouslySetInnerHTML`.
- **Eksport list a dane osobowe i formuły.** Eksport musi maskować dane jak lista, zapisać wpis w dzienniku audytu i chronić przed wstrzyknięciem formuł w XLSX i CSV (D6, ADR 0073).
- **ExcelJS** nie miał wydań od października 2023 (ADR 0029); przed ADR 0071 trzeba sprawdzić wersję, ESM pod NestJS 12 i zapis strumieniowy.

**Do zrobienia przed implementacją**
- Odpowiedzi autora na pytania 1–15 i decyzje D1–D8.
- Makiety brakujących stanów w trzech katalogach.
- Sprawdzenia przed ADR-ami (wersje starsze niż 3 dni): ExcelJS, nagłówki i stopki stron w Chromium Gotenberga, wyzwalacz historii stanów a aktualizacje `online`, czas generatora danych.
- ADR 0071–0076.

**Odpowiedzi autora (19 listopada 2026)**
- Autor przyjął wszystkie rekomendacje: pytania 1–15 i decyzje D1–D8 bez zmian (tabela w [planie](iteracje/iteracja-08-raporty-domkniecie-panelu.md#odpowiedzi-autora-19-listopada-2026)). Najważniejsze skutki: nowe uprawnienie `reports.manage`, tabela `scooter_status_history`, generator danych historycznych `pnpm db:history`, wykresy z własnej geometrii w `packages/shared`, eksport list synchronicznie strumieniem.
- Następny krok: makiety w `32-panel-raporty`, `33-panel-pulpit`, `34-panel-domkniecie`.

**Makiety (19 listopada 2026)**
- 21 plansz panelu 1440×900 w trzech katalogach ([spis makiet](projekt/README.md#panel-operatora-raporty-pulpit-i-domknięcie-iteracja-8)):
  - `32-panel-raporty` (8): katalog, przychody z podglądem, przejazdy według stref i godzin z mapą ciepła, stany podglądu, okno eksportu ze stanami, historia uruchomień, definicja, strony PDF A4 pionowo i poziomo;
  - `33-panel-pulpit` (3): Administrator, Serwisant, Redaktor;
  - `34-panel-domkniecie` (10): okno eksportu listy, telemetria, komendy, historia stanów na karcie hulajnogi, zgody, sesje, kody SMS, zaproszenia i sesje operatorów, uprawnienia z opisem, edycja i dezaktywacja szablonu wydruku.
- Spis ekranów: 193. Plansze przygotowało trzech agentów równolegle, a PNG wyrenderował Chrome headless. Wszystkie PNG obejrzane.
- Poprawki koordynatora: plansza komend miała 312 hulajnóg zamiast 240 w ruchu (243 z wycofanymi) jak pozostałe; słupki pulpitu przyciemnione z betonu do `#6B6E75`, jak w raportach (beton na białym ma kontrast poniżej 3:1).
- Luki ze schematu i rozbieżności między planszami zebrane w planie w sekcji „Do rozstrzygnięcia w ADR 0071–0076”. Najważniejsze: dwie różne definicje wykorzystania i dostępności (raport floty i karta hulajnogi), brakujące kolumny `report_runs`, źródło komendy w `scooter_commands`, `locked` i `buffered` w telemetrii, retencja telemetrii bez zadania, uprawnienia nowych list inne niż w macierzy.
- Następny krok: sprawdzenia przed ADR-ami i ADR 0071–0076.

**Sprawdzenia i ADR 0071–0076 (19 listopada 2026)**
- **ExcelJS:** najnowsze stabilne wydanie 4.4.0 (19 października 2023), potem tylko `4.4.1-prerelease.0`. Test w katalogu tymczasowym (poza repozytorium), Node 22: import domyślny w ESM działa; `WorkbookWriter` zapisał 50 000 wierszy w 0,46 s (1,06 MB, 129 MB pamięci); formaty kwot i dat, zamrożony wiersz i autofiltr wracają po odczycie. Daty idą jako UTC, więc czas polski trzeba przeliczyć przed zapisem. `npm audit`: `uuid < 11.1.1` (v3, v5, v6 z buforem), a ExcelJS używa tylko `v4`.
- **Gotenberg 9.5.1 (Chromium) na żywo:** A4 poziomo przez `@page`, tabela 120 wierszy na 5 stronach w 0,2 s, powtarzany `thead`, stopka „Strona 2 z 5” z klas `pageNumber` i `totalPages` w `footer.html`, polskie znaki i Inter; stopka ma osobny dokument i układ trzeba w niej zbudować od nowa.
- **Kod:**
  - `online` zmienia tylko wiadomość `status` (`setConnection`), a partie telemetrii nie ruszają `status` ani `online`, więc wyzwalacz historii stanów nie zadziała przy każdej partii; `setConnection` zapisuje też powtórzony stan, więc wyzwalacz porównuje starą i nową wartość;
  - `sp_wallet_post` i `sp_issue_receipt` stemplują `now()`, a księga i paragony są tylko do dopisywania, więc generator historii nie może iść przez procedury (ADR 0075);
  - seed wstawia cennik z `valid_from = now()`;
  - `sp_purge_telemetry` nie ma zadania, które by ją wołało;
  - panel pobiera pliki przez `fetch` i `saveBlob`.
- **ADR-y** (proponowane, do akceptacji autora): 0071 moduł raportów, 0072 wykresy w panelu i w PDF, 0073 eksport list do XLSX i CSV, 0074 historia stanów hulajnogi, 0075 dane historyczne do demonstracji, 0076 domknięcie macierzy operacji.
- **Zmiany planu po ADR-ach** (sekcja w planie):
  - generator bez procedur i bez selektywnego usuwania (zmiana odpowiedzi na pytanie 12);
  - raport stref bez przychodu;
  - jedna definicja wykorzystania i dostępności;
  - eksport list jako `POST` z etykietami z panelu;
  - kolumny `locked` i `buffered` oraz retencja telemetrii w zakresie.
- **Akceptacja:** autor przyjął ADR 0071–0076 i zmiany planu po ADR-ach bez uwag (19 listopada 2026). Następny krok: implementacja według kolejności kroków w planie (krok 4: migracja 0013 i generator).

## Iteracja 8: implementacja (19 listopada 2026)

Plan: [iteracja 8](iteracje/iteracja-08-raporty-domkniecie-panelu.md), decyzje w [ADR 0071–0076](adr/README.md). Pracowali agenci etapami, każdy z raportem dla następnych: baza (migracja 0013), potem równolegle generator danych historycznych oraz core i shared, potem równolegle API raportów i pulpitu oraz API list i eksportu (w osobnym drzewie roboczym), a na końcu równolegle panel raportów i pulpitu oraz panel list (w osobnym drzewie roboczym). Potem dwa przeglądy kodu i dwa równoległe etapy poprawek (niżej). Koordynator scalał gałęzie, rozwiązywał konflikty, dopisywał drobne poprawki i domyka weryfikację.

**Baza (migracja 0013)**
- Uprawnienie `reports.manage` (tylko Administrator). Opis uprawnienia z blokadą optymistyczną (`permissions.updated_at`, `updated_by`, `version`, do 160 znaków); nazwa (do 80 znaków) i opis (do 300) definicji raportu.
- `report_runs`: chwila danych `data_as_of`, `error_code`, liczba wierszy i stron, ponowienie `retry_of`, usunięcie pliku `file_deleted_at`, tylko PDF i XLSX; widoki `v_report_run_list` i `v_report_definitions`.
- Historia stanów (ADR 0074):
  - tabela `scooter_status_history` (przedziały stanu i łączności) z wyzwalaczami AFTER na `scooters`: przedział otwarty przy nowej hulajnodze, zamknięcie i nowy przedział przy zmianie stanu albo łączności, powtórzony stan łączności pominięty;
  - tylko do dopisywania (`STATUS_HISTORY_APPEND_ONLY`), jeden otwarty przedział na hulajnogę, przedziały bez nakładania (`EXCLUDE USING gist`, rozszerzenie `btree_gist`), przedział otwarty dla istniejących hulajnóg;
  - widok `v_scooter_status_history` z przyczyną i kategorią czasu.
- 34 funkcje raportowe i pomocnicze: `fn_report_*` dla sześciu raportów, `fn_report_buckets`, `fn_report_earliest_data`, `fn_scooter_time_category`, `fn_ticket_is_failure`, `fn_wallet_balances_at`, `fn_dashboard_rides_by_hour`, `fn_telemetry_readings` (kursor po czasie).
- Kolumny z ADR 0076 z uzupełnieniem starych wierszy: `consents.source` i `revoked_by_staff`; `sessions.platform` (typ `session_platform`) i `app_version`; `otp_codes.purpose`; `scooter_commands.source` (wyzwalacz uzupełnia źródło przy wstawieniu bez niego) i `zone_id`; `staff_invitations.replaced_by`; `staff_sessions.remembered`; `document_templates.deactivated_at`; `telemetry.locked` i `buffered`.
- Procedury `sp_document_template_deactivate` (`TEMPLATE_IS_DEFAULT`) i `sp_document_template_reactivate`. `v_low_stock_parts` liczy `<` jak core, `v_doc_receipt` ma przyczynę korekty, `v_document_templates` pola aktywnej wersji i wydruki z 30 dni.
- 15 widoków nowych list; indeksy pod funkcje raportowe sprawdzone `EXPLAIN` na danych generatora.
- Stan bazy: 58 tabel, 79 widoków, 58 funkcji, 24 procedury (bez funkcji `btree_gist`; test bazy).
- Odstępstwa od planu i ADR-ów:
  - pliki raportów w istniejącym od 0002 celu `REPORT_EXPORT` zamiast nowego `REPORT` (bez nowej wartości typu);
  - źródło starych komend uzupełnione także dla komend stref z przejazdem (`ZONE`);
  - historia stanów znika kaskadą z usuniętą hulajnogą;
  - raport floty bez rozkładu baterii przy końcu przejazdu (pytanie 1), bo `rentals` nie zapisuje baterii;
  - filtr strefy w raportach bez wartości „poza strefą”;
  - ponad plan: `fn_dashboard_rides_by_hour`, `fn_telemetry_readings`, `report_runs.retry_of`, `v_report_definitions`, ograniczenie wykluczające i typ `session_platform`.
- **Raporty bez JIT:** przy JIT funkcje szeregów trwały 1,3–1,6 s (sama kompilacja JIT ponad 1 s), bez niego wszystkie poniżej 0,35 s na 90 dniach. Repozytorium raportów liczy więc w transakcji `REPEATABLE READ READ ONLY` z `SET LOCAL jit = off` i `statement_timeout`.
- **Zmiana wykonanej migracji:** 0013 zmieniła się po wykonaniu na bazie deweloperskiej dwa razy: jedna funkcja przed commitem bazy (`193da37`), potem indeks `rental_events_zone_exit_idx` po pomiarach (commit generatora `be81eb6`). Suma kontrolna w `schema_migrations` lokalnej bazy poprawiona ręcznie, jak w iteracji 7. Migracja nie trafiła na `main` ani na bazę spoza komputera autora; poprawki po przeglądzie są już w nowej migracji 0014.

**Generator danych historycznych (ADR 0075)**
- `pnpm db:history [--days 90] [--rides-per-day 200] [--seed 2026]` (`packages/db/src/cli/history.ts`, `src/history/`): deterministyczny z ziarna, wstawia wiersze z jawnymi czasami i wartościami z core, jedna transakcja na dobę. Na końcu 17 kontroli spójności (`checks.ts`): salda z księgi, paragony wobec przejazdów, płatności i zwrotów, numery paragonów rosnące z datą, przedziały historii bez nakładania i luk, magazyn z ruchów, udział wjazdów do strefy zakazu.
- Działa tylko na świeżej bazie: `pnpm db:migrate`, `SEED_SAMPLE_RENTALS=0 pnpm db:seed`, `pnpm db:history`. Odmawia przy `NODE_ENV=production` i przy dowolnych przejazdach albo paragonach w bazie (także przykładowych z seeda). 90 dób w 16,8 s.
- Odstępstwa od ADR 0075:
  - wyzwalacz cennika odrzuca `UPDATE` (`TARIFF_IMMUTABLE`), więc generator usuwa nieużytą najstarszą wersję i wstawia ją ponownie z `valid_from` na początku okna;
  - hulajnogi z otwartymi zadaniami z seeda mają w oknie stan z seeda;
  - magazyn z dostawą na początku okna i inwentaryzacją do zera na końcu;
  - numery klientów `+48 100 …` (prefiks wyboru dostawcy, nie numer abonenta);
  - zgody wcześniej niż `published_at` wersji dokumentu;
  - bez usunięć kont.
- Dane z 90 dni (20.08–18.11.2026): 17 925 przejazdów, 17 413 paragonów, 44 598 przedziałów historii stanów, 187 783 zdarzeń przejazdu, 78 670 komend, 17 964 wpisów księgi, 10 514 płatności, 64 zwroty, 507 zgłoszeń, 1 828 zadań, 1 203 klientów. Baza demonstracyjna `hulajnogi_history` na lokalnym Postgresie.

**Core i shared**
- **Core (`packages/core/src/reports`):**
  - katalog `REPORT_CATALOG` (sześć raportów: kod, uprawnienie, parametry, formaty, kafelki, wykresy, tabele, kolumny z typem wartości) i limity `REPORT_LIMITS` (okres do 366 dni, podgląd 200 wierszy i 15 s, PDF 50 wierszy, zadanie 120 s, retencja pliku 30 dni);
  - parametry w Europe/Warsaw (gotowe zakresy, granulacja dobierana do długości okresu, porównanie z poprzednim okresem), port `ReportsRepository`, budowanie modelu raportu z wierszy (`build-*.ts`), reguły uruchomień (ponowienie, przejęcie, retencja);
  - czas hulajnogi według kategorii i wskaźniki floty (`scooter-time.ts`: wykorzystanie, dostępność, MTBF);
  - port `SpreadsheetWriter` i eksport list (`list-export.ts`: limit 50 000 wierszy, 17 280 dla telemetrii, partie po 1000, 3 eksporty naraz, ochrona przed formułami, CSV ze średnikiem i BOM);
  - katalog kafelków pulpitu (`dashboard.ts`: 7 kafelków, rola widzi najwyżej 5 dozwolonych, segmenty stanu floty, „Twoje zadania”).
- **Shared:**
  - geometria wykresów w `packages/shared/src/charts` (skale, podziałki, słupki, mapa ciepła, pasek udziałów jako dane kształtów bez DOM); kolory wykresów w `docs/projekt/tokens.json` (`color.chart`, w tym rezerwacja `#AEB6FB`);
  - schematy raportów i pulpitu, zdarzenie `report.ready`, schemat żądania eksportu listy (`admin/export.ts`);
  - 15 nowych zasobów list (`admin/system-lists.ts`, `admin/reports.ts`); pola `personal` (dane klienta do maskowania i ostrzeżenia w oknie eksportu) i `money` (kwota w groszach jako liczba w złotych) w `FieldDefinition`, `money` ponad ADR 0073.
- Seed `report_definitions` według D3: wstawia brakujące wiersze z nazwą i opisem z katalogu, aktualizuje parametry i formaty, nie rusza nazwy, opisu, aktywności i kolejności; wpis w dzienniku audytu `report_definition.created` albo `report_definition.synced` z `data.source = 'catalog'`.

**API: raporty i pulpit**
- Moduł `reports` (`apps/api/src/reports`):
  - `GET /admin/reports` (katalog według uprawnień), `GET /admin/reports/{code}/preview` (podgląd w jednej migawce z limitem 15 s, `REPORT_TIMEOUT`), `POST /admin/reports/{code}/runs` (`202`, wpis `report_run.requested`, pusty raport `409 REPORT_EMPTY`);
  - `GET /admin/report-runs` (historia na kontrakcie list, także cudze uruchomienia raportów z uprawnieniem), `GET /admin/report-runs/{id}`, `GET …/{id}/file` (`409 REPORT_RUN_NOT_READY`, `410 REPORT_FILE_DELETED`), `POST …/{id}/retry` (nowy wiersz z `retry_of`);
  - `GET /admin/report-definitions`, `GET` i `PATCH /admin/report-definitions/{code}`, `POST /admin/report-definitions/reorder` z `reports.manage` i blokadą optymistyczną (wpisy `report_definition.updated`, `report_definitions.reordered`).
- **PDF:** HTML raportu w API funkcjami z ucieczką znaków (`report-html.ts`), wykresy jako tekst SVG z geometrii shared (`chart-svg.ts`), A4 pionowo albo poziomo, stopka „Strona X z N” w `footer.html` przekazanym jako `assets`, `htmlToPdf` w Gotenbergu z `RenderOptions.timeoutMs` (60 s).
- **XLSX:** ExcelJS 4.4.0 za portem `SpreadsheetWriter` (wspólny adapter `apps/api/src/common/spreadsheet/exceljs-writer.ts`), arkusz na tabelę i arkusz „Parametry”, kwoty jako liczby z formatem złotych, daty jako daty Excela w czasie polskim.
- Zadania: `report.generate` (żeton przejęcia `started_at`, zapytanie do 60 s, łączny limit migawki 45 s przez `statement_timeout` na resztę limitu, `REPORT_LIMITS.jobSnapshotTotalMs`), `reports.sweep` (co 5 min, porzucone po 15 min kończą się `REPORT_TIMEOUT` z `report.ready`), `reports.retention` (03:40 UTC, pliki po 30 dniach, wiersz zostaje).
- `report.ready` w pokoju `staff:{id}` zlecającego (Socket.IO 1.7.0); panel odpytuje `GET /admin/report-runs/{id}` co 2 s jako zapas.
- Pulpit: `GET /admin/dashboard/summary` z kafelkami według uprawnień, przejazdami dziś według godzin ze średnią z czterech poprzednich tych samych dni tygodnia, stanem floty, „Twoimi zadaniami” i grupą „Treści”; pole bez uprawnienia ma `null`.
- Odstępstwa:
  - PDF bez krótkiego nagłówka na kolejnych stronach: pełny nagłówek na pierwszej, nagłówek tabeli (`thead`) i stopka na każdej;
  - czasy w PDF jako „s”, „min” albo „X,X h”;
  - dodatkowe wpisy audytu `report_run.requested` i `report_definitions.reordered`;
  - w raporcie stref kafelek „Odholowania (zakończone w okresie)”.

**API: listy i eksport**
- `POST /admin/{zasób}/export` dla każdej listy wzorca (47 punktów; `apps/api/src/common/list-export/`, dekorator `@ListExport`): te same funkcje list i to samo maskowanie co `GET`, kolumny z etykietami z panelu w treści żądania, limit 50 000 wierszy (`422 LIST_EXPORT_LIMIT` z liczbą wierszy), wpis `list.exported`, zapis strumieniem w odpowiedzi (CSV wiersz po wierszu, XLSX `WorkbookWriter`).
- Nowe listy z poleceniami z ADR 0076 (adresy w [OpenAPI](kontrakty/openapi.json)):
  - Użytkownicy: zgody (wycofanie zgody marketingowej, `consent.revoked`), sesje (unieważnienie, `session.revoked`), kody SMS (bez kodu, „Usuń wygasłe” z podglądem liczby, `otp.purged`), zapisane miejsca na karcie klienta (usunięcie, `saved_place.deleted`);
  - Operatorzy i role: sesje i zaproszenia operatorów (unieważnienie, ponowne wysłanie), uprawnienia z edycją opisu (`permission.updated`);
  - Flota: telemetria (`fn_telemetry_readings`, hulajnoga i zakres czasu wymagane, kursor bez `total`), komendy, historia stanów (`GET /admin/scooter-status-history`);
  - Przejazdy → Zdarzenia, Strefy → Obecność w strefach i Komendy stref, Płatności → Klienci operatora;
  - Wydruki: edycja nazwy i opisu (`PATCH /admin/document-templates/{id}`), dezaktywacja i ponowna aktywacja szablonu.
- Zmiany kontraktu:
  - katalog uprawnień przeniesiony z `GET /admin/permissions` na `GET /admin/permissions/catalog` (`GET /admin/permissions` to teraz lista);
  - `POST /auth/otp/verify` i `POST /auth/refresh` przyjmują opcjonalne `platform` i `appVersion`;
  - `TEMPLATE_NAME_TAKEN` także przy tworzeniu szablonu.
- Wycofanie zgody przez operatora nie wysyła zdarzenia do klienta. `zone_id` w komendach stref tylko wtedy, gdy przyczyną jest jedna strefa.
- Kontrakty: `openapi.json` odtworzony, `asyncapi-realtime.yaml` 1.7.0.

**Panel**
- **Analiza → Raporty** (`/admin/raporty`): katalog według uprawnień, strona raportu `/raporty/[kod]` z parametrami w adresie, kafelkami, wykresami z dymkami, tabelami i stanami (ładowanie, brak danych, za długi okres, błąd), okno eksportu PDF i XLSX z `report.ready`, Historia (`/raporty/historia`) z ponowieniem i eksportem listy, Definicje (`/raporty/definicje` i `/raporty/definicje/[kod]`) z zapisem i kolejnością.
- **Pulpit** z kafelkami, przejazdami według godzin, stanem floty, „Twoimi zadaniami” i grupą „Treści”, obok „Wymaga uwagi”; odświeżanie co 60 s i po zdarzeniach `fleet`.
- Wspólny komponent wykresu `apps/web/components/admin/charts/chart.tsx` (React SVG z geometrii shared, „Pokaż jako tabelę”).
- „Eksportuj” w `ResourceList` i `InlineList` (`components/admin/list-export.tsx`, `apiDownload`) z oknem formatu, liczbą wierszy, limitem i ostrzeżeniem o danych osobowych.
- Zakładki obszarów (`areas.tsx`, `area-tabs.tsx`) i nowe listy: Flota (Telemetria, Komendy), Klienci (Zgody, Sesje, Kody SMS), Operatorzy (Sesje, Zaproszenia), Uprawnienia, Przejazdy (Zdarzenia), Strefy (Obecność w strefach, Komendy stref), Płatności (Klienci operatora); historia stanów na karcie hulajnogi, zapisane miejsca na karcie klienta, edycja i dezaktywacja szablonu wydruku.
- Style w `app/admin/analytics.css` i `lists.css`. `pl.json`: 3850 → 5191 kluczy.

**Aplikacja**
- Komunikat `mobile.notice` jako baner na mapie (`components/content-notice.tsx`, nowa plansza `31-mobile-tresci/komunikat`); zamknięcie pamiętane po skrócie treści, zmiana treści w panelu pokazuje go ponownie.
- Godziny pomocy: tekst aplikacji „Godziny pomocy: {hours}” zamiast zdania „Pomoc odpowiada {hours}.”, które z danymi startowymi dawało wielką literę w środku.
- Dane urządzenia przy logowaniu i odświeżeniu sesji (`lib/device-info.ts`): platforma, wersja aplikacji i model z `expo-device`, bez nazwy nadanej przez właściciela (często imię i nazwisko). `pl.json`: 941 → 942 klucze.

**Decyzje podjęte przy implementacji**
- **Wpływy:** płatności minus zwroty na kartę; zwrot do portfela nie jest wypływem, bo pieniądze zostają u operatora.
- **Pulpit:** zawsze 24 słupki godzin, także w dobie zmiany czasu. Grupa „Treści” tylko dla roli bez kafelków operacyjnych (Redaktor), „Twoje zadania” dla `service.read` bez `rentals.read`.
- **Pole `money`** w definicji zasobu (ponad ADR 0073): eksport zapisuje kwotę jako liczbę w złotych z formatem, a nie tekst.
- **Filtr spoza raportu** daje `400 REPORT_PARAM_NOT_SUPPORTED` z `details.param` (po przeglądzie), zamiast cicho go pominąć.

**Sprostowania ADR (ADR bez zmian)**
- **ADR 0071, raport stref bez przychodu:** uzasadnienie, że Dyspozytor nie ma `payments.read`, jest nieprawdziwe (ma je od migracji 0002). Decyzja zostaje z innego powodu: kwoty przychodu należą do raportu przychodów (`reports.revenue`), którego Dyspozytor nie ma.
- **ADR 0076, retencja telemetrii:** ADR twierdzi, że `sp_purge_telemetry` nie woła żadne zadanie. W rzeczywistości woła ją zadanie `telemetry.purge` (codziennie o 3:00, ADR 0037) z 90 dniami; nowego zadania `telemetry.retention` z planu nie dodano.
- **ADR 0074, doprecyzowanie po przeglądzie:** wykorzystanie i dostępność liczą się względem czasu z historią stanów poza wyłączeniem z ruchu (`tracked_seconds − retired_seconds`), z adnotacją w opisie tabel, gdy część okresu nie ma historii. Czas przejazdów sprzed historii wchodzi tylko do MTBF.
- **ADR 0071, porównanie miesięcy:** zakres kończący się ostatnim dniem miesiąca porównuje się z całym poprzednim miesiącem (ADR opisał tylko przypadek odwrotny).
- **ADR 0073, zamaskowane dane klienta w pliku:** komórki są puste, a nie „Klient”; okno eksportu w panelu to mówi.

**Odstępstwa od makiet**
- **Raporty:**
  - kafelek katalogu bez nazwiska zlecającego ostatnie uruchomienie;
  - raport stref: „Strefy ze sterowaniem” jako tabela, mapa ciepła w parze z „Zakończeniami według trybu”;
  - sekcje raportu w prostym układzie: szerokie na całą szerokość, reszta parami;
  - przychody bez przypisu „Saldo portfeli”;
  - Historia z wyszukiwarką i panelem filtrów zamiast chipów, bez filtra „Zlecił” (jest szybki filtr „Moje”);
  - historia definicji z dziennika audytu (wymaga `audit.read`);
  - skróty dni mapy ciepła z `Intl`, tabele skracają czas do jednej jednostki.
- **Pulpit:** bez podpisu wartości nad bieżącym słupkiem, „Pokaż jako tabelę” pod wykresem.
- **Listy:**
  - komendy stref jako dwie zakładki („Obecność w strefach”, „Komendy stref”), strona stref z mapą bez pasa zakładek;
  - wycofanie zgody i opis uprawnienia w wysuwanym panelu;
  - sesje operatorów bez oznaczenia „bieżąca sesja” (API nie zwraca identyfikatora bieżącej);
  - telemetria bez pinezki „pokaż na mapie”, „Eksportuj” w nagłówku po wyborze hulajnogi;
  - szablony wydruków z kolumną „Pola” i bez panelu „Filtry”;
  - lista komend bez drugiej linii z ładunkiem;
  - nazwy plików eksportu z nazwy zasobu (`consents-…`);
  - udziały na karcie hulajnogi liczą przedziały;
  - podtytuł listy Klienci jako opis obszaru;
  - bez `users.read` kolumny klienta pokazują „Klient” i nie sortują się.
- **Aplikacja:** godziny pomocy jako „Godziny pomocy: {hours}” (odstępstwo od plansz `pomoc` i `pomoc-offline`).

**Poprawki koordynatora**
- Scalenie gałęzi etapów API i panelu z osobnych drzew roboczych (konflikty w `apps/web/app/admin/layout.tsx` i `packages/db/src/accounts.test.ts`) i drobne poprawki między etapami.
- **Migracja 0013:** zmiana wykonanej lokalnie migracji z ręczną poprawką sumy kontrolnej (opis w części „Baza”).
- **Spis makiet:** plansza `31-mobile-tresci/komunikat` dopisana do spisu w etapie poprawek, licznik ekranów poprawiony na 194 przy domknięciu dokumentacji.

**Poprawki po przeglądzie iteracji 8 (19 listopada 2026)**

Dwa przeglądy kodu (raporty, pulpit, baza i generator; listy, eksport i aplikacja) i dwa równoległe etapy poprawek (commity `b3d6b0a` i `d4dc1b3`, scalenie `692951e`).

- **Migracja `0014_iteration8_fixes.sql`** (0013 bez zmian, liczby obiektów bez zmian):
  - przyczyna w `v_scooter_status_history`: przejazd wygasły albo nieodblokowany z `ended_at = NULL` dopasowywał się do późniejszych przedziałów; teraz początek z `reserved_at` albo `created_at`, a koniec z przejścia stanu (`STATE_CHANGED`, inaczej `updated_at`);
  - `duration_ms` w `v_report_run_list` i `response_ms` w `v_scooter_command_list` jako `bigint`;
  - `fn_wallet_balances_at` bierze ostatni wpis klienta po `id`, jak wyzwalacz ciągłości księgi;
  - `fn_report_buckets` zwraca datę początku przedziału po przycięciu do okresu;
  - kategorie czasu zaokrąglane z sum narastających, więc suma kategorii równa się czasowi z historią.
- **Raporty:** żeton przejęcia `started_at` w `report.generate` (wynik spóźnionego wykonania jest odrzucany, a jego plik usuwany), łączny limit migawki zadania 45 s, `REPORT_PARAM_NOT_SUPPORTED`, wykorzystanie i dostępność względem czasu z historią (sprostowanie ADR 0074), porównanie miesięcy.
- **Pliki:** `DELETE /files/{id}` odrzuca cele spoza plików wgrywanych przez operatora, a pliki raportów, wydruków i eksportów danych są „przypięte” (luka z iteracji 7).
- **Pulpit:** `GET /admin/dashboard/attention` maskuje nazwiska klientów bez `users.read`.
- **Generator:** trasy omijają strefę zakazu poza zamierzonymi przejazdami (wjazdy spadły z ok. 12% do 1,5%), kontrola udziału poniżej 3% od 1000 przejazdów.
- **Prywatność list:** listy, eksporty i szczegóły przejazdów, płatności, księgi, portfeli, paragonów, kart, webhooków i zwrotów pokazywały imię, nazwisko i telefon klienta roli bez `users.read`. To luka od iteracji 3 i 5, nie decyzja (ADR 0055, 0068 i 0073 mówią o ukryciu klienta). Teraz dane są maskowane (`listWithCustomerData`, `withoutCustomerData`), a filtr i sortowanie po polach klienta bez `users.read` dają `403`.
- **Eksport list:**
  - wpis `list.exported` i sprawdzenie limitu przed transakcją odczytu, więc eksport trzyma jedno połączenie z puli (wcześniej przy pełnej puli eksporty mogły się zakleszczyć);
  - najwyżej 3 eksporty naraz na instancję (`429 LIST_EXPORT_BUSY` z `Retry-After`), `connectionTimeoutMillis` puli 10 s;
  - kolejne partie bez `count(*)`, XLSX czeka na `drain` odpowiedzi;
  - eksport Historii raportów (`POST /admin/report-runs/export`).
- **Wyścigi:** unieważnienie rodziny sesji równoległe z rotacją tokenu (blokady doradcze rodziny i właściciela), równoczesne „Wyślij ponownie” zaproszenia (`409 INVITATION_ALREADY_OPEN`, `INVITATION_NOT_PENDING`).
- **Listy:** stabilny klucz listy obecności w strefach i klientów operatora płatności (`ListSource.id` z kilku kolumn), kursor telemetrii ograniczony do zakresu, `Object.hasOwn` w kolumnach eksportu i parametrach listy, brakujące teksty w `pl.json`.
- **Aplikacja:** platforma, wersja i model urządzenia w sesji; komunikat `mobile.notice` na mapie.

**Potrzebne zmiany odłożone**
- **API i shared (dla panelu):**
  - identyfikator bieżącej sesji w liście sesji operatorów (oznaczenie „bieżąca sesja”);
  - ładunek komendy w `v_scooter_command_list` (druga linia na liście komend);
  - pozycja odczytu do pinezki „pokaż na mapie” w telemetrii;
  - nazwisko zlecającego w ostatnim uruchomieniu w katalogu raportów (`lastRun`);
  - historia definicji raportu bez `audit.read` (dziś z dziennika audytu);
  - filtr „Zlecił” w Historii raportów, krótki nagłówek na kolejnych stronach PDF;
  - etykiety parametrów i opis szablonu w `DocumentTypeView` (z iteracji 7).
- **Raporty:** rozkład baterii przy końcu przejazdu (wymaga zapisu baterii w `rentals`), filtr „poza strefą”, przypis „Saldo portfeli” w przychodach.
- **Eksport danych:** zdjęcia tylko jako metadane (ADR 0069, bez zmian od iteracji 7).
- Odłożone zmiany z iteracji 6 (D7) do decyzji przy iteracji 9 (pytanie 14).

**Weryfikacja**
- Testy (koordynator, 19 listopada 2026): db 125, api 304, shared 162, core 333, symulator 54 (po iteracji 7: 87, 257, 136, 299, 54). Nowe pliki testów:
  - baza: `reports.test.ts`, `reports-repository.test.ts`, `history.test.ts` (generator na 3 dobach z kontrolą spójności, to samo ziarno na drugiej bazie, odmowa w produkcji i na bazie z przejazdami);
  - core i shared: `reports/reports.test.ts`, `charts/charts.test.ts`, `reports.test.ts`, `admin/resources.test.ts`;
  - API: `reports.e2e.test.ts`, `dashboard.e2e.test.ts`, `list-export.e2e.test.ts`, `lists.e2e.test.ts`, `telemetry-admin.e2e.test.ts`, `templates-edit.e2e.test.ts`.
- `pnpm lint`, `pnpm typecheck`, `pnpm build` przechodzą; aplikacja `tsc` i `expo lint` przechodzą.
- Gotenberg 9.5.1 na żywo w teście integracyjnym: raport A4 poziomo, stopka „Strona X z N”, powtarzany `thead`.
- W przeglądarce (agenci panelu, baza `hulajnogi_history`):
  - katalog, sześć raportów za październik z dymkami i stanami (za długi okres, brak danych, błąd), eksport PDF (3 strony) i XLSX, Historia z ponowieniem, Definicje (zapis i kolejność);
  - pulpit w trzech rolach, Serwisant bez raportu przychodów, Redaktor bez Raportów;
  - zgody z eksportem XLSX (205 KB), limit eksportu przy 193 677 zdarzeniach, komendy, historia stanów, szablony, uprawnienia, kody SMS, zaproszenia, karta klienta.
- Podgląd raportów 70–300 ms, render PDF 165–225 ms.

**Niesprawdzone**
- Panel w przeglądarce: polecenia zmieniające dane (wycofanie zgody, unieważnienia, usunięcie kodów i miejsc, dezaktywacja szablonu; pokryte testami API), stany okna eksportu „W kolejce”, „Generowanie”, „Błąd” i „Plik usunięty” (testy API), konflikt wersji definicji, przeciąganie myszą, tryb ciemny.
- Telemetria na prawdziwych odczytach (baza z generatora nie ma telemetrii).
- Komunikat `mobile.notice` w działającej aplikacji i aplikacja natywna (development build).
- Ciasteczko `admin_refresh` na `localhost` jest wspólne dla portów, a CORS poza produkcją wpuszcza każdy `http://localhost:*`, więc przy dwóch panelach naraz (np. 3002 i 3007) sesje się mieszają. Dotyczy tylko środowiska deweloperskiego.

**Sprawy dla autora**
- Wypchnięcie gałęzi `iteracja-8`, zielone CI i scalenie do `main`.
- Baza demonstracyjna do obrony: nowa baza, `pnpm db:migrate`, `SEED_SAMPLE_RENTALS=0 pnpm db:seed`, `pnpm db:history` (procedura w [scenariuszu demo](iteracje/iteracja-08-raporty-domkniecie-panelu.md#scenariusz-demo)); generator nie dopisze danych do bazy z przejazdami.
- Opublikowanie komunikatu `mobile.notice` w panelu (Konfiguracja → Treści → Bloki treści, sekcja `mobile.notice`), jeśli ma być widoczny; dane startowe go nie mają.
- Rola z `payments.read` bez `users.read` (np. własna rola księgowa) widzi teraz w płatnościach „Klient” zamiast imienia i nazwiska (poprawka prywatności).
- Ocena progów mapy ciepła i limitów raportów (wartości w nawiasach na planszach: limit podglądu 15 s, renderu 60 s, 50 wierszy tabeli w PDF, telemetria do 24 h).
- Development build aplikacji (bez zmian od iteracji 3), konto Stripe w trybie testowym (bez zmian).

**Uwagi**
- Konfiguracje w `.claude/launch.json` dla bazy demonstracyjnej: `api-history` (API z buildu na 3005 na bazie `hulajnogi_history`, bez MQTT, z kolejką zadań), `web-reports` (`next dev` na 3007 z API na 3005) i `web-reports-start` (`next start` na 3009). Adres bazy w `api-history` ma port 5433 z komputera autora.
- Generator nie działa na bazie deweloperskiej z przejazdami z przeklikania (odmowa), więc raporty z danymi pokazuje tylko osobna baza `hulajnogi_history`.

**Wypchnięcie**
- Iteracja 8 w commitach `80e66a5`–`83d223f` na gałęzi `iteracja-8`, scalona do `main` przewinięciem i wypchnięta 20 listopada 2026; CI zielone 20 listopada 2026 (przebieg 44716569333, zadanie „Lint, typy, testy, build”).
