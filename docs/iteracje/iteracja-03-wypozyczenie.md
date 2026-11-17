# Iteracja 3: wypożyczenie

**Status:** plan (16 listopada 2026); w realizacji; decyzje autora ([odpowiedzi](#odpowiedzi-autora-16-listopada-2026)), makiety i ADR 0036–0042 przyjęte 16 listopada 2026

## Cel
Klient widzi na mapie w aplikacji wolne hulajnogi w pobliżu, rezerwuje jedną albo skanuje jej kod, odblokowuje ją, jedzie z pauzą i kończy przejazd w strefie parkowania. Odblokowanie i blokada idą komendami MQTT z potwierdzeniem ([ADR 0011](../adr/0011-mqtt-dla-hulajnog.md)), a każde przejście stanu przejazdu przechodzi przez maszynę stanów z `packages/core` i zapisuje zdarzenie na osi czasu ([ADR 0013](../adr/0013-rezerwacja-jako-stan-przejazdu.md)). Rezerwacja wygasa sama, a zadania w tle (wygaszanie, limity potwierdzeń, czyszczenie danych technicznych) przechodzą na pg-boss ([ADR 0016](../adr/0016-zadania-w-tle-pg-boss.md)). Operator widzi w panelu przejazdy na żywo z osią czasu i może zakończyć przejazd zdalnie. Aplikacja dostaje nawigację, profil, historię przejazdów, ustawienia i usunięcie konta (dług z iteracji 2).

Granice z sąsiednimi iteracjami: strefy są tylko czytane z danych startowych (P-01…P-05, S-01, obszar działania); edytor stref, limit prędkości w strefie i komunikaty o wjeździe w strefę są w iteracji 4. Portfel, doładowania, obciążenie za przejazd, stan `UNPAID` i paragony są w iteracji 5 (zakres wyceny w tej iteracji zależy od decyzji D1). Utrata łączności w trakcie jazdy, zgłoszenia i powiadomienia push są w iteracji 6.

Wymagania uczelni: 13 (proces wypożyczenia od rezerwacji do zakończenia; rozliczenie domyka iteracja 5), 12 (przejazdy i oś czasu w panelu, tylko do odczytu i polecenia według [macierzy operacji](../model-danych/README.md#operacje-w-panelu-dla-każdej-tabeli)), 14 (ekrany mapy, przejazdu i profilu w aplikacji, przejazdy w panelu), 3c (reguły przejazdu w `packages/core`).

## Warunek wstępny: decyzje i makiety
Przed implementacją autor odpowiada na [pytania](#pytania-do-autora-wartości-biznesowe) i [decyzje](#decyzje-do-potwierdzenia) poniżej, a brakujące stany dostają makiety w `docs/projekt/ekrany/` według [design systemu](../projekt/design-system.md). Proponowane katalogi: `20-mobile-wypozyczenie` i `21-panel-przejazdy`.

Istniejące makiety, z których korzysta iteracja:

| Obszar | Makiety |
|---|---|
| Mapa | `01-kierunek-produktowy/produkt-mapa`, `04-mobile-mapa/mapa-rezerwacja`, `mapa-strefy` (legenda; strefy tylko do odczytu), `03-mobile-konto/konto-lokalizacja`, `08-mobile-stany/stan-brak-lokalizacji`, `stan-brak-hulajnog`, `stan-offline` |
| Wypożyczenie | `02-mobile-przeplyw/flow-skan`, `01-kierunek-produktowy/produkt-hulajnoga`, `08-mobile-stany/stan-niedostepna`, `05-mobile-przejazd/przejazd-odblokowywanie` |
| Przejazd | `01-kierunek-produktowy/produkt-przejazd`, `05-mobile-przejazd/przejazd-pauza`, `przejazd-poza-strefa`, `02-mobile-przeplyw/flow-podsumowanie` |
| Profil | `06-mobile-profil/profil`, `profil-historia`, `profil-historia-pusta`, `profil-ustawienia`, `profil-usun-konto` |
| Tryb ciemny | `09-mobile-ciemny/ciemny-mapa`, `ciemny-hulajnoga`, `ciemny-przejazd`, `ciemny-profil` (jeśli motyw wejdzie do zakresu, D6) |
| Panel | `13-panel/admin-przejazdy` (lista z panelem bocznym i osią czasu), `17-panel-wzorce/*` (lista, filtry, stany), `13-panel/admin-mapa` i `admin-hulajnoga` (bieżący przejazd hulajnogi) |
| Przepływ | `12-mapa-przeplywow/mapa-przeplywow` (mapa jako ekran główny, profil z awatara w polu wyszukiwania) |

Brakujące makiety (gotowe 16 listopada 2026: [`20-mobile-wypozyczenie`, `21-panel-przejazdy`](../projekt/README.md#aplikacja-wypożyczenie-iteracja-3)):

- [x] **Karta hulajnogi na mapie z akcją „Zarezerwuj”.** `produkt-mapa` ma tylko „Skanuj i jedź”, a mapa przepływów przewiduje opcjonalną rezerwację z karty hulajnogi.
- [x] **Wpisanie numeru hulajnogi.** Link „Wpisz numer hulajnogi” z `flow-skan` nie ma ekranu docelowego. W symulatorze iOS i w wersji web to jedyna droga do hulajnogi, bo nie ma aparatu.
- [x] **Brak dostępu do aparatu** (odmowa uprawnienia na ekranie skanowania), analogicznie do `stan-brak-lokalizacji`.
- [x] **Odblokowanie nieudane:** brak potwierdzenia w 10 s albo odmowa hulajnogi (`UNLOCK_FAILED`). Komunikat „nie pobraliśmy opłaty” i akcje „Spróbuj ponownie” i „Wybierz inną”.
- [x] **Rezerwacja wygasła albo anulowana:** powrót na mapę z komunikatem. Do tego potwierdzenie anulowania, jeśli autor go chce.
- [x] **Kończenie przejazdu:** oczekiwanie na potwierdzenie blokady (`ENDING`) i błąd, gdy hulajnoga nie potwierdza blokady.
- [x] **Wznawianie jazdy po pauzie:** wariant ekranu odblokowywania z innym tekstem. Do decyzji, czy wystarczy wariant bez osobnej planszy.
- [x] **Profil → Dane osobowe:** edycja imienia i e-maila; telefon tylko do odczytu, bo zmienia go nowy kod SMS (iteracja 2).
- [x] **Usunięcie konta niemożliwe:** otwarty przejazd albo rezerwacja (`USER_HAS_OPEN_RENTAL` z `sp_anonymize_user`).
- [x] **Podsumowanie przejazdu w wariancie z decyzji D1.** `flow-podsumowanie` pokazuje kwoty i „Zapłacono z: Portfel”, a obciążenie powstaje w iteracji 5.
- [x] **Panel: szczegóły przejazdu** jako strona: trasa na mapie, oś czasu, komendy z czasem potwierdzenia, wersja cennika, liczniki czasu i dystansu, dane klienta i hulajnogi. `admin-przejazdy` ma tylko panel boczny.
- [x] **Panel: zdalne zakończenie przejazdu:** okno z powodem, skutkami dla klienta (D7) i potwierdzeniem operacji nieodwracalnej, według wzorca z `17-panel-wzorce`.

Stany, które nie wymagają nowych plansz: `stan-niedostepna` z innym tekstem dla hulajnogi zarezerwowanej, w użyciu, offline albo w serwisie; ponowna akceptacja dokumentu przed rezerwacją (`19-mobile-dostep/konto-nowa-wersja`); lista przejazdów w nowej nawigacji z `17-panel-wzorce` zamiast starej z `13-panel` (odstępstwo jak w iteracji 1).

## Zakres
- [x] **Migracja 0005** (`0005_rentals.sql`, testy w `packages/db/src/db.test.ts`):
  - widoki: lista przejazdów w panelu (`v_rental_details` z bieżącym czasem jazdy i pauzy, numerem hulajnogi i flagą „problem”), oś czasu przejazdu (zdarzenia z `rental_events` razem z komendami z `scooter_commands` dla przejazdu), historia przejazdów klienta i statystyki profilu (liczba przejazdów, dystans, czas w drodze);
  - wygaszanie rezerwacji, które zwraca identyfikatory przejazdów, klientów i hulajnóg, bo aplikacja i panel muszą dostać zdarzenie. Obecne `sp_expire_reservations` zwraca tylko liczbę; nowa funkcja albo procedura zgodnie z ADR o pg-boss;
  - `sp_purge_expired_sessions`: sesje klientów i operatorów oraz zaproszenia wygasłe dawniej niż N dni. Usuwa całe rodziny sesji, w których wszystkie wygasły, bo `replaced_by` wskazuje następcę;
  - preferencje powiadomień klienta (koniec rezerwacji, paragony) z ekranu ustawień. Przełącznik „Promocje” to zgoda `MARKETING` z `consents`, bez nowej kolumny;
  - portfel zakładany przy rejestracji: dziś nikt nie tworzy wiersza w `wallets`, a profil i reguła minimalnego salda go potrzebują. Migracja uzupełnia portfele istniejących klientów saldem 0, bez wpisu w księdze;
  - indeksy: przejazdy według stanu i czasu (szybkie filtry w panelu), otwarty przejazd klienta;
  - po migracji `pnpm db:pull` i aktualizacja liczb w teście bazy oraz w [modelu danych](../model-danych/README.md).
- [x] **`packages/core`** (`rentals`, porty repozytoriów razem z repozytoriami w `packages/db`):
  - warunki rezerwacji i startu: klient aktywny, niezablokowany, z akceptacją obowiązujących dokumentów (reguła zapowiedziana w iteracji 2) i bez otwartego przejazdu; hulajnoga `AVAILABLE`, online, z baterią co najmniej `min_battery_pct` z cennika; rezerwację odblokowuje tylko jej właściciel; minimalne saldo nie w tej iteracji (D1);
  - rezerwacja: wygaśnięcie po `free_reservation_minutes` z wersji cennika zapisanej w przejeździe, anulowanie przez klienta (`RESERVED → EXPIRED` z powodem, zgodnie z arc42 §6.1);
  - przejścia z komendami: `UNLOCKING` i wznowienie czekają na potwierdzenie odblokowania, pauza i kończenie na potwierdzenie blokady; spóźnione albo odrzucone potwierdzenie nie zmienia stanu zakończonego przejazdu (ADR o wygasaniu komend);
  - liczniki: `ride_seconds` i `pause_seconds` z osi czasu, dystans z telemetrii przejazdu (`fn_rental_distance_m`), moment końca naliczania według pytania 3;
  - zakończenie: `evaluatePosition(...).canPark` (już w core) dla pozycji hulajnogi z ostatniej telemetrii; poza strefą błąd `OUTSIDE_PARKING` z najbliższą strefą parkowania;
  - zdalne zakończenie przez operatora: dozwolone stany, wymagany powód, skutki według D7;
  - dzwonek z aplikacji: tylko dla własnej rezerwacji albo hulajnogi otwartej po zeskanowaniu (D5);
  - wycena przejazdu według D1 (funkcja czysta: wersja cennika, liczniki → kwoty w groszach);
  - usunięcie konta: warunki przed `sp_anonymize_user` i saldo według pytania 7.
- [x] **`packages/db`**: repozytorium przejazdów (przejścia w transakcji z `SELECT … FOR UPDATE` na hulajnodze i przejeździe, `scooters.status` zmieniany w tej samej transakcji: `RESERVED`, `IN_USE`, `AVAILABLE`), zdarzenia osi czasu, przypisanie `rental_id` do telemetrii w trakcie przejazdu, trasa (`rentals.route`) przy zakończeniu, `ListSource` dla `rentals`, historia i statystyki klienta, preferencje, usunięcie konta. Dane startowe: zakończone przejazdy przykładowe, żeby lista w panelu i historia w aplikacji nie były puste.
- [x] **`packages/shared`**: schematy żądań i odpowiedzi przejazdu, definicja zasobu `rentals` (filtry: stan, zakres dat, hulajnoga, klient; szybkie filtry „W trakcie”, „Zakończone”, „Problemy”), zdarzenia Socket.IO przejazdu.
- [x] **Kontrakty:**
  - [x] [AsyncAPI MQTT](../kontrakty/asyncapi-mqtt.yaml) 1.1.0: wygaśnięcie komendy i powód odrzucenia dla przeterminowanej komendy (ADR o wygasaniu komend);
  - [x] [AsyncAPI Socket.IO](../kontrakty/asyncapi-realtime.yaml): pokoje `user:{id}` i `rental:{id}` zapowiedziane w kontrakcie, zdarzenia zmiany stanu przejazdu i liczników jazdy;
  - [x] [OpenAPI](../kontrakty/openapi.json): `pnpm api:openapi`.
- [x] **Symulator** (ADR o symulatorze w trakcie przejazdu): wygaśnięcie komend; po odblokowaniu komendą hulajnoga jedzie trasą z OSRM do celu (w demo: strefa parkowania), staje i czeka na blokadę zamiast blokować się sama; przejazdy pokazowe domyślnie wyłączone (`SIM_RIDES_PER_HOUR=0`), zgodnie z [ADR 0034](../adr/0034-symulator-floty.md); prosty sposób na rozłączenie wybranej hulajnogi albo wstrzymanie jej potwierdzeń do demo nieudanego odblokowania (dziś symulator go nie ma; ekran symulatora w panelu jest w iteracji 6).
- [x] **Zadania w tle (pg-boss)**, wersja sprawdzona przed instalacją:
  - [x] wygaszanie rezerwacji (zadanie zaplanowane na `reservation_expires_at` w transakcji rezerwacji oraz cykliczne sprawdzenie jako zabezpieczenie);
  - [x] limit 10 s na potwierdzenie komendy zamiast `setInterval` w `commands.service.ts`; dla `UNLOCKING` przejście do `UNLOCK_FAILED`;
  - [x] partycje telemetrii zamiast `setInterval` w `telemetry.service.ts` ([ADR 0033](../adr/0033-telemetria-i-status-floty.md) to zapowiada) i retencja `sp_purge_telemetry` (okres według pytania 10);
  - [x] dług z iteracji 2: `sp_purge_expired_otp` i `sp_purge_expired_sessions` cyklicznie.
- [x] **API:**
  - [x] klient (`@CustomerAuth`): hulajnogi w pobliżu (`fn_nearest_scooters` z progiem baterii z cennika), hulajnoga po numerze (skan i wpisanie numeru), rezerwacja i jej anulowanie, start przejazdu (z rezerwacji albo od razu), pauza, wznowienie, zakończenie, bieżący przejazd, historia i szczegóły przejazdu, dzwonek (D5), `DELETE /me` (usunięcie konta), preferencje; ponowione żądanie startu zwraca otwarty przejazd zamiast drugiego (indeksy `rentals_one_open_per_*`);
  - [x] MQTT: potwierdzenia komend przejazdu zmieniają stan przez maszynę stanów; status offline i online w trakcie przejazdu zapisują zdarzenia `CONNECTION_LOST` i `CONNECTION_RESTORED` (bez zmiany naliczania; reguła w iteracji 6, pytanie 5);
  - [x] Socket.IO: uwierzytelnienie tokenem klienta, pokoje `user:{id}` i `rental:{id}`, panel dostaje zmiany przejazdów w pokoju `fleet` albo nowym pokoju `rentals`;
  - [x] panel: `GET /admin/rentals` (lista według wzorca), `GET /admin/rentals/{id}` (szczegóły, oś czasu, komendy, trasa), `POST /admin/rentals/{id}/end` z `rentals.manage`, powodem i wpisem w `audit_log` w tej samej transakcji;
  - [x] błędy w formacie `{ code, message, details }`: `SCOOTER_UNAVAILABLE` (z przyczyną: bateria, zajęta, offline, serwis), `RENTAL_ALREADY_OPEN`, `DOCUMENTS_NOT_ACCEPTED`, `OUTSIDE_PARKING` (z najbliższą strefą), `INVALID_RENTAL_TRANSITION`, `USER_HAS_OPEN_RENTAL`, `WALLET_BALANCE_NOT_ZERO` (pytanie 7); `INSUFFICIENT_BALANCE` w iteracji 5 (D1).
- [x] **Panel:**
  - [x] „Przejazdy” w nawigacji: lista według wzorca z szybkimi filtrami i liczbami, panel boczny z trasą i osią czasu (`admin-przejazdy`), aktualizacja na żywo;
  - [x] szczegóły przejazdu i zdalne zakończenie (nowe makiety);
  - [x] odnośnik do bieżącego przejazdu na karcie hulajnogi i na mapie floty; komendy przejazdu w dzienniku komunikacji hulajnogi.
- [x] **Aplikacja** (ADR o mapie, lokalizacji i aparacie):
  - [x] nawigacja: mapa jako ekran główny po zalogowaniu (zastępuje zaślepkę `/konto`), profil z awatara, ekran przejazdu przejmuje aplikację przy otwartym przejeździe (także po ponownym uruchomieniu), bramka z iteracji 2 bez zmian;
  - [x] zgoda na lokalizację i stan bez zgody, mapa z wolnymi hulajnogami i strefami z `GET /zones`, karta hulajnogi, brak hulajnóg w pobliżu, brak internetu;
  - [x] rezerwacja z odliczaniem i anulowaniem, wygaśnięcie;
  - [x] skanowanie kodu QR, wpisanie numeru, brak dostępu do aparatu, szczegóły hulajnogi z suwakiem odblokowania, hulajnoga niedostępna;
  - [x] odblokowywanie, nieudane odblokowanie, jazda (czas, dystans, prędkość, koszt według D1), pauza i wznowienie, poza strefą parkowania (najbliższa strefa na mapie; „Prowadź do strefy” w iteracji 4), kończenie, podsumowanie;
  - [x] profil (statystyki, saldo z portfela, odnośniki do regulaminu i polityki), historia przejazdów z pustym stanem i szczegółami (podsumowanie), ustawienia (preferencje powiadomień, zgoda marketingowa, motyw według D6), dane osobowe, usunięcie konta z saldem i warunkami, wylogowanie. Pozycje „Metody płatności” i „Pomoc i zgłoszenia” pojawią się w iteracjach 5 i 6.
- [x] **Dokumentacja:** arc42 §6.1–6.4 (wygaszanie i anulowanie rezerwacji, pauza z potwierdzeniem blokady, zakończenie według D1 i D2, zdalne zakończenie), §5.2 moduł Wypożyczenia i Zadania w tle, §8 (zadania w tle, idempotencja komend), §11 (ryzyka); [model danych](../model-danych/README.md); tabela zgodności w [wymaganiach uczelni](../wymagania-uczelni.md); spis makiet w [`projekt/README.md`](../projekt/README.md).

## ADR-y do napisania
Numery są propozycją (ostatni to 0035). Każdy ADR powstaje przed kodem, którego dotyczy.

| Nr | Temat | Co rozstrzyga |
|---|---|---|
| 0036 | Proces wypożyczenia w API | Przejście stanu w jednej transakcji z blokadą wiersza hulajnogi i przejazdu, zmiana `scooters.status` razem z przejazdem, powiązanie komend z przejazdem (`scooter_commands.rental_id`), stany przejściowe czekające na potwierdzenie (wznowienie, pauza, kończenie), idempotencja startu (otwarty przejazd zamiast klucza idempotencji), zdarzenia dla klienta przez Socket.IO z pokojami z [ADR 0012](../adr/0012-socket-io.md) i uwierzytelnieniem z [ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md) |
| 0037 | Zadania w tle w pg-boss: konfiguracja i zadania | Uzupełnia [ADR 0016](../adr/0016-zadania-w-tle-pg-boss.md): wersja, schemat w bazie, planowanie zadania w transakcji Drizzle, zadania jednorazowe (wygaśnięcie rezerwacji, limit potwierdzenia) i cykliczne (zabezpieczenie wygaszania, partycje i retencja telemetrii, czyszczenie kodów i sesji), jeden proces API. Zastępuje liczniki `setInterval` z [ADR 0033](../adr/0033-telemetria-i-status-floty.md) |
| 0038 | Wygasanie komend MQTT | Problem: sesja trwała i QoS 1 dostarczą komendę `unlock` hulajnodze, która wróci online po `UNLOCK_FAILED`, więc odblokuje się bez przejazdu. Opcje: pole `expiresAt` w komendzie, wygaśnięcie wiadomości w MQTT 5, komenda `lock` po spóźnionym potwierdzeniu. Zmiana kontraktu do wersji 1.1.0 |
| 0039 | Symulator w trakcie przejazdu klienta | Zastępuje część [ADR 0034](../adr/0034-symulator-floty.md): co robi hulajnoga po odblokowaniu komendą (cel, trasa, prędkość), brak samoczynnej blokady, przejazdy pokazowe wyłączone domyślnie, sterowanie celem w demo |
| 0040 | Mapa, lokalizacja i aparat w aplikacji | [ADR 0005](../adr/0005-react-native-expo.md) i [ADR 0017](../adr/0017-uslugi-mapowe.md) zakładają natywny MapLibre, który wymaga development build zamiast Expo Go. Do rozstrzygnięcia: wersja web aplikacji (MapLibre GL JS), wersje `expo-location` i `expo-camera` (sprawdzone, starsze niż 3 dni), podgląd w przeglądarce (`mobile-web`) |
| 0041 | Kod QR hulajnogi | Co zawiera kod (adres z numerem, który otwiera aplikację, albo sam numer), wpisanie numeru jako równorzędna droga, kto i jak drukuje kody (karta hulajnogi w iteracji 7) |
| 0042 | Wycena przejazdu | Po D1: czysta funkcja w core, każda rozpoczęta minuta jazdy i pauzy, wersja cennika z przejazdu, koniec naliczania przy żądaniu zakończenia, zapis `total_amount` przy `ENDED`, bez obciążenia portfela do iteracji 5 |

ADR o zdjęciach parkowania w SeaweedFS nie powstaje (D2: iteracja 6).

## Odpowiedzi autora (16 listopada 2026)
Autor przyjął wszystkie rekomendacje D1–D8 i domyślne odpowiedzi na pytania. Kwoty i czasy dalej pochodzą z wersji cennika (w seedzie `DEV_TARIFF`, wartości deweloperskie). Marka i ostateczne ceny zostają otwarte w `CLAUDE.md`.

| Pytanie | Odpowiedź |
|---|---|
| 1. Rezerwacja | Bezpłatna przez `free_reservation_minutes` z wersji cennika w przejeździe; po tym czasie zawsze wygasa (`EXPIRED`). Bez przedłużania i bez płatnej rezerwacji. Tę samą hulajnogę można od razu zarezerwować ponownie. Bez limitu rezerwacji i anulowań na klienta. |
| 2. Minimalne saldo | Nie sprawdzamy w tej iteracji (D1); reguła wchodzi w iteracji 5 razem z portfelem. |
| 3. Naliczanie | Każda rozpoczęta minuta jazdy i osobno każda rozpoczęta minuta pauzy. Naliczanie kończy się w chwili żądania zakończenia (zdarzenie `END_REQUESTED`), jeśli blokada zostanie potwierdzona. Pauza bez limitu czasu. |
| 4. Próg baterii | `min_battery_pct` z wersji cennika (seed: 15%). Makieta `admin-hulajnoga` (20%) jest przykładem, a odmowa symulatora poniżej 5% to osobne zabezpieczenie hulajnogi. |
| 5. Brak potwierdzenia blokady | Po 10 s przejazd wraca z `ENDING` do `ACTIVE` (zdarzenie `LOCK_FAILED`), klient widzi „Nie udało się zablokować” i może ponowić. Naliczanie trwa dalej. Zakończenie bez blokady tylko przez operatora (D7). Pełna reguła utraty łączności w iteracji 6. |
| 6. Poza strefą parkowania | Twarda blokada: błąd `OUTSIDE_PARKING` z najbliższą strefą. Zakończenie poza strefą za `out_of_zone_fee` najwcześniej w iteracji 5. |
| 7. Saldo przy usunięciu konta | Saldo różne od 0 blokuje usunięcie (`WALLET_BALANCE_NOT_ZERO`). W tej iteracji każde saldo to 0; zasady zwrotu w iteracji 5. |
| 8. Zdalne zakończenie | Klient płaci za czas do chwili zakończenia przez operatora, bez opłaty za parkowanie poza strefą. |
| 9. Wyszukiwanie | Promień 2 km, najwyżej 50 hulajnóg. |
| 10. Retencja | Telemetria 90 dni; wygasłe sesje, zaproszenia i kody SMS usuwane 30 dni po wygaśnięciu. |

| Decyzja | Rozstrzygnięcie |
|---|---|
| D1 | Wycena w tej iteracji: czysta funkcja w `packages/core` na wersji cennika z przejazdu, bieżący koszt na ekranie jazdy, `total_amount` przy zakończeniu, kwota w podsumowaniu i w panelu. Obciążenie portfela, minimalne saldo, `UNPAID` i paragony w iteracji 5. Przejazd kończy się `ENDED`. Warunkowy ADR o wycenie powstaje (0042). |
| D2 | Zdjęcie parkowania w iteracji 6; diagram §6.4 dostaje adnotację. ADR o zdjęciach w SeaweedFS nie powstaje w tej iteracji. |
| D3 | Rezerwacja z karty hulajnogi na mapie przez `POST /reservations`; start bez rezerwacji przez skan albo numer. |
| D4 | Symulator po odblokowaniu jedzie do losowej strefy parkowania i tam czeka. |
| D5 | Dzwonek w zakresie; „Trasa” i „Zgłoś” ukryte do iteracji 4 i 6. |
| D6 | Motyw: systemowy, jasny, ciemny; motyw i „Pokazuj strefy na mapie” na urządzeniu, preferencje powiadomień w bazie. |
| D7 | Operator z `rentals.manage` kończy przejazd w `ACTIVE`, `PAUSED` albo `ENDING` niezależnie od strefy, z powodem, komendą `lock`, wpisem w audycie i na osi czasu. |
| D8 | „Pobierz moje dane” w iteracji 7; w tej iteracji pozycja ukryta. |

Skutki dla planu: wycena przechodzi z iteracji 5 do 3 ([plan iteracji](README.md)); minimalne saldo i błąd `INSUFFICIENT_BALANCE` wypadają z tej iteracji; nowy błąd `WALLET_BALANCE_NOT_ZERO`; stan `ENDING` ma powrót do `ACTIVE` po nieudanej blokadzie.

## Pytania do autora: wartości biznesowe
Otwarte decyzje z `CLAUDE.md`. Seed ma wartości deweloperskie (`DEV_TARIFF` w `packages/db/src/seed.ts`), a makiety pokazują nawiasy. Plan ich nie ustala.

1. **Czas bezpłatnej rezerwacji** (`free_reservation_minutes`, makieta: „[CZAS] min”). Czy po nim rezerwacja zawsze wygasa (tak mówi `mapa-rezerwacja`), czy może przejść w płatną? Czy rezerwację można przedłużyć albo ponowić na tę samą hulajnogę i czy jest limit rezerwacji lub anulowań na klienta?
2. **Minimalne saldo do startu** (`min_wallet_balance`, „[MINIMUM] zł”). Czy sprawdzamy je już w tej iteracji (zależy od D1)?
3. **Ceny i naliczanie:** opłata za odblokowanie, stawka za minutę jazdy i za minutę pauzy. Czy naliczamy za każdą rozpoczętą minutę, czy co do sekundy? Kiedy kończy się naliczanie: przy żądaniu zakończenia czy przy potwierdzeniu blokady? Czy pauza ma limit czasu?
4. **Próg baterii do wypożyczenia** (`min_battery_pct`). Seed ma 15%, makieta `admin-hulajnoga` pokazuje próg 20%, a symulator odmawia odblokowania poniżej 5%.
5. **Naliczanie czasu przy utracie łączności.** Czy klient może zakończyć przejazd, gdy hulajnoga jest offline i nie potwierdza blokady? Od kiedy przestajemy naliczać? Pełna reguła jest w iteracji 6, ale kończenie przejazdu potrzebuje jej w tej iteracji choćby w wersji minimalnej.
6. **Parkowanie poza strefą.** Plan zakłada „tu nie zakończysz jazdy” jak w `przejazd-poza-strefa` i błąd `OUTSIDE_PARKING`. Czy `out_of_zone_fee` oznacza możliwość zakończenia poza strefą za opłatą, a jeśli tak, w której iteracji?
7. **Saldo przy usunięciu konta** („[ZASADY ZWROTU]” w `profil-usun-konto`). Czy dodatnie saldo jest zwracane, przepada, czy blokuje usunięcie? Czy ujemne saldo albo zaległość blokuje usunięcie?
8. **Zdalne zakończenie przez operatora:** czy klient płaci za czas do chwili zakończenia i czy obowiązuje opłata za parkowanie poza strefą (D7)?
9. **Promień wyszukiwania i liczba hulajnóg na mapie.** Na przykład `stan-brak-hulajnog` pokazuje najbliższą hulajnogę 1,2 km dalej.
10. **Retencja telemetrii** (`sp_purge_telemetry`) i okres przechowywania wygasłych sesji i kodów przed usunięciem.

## Decyzje do potwierdzenia
Rozstrzygnięcia zakresu z rekomendacją. Autor potwierdza albo zmienia.

- **D1. Wycena i obciążenie.** Rekomendacja: wycena (czysta funkcja w core na wersji cennika z przejazdu) już w tej iteracji. Pokazuje bieżący koszt na ekranie jazdy, zapisuje `total_amount` przy zakończeniu i kwotę w podsumowaniu i panelu. Obciążenie portfela, minimalne saldo, `UNPAID` i paragony zostają w iteracji 5, a przejazd kończy się `ENDED` po potwierdzeniu blokady. Wtedy w [planie iteracji](README.md) „wycena” przechodzi z iteracji 5 do 3. Alternatywa: przejazd bez kwot do iteracji 5, a podsumowanie tylko z czasem i dystansem (odstępstwo od makiety).
- **D2. Zdjęcie parkowania** (`przejazd-zdjecie`, arc42 §6.4). Rekomendacja: przenieść je do iteracji 6. Służy rozstrzyganiu zgłoszeń o źle zaparkowanych hulajnogach, wymaga pierwszego użycia SeaweedFS i aparatu, a w symulatorze iOS i w wersji web aparatu nie ma, więc obowiązkowe zdjęcie zablokowałoby demo. Diagram §6.4 dostanie wtedy adnotację.
- **D3. Rezerwacja** z karty hulajnogi na mapie (nowa makieta) i przez `POST /reservations`. Start przejazdu bez rezerwacji przez skan, zgodnie z §6.1.
- **D4. Ruch hulajnogi w demo:** symulator po odblokowaniu jedzie do losowej strefy parkowania i tam czeka (ADR 0039). W iteracji 6 wybór celu przejdzie na ekran symulatora w panelu.
- **D5. Dzwonek z aplikacji** (`produkt-hulajnoga`): w zakresie, bo komenda `RING` już działa. „Trasa” (prowadzenie pieszo) i „Zgłoś” zostają ukryte do iteracji 4 i 6.
- **D6. Motyw w ustawieniach:** tokeny ciemne są już w `apps/mobile/src/theme/tokens.ts`, a makiety trybu ciemnego są dla czterech ekranów. Rekomendacja: przełącznik systemowy, jasny i ciemny w tej iteracji, z ekranami bez planszy ciemnej na tych samych tokenach. „Pokazuj strefy na mapie” i motyw są zapisane na urządzeniu, a preferencje powiadomień w bazie.
- **D7. Zdalne zakończenie:** operator z `rentals.manage` kończy przejazd w stanie `ACTIVE`, `PAUSED` albo `ENDING` niezależnie od strefy. Wysyła komendę `lock`, podaje powód i zostawia wpis w dzienniku audytu i na osi czasu. Skutki finansowe według pytania 8.
- **D8. „Pobierz moje dane”** z ustawień: rekomendacja to iteracja 7 (silnik dokumentów), a w tej iteracji pozycja jest ukryta.

## Poza zakresem (świadomie)
- Edytor stref, limit prędkości w strefie wolnej jazdy, zdarzenia wjazdu i wyjazdu ze strefy, „Prowadź do strefy”, wyszukiwanie celu (`mapa-szukaj`): iteracja 4.
- Portfel z doładowaniem, metody płatności, obciążenie za przejazd, `UNPAID`, paragony, wersje cennika w panelu, cennik w aplikacji: iteracja 5 (zakres wyceny według D1).
- Utrata łączności z naliczaniem czasu (`przejazd-lacznosc`), niska bateria w trakcie jazdy (`przejazd-bateria`), zgłoszenie usterki, powiadomienia push, ekran symulatora w panelu: iteracja 6.
- Zdjęcie parkowania: iteracja 6, jeśli autor potwierdzi D2.
- Eksport listy przejazdów do XLSX i CSV: iteracja 8.

## Kolejność kroków
1. Odpowiedzi autora na pytania 1–10 i decyzje D1–D8; aktualizacja tego planu i, przy zmianie granic iteracji, [planu iteracji](README.md).
2. Makiety brakujących stanów (lista wyżej) z PNG obejrzanymi przed implementacją i wpisem w [spisie makiet](../projekt/README.md).
3. ADR 0036–0041 (i warunkowe), zaakceptowane przed kodem.
4. Migracja 0005, `pnpm db:pull`, testy bazy (liczby obiektów, reguły przejazdu pilnowane przez bazę, czyszczenie sesji).
5. `packages/core`: reguły przejazdu, rezerwacji, zakończenia i wyceny według D1 z testami jednostkowymi.
6. Kontrakty: AsyncAPI MQTT 1.1.0 i Socket.IO, schematy w `packages/shared`; symulator: wygaśnięcie komend i jazda po odblokowaniu (testy symulatora).
7. pg-boss w API: zadania z dziennika długu technicznego i przeniesienie liczników `setInterval`; testy z bazą.
8. `packages/db` i API klienta: rezerwacja, start, pauza, wznowienie, zakończenie, potwierdzenia MQTT, Socket.IO klienta; test API całego przejazdu z symulowanym potwierdzeniem i z brakiem potwierdzenia.
9. API panelu: lista, szczegóły, zdalne zakończenie z dziennikiem audytu; `pnpm api:openapi`.
10. Panel: Przejazdy, szczegóły, zdalne zakończenie, odnośniki z floty.
11. Aplikacja: development build według ADR 0040, nawigacja, mapa, lokalizacja, rezerwacja, skan i numer, przejazd, podsumowanie.
12. Aplikacja: profil, historia, ustawienia, dane osobowe, usunięcie konta.
13. Domknięcie: arc42, model danych, wymagania uczelni, spis makiet, odstępstwa w dzienniku, scenariusz demo przejdzie krok po kroku, `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, zielone CI.

## Scenariusz demo
Wymaga infrastruktury z OSRM i danych startowych (`pnpm infra:up && pnpm db:migrate && pnpm db:places && pnpm db:seed`), panelu na `WEB_PORT=3002` i aplikacji (development build w symulatorze iOS albo wersja web). Kod SMS jest w logu API. Wartości w nawiasach zależą od odpowiedzi na pytania.

1. `pnpm dev`; symulator wypisuje 40 hulajnóg i 0 przejazdów pokazowych na godzinę. Panel → „Mapa floty”: hulajnogi stoją, „Przejazdy” pokazuje przykładowe przejazdy z danych startowych.
2. Aplikacja: logowanie kodem SMS → zgoda na lokalizację → mapa z wolnymi hulajnogami w pobliżu Rynku i strefami parkowania. Hulajnoga z baterią poniżej progu nie jest widoczna; po wpisaniu jej numeru aplikacja pokazuje „Tej hulajnogi nie wypożyczysz” z przyczyną.
3. Karta hulajnogi → „Zarezerwuj”: odliczanie [CZAS] min. W panelu hulajnoga ma status „Rezerwacja”, a „Przejazdy” pokazuje nowy przejazd w stanie rezerwacji. Anulowanie zwalnia hulajnogę w obu miejscach od razu.
4. Ponowna rezerwacja i odczekanie do wygaśnięcia (w demo krótki czas z wersji cennika deweloperskiej): zadanie pg-boss zmienia stan na „Wygasła”, aplikacja wraca na mapę z komunikatem, oś czasu w panelu ma zdarzenie z powodem.
5. „Skanuj i jedź” → „Wpisz numer hulajnogi” → szczegóły z suwakiem → „Odblokowuję hulajnogę…”. Symulator potwierdza komendę, ekran przechodzi w jazdę z czasem, dystansem, prędkością i kosztem (D1), a hulajnoga rusza na mapie floty w panelu.
6. „Pauza”: komenda `lock` z potwierdzeniem, ekran pauzy z drugim licznikiem. „Wznów jazdę”: ponowne odblokowanie.
7. „Zakończ” przed dojazdem do strefy: „Tu nie zakończysz jazdy” z odległością do najbliższej strefy. Po dojechaniu symulatora do strefy parkowania: „Zakończ” → potwierdzenie blokady → podsumowanie. Historia przejazdów w profilu zawiera przejazd, a panel pokazuje go jako zakończony z trasą i pełną osią czasu (rezerwacja, odblokowanie, pauza, wznowienie, zakończenie, każda komenda z czasem potwierdzenia).
8. Nieudane odblokowanie: ekran symulatora w panelu jest dopiero w iteracji 6, więc wybraną hulajnogę rozłącza mechanizm symulatora z zakresu tej iteracji. Hulajnoga nie potwierdza komendy, po 10 s aplikacja pokazuje „Nie udało się odblokować”, a przejazd ma stan `UNLOCK_FAILED` bez kosztu. Po powrocie hulajnogi online przeterminowana komenda nie odblokowuje jej (ADR 0038).
9. Zdalne zakończenie: nowy przejazd w aplikacji, w panelu „Przejazdy” → przejazd → „Zakończ zdalnie” z powodem. Aplikacja przechodzi do podsumowania, a wpis jest w dzienniku audytu i na osi czasu. Serwisant (rola bez `rentals.read` i `rentals.manage`) nie widzi przejazdów, a API zwraca 403; Dyspozytor ma `rentals.manage` z migracji 0002.
10. Profil: statystyki, saldo 0 zł, ustawienia (motyw, powiadomienia, zgoda marketingowa widoczna w karcie klienta w panelu), edycja danych. „Usuń konto” w trakcie przejazdu jest odrzucone; po zakończeniu konto jest zanonimizowane, aplikacja wraca do ekranu startowego, a w panelu klient ma status „Usunięty” z zachowanymi przejazdami.

## Wynik
Zakres zrealizowany 16–17 listopada 2026; przebieg, odstępstwa i weryfikacja w [dzienniku](../dziennik.md#iteracja-3-wypożyczenie-16-listopada-2026). Otwarte: development build aplikacji z natywną mapą i aparatem (ADR 0040), ekrany awarii w aplikacji sprawdzone tylko testami API, zmiana numeru telefonu klienta (decyzja na później), zielone CI.
