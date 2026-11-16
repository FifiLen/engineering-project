# 11. Ryzyka i dług techniczny

| Ryzyko | Wpływ | Działanie |
|---|---|---|
| Rozrost zakresu przy jednym autorze | Wysoki | Iteracje z działającym demem, rozszerzenia oznaczone jako opcjonalne |
| Limity publicznych usług mapowych (Photon, OpenFreeMap) | Średni | Adaptery z możliwością podmiany, OSRM hostowany samodzielnie |
| Dostępność BLIK w trybie testowym | Niski | Karta jako podstawowa metoda, BLIK opcjonalnie |
| Broker MQTT jako pojedynczy punkt awarii | Średni | Akceptowane w projekcie; opis klastrowania jako kierunek rozwoju |
| Pamięć OSRM na małym VPS | Niski | Wycinek tylko jednego województwa |
| Różnice między symulatorem a prawdziwym urządzeniem | Średni | Kontrakt MQTT w AsyncAPI jako jedyne źródło prawdy o protokole |
| Panel bez logowania do iteracji 2 | Średni | API i panel tylko lokalnie; definicje zasobów mają już wymagane uprawnienia, zapisy przechodzą przez jedno miejsce w serwisach ([ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md)) |
| Jedna instancja backendu (stały identyfikator klienta MQTT, bufor telemetrii w pamięci) | Niski | Skalowanie przez subskrypcje współdzielone MQTT; opisane w [ADR 0033](../adr/0033-telemetria-i-status-floty.md) |

Dług techniczny jest dopisywany w dzienniku w chwili, gdy świadomie go zaciągamy.
