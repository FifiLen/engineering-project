# 11. Ryzyka i dług techniczny

| Ryzyko | Wpływ | Działanie |
|---|---|---|
| Rozrost zakresu przy jednym autorze | Wysoki | Iteracje z działającym demem, rozszerzenia oznaczone jako opcjonalne |
| Limity publicznych usług mapowych (Photon, OpenFreeMap) | Średni | Adaptery z możliwością podmiany, OSRM hostowany samodzielnie |
| Dostępność BLIK w trybie testowym | Niski | Karta jako podstawowa metoda, BLIK opcjonalnie |
| Broker MQTT jako pojedynczy punkt awarii | Średni | Akceptowane w projekcie; opis klastrowania jako kierunek rozwoju |
| Pamięć OSRM na małym VPS | Niski | Wycinek tylko jednego województwa |
| Różnice między symulatorem a prawdziwym urządzeniem | Średni | Kontrakt MQTT w AsyncAPI jako jedyne źródło prawdy o protokole |
| Brak dostawcy SMS i poczty | Średni | Bramka SMS i link zaproszenia za adapterami; w środowisku deweloperskim kod w logu API, link pokazany raz w panelu ([ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md)) |
| Pamięć podręczna uprawnień w jednej instancji API | Niski | Zmiana ról działa od razu w tej instancji, w pozostałych po 10 s; dezaktywacja odcina dostęp przy następnym odczycie |
| Jedna instancja backendu (stały identyfikator klienta MQTT, bufor telemetrii w pamięci) | Niski | Skalowanie przez subskrypcje współdzielone MQTT; opisane w [ADR 0033](../adr/0033-telemetria-i-status-floty.md) |
| Natywna mapa w aplikacji niesprawdzona (brak Xcode i Android SDK na komputerze autora) | Średni | Mapa w dwóch implementacjach ze wspólnym interfejsem; wersja web sprawdzana w każdej iteracji, development build do zbudowania po instalacji Xcode ([ADR 0040](../adr/0040-mapa-lokalizacja-aparat-w-aplikacji.md)) |
| Zegar urządzenia a termin `expiresAt` komendy | Niski | W projekcie zegar symulatora i backendu jest wspólny; dla prawdziwego sprzętu tolerancja albo czas względny ([ADR 0038](../adr/0038-wygasanie-komend-mqtt.md)) |
| Limit potwierdzenia zależy od odpytywania kolejki pg-boss | Niski | `UNLOCK_FAILED` po 10–11 s zamiast dokładnie 10 s; odpytywanie co 1 s ([ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)) |
| Przejazdy z iteracji 3 bez obciążenia portfela | Niski | Iteracja 5 zdecyduje, czy rozliczyć je wstecz, czy zostawić jako deweloperskie ([ADR 0042](../adr/0042-wycena-przejazdu.md)) |

Dług techniczny jest dopisywany w dzienniku w chwili, gdy świadomie go zaciągamy.
