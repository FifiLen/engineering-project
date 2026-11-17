# ADR 0045: Wyszukiwanie miejsc (Photon)

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Aplikacja dostaje pasek „Dokąd jedziesz?” (makiety `04-mobile-mapa/mapa-szukaj`, `22-mobile-strefy/szukaj-wynik` i `szukaj-brak-wynikow`). [ADR 0017](0017-uslugi-mapowe.md) wybrał do wyszukiwania adresów Photon za adapterem, ale nie rozstrzygnął, kto z niego korzysta ani jak.

Autor przyjął zasady (pytanie 9, D4 i D5 w [planie iteracji 4](../iteracje/iteracja-04-strefy.md)):
- wyniki z obszaru działania z zapasem 1 km;
- 5 wyników;
- tylko ostatnie wyszukiwania na urządzeniu, bez zapisanych miejsc;
- szacunek czasu dojazdu hulajnogą.

Sprawdzone 17 listopada 2026 na publicznym `https://photon.komoot.io/api`:
- parametr `bbox` zawęża wyniki;
- `lang=pl` jest odrzucany (obsługiwane: `default`, `de`, `en`, `fr`);
- `lang=default` zwraca nazwy lokalne, czyli polskie: zapytanie „Rynek” w ramce Rybnika zwraca Rynek, deptak Rynek i Mały Rynek.
- Publiczna instancja jest przeznaczona do umiarkowanego użycia; przy większym ruchu zalecana jest własna.

## Rozważane opcje

1. **Aplikacja pyta Photon bezpośrednio.** Najmniej kodu, ale łamie zasadę, że klienci znają tylko API. Każdy telefon trafia do publicznej usługi bez pamięci podręcznej i limitu, a zmiana dostawcy wymaga nowej wersji aplikacji.
2. **API jako pośrednik do publicznego Photon** z zawężeniem, pamięcią podręczną i limitem zapytań.
3. **Własny kontener Photon** w `infra/`. Niezależny od cudzej usługi, ale indeks nawet dla Polski to kilka GB i długie przygotowanie, nieproporcjonalne do jednego miasta w projekcie.

## Decyzja

**Opcja 2.** Szczegóły:

- **Punkt API:** `GET /places/search?q=…&lat=…&lon=…`, dostęp `@CustomerAuth()`.
  - Zapytanie od 3 znaków, przycięte do 100.
  - Odpowiedź: do 5 miejsc z nazwą, opisem (ulica, dzielnica, miasto), współrzędnymi i odległością od klienta, jeśli podał pozycję.
- **Adapter:** port `PlaceSearch` w API z implementacją `PhotonPlaceSearch` (adres z `PHOTON_URL`, domyślnie publiczna instancja). Parametry zapytania:
  - `bbox` liczony z obszaru działania z zapasem 1 km (`ST_Expand` na geografii w module Strefy);
  - `lang=default`;
  - `limit=5`;
  - `lat` i `lon` klienta jako preferencja odległości;
  - nagłówek `User-Agent` projektu.
- **Pamięć podręczna i limity:**
  - wyniki w pamięci API na 24 godziny, kluczem jest znormalizowane zapytanie (małe litery, bez zbędnych spacji);
  - limit 30 zapytań na minutę na klienta (błąd `RATE_LIMITED`);
  - aplikacja wysyła zapytanie po 300 ms bez pisania.
- **Niedostępność:** po 3 s bez odpowiedzi albo przy błędzie Photon API zwraca `503 PLACES_UNAVAILABLE`, a aplikacja pokazuje wariant błędu z `szukaj-brak-wynikow` z „Spróbuj ponownie”. Brak wyników to pusta lista, nie błąd.
- **Szacunek czasu** na ekranie wyniku liczy API z OSRM na profilu rowerowym, od klienta do celu ([ADR 0048](0048-trasy-dla-klienta-z-osrm.md)). Na liście wyników jest tylko odległość w linii prostej, bez zapytań do OSRM dla każdego wyniku.
- **Ostatnie wyszukiwania:** 5 ostatnich wybranych miejsc na urządzeniu, zapisanych przez `saveSetting` jak motyw i „Pokazuj strefy na mapie” (decyzja D6 z iteracji 3), z „Wyczyść”. Serwer nie zapisuje historii wyszukiwań klienta.
- **Wymiana dostawcy:** własny kontener Photon albo inna usługa to nowa implementacja portu i zmiana `PHOTON_URL`, bez zmiany aplikacji.

## Konsekwencje

Pozytywne:

- Klient zna tylko API, a zawężenie do obszaru działania i limity są w jednym miejscu.
- Pamięć podręczna ogranicza ruch do publicznej usługi, bo popularne zapytania w jednym mieście się powtarzają.
- Historia wyszukiwań nie opuszcza telefonu.

Negatywne i ryzyka:

- Demo zależy od publicznej usługi. Przy jej niedostępności działa wariant błędu, a reszta aplikacji jest niezależna.
- Zapytania klientów przechodzą przez serwer komoot, choć bez danych osobowych: tylko tekst zapytania i pozycja.
- Pamięć podręczna w procesie znika przy restarcie i nie jest współdzielona między instancjami. Wystarcza dla jednego procesu API ([ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)).

## Powiązane

[ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0017](0017-uslugi-mapowe.md), [ADR 0040](0040-mapa-lokalizacja-aparat-w-aplikacji.md), [ADR 0048](0048-trasy-dla-klienta-z-osrm.md), [plan iteracji 4](../iteracje/iteracja-04-strefy.md) (pytanie 9, D4, D5)
