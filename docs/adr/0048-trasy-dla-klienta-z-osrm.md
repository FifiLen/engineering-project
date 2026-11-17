# ADR 0048: Trasy dla klienta z OSRM

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Aplikacja w iteracji 4 rysuje trzy rodzaje tras (makiety `22-mobile-strefy`, decyzje D5 i D6 w [planie iteracji 4](../iteracje/iteracja-04-strefy.md)):
- **prowadzenie do najbliższej strefy parkowania** w trakcie jazdy („Prowadź do strefy” z `przejazd-poza-strefa`);
- **trasa piesza do hulajnogi** po rezerwacji i po „Trasa” na ekranie hulajnogi;
- **szacunek czasu dojazdu** do celu z wyszukiwania ([ADR 0045](0045-wyszukiwanie-miejsc-photon.md)).

[ADR 0017](0017-uslugi-mapowe.md) zakłada OSRM w Dockerze z wycinkiem województwa śląskiego dla backendu i symulatora. Dziś korzysta z niego tylko symulator, a kontener ma jeden profil: rowerowy (`infra/osrm/prepare.sh`, `bicycle.lua`).

Pomiar 17 listopada 2026 na tym samym wycinku (`slaskie-latest.osm.pbf`, 187 MB) i obrazie `osrm-backend:v26.11.0-debian`:

| Profil | Przygotowanie (extract, partition, customize) | Dane na dysku | Pamięć `osrm-routed` |
|---|---|---|---|
| rowerowy (obecny) | około 1 min | około 850 MB | około 560 MiB |
| pieszy (`foot.lua`) | 54 s | 796 MB | około 500 MiB |

Trasa piesza z Rynku na dworzec PKP: 1,1 km, około 13 min.

## Rozważane opcje

Dla trasy pieszej (D6):

1. **Drugi kontener OSRM z profilem pieszym.** Prawdziwe drogi piesze (deptaki, przejścia, schody), kosztem około 0,8 GB danych i 0,5 GB pamięci.
2. **Profil rowerowy z dopiskiem „szacunkowo”.** Bez nowej usługi, ale trasa omija deptaki, a czas pieszy trzeba przeliczać z rowerowego.
3. **Linia prosta z odległością.** Bez OSRM, ale bez czasu dojścia i z trasą przez budynki.

Dla miejsca, z którego aplikacja bierze trasy:

1. **Aplikacja pyta OSRM bezpośrednio.** Łamie zasadę, że klienci znają tylko API, i wystawia OSRM na zewnątrz.
2. **API jako pośrednik** z adapterem OSRM, zawężeniem do obszaru działania i zachowaniem przy awarii.

## Decyzja

- **Trasa piesza: opcja 1.** Koszt jest akceptowalny według pomiaru.
  - `infra/` dostaje usługę `osrm-foot` z tym samym obrazem i plikiem `.osm.pbf`, osobnym katalogiem danych (`infra/osrm/foot/`) i przygotowaniem z `foot.lua`.
  - Port to `OSRM_FOOT_PORT`, domyślnie 5001; port 5000 na macOS zajmuje AirPlay, więc jak przy `OSRM_PORT` wartość można zmienić.
- **Trasy przez API: opcja 2.** Port `RoutePlanner` w API z implementacją OSRM. Adresy z `OSRM_URL` (rower) i `OSRM_FOOT_URL` (pieszo); limit czasu 2 s. Punkty API (dostęp `@CustomerAuth()`):
  - **`GET /zones/nearest-parking?lat=…&lon=…`** (prowadzenie do strefy):
    - najbliższa aktywna strefa parkowania w linii prostej (funkcja z migracji 0006);
    - punkt docelowy to `ST_ClosestPoint` granicy strefy od klienta, a nie jej środek, więc prowadzenie kończy się po wjeździe;
    - trasa na profilu rowerowym.
  - **`GET /scooters/{id}/walk?lat=…&lon=…`** (trasa piesza do hulajnogi): tylko dla hulajnogi dostępnej albo zarezerwowanej przez tego klienta, w promieniu wyszukiwania 2 km (`NEARBY_RADIUS_M` z iteracji 3).
  - **szacunek czasu do celu:** w odpowiedzi wybranego miejsca z wyszukiwania, na profilu rowerowym.

  Odpowiedź ma linię trasy (`[lon, lat]`, uproszczoną do 6 miejsc), odległość w metrach, czas w sekundach i `approximate: boolean`.
- **Przy niedostępnym OSRM** API zwraca linię prostą z odległością, `durationSec: null` i `approximate: true`. Aplikacja pokazuje „N m w linii prostej” bez czasu, jak w makiecie `hulajnoga-trasa`. Brak OSRM nigdy nie blokuje jazdy ani zakończenia.
- **Odświeżanie:** aplikacja prosi o nową trasę, gdy klient oddali się od niej o więcej niż 30 m, nie częściej niż co 10 s. Wcześniej odliczanie odległości liczy lokalnie. Prowadzenie do strefy kończy się samo po zdarzeniu wjazdu do strefy parkowania ([ADR 0043](0043-wykrywanie-zmian-stref.md)).
- **Pamięć podręczna:** brak, bo trasy zależą od bieżącej pozycji. Ochroną jest limit 30 zapytań na minutę na klienta, wspólny z wyszukiwaniem.
- **Bez nawigacji zakręt po zakręcie** (D5): API nie zwraca manewrów (`steps=false`).

## Konsekwencje

Pozytywne:

- Trasa piesza prowadzi drogami dla pieszych, a czas dojścia jest wiarygodny.
- Aplikacja zna tylko API, a OSRM nie jest wystawiony poza komputer dewelopera.
- Awaria OSRM obniża tylko jakość podpowiedzi, nie działanie wypożyczenia.

Negatywne i ryzyka:

- Pierwsze `pnpm infra:up` przygotowuje drugi zestaw danych OSRM: około minuty dłużej i około 0,8 GB więcej na dysku.
- Najbliższa strefa w linii prostej nie zawsze jest najbliższa drogą (na przykład przez rzekę). Możliwe ulepszenie: trasy do trzech najbliższych i wybór najkrótszej.
- Dwa procesy OSRM to około 1 GB pamięci na komputerze dewelopera.

## Powiązane

[ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0017](0017-uslugi-mapowe.md), [ADR 0040](0040-mapa-lokalizacja-aparat-w-aplikacji.md), [ADR 0043](0043-wykrywanie-zmian-stref.md), [ADR 0045](0045-wyszukiwanie-miejsc-photon.md), [plan iteracji 4](../iteracje/iteracja-04-strefy.md) (D5, D6)
