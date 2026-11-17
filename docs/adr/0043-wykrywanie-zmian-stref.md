# ADR 0043: Wykrywanie zmian stref z telemetrii

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

W iteracji 4 przejazd ma reagować na strefy ([plan iteracji 4](../iteracje/iteracja-04-strefy.md)):
- wjazd do strefy wolnej jazdy daje limit prędkości;
- wjazd do strefy zakazu i wyjazd poza obszar działania zatrzymują hulajnogę;
- oś czasu przejazdu dostaje zdarzenia `ZONE_ENTERED` i `ZONE_EXITED` (wartości są w typie `rental_event_type` od migracji 0001);
- klient widzi komunikat na ekranie jazdy.

Dziś telemetria przechodzi przez moduł Telemetria partiami co 1 s ([ADR 0033](0033-telemetria-i-status-floty.md)). Moduł przypisuje odczyt do otwartego przejazdu, a stref nie sprawdza. Reguły stref w punkcie liczy `evaluatePosition` w core, a strefy w punkcie zwraca `fn_zones_at_point` z indeksem GiST.

Co jest do rozstrzygnięcia:
- **Gdzie żyje wykrywanie i stan:** zasada monolitu modularnego mówi, że moduł nie czyta tabel innego modułu ([ADR 0003](0003-monolit-modularny.md)).
- **Dla których hulajnóg:** tylko w przejeździe czy dla całej floty.
- **Dokładność GPS:** odczyty przy granicy skaczą, więc bez histerezy oś czasu dostałaby serię wjazdów i wyjazdów, a hulajnoga serię komend. Autor przyjął regułę (pytanie 6): wjazd od pierwszego odczytu w strefie, wyjazd po dwóch kolejnych odczytach poza strefą albo po oddaleniu o więcej niż 10 m.
- **Punkty dosłane z bufora:** hulajnoga po odzyskaniu łączności wysyła odczyty sprzed kilku minut (`buffered: true`).

## Rozważane opcje

1. **Wykrywanie w module Telemetria** bezpośrednio w transakcji zapisu partii. Mało kodu, ale Telemetria zaczęłaby czytać strefy i pisać na oś czasu przejazdu, czyli tabele dwóch innych modułów.
2. **Wykrywanie w module Strefy wołanym przez port**, wynik przekazany do modułu Wypożyczenie. Telemetria po zapisie partii przekazuje odczyty przejazdów do Stref; Strefy trzymają bieżące strefy hulajnogi i liczą przejścia regułą z core; Wypożyczenie zapisuje zdarzenia i decyduje o komendach.
3. **Wyzwalacz w bazie** na tabeli telemetrii. Spójne i szybkie, ale reguły (histereza, pierwszeństwo stref, punkty z bufora) trafiłyby do SQL zamiast do `packages/core` ([ADR 0025](0025-logika-biznesowa-packages-core.md)), a wyzwalacz na partycjonowanej tabeli telemetrii obciąża każdy zapis.

## Decyzja

**Opcja 2.** Szczegóły:

- **Zakres:** wykrywanie dotyczy tylko hulajnóg w przejeździe w stanach `ACTIVE`, `PAUSED` i `ENDING`, czyli tych, którym telemetria już przypisuje `rental_id`. Dostępność hulajnóg stojących poza przejazdem (przyczyna `OUT_OF_AREA`, pytanie 4) i zajętość stref parkowania liczy zapytanie przestrzenne w chwili odczytu (`fn_nearest_scooters`, widoki z migracji 0006), bez stanu.
- **Stan:** tabela `scooter_zone_presence` modułu Strefy (migracja 0006), w której jeden wiersz to jedna strefa danej hulajnogi. Kolumny:
  - `scooter_id`, `zone_id`, `rental_id`;
  - `entered_at` (czas odczytu, który dał wjazd; z niego bierze się kolumna „W strefie od” w panelu);
  - `outside_count`, czyli liczba kolejnych odczytów poza strefą.

  Wiersz znika przy wyjściu ze strefy albo przy zakończeniu przejazdu.
