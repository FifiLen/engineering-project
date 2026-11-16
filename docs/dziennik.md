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

