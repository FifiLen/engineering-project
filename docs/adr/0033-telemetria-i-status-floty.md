# ADR 0033: Przyjmowanie telemetrii partiami i status floty liczony w core i w bazie

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

Każda hulajnoga wysyła telemetrię co 5 s ([kontrakt MQTT](../kontrakty/asyncapi-mqtt.yaml)). Przy 40 hulajnogach to 8 wiadomości na sekundę, a test obciążeniowy w iteracji 9 zakłada setki urządzeń. Backend musi zapisać punkt trasy, zaktualizować stan bieżący hulajnogi i powiadomić panel ([ADR 0012](0012-socket-io.md)).

Siły:

- QoS 1 dopuszcza powtórzone dostarczenie, a po odzyskaniu łączności hulajnoga dosyła punkty z bufora z oryginalnym czasem.
- Status (online/offline) przychodzi osobnym kanałem z Last Will i może wyprzedzić albo minąć telemetrię.
- Panel pokazuje statusy, których nie ma w bazie wprost: „niska bateria” i „offline” ([makieta Flota](../projekt/ekrany/13-panel/admin-flota.png)). Lista filtruje i liczy je w SQL ([ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md)), a zdarzenia na żywo liczy backend dla pojedynczej hulajnogi.
- Reguły biznesowe mają być w `packages/core` ([ADR 0025](0025-logika-biznesowa-packages-core.md)), a baza ma widoki i funkcje dla list ([ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md)).

## Rozważane opcje

1. **Zapis każdej wiadomości od razu** i zdarzenie Socket.IO na każdą wiadomość. Najprostsze, ale dwa zapytania i jedno zdarzenie na wiadomość; przy setkach hulajnóg obciąża bazę i przeglądarkę.
2. **Okno zbierania** (domyślnie 1 s): odczyty z okna oceniane regułami core, zapisane jedną transakcją (wiele punktów, jedna aktualizacja na hulajnogę) i wysłane do panelu jedną paczką.
3. **Osobny proces lub kolejka** (np. strumień w Redisie) między brokerem a bazą. Skaluje się najlepiej, ale to dodatkowa infrastruktura bez potrzeby w skali projektu.

Dla statusu floty: (a) tylko w SQL, (b) tylko w kodzie z filtrowaniem w pamięci, (c) ta sama reguła w core i w funkcji bazy ze sprawdzeniem zgodności testem.

## Decyzja

Opcja 2 i wariant (c).

- `TelemetryService` zbiera odczyty zgodne z kontraktem (`telemetrySchema`), co `TELEMETRY_FLUSH_MS` sortuje je po czasie i ocenia funkcją `evaluateTelemetry` z core: odczyt z przyszłości (ponad 60 s różnicy zegara) jest odrzucany, każdy poprawny trafia do historii, a stan bieżący zmienia tylko odczyt nowszy od ostatniego. Przebieg rośnie o odległość między kolejnymi punktami, z pominięciem szumu GPS (poniżej 3 m) i skoków szybszych niż 45 km/h.
- Historia: `INSERT ... ON CONFLICT DO NOTHING` na kluczu (hulajnoga, czas), więc powtórzona wiadomość nic nie zmienia. Stan bieżący: aktualizacja z warunkiem `last_seen_at < czas odczytu`, więc równoległe zapisy nie cofną stanu.
- Status łączności i zapisy telemetrii idą przez jedną kolejkę w kolejności przyjścia: odczyty sprzed zmiany statusu zapisują się przed nią. Bez tego partia mogła odczytać stan sprzed zmiany i wysłać do panelu nieaktualny status (błąd wykryty testem API).
- Backend łączy się z brokerem ze stałym identyfikatorem i sesją trwałą (`clean: false`), dopiero po inicjalizacji wszystkich modułów, żeby zaległe wiadomości z czasu restartu trafiły do zarejestrowanej obsługi. Mosquitto usuwa porzucone sesje po dobie (`persistent_client_expiration`).
- Status floty: `deriveFleetStatus` w core i `fn_fleet_status` w bazie (migracja 0003), kolejność: wycofana, serwis, offline, rezerwacja i jazda, niska bateria, dostępna. Próg niskiej baterii to minimalna bateria do wypożyczenia z obowiązującej wersji cennika (`fn_low_battery_threshold`); backend pamięta go przez minutę. Test bazy porównuje obie implementacje dla wszystkich kombinacji stanu, łączności i baterii.
- Partycje telemetrii zakłada moduł przy starcie API i co 6 godzin na 7 dni naprzód (`sp_ensure_telemetry_partitions`, operacja idempotentna). Gdy w iteracji 3 dojdzie pg-boss ([ADR 0016](0016-zadania-w-tle-pg-boss.md)), przejdzie to do zadania cyklicznego.

## Konsekwencje

Pozytywne:

- Jedna transakcja i jedno zdarzenie na okno niezależnie od liczby hulajnóg; panel nie przerysowuje mapy setki razy na sekundę.
- Idempotencja i odporność na kolejność wynikają z danych (klucz, warunek na czasie), a nie z założeń o sieci.
- Lista w SQL i zdarzenia na żywo pokazują ten sam status, a rozjazd reguł wykrywa test.

Negatywne i ryzyka:

- Opóźnienie pozycji na mapie do jednego okna (1 s) i utrata najwyżej jednego okna odczytów przy awarii procesu między odebraniem a zapisem (wiadomość jest już potwierdzona brokerowi). Akceptowalne dla telemetrii; komendy i przejazdy nie przechodzą przez bufor.
- Reguła statusu jest w dwóch miejscach; zmiana wymaga nowej migracji z funkcją i zmiany w core w tym samym commicie (pilnuje test).
- Jeden proces backendu: stały identyfikator klienta MQTT wyklucza dwie instancje API jednocześnie. Przy skalowaniu potrzebne byłyby subskrypcje współdzielone (`$share/…`).

## Powiązane

[ADR 0002](0002-symulacja-floty-zamiast-sprzetu.md), [ADR 0011](0011-mqtt-dla-hulajnog.md), [ADR 0012](0012-socket-io.md), [ADR 0015](0015-wersjonowany-cennik.md), [ADR 0016](0016-zadania-w-tle-pg-boss.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [§6.3](../arc42/06-widok-czasu-dzialania.md), [model danych](../model-danych/README.md)