- **Reguła w core:** czysta funkcja `detectZoneChanges(previous, reading)`.
  - `previous` to bieżące strefy hulajnogi z licznikami;
  - `reading` to strefy zawierające punkt i strefy w promieniu 10 m od punktu (jedno zapytanie przestrzenne na partię: `ST_DWithin` na geografii z flagą `ST_Contains`).

  Funkcja zwraca nowy stan i listę przejść:
  - strefa zawierająca punkt, której nie było w stanie, to wjazd;
  - strefa ze stanu, która nie zawiera punktu, dostaje `outside_count + 1`;
  - wyjście następuje przy `outside_count = 2` albo gdy strefa nie jest nawet w promieniu 10 m.
  - Pierwszy odczyt przejazdu (pusty stan) ustawia stan bez zdarzeń. Strefy, w których przejazd się zaczyna, to nie wjazd. Komendy i tak wynikają ze stanu ([ADR 0044](0044-komendy-stref-dla-hulajnogi.md)), więc start w strefie wolnej jazdy od razu dostaje limit.
  - Obszar działania liczy się jak każda strefa. W praktyce jego zdarzeniami są tylko wyjazd i powrót, bo przejazd zaczyna się w obszarze (pytanie 4).
- **Przebieg:** Telemetria po zatwierdzeniu partii woła port `ZoneTracker.track(readings)` z odczytami przejazdów (hulajnoga, przejazd, punkt, czas, `buffered`).
  - Strefy w jednej transakcji: czytają stan, liczą przejścia regułą z core, zapisują stan i zwracają przejścia.
  - Wypożyczenie dostaje przejścia przez port `RentalZoneEvents` i w swojej transakcji:
    - zapisuje `ZONE_ENTERED` albo `ZONE_EXITED` na osi czasu z `zone_id` i czasem odczytu;
    - uzgadnia komendy według [ADR 0044](0044-komendy-stref-dla-hulajnogi.md);
    - wysyła `rental.updated`.
- **Kolejność i punkty z bufora:** odczyty partii są przetwarzane według `recorded_at`. Punkty z bufora zmieniają stan i dają zdarzenia z prawdziwym czasem, ale nie uruchamiają komend: komendę wyznacza dopiero stan po ostatnim odczycie bieżącym ([ADR 0044](0044-komendy-stref-dla-hulajnogi.md)).
- **Zmiana stref w panelu:** po zapisie, dezaktywacji albo usunięciu strefy moduł Strefy przelicza stan hulajnóg w trwających przejazdach od ich ostatniej pozycji, bez czekania na odczyt. Przejścia z tego przeliczenia idą tą samą ścieżką (pytanie 7).
- **Koszt:** jedno zapytanie przestrzenne na partię (wszystkie punkty partii w jednym `unnest`), a nie na odczyt. Przy 40 hulajnogach i odczycie co 5 s to kilkanaście punktów na partię.

## Konsekwencje

Pozytywne:

- Reguły (histereza, pierwszeństwo, obszar działania) są w core i mają testy jednostkowe bez bazy.
- Moduły komunikują się portami: Telemetria nie zna stref, Strefy nie piszą na oś czasu przejazdu.
- Stan w bazie przeżywa restart API, więc po restarcie nie ma fałszywych wjazdów.

Negatywne i ryzyka:

- Komunikat o strefie przychodzi z opóźnieniem: odczyt co 5 s plus okno 1 s. Przy 15 km/h to do około 25 m za granicą. Dla demo wystarczy; prawdziwy sprzęt miałby geofencing w urządzeniu.
- Wyjazd ze strefy jest potwierdzany dwoma odczytami, czyli do 10 s. Limit prędkości trzyma się więc chwilę dłużej po wyjeździe, co jest bezpieczniejszym błędem.
- Hulajnogi poza przejazdem nie mają zdarzeń stref (na przykład przewiezione przez serwis). Wystarcza, bo zdarzenia należą do osi czasu przejazdu.

## Powiązane

[ADR 0003](0003-monolit-modularny.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0033](0033-telemetria-i-status-floty.md), [ADR 0036](0036-proces-wypozyczenia-w-api.md), [ADR 0044](0044-komendy-stref-dla-hulajnogi.md), arc42 §6.3, [plan iteracji 4](../iteracje/iteracja-04-strefy.md) (pytania 2–4, 6 i 7)
