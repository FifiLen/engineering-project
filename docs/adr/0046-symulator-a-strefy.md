# ADR 0046: Symulator a strefy

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Symulator po odblokowaniu jedzie trasą z OSRM do losowej strefy parkowania i tam czeka ([ADR 0039](0039-symulator-w-trakcie-przejazdu.md)). Strefy parkowania i obszar działania czyta z pliku `packages/db/seed/rybnik-places.json`, z którego powstają dane startowe.

W iteracji 4 to nie wystarcza:
- **Strefy z panelu:** operator zmienia, dodaje i dezaktywuje strefy, a symulator ich nie zobaczy. Hulajnoga pojedzie do strefy, której już nie ma, albo ominie nową.
- **Strefa zakazu i wyjazd poza obszar:** hulajnoga ma zwolnić i stanąć (`stop_gradually`), a klient ma ją wyprowadzić pieszo i dostać napęd z powrotem (`release_stop`, [ADR 0044](0044-komendy-stref-dla-hulajnogi.md); pytania 2 i 3 w [planie iteracji 4](../iteracje/iteracja-04-strefy.md)). Symulator musi odegrać tę część, w której człowiek prowadzi hulajnogę.
- **Demo:** potrzebny jest przejazd przez strefę wolnej jazdy, do strefy zakazu i poza obszar, a dziś cel jest losowy.

Symulator ma dwie role:
- **hulajnoga:** zna tylko broker MQTT ([ADR 0002](0002-symulacja-floty-zamiast-sprzetu.md));
- **wirtualny klient:** wybiera cel i prowadzi hulajnogę, co w rzeczywistości robi człowiek z aplikacją.

## Rozważane opcje

1. **Strefy z bazy.** Symulator łączy się z PostgreSQL. Łamie zasadę, że tylko API zna bazę.
2. **Strefy z publicznego `GET /zones`**, tak jak w aplikacji, tylko w części wirtualnego klienta. Część hulajnogi dalej zna tylko MQTT i komendy.
3. **Strefy w MQTT** (wiadomość zachowana z geometrią stref). Tak działa geofencing w części prawdziwych flot, ale przenosi reguły stref do urządzenia, a w tym projekcie reguły są w backendzie ([ADR 0043](0043-wykrywanie-zmian-stref.md)).

## Decyzja

**Opcja 2.** Szczegóły:

- **Źródło stref:** wirtualny klient pobiera `GET /zones` (adres z `SIM_API_URL`, domyślnie `http://localhost:3001`):
  - przy starcie;
  - przed planowaniem każdej trasy;
  - co 60 s, z `If-None-Match` i `ETag` z API.

  Plik miejsc zostaje tylko dla pozycji startowych floty i jako zapas, gdy API nie działa (z ostrzeżeniem w logu).
- **Punkt celu w strefie:** `GET /zones` dostaje we właściwościach `anchor`, czyli punkt wewnątrz wielokąta z `ST_PointOnSurface`. Tak samo korzysta z niego aplikacja do etykiet. Symulator jedzie do `anchor` strefy parkowania zamiast do środka okręgu.
- **Zachowanie hulajnogi** (część MQTT, kontrakt 1.2.0):
  - `stop_gradually`: prędkość spada do 0 w około 3 s, a napęd jest wyłączony;
  - `release_stop`: napęd znów działa;
  - `lock`: kasuje limit i zatrzymanie;
  - `speed_limit` bez `kmh`: zdejmuje limit.
- **Zachowanie wirtualnego klienta po zatrzymaniu:** gdy hulajnoga stoi przez `stop_gradually`, klient prowadzi ją pieszo z prędkością 4 km/h (`v ≈ 4`, `locked: false`) wstecz po przebytej trasie, aż według stref z API znajdzie się poza strefą zakazu albo z powrotem w obszarze. Tam czeka na `release_stop` i planuje nową trasę do losowej strefy parkowania. Bez `release_stop` stoi, a ten przypadek pokazuje panel.
- **Sterowanie celem w demo:** nowe polecenie `pnpm --filter @hulajnogi/simulator control goto <numer> <kod strefy | lat,lon>` zapisuje cel w `.state/control.json` ([ADR 0039](0039-symulator-w-trakcie-przejazdu.md)). Następna trasa tej hulajnogi prowadzi do `anchor` podanej strefy (na przykład S-01 albo Z-01) albo do podanego punktu (na przykład poza obszarem). Cel z pliku jest jednorazowy. Ekran symulatora w panelu (iteracja 6) przejmie to sterowanie.
- **Trasy** dalej pochodzą z OSRM na profilu rowerowym. Trasa może przeciąć strefę zakazu, bo OSRM nie zna stref, co jest zamierzone: tak powstaje sytuacja z pytania 2.

## Konsekwencje

Pozytywne:

- Zmiana strefy w panelu działa w symulatorze najpóźniej po minucie albo przy następnej trasie, bez restartu.
- Część hulajnogi zostaje czystym klientem MQTT, więc kontrakt 1.2.0 testuje się na niej tak, jak na sprzęcie.
- Demo stref da się powtórzyć krok po kroku poleceniem `control goto`.

Negatywne i ryzyka:

- Symulator zależy od działającego API. Bez API wraca do pliku miejsc i nie zna stref z panelu.
- Prowadzenie „wstecz po trasie” jest uproszczeniem: prawdziwy klient wybrałby najkrótszą drogę poza strefę.
- `GET /zones` jest publiczny i bez limitu; odpytywanie co 60 s przez jeden symulator to pomijalny ruch.

## Powiązane

[ADR 0002](0002-symulacja-floty-zamiast-sprzetu.md), [ADR 0034](0034-symulator-floty.md), [ADR 0039](0039-symulator-w-trakcie-przejazdu.md) (zastępuje w części o źródle stref parkowania i celu przejazdu), [ADR 0043](0043-wykrywanie-zmian-stref.md), [ADR 0044](0044-komendy-stref-dla-hulajnogi.md), [plan iteracji 4](../iteracje/iteracja-04-strefy.md)
