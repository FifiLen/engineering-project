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
