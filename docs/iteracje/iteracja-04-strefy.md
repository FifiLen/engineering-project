# Iteracja 4: strefy

**Status:** plan (17 listopada 2026); decyzje autora przyjęte 17 listopada 2026 ([odpowiedzi](#odpowiedzi-autora-17-listopada-2026)); makiety gotowe 17 listopada 2026; czeka na ADR 0043–0048

## Cel
Operator rysuje i zmienia strefy w panelu: obszar działania, strefy parkowania, wolnej jazdy i zakazu. Zmiana działa od razu w aplikacji, w symulatorze i w trwających przejazdach. W trakcie jazdy API wykrywa z telemetrii wjazd i wyjazd ze strefy i zapisuje je na osi czasu przejazdu. Wysyła też hulajnodze komendę limitu prędkości albo stopniowego zatrzymania, a klientowi komunikat na ekranie jazdy, jak w makiecie `przejazd-strefa`. Aplikacja dostaje legendę stref, prowadzenie do najbliższej strefy parkowania, trasę do hulajnogi i wyszukiwanie celu „Dokąd jedziesz?”, czyli rzeczy odłożone w iteracji 3.

Granice z sąsiednimi iteracjami:
- **Iteracja 5:** opłata za parkowanie poza strefą (`out_of_zone_fee`), cennik zależny od strefy i obciążenie portfela.
- **Iteracja 6:** utrata łączności w strefie, zgłoszenia o źle zaparkowanej hulajnodze, ekran symulatora w panelu i powiadomienia push o strefach.
- **Iteracja 8:** raport „przejazdy według stref i godzin” (`v_zone_usage`, uprawnienie `reports.rides_by_zone`).

Wymagania uczelni:
- **12:** `zones` w panelu z tworzeniem, edycją, dezaktywacją, filtrowaniem i sortowaniem według [macierzy operacji](../model-danych/README.md#operacje-w-panelu-dla-każdej-tabeli).
- **13:** reguły stref w procesie wypożyczenia: start, jazda i zakończenie.
- **14:** edytor stref w panelu, ekrany stref w aplikacji.
- **3c:** reguły stref i wykrywanie zmian w `packages/core`.
- **8:** nowe widoki i funkcje bazy.

## Stan wyjściowy
Ta iteracja nie zaczyna od zera:
- **Baza (migracje 0001 i 0002):**
  - tabela `zones` ma `MultiPolygon` z indeksem GiST, typy `SERVICE_AREA`, `PARKING`, `SLOW` i `NO_RIDE`, limit dla `SLOW`, pojemność dla `PARKING`, flagi `visible_in_app` i `active`, wersję rekordu i autora zmiany;
  - funkcja `fn_zones_at_point` zwraca strefy w punkcie od najbardziej restrykcyjnej;
  - typ `rental_event_type` ma już `ZONE_ENTERED` i `ZONE_EXITED`;
  - są uprawnienia `zones.read` i `zones.write`.
- **Core:** `evaluatePosition` zwraca `canRide`, `canPark` i najniższy limit prędkości. Iteracja 3 używa jej przy zakończeniu (`OUTSIDE_PARKING` z najbliższą strefą).
- **API:**
  - `GET /zones` zwraca GeoJSON aktywnych stref;
  - `GET /zones/lookup` zwraca strefy w punkcie;
  - komendy `SPEED_LIMIT` i `STOP_GRADUALLY` są w kontrakcie MQTT, ale panel nie może ich wysłać (`ensurePanelCommandAllowed`).
- **Symulator:** stosuje `speed_limit` i `stop_gradually`. Nie wie jednak, gdzie są strefy: strefy parkowania czyta z `packages/db/seed/rybnik-places.json`, nie z bazy.
- **Dane startowe:**
  - strefy to okręgi (`ST_Buffer`) wokół sprawdzonych punktów: P-01…P-05, S-01 „Okolice Rynku” z limitem 10 km/h i obszar działania o promieniu 3,5 km;
  - nie ma strefy zakazu.
- **Klienci:** panel i aplikacja rysują strefy na mapie (`map-layers.ts`), a aplikacja ma przełącznik „Pokazuj strefy na mapie”. Nie ma legendy stref (`mapa-strefy`) ani komunikatów o strefie w trakcie jazdy.
- **Ograniczenie indeksu:** `scooter_commands_one_pending_per_rental` dopuszcza jedną oczekującą komendę na przejazd. Komenda limitu prędkości powiązana z przejazdem zderzyłaby się z oczekującą pauzą albo blokadą (ADR 0044).
- **OSRM:** ma tylko profil rowerowy (`infra/osrm/prepare.sh`), więc trasa piesza do hulajnogi wymaga decyzji (D6).

## Warunek wstępny: decyzje i makiety
Zanim zacznie się implementacja:
- autor odpowiada na [pytania](#pytania-do-autora-wartości-biznesowe) i [decyzje](#decyzje-do-potwierdzenia) poniżej;
- brakujące stany dostają makiety w `docs/projekt/ekrany/` według [design systemu](../projekt/design-system.md). Proponowane katalogi: `22-mobile-strefy` i `23-panel-strefy`.

Istniejące makiety, z których korzysta iteracja:

| Obszar | Makiety |
|---|---|
| Panel | `13-panel/admin-strefy` (lista stref, mapa z rysowaniem i edycją punktów, formularz: nazwa, typ, pojemność, widoczność, powierzchnia i liczba hulajnóg w strefie), `17-panel-wzorce/*` (lista, filtry, formularz z konfliktem wersji, stany), `21-panel-przejazdy/przejazd-szczegoly` (oś czasu dostaje zdarzenia stref) |
| Aplikacja: mapa | `04-mobile-mapa/mapa-strefy` (legenda), `mapa-szukaj` (wyszukiwanie celu), `01-kierunek-produktowy/produkt-mapa` (pasek z wyszukiwarką) |
| Aplikacja: jazda | `05-mobile-przejazd/przejazd-strefa` (wolna jazda z limitem), `przejazd-poza-strefa` („Prowadź do strefy”) |
| Techniczne | `15-techniczne/tech-jazda` (telemetria i strefy w trakcie jazdy) |

Brakujące makiety (gotowe 17 listopada 2026: [`22-mobile-strefy`, `23-panel-strefy`](../projekt/README.md#aplikacja-strefy-iteracja-4), 14 plansz; ekran listy z edytorem `strefy-lista` zastępuje `13-panel/admin-strefy` w nowej nawigacji):

- [x] **Panel: nowa strefa.** Rysowanie wielokąta od pierwszego punktu, pusty formularz i wybór typu przed zapisem.
- [x] **Panel: formularz według typu:**
  - wolna jazda z limitem prędkości;
  - zakaz bez pojemności;
  - obszar działania bez pojemności i bez przełącznika widoczności.

  `admin-strefy` pokazuje tylko parkowanie.
- [x] **Panel: błędy geometrii.** Wielokąt przecina sam siebie, wychodzi poza obszar działania albo nachodzi na strefę tego samego typu (według D3). Błąd widać przy polu i na mapie.
- [x] **Panel: dezaktywacja i usunięcie.** Strefa użyta w przejazdach jest dezaktywowana, a nieużyta usuwana. Okno pokazuje skutki: liczbę trwających przejazdów i hulajnóg w strefie. Do tego lista z filtrem „Nieaktywne” i przywrócenie strefy.
- [x] **Panel: zmiana stref w trakcie przejazdów.** Ostrzeżenie przed zapisem, gdy zmiana dotyczy trwających przejazdów, na przykład nowy limit prędkości dla N hulajnóg w strefie.
- [x] **Aplikacja: strefa zakazu w trakcie jazdy.** Hulajnoga zwalnia i staje, komunikat mówi, co zrobić (według pytania 2), a po wyjeździe ze strefy jazda wraca.
- [x] **Aplikacja: wyjazd poza obszar działania** w trakcie jazdy (według pytania 3).
- [x] **Aplikacja: hulajnoga niedostępna w strefie zakazu albo poza obszarem.** Wariant `stan-niedostepna` z nową przyczyną; może wystarczyć tekst bez osobnej planszy.
- [x] **Aplikacja: prowadzenie do strefy parkowania.** Ekran jazdy z trasą do najbliższej strefy, odległością i czasem dojazdu po „Prowadź do strefy” z `przejazd-poza-strefa`.
- [x] **Aplikacja: trasa do hulajnogi** z karty hulajnogi albo rezerwacji („Trasa”, decyzja D5 z iteracji 3), według D6.
- [x] **Aplikacja: wynik wyszukiwania.** Cel na mapie ze strefami parkowania przy celu, wolnymi hulajnogami w pobliżu i szacunkiem czasu. Do tego brak wyników i błąd usługi wyszukiwania. `mapa-szukaj` pokazuje tylko listę wyników.

Stany, które nie wymagają nowych plansz:
- **Wyjazd ze strefy wolnej jazdy:** ten sam komunikat co przy wjeździe, z tekstem „Koniec strefy wolnej jazdy”.
- **Zdarzenia stref na osi czasu przejazdu w panelu:** nowe wpisy w istniejącym komponencie.
- **Warstwa stref nieaktywnych na mapie floty:** ukryta.

## Zakres
- [ ] **Migracja 0006** (`0006_zones.sql`, testy w `packages/db/src/db.test.ts`):
  - **reguły geometrii pilnowane przez bazę** (według D3):
    - jeden aktywny obszar działania (indeks częściowy);
    - aktywna strefa inna niż obszar działania leży w obszarze działania (wyzwalacz z kodem błędu `ZONE_OUTSIDE_SERVICE_AREA`);
    - `ST_IsValid` już jest.
  - **bieżące strefy hulajnogi** do wykrywania zmian: osobna tabela albo kolumna (ADR 0043). Jest częścią modułu Strefy, a nie Telemetrii.
  - **widoki:**
    - lista stref do panelu z typem, powierzchnią, liczbą punktów, liczbą hulajnóg w strefie, liczbą trwających przejazdów w strefie i autorem zmiany;
    - zajętość stref parkowania (hulajnogi w strefie a pojemność);
    - zdarzenia stref na osi czasu przejazdu: `v_rental_timeline` już łączy `rental_events` ze strefą przez `zone_id`.
  - **funkcje:**
    - najbliższa strefa parkowania z odległością (dziś liczy ją repozytorium przejazdów);
    - strefy, których dotyczy zmiana geometrii: hulajnogi i przejazdy w starej i nowej geometrii;
  - **procedura** dezaktywacji albo usunięcia strefy: usunięcie tylko wtedy, gdy strefa nie ma przejazdów ani zdarzeń (`rentals.end_zone_id`, `rental_events.zone_id`);
  - po migracji `pnpm db:pull` i aktualizacja liczb w teście bazy oraz w [modelu danych](../model-danych/README.md).
- [ ] **`packages/core`** (`zones`, porty repozytoriów):
  - walidacja strefy:
    - typ, limit prędkości w zakresie z pytania 1;
    - pojemność tylko dla parkowania;
    - wielokąt bez samoprzecięć, z co najmniej trzema punktami i z minimalną powierzchnią;
    - geometria w GeoJSON z SRID 4326;
  - **wykrywanie zmian stref** (ADR 0043): czysta funkcja „poprzednie strefy + nowe strefy w punkcie → zdarzenia wjazdu i wyjazdu oraz komendy”, z histerezą na granicy (pytanie 6);
  - **reguły w trakcie jazdy:**
    - wjazd do wolnej jazdy wysyła limit;
    - wyjazd z niej przywraca limit poprzedniej strefy albo zdejmuje limit;
    - wjazd do zakazu i wyjazd poza obszar zatrzymują hulajnogę według pytań 2 i 3;
    - kilka nakładających się stref daje najniższy limit (`evaluatePosition` już to liczy);
  - **reguły startu i rezerwacji:** hulajnoga w strefie zakazu albo poza obszarem jest niedostępna według pytania 4, z nową przyczyną `OUT_OF_AREA` w `UNAVAILABLE_REASONS`;
  - **zakończenie:** bez zmian, czyli `canPark`; pełna strefa parkowania według pytania 5;
  - zmiana strefy w trakcie przejazdów działa od następnego odczytu telemetrii (pytanie 7).
- [ ] **`packages/db`:**
  - repozytorium stref: lista według wzorca (`ListSource` dla `zones` z filtrami typu, aktywności i widoczności), odczyt jednej strefy z geometrią, zapis z wersją rekordu (konflikt `CONFLICT`), dezaktywacja, przywrócenie, usunięcie i bieżące strefy hulajnóg;
  - **dane startowe:**
    - strefa zakazu w Parku imienia świętego Jana Sarkandra (pytanie 8, `way/209433745`), ze współrzędnymi z `pnpm db:places`, a nie zgadniętymi;
    - przykładowe przejazdy ze zdarzeniami stref.
- [ ] **`packages/shared`:**
  - definicja zasobu `zones` (filtry: typ, aktywna, widoczna w aplikacji, wyszukiwanie po kodzie i nazwie; sortowanie po kodzie, nazwie, typie i dacie zmiany);
  - schemat zapisu strefy z geometrią;
  - widok przejazdu z bieżącą strefą i limitem (`RentalView.zone`) oraz zdarzeniem stref w `notice`;
  - zdarzenia Socket.IO zmiany stref.
- [ ] **Kontrakty:**
  - [ ] [AsyncAPI MQTT](../kontrakty/asyncapi-mqtt.yaml): wznowienie po `stop_gradually` i zdjęcie limitu, jeśli ADR 0044 zmieni kontrakt (wersja 1.2.0);
  - [ ] [AsyncAPI Socket.IO](../kontrakty/asyncapi-realtime.yaml): `zones.changed` dla panelu, aplikacji i symulatora; strefa i limit w `rental.updated`;
  - [ ] [OpenAPI](../kontrakty/openapi.json): `pnpm api:openapi`.
- [ ] **Symulator** (ADR 0046):
  - strefy z bazy przez API zamiast z pliku miejsc, odświeżane po `zones.changed`;
  - cel przejazdu w aktualnej strefie parkowania;
  - zachowanie po `stop_gradually` według pytania 2, na przykład prowadzenie hulajnogi pieszo do granicy strefy;
  - jeden przejazd pokazowy, który przecina strefę wolnej jazdy i strefę zakazu, do demo.
- [ ] **API:**
  - [ ] **panel** (`@RequirePermission('zones.read' | 'zones.write')`):
    - `GET /admin/zones` (lista według wzorca);
    - `GET /admin/zones/{id}` z geometrią i skutkami zmiany;
    - `POST /admin/zones`, `PATCH /admin/zones/{id}` z wersją;
    - `POST /admin/zones/{id}/deactivate`, `POST /admin/zones/{id}/restore` i `DELETE /admin/zones/{id}`;
    - każdy zapis z wpisem `zone.created`, `zone.updated` albo `zone.deactivated` w `audit_log` w tej samej transakcji, z historią rekordu jak w iteracji 2;
  - [ ] **strefy w trakcie jazdy:**
    - telemetria przejazdu przechodzi przez wykrywanie zmian;
    - zdarzenia `ZONE_ENTERED` i `ZONE_EXITED` na osi czasu;
    - komendy `speed_limit` i `stop_gradually` z `expiresAt` i ponowieniem po braku potwierdzenia (ADR 0044);
    - `rental.updated` do klienta;
    - po zmianie stref ponowna ocena hulajnóg w trwających przejazdach;
  - [ ] **klient:**
    - `GET /zones` z polem `visible_in_app`;
    - prowadzenie do najbliższej strefy parkowania (`GET /zones/nearest-parking?lat&lon` z trasą z OSRM);
    - trasa do hulajnogi według D6;
    - wyszukiwanie celu przez adapter Photon (`GET /places/search?q`, ADR 0045);
  - [ ] błędy w formacie `{ code, message, details }`: `ZONE_INVALID_GEOMETRY`, `ZONE_OUTSIDE_SERVICE_AREA`, `ZONE_OVERLAP` (według D3), `ZONE_IN_USE`, `SERVICE_AREA_REQUIRED`, `CONFLICT`, `SCOOTER_UNAVAILABLE` z przyczyną `OUT_OF_AREA`.
- [ ] **Panel:**
  - [ ] „Strefy” w nawigacji: edytor według `admin-strefy` i nowych makiet. Lista po lewej korzysta z kontraktu list (filtry, sortowanie, wyszukiwanie) według D2. Mapa z rysowaniem, edycją i usuwaniem punktów (ADR 0047). Formularz z wersją rekordu i konfliktem wersji. Dezaktywacja, przywrócenie i usunięcie;
  - [ ] zmiany stref na żywo: mapa floty i edytor u innego operatora;
  - [ ] oś czasu przejazdu ze zdarzeniami stref; strefa na karcie hulajnogi (już jest jako strefa parkowania) i na mapie floty.
- [ ] **Aplikacja:**
  - [ ] legenda stref (`mapa-strefy`), tylko strefy z `visible_in_app`;
  - [ ] komunikat strefy na ekranie jazdy i pigułka limitu (`przejazd-strefa`); strefa zakazu i wyjazd poza obszar (nowe makiety);
  - [ ] „Prowadź do strefy” z `przejazd-poza-strefa`;
  - [ ] „Trasa” na karcie hulajnogi i rezerwacji według D6;
  - [ ] pasek „Dokąd jedziesz?” i wyszukiwanie (`mapa-szukaj`) z wynikiem na mapie; zapisane miejsca według D4;
  - [ ] hulajnoga niedostępna z przyczyną `OUT_OF_AREA`.
- [ ] **Dokumentacja:**
  - arc42: §6.3 (strefy w trakcie jazdy według ADR 0043 i 0044, diagram bez zmian albo poprawiony), §5.2 (moduły Strefy i Telemetria: kto wykrywa zmiany), §8 (geometria i walidacja), §11 (ryzyka: GPS na granicy, publiczny Photon);
  - [model danych](../model-danych/README.md);
  - tabela zgodności w [wymaganiach uczelni](../wymagania-uczelni.md);
  - spis makiet w [`projekt/README.md`](../projekt/README.md).

## ADR-y do napisania
Numery są propozycją, ostatni ADR to 0042. Każdy ADR powstaje przed kodem, którego dotyczy.

| Nr | Temat | Co rozstrzyga |
|---|---|---|
| 0043 | Wykrywanie zmian stref z telemetrii | Gdzie i jak:<ul><li>moduł Strefy wołany z Telemetrii przez port, bez czytania cudzych tabel;</li><li>tylko hulajnogi w przejeździe czy cała flota (zajętość parkowania liczona zapytaniem);</li><li>zapis bieżących stref hulajnogi;</li><li>histereza na granicy (pytanie 6);</li><li>punkty dosłane z bufora nie wywołują komend;</li><li>koszt zapytania przestrzennego na paczkę odczytów.</li></ul> |
| 0044 | Komendy stref dla hulajnogi | Problem:<ul><li>komendy stref nie mogą blokować pauzy i zakończenia, a indeks `scooter_commands_one_pending_per_rental` dopuszcza jedną oczekującą komendę na przejazd;</li><li>`stop_gradually` nie ma w kontrakcie odwrotności.</li></ul>Opcje:<ul><li>komendy stref bez `rental_id` albo indeks ograniczony do `LOCK` i `UNLOCK`;</li><li>nowa komenda albo parametr wznowienia;</li><li>ponowienie po braku potwierdzenia;</li><li>kolejność komend przy szybkim wjeździe i wyjeździe.</li></ul>Ewentualna zmiana kontraktu MQTT do 1.2.0. |
| 0045 | Wyszukiwanie miejsc (Photon) | Uzupełnia [ADR 0017](../adr/0017-uslugi-mapowe.md):<ul><li>publiczny Photon czy własny kontener;</li><li>zawężenie do obszaru działania;</li><li>pamięć podręczna i limit zapytań w API (klient zna tylko API);</li><li>język wyników;</li><li>zachowanie przy niedostępności usługi;</li><li>zapisane i ostatnie miejsca według D4.</li></ul> |
| 0046 | Symulator a strefy | Zmienia część [ADR 0039](../adr/0039-symulator-w-trakcie-przejazdu.md):<ul><li>źródło stref (API zamiast pliku miejsc);</li><li>odświeżanie po zmianie;</li><li>zachowanie po `stop_gradually` i przy granicy obszaru;</li><li>przejazd pokazowy przez strefy.</li></ul> |
| 0047 | Edytor geometrii w panelu | Biblioteka do rysowania i edycji wielokątów na MapLibre GL JS 6 (wersja sprawdzona, starsza niż 3 dni). Do tego:<ul><li>przyciąganie do granic innych stref;</li><li>`Polygon` w edytorze a `MultiPolygon` w bazie;</li><li>uproszczenie i dokładność współrzędnych;</li><li>cofanie zmian;</li><li>walidacja na kliencie a w bazie.</li></ul> |
| 0048 | Trasy dla klienta z OSRM | Prowadzenie do strefy i trasa do hulajnogi:<ul><li>adapter OSRM w API (dziś używa go tylko symulator);</li><li>profil pieszy według D6;</li><li>pamięć podręczna;</li><li>zachowanie przy niedostępnym OSRM (linia prosta z odległością).</li></ul> |

## Odpowiedzi autora (17 listopada 2026)
Autor przyjął wszystkie rekomendacje D1–D8 i domyślne odpowiedzi na pytania. Miejsce strefy zakazu w danych startowych autor wybrał z propozycji z OpenStreetMap. Do `rybnik-places.json` trafi przy implementacji, ze współrzędnymi z `pnpm db:places`.

| Pytanie | Odpowiedź |
|---|---|
| 1. Limit w wolnej jeździe | Operator ustawia 5–15 km/h; seed zostaje przy 10 km/h. |
| 2. Strefa zakazu w trakcie jazdy | Hulajnoga zwalnia i staje (`stop_gradually`), przejazd trwa i jest naliczany. Klient prowadzi hulajnogę pieszo poza strefę, wtedy silnik wraca. Zakończenie w strefie zakazu niemożliwe (`canPark`). |
| 3. Wyjazd poza obszar działania | Tak samo jak strefa zakazu: zatrzymanie, powrót silnika po powrocie do obszaru, zakończenie niemożliwe. Bez opłaty w tej iteracji. |
| 4. Start w zakazie albo poza obszarem | Hulajnoga niedostępna dla klientów z przyczyną `OUT_OF_AREA`; czeka na serwis. |
| 5. Pełna strefa parkowania | Pojemność tylko informuje (panel, aplikacja), nie blokuje zakończenia. |
| 6. Granica strefy | Wjazd od pierwszego odczytu w strefie; wyjazd po dwóch kolejnych odczytach poza strefą albo po oddaleniu o więcej niż 10 m. |
| 7. Zmiana strefy w trakcie przejazdów | Działa od następnego odczytu, z ostrzeżeniem w panelu przed zapisem. Strefę użytą w przejazdach się dezaktywuje, więc zakończone przejazdy zachowują strefę końcową. |
| 8. Strefa zakazu w danych startowych | Park imienia świętego Jana Sarkandra, `way/209433745`, 1,63 ha, około 430 m od Rynku, w obszarze działania. Jego krawędź jest około 185 m od strefy P-03 i około 200 m od S-01, więc strefa nie nachodzi na inne. Odrzuceni kandydaci: Park nad Nacyną (nachodzi na S-01, 60 m od P-05), Mały Park (0,17 ha, za mały na demo), Park Śródmiejski (około 1,4 km od Rynku, poza trasami demo). |
| 9. Wyszukiwanie | Obszar działania z zapasem 1 km, 5 wyników. |
| 10. Kto edytuje strefy | `zones.write` tylko u Administratora, jak w migracji 0002; makieta z Dyspozytorem jest przykładem. |

| Decyzja | Rozstrzygnięcie |
|---|---|
| D1 | Edytor rysuje wielokąty; okręgi z danych startowych stają się wielokątami do edycji. Jedna strefa to jeden wielokąt w edytorze. |
| D2 | Jeden ekran „Strefy” według `admin-strefy`; lista po lewej korzysta z kontraktu list (filtry, wyszukiwanie, sortowanie, stronicowanie). |
| D3 | Każda strefa w obszarze działania (pilnuje baza); strefy parkowania nie nachodzą na siebie; wolna jazda i zakaz mogą nachodzić na inne strefy. |
| D4 | Ostatnie wyszukiwania na urządzeniu; „Dom”, „Praca” i „Dodaj” ukryte. |
| D5 | Wynik wyszukiwania: cel, strefy parkowania przy celu i hulajnogi przy kliencie, szacunek czasu z OSRM; bez nawigacji zakręt po zakręcie. |
| D6 | Wycinek OSRM z profilem pieszym, jeśli rozmiar i czas przygotowania są akceptowalne (sprawdzenie przy ADR 0048); w przeciwnym razie profil rowerowy z dopiskiem „szacunkowo”. |
| D7 | `SPEED_LIMIT` i `STOP_GRADUALLY` wysyła tylko system według stref; panel ich nie wysyła ręcznie. |
| D8 | Historia zmian strefy z wersji rekordu i dziennika audytu (stara i nowa geometria); bez tabeli wersji stref. |

## Pytania do autora: wartości biznesowe
Otwarte decyzje z `CLAUDE.md` i nowe pytania tej iteracji. Seed ma wartości deweloperskie, a makiety pokazują nawiasy. Plan ich nie ustala.

1. **Limit prędkości w strefie wolnej jazdy** (makieta: „[LIMIT] km/h”, seed: 10 km/h). Jaki zakres może ustawić operator? Proponuję 5–15 km/h, bo hulajnogi i tak jeżdżą najwyżej 20 km/h.
2. **Strefa zakazu w trakcie jazdy.** Legenda `mapa-strefy` mówi „Hulajnoga zwolni i zatrzyma się na granicy”. Co dalej? Rekomendacja:
   - hulajnoga zatrzymuje się, a przejazd trwa i jest naliczany;
   - klient prowadzi ją pieszo poza strefę i po wyjeździe silnik wraca;
   - zakończyć przejazdu w strefie zakazu nie można, tak jak dziś (`canPark`).

   Alternatywa: hulajnoga tylko zwalnia do niskiego limitu i nie staje.
3. **Wyjazd poza obszar działania.** Czy działa jak strefa zakazu (zatrzymanie), czy tylko jak ostrzeżenie? Czy przy wyjeździe obowiązuje opłata, czy to temat iteracji 5?
4. **Start w strefie zakazu albo poza obszarem.** Hulajnoga, która tam stoi, na przykład po zdalnym zakończeniu, jest niedostępna dla klientów (`OUT_OF_AREA`) i czeka na serwis. Czy tak?
5. **Pełna strefa parkowania** (`capacity`, makieta: „do 25 hulajnóg”). Czy zakończenie w pełnej strefie jest blokowane, czy pojemność tylko informuje operatora i aplikację („prawie pełna”)? Rekomendacja: tylko informacja w tej iteracji.
6. **Granica strefy i dokładność GPS.** Ile metrów albo ile kolejnych odczytów potwierdza wjazd i wyjazd? Rekomendacja:
   - wjazd od pierwszego odczytu w strefie;
   - wyjazd po dwóch kolejnych odczytach poza nią albo po oddaleniu o więcej niż 10 m.
7. **Zmiana strefy w trakcie przejazdów.** Czy nowy limit albo nowa granica działa od razu w trwających przejazdach? Rekomendacja: tak, od następnego odczytu, z ostrzeżeniem w panelu przed zapisem. Czy zakończone przejazdy zachowują strefę końcową, gdy strefa zostanie zmieniona albo dezaktywowana? Rekomendacja: tak, strefę się dezaktywuje, a nie usuwa.
8. **Strefa zakazu w danych startowych.** Które miejsce w Rybniku? Makieta pokazuje „Park Miejski”. Współrzędne pobierze `pnpm db:places` z OpenStreetMap, a autor potwierdzi wynik.
9. **Wyszukiwanie.** Czy wyniki mają być tylko z obszaru działania, czy z całego Rybnika z informacją „poza obszarem”? Ile wyników pokazujemy? Rekomendacja: obszar działania z zapasem 1 km i 5 wyników.
10. **Kto edytuje strefy.** Migracja 0002 daje `zones.write` tylko Administratorowi; Dyspozytor i Serwisant mają `zones.read`. Makieta `admin-strefy` pokazuje edycję przez Dyspozytora. Rekomendacja: zostawić uprawnienia bez zmian, bo Administrator może je nadać w macierzy ról; makieta jest przykładem.

## Decyzje do potwierdzenia
Rozstrzygnięcia zakresu z rekomendacją. Autor potwierdza albo zmienia.

- **D1. Kształt stref.** Edytor rysuje wielokąty, a okręgi z danych startowych zostają jako wielokąty z 64 punktami do edycji. Rekomendacja: bez osobnego typu „okrąg”, bo baza i tak trzyma `MultiPolygon`. Jedna strefa to jeden wielokąt w edytorze. Wieloczęściowe strefy można dodać później, jeśli będą potrzebne.
- **D2. Lista stref w panelu** a wzorzec widoku tabeli ([ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md)). Rekomendacja:
  - jeden ekran „Strefy” według `admin-strefy`;
  - lista po lewej korzysta z kontraktu list: filtr typu i aktywności, wyszukiwanie, sortowanie, stronicowanie;
  - nie powstaje osobna tabela bez mapy;
  - spełnia to wymaganie 12 dla `zones`.

  Alternatywa: zwykła lista według wzorca z przełącznikiem „Mapa”.
- **D3. Nakładanie się stref.** Rekomendacja:
  - każda strefa leży w obszarze działania (pilnuje baza);
  - strefy parkowania nie nachodzą na siebie;
  - wolna jazda i zakaz mogą nachodzić na inne strefy, a pierwszeństwo daje `fn_zones_at_point` (zakaz, wolna jazda, parkowanie);
  - parkowanie w strefie zakazu jest wykluczone regułą `canPark`, więc baza tego nie blokuje.
- **D4. Zapisane miejsca** („Dom”, „Praca”, „Dodaj” w `mapa-szukaj`). Rekomendacja:
  - ostatnie wyszukiwania na urządzeniu;
  - zapisane miejsca ukryte do późniejszej iteracji, bo wymagają nowej tabeli i ekranu edycji, a nie wnoszą nic do procesu wypożyczenia.
- **D5. Wynik wyszukiwania.** Rekomendacja:
  - po wyborze celu mapa pokazuje cel, najbliższe strefy parkowania przy celu i wolne hulajnogi przy kliencie;
  - szacunek czasu liczy OSRM na profilu rowerowym;
  - bez nawigacji zakręt po zakręcie.
- **D6. Trasa do hulajnogi.** OSRM ma tylko profil rowerowy. Rekomendacja: drugi wycinek z profilem pieszym (`foot.lua`) w `infra/osrm`, jeśli rozmiar i czas przygotowania są akceptowalne; w przeciwnym razie profil rowerowy z dopiskiem „szacunkowo”. Alternatywa: linia prosta z odległością, bez OSRM.
- **D7. Panel wysyła komendy limitu i zatrzymania ręcznie?** Rekomendacja: nie. `SPEED_LIMIT` i `STOP_GRADUALLY` wysyła tylko system według stref, żeby ręczna komenda nie rozjechała się z regułą strefy. Panel pokazuje je w dzienniku komunikacji hulajnogi.
- **D8. Historia zmian strefy.** Rekomendacja: wersja rekordu i historia z dziennika audytu jak w iteracji 2 (stara i nowa geometria w `audit_log`), bez osobnej tabeli wersji stref. Cennik ma wersje, bo przejazd pamięta wersję z chwili startu; strefy działają według stanu bieżącego.

## Poza zakresem (świadomie)
- Opłata za zakończenie poza strefą, cennik zależny od strefy, premie za parkowanie w wybranej strefie: iteracja 5.
- Utrata łączności w strefie, zgłoszenie źle zaparkowanej hulajnogi, push „wjeżdżasz w strefę zakazu” przy zamkniętej aplikacji, ekran symulatora w panelu: iteracja 6.
- Raport przejazdów według stref i godzin, eksport stref do pliku: iteracja 8.
- Zapisane miejsca w wyszukiwaniu (D4), nawigacja zakręt po zakręcie, import i eksport GeoJSON w edytorze.

## Kolejność kroków
1. Odpowiedzi autora na pytania 1–10 i decyzje D1–D8; aktualizacja tego planu i, przy zmianie granic iteracji, [planu iteracji](README.md).
2. Makiety brakujących stanów z PNG obejrzanymi przed implementacją i wpisem w [spisie makiet](../projekt/README.md).
3. ADR 0043–0048 zaakceptowane przed kodem; przy D6 sprawdzenie rozmiaru i czasu przygotowania wycinka pieszego OSRM.
4. Migracja 0006, `pnpm db:pull`, testy bazy: reguły geometrii, dezaktywacja i usunięcie, widoki zajętości.
5. `packages/core`: walidacja strefy, wykrywanie zmian z histerezą, reguły jazdy, startu i komend z testami jednostkowymi.
6. Kontrakty: MQTT (jeśli ADR 0044 go zmienia) i Socket.IO; schematy w `packages/shared`.
7. API panelu: zasób `zones` z dziennikiem audytu i konfliktem wersji; `pnpm api:openapi`.
8. API w trakcie jazdy: wykrywanie zmian w telemetrii, komendy stref, oś czasu, `rental.updated`; test API przejazdu przez strefę wolnej jazdy i zakazu.
9. Symulator: strefy z API, zachowanie przy zakazie, przejazd pokazowy przez strefy (testy symulatora).
10. Panel: edytor stref, zmiany na żywo, oś czasu ze strefami.
11. API klienta i aplikacja: legenda, komunikaty stref, prowadzenie do strefy, trasa do hulajnogi, wyszukiwanie.
12. Domknięcie:
    - arc42, model danych, wymagania uczelni, spis makiet, odstępstwa w dzienniku;
    - scenariusz demo przechodzi krok po kroku;
    - `pnpm lint && pnpm typecheck && pnpm test && pnpm build`;
    - zielone CI.

## Scenariusz demo
Wymaga infrastruktury z OSRM i danych startowych (`pnpm infra:up && pnpm db:migrate && pnpm db:places && pnpm db:seed`), panelu na `WEB_PORT=3002` i aplikacji (wersja web albo development build). Kod SMS jest w logu API. Wartości w nawiasach zależą od odpowiedzi na pytania.

1. Panel → „Strefy”: lista z obszarem działania, pięcioma strefami parkowania, strefą wolnej jazdy i strefą zakazu. Filtr „Wolna jazda” zostawia S-01, a sortowanie po dacie zmiany działa jak w innych listach.
2. Edycja P-01 „Rynek”: przesunięcie punktów wielokąta, zapis i nowa wersja rekordu. Wpis w dzienniku audytu zawiera starą i nową geometrię. Druga karta panelu widzi zmianę na mapie floty bez odświeżania. Zapis starej wersji z drugiej karty kończy się konfliktem wersji.
3. Nowa strefa parkowania narysowana częściowo poza obszarem działania jest odrzucona z błędem na mapie. Ta sama strefa narysowana wewnątrz obszaru zapisuje się, a aplikacja widzi ją po odświeżeniu stref.
4. Aplikacja: legenda stref, „Dokąd jedziesz?” → „Rynek” → cel na mapie ze strefą parkowania i szacunkiem czasu.
5. Przejazd przez strefę wolnej jazdy:
   - po wjeździe ekran jazdy pokazuje „Strefa wolnej jazdy” i pigułkę „Limit [LIMIT] km/h”;
   - prędkość w symulatorze spada do limitu;
   - oś czasu w panelu ma „Wjazd do strefy S-01” i komendę limitu z czasem potwierdzenia;
   - po wyjeździe limit znika.
6. Zmiana limitu S-01 w panelu w trakcie przejazdu:
   - panel ostrzega, że zmiana dotyczy jednej hulajnogi w trakcie jazdy;
   - po zapisie hulajnoga dostaje nowy limit, a aplikacja go pokazuje.
7. Wjazd do strefy zakazu: hulajnoga zwalnia i staje według pytania 2, a aplikacja pokazuje komunikat. Po wyprowadzeniu ze strefy jazda wraca. „Zakończ” w strefie zakazu jest odrzucone.
8. „Zakończ” poza strefą parkowania → „Prowadź do strefy” → trasa do najbliższej strefy na mapie. Po dojechaniu zakończenie przechodzi, a podsumowanie i panel pokazują strefę końcową.
9. Dezaktywacja strefy użytej w przejazdach: strefa znika z aplikacji i z mapy floty. Zakończone przejazdy dalej pokazują ją jako strefę końcową. Usunięcie nowej, nieużytej strefy z kroku 3 przechodzi.
10. Dyspozytor (rola z `zones.read` bez `zones.write`, według pytania 10) widzi strefy bez edycji, a API zwraca 403 na zapis.
