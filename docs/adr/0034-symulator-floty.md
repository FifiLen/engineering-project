# ADR 0034: Budowa symulatora floty i przejazdy pokazowe do czasu wypożyczeń

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

[ADR 0002](0002-symulacja-floty-zamiast-sprzetu.md) ustala, że symulator mówi protokołem urządzenia i backend nie odróżnia go od prawdziwej hulajnogi. Iteracja 1 ma pokazać hulajnogi jeżdżące po Rybniku, ale proces wypożyczenia (rezerwacja, odblokowanie komendą) powstaje dopiero w iteracji 3. Trzeba też ustalić, skąd symulator zna pozycje startowe i obszar, skoro hulajnoga zna tylko broker MQTT.

## Rozważane opcje

1. **Symulator czyta bazę albo API**, żeby poznać flotę i jej pozycje. Wygodne, ale łamie zasadę, że urządzenie zna tylko broker, i nie zadziała z prawdziwym sprzętem.
2. **Symulator ma własny stan**: numery 1…N jak w danych startowych, pozycja i bateria z tego samego algorytmu co `seedDatabase`, obszar i strefy parkowania z pliku sprawdzonych współrzędnych (`packages/db/seed/rybnik-places.json`), stan zapisywany do pliku między uruchomieniami.
3. **Hulajnogi stoją do iteracji 3**. Zgodne z procesem, ale mapa na żywo nie pokazywałaby ruchu.

Dla ruchu: przejazdy pokazowe uruchamiane przez sam symulator albo przejazdy tworzone już teraz przez API bez rezerwacji.

## Decyzja

Opcja 2 i przejazdy pokazowe w symulatorze.

- Każda hulajnoga ma własne połączenie MQTT (`scooter-0001`…), sesję trwałą, Last Will `{"online": false}` na kanale status (retained), telemetrię co `SIM_TELEMETRY_INTERVAL_MS` z przesunięciem fazy i bufor telemetrii dosyłany z `buffered: true` po odzyskaniu łączności.
- Komendy według kontraktu z potwierdzeniem: odblokowanie odmawia przy baterii poniżej 5% (`LOW_BATTERY`) i w stanie już odblokowanym (`ALREADY_IN_STATE`), blokada zatrzymuje jazdę, limit prędkości ogranicza prędkość. Powtórzony `commandId` dostaje to samo potwierdzenie bez ponownego wykonania.
- Przejazdy pokazowe: proces Poissona z `SIM_RIDES_PER_HOUR` przejazdami na godzinę (domyślnie 30, jak na makiecie ekranu symulatora). Losowana jest zablokowana hulajnoga z baterią co najmniej 20%, cel w okolicy strefy parkowania (70%) albo w obszarze działania, trasa rowerowa z OSRM ([ADR 0017](0017-uslugi-mapowe.md)); bez OSRM linia prosta. Bateria spada o 1 punkt na 300 m. Na końcu trasy hulajnoga staje i się blokuje.
- Backend widzi przejazd pokazowy jako ruch odblokowanej hulajnogi bez przejazdu: status w bazie zostaje `AVAILABLE`. Od iteracji 3 przejazdy powstają przez API (rezerwacja i odblokowanie komendą), a przejazdy pokazowe zostają wyłączone domyślnie (`SIM_RIDES_PER_HOUR=0`) albo zastąpione scenariuszem „Wygeneruj przejazdy” z panelu.
- Symulator publikuje własny stan i liczniki (podłączone hulajnogi, wiadomości na sekundę, przejazdy w toku) na `simulator/status` (retained) dla ekranu symulatora w panelu (iteracja 6). Temat nie jest częścią kontraktu hulajnogi.

## Konsekwencje

Pozytywne:

- Symulator można zastąpić prawdziwym sprzętem bez zmian w backendzie; nie ma zależności od bazy ani API.
- Pierwsza telemetria zgadza się z pozycjami z danych startowych, a restart symulatora nie przenosi floty.
- Mapa floty pokazuje realistyczny ruch po ulicach Rybnika już w iteracji 1.

Negatywne i ryzyka:

- Do iteracji 3 ruch nie odpowiada przejazdom w bazie (brak `IN_USE`, brak przejazdów w statystykach). Opisane w scenariuszu demo.
- Algorytm pozycji startowych jest w dwóch miejscach (seed i symulator); rozjazd oznacza tylko inną pozycję startową, którą i tak nadpisuje telemetria.
- Bateria tylko spada; wymiana baterii przyjdzie z procesem serwisowym (iteracja 6).

## Powiązane

[ADR 0002](0002-symulacja-floty-zamiast-sprzetu.md), [ADR 0011](0011-mqtt-dla-hulajnog.md), [ADR 0017](0017-uslugi-mapowe.md), [ADR 0020](0020-obszar-dzialania-rybnik.md), [ADR 0033](0033-telemetria-i-status-floty.md), [kontrakt MQTT](../kontrakty/asyncapi-mqtt.yaml)
