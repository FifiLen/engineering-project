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
