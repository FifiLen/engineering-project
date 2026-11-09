# 4. Strategia rozwiązania

| Cel lub problem | Rozwiązanie | Decyzja |
|---|---|---|
| Ograniczony czas, jeden autor | Monolit modularny, jedno repozytorium, jeden język | [0003](../adr/0003-monolit-modularny.md), [0008](../adr/0008-monorepo-typescript.md) |
| Brak sprzętu | Symulator mówiący tym samym protokołem co urządzenie | [0002](../adr/0002-symulacja-floty-zamiast-sprzetu.md), [0011](../adr/0011-mqtt-dla-hulajnog.md) |
| Niezawodna łączność z urządzeniami | MQTT z QoS 1, identyfikatorami komend i Last Will | [0011](../adr/0011-mqtt-dla-hulajnog.md) |
| Geolokalizacja i strefy | PostGIS, zapytania przestrzenne w bazie | [0010](../adr/0010-postgresql-postgis-drizzle.md) |
| Spójność przejazdów i płatności | Maszyna stanów, ograniczenia w bazie, idempotencja | [0013](../adr/0013-rezerwacja-jako-stan-przejazdu.md), [0014](../adr/0014-kwoty-w-groszach-portfel-ksiega.md) |
| Dane na żywo w klientach | Socket.IO | [0012](../adr/0012-socket-io.md) |
| Opóźnione działania (limity czasu) | Kolejka zadań w PostgreSQL | [0016](../adr/0016-zadania-w-tle-pg-boss.md) |
| Niezależny rozwój klientów | Jedynym wspólnym elementem jest kontrakt API | [0004](../adr/0004-niezalezni-klienci-wspolny-kontrakt.md) |

Zasada nadrzędna: **klienci znają tylko API, hulajnogi znają tylko broker MQTT, cała logika biznesowa jest w backendzie.**
