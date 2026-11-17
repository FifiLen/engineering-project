# 11. Ryzyka i dług techniczny

| Ryzyko | Wpływ | Działanie |
|---|---|---|
| Rozrost zakresu przy jednym autorze | Wysoki | Iteracje z działającym demem, rozszerzenia oznaczone jako opcjonalne |
| Limity publicznych usług mapowych (Photon, OpenFreeMap) | Średni | Adaptery z możliwością podmiany, OSRM hostowany samodzielnie |
| Dostępność BLIK w trybie testowym | Niski | Sprawdzone przy ADR 0050: BLIK działa w trybie testowym Stripe dla PLN; `STRIPE_BLIK=false` ukrywa go w aplikacji |
| Zależność od operatora płatności (Stripe) | Średni | Port `PaymentProvider` z atrapą w procesie: testy, CI i demo działają bez sieci i kluczy ([ADR 0050](../adr/0050-integracja-stripe.md)) |
| Webhooki Stripe lokalnie wymagają Stripe CLI | Niski | Bez `stripe listen` płatności rozstrzyga sprawdzenie statusu po 2 min (`payments.reconcile`) |
| Atrapa operatora może się rozjechać ze Stripe | Niski | Te same zdarzenia, kody odmów i podpis w formacie `Stripe-Signature`; scenariusz demo przechodzi też na Stripe po wpisaniu kluczy |
| Stan atrapy w pamięci API | Niski | Po restarcie API płatności atrapy w toku kończą się odmową przy sprawdzeniu statusu; dotyczy tylko środowiska deweloperskiego |
| Płatności w natywnej aplikacji niesprawdzone (development build) | Średni | Ten sam dług co przy mapie: implementacja natywna przechodzi typy i lint, ekrany sprawdzane w wersji web na atrapie ([ADR 0051](../adr/0051-platnosci-w-aplikacji.md)) |
| Ujemne saldo po przejeździe droższym niż saldo | Niski | Ujemne saldo blokuje kolejny start do doładowania (pytanie 4); w produkcji ryzyko nieściągalnej kwoty |
| Paragon niefiskalny i robocza stawka VAT | Średni | Opis drogi do kasy fiskalnej online w §8.4; stawka VAT jako pole wersji cennika do zmiany bez kodu |
| Broker MQTT jako pojedynczy punkt awarii | Średni | Akceptowane w projekcie; opis klastrowania jako kierunek rozwoju |
| Pamięć OSRM na małym VPS | Niski | Wycinek tylko jednego województwa |
| Różnice między symulatorem a prawdziwym urządzeniem | Średni | Kontrakt MQTT w AsyncAPI jako jedyne źródło prawdy o protokole |
| Brak dostawcy SMS i poczty | Średni | Bramka SMS i link zaproszenia za adapterami; w środowisku deweloperskim kod w logu API, link pokazany raz w panelu ([ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md)) |
| Pamięć podręczna uprawnień w jednej instancji API | Niski | Zmiana ról działa od razu w tej instancji, w pozostałych po 10 s; dezaktywacja odcina dostęp przy następnym odczycie |
| Jedna instancja backendu (stały identyfikator klienta MQTT, bufor telemetrii w pamięci) | Niski | Skalowanie przez subskrypcje współdzielone MQTT; opisane w [ADR 0033](../adr/0033-telemetria-i-status-floty.md) |
| Natywna mapa w aplikacji niesprawdzona (brak Xcode i Android SDK na komputerze autora) | Średni | Mapa w dwóch implementacjach ze wspólnym interfejsem; wersja web sprawdzana w każdej iteracji, development build do zbudowania po instalacji Xcode ([ADR 0040](../adr/0040-mapa-lokalizacja-aparat-w-aplikacji.md)) |
| Zegar urządzenia a termin `expiresAt` komendy | Niski | W projekcie zegar symulatora i backendu jest wspólny; dla prawdziwego sprzętu tolerancja albo czas względny ([ADR 0038](../adr/0038-wygasanie-komend-mqtt.md)) |
| Limit potwierdzenia zależy od odpytywania kolejki pg-boss | Niski | `UNLOCK_FAILED` po 10–11 s zamiast dokładnie 10 s; odpytywanie co 1 s ([ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)) |
| Dokładność GPS na granicy strefy | Niski | Histereza wyjazdu (2 odczyty albo 10 m) i komunikat z opóźnieniem do jednego odczytu (5 s); prawdziwy sprzęt miałby geofencing w urządzeniu ([ADR 0043](../adr/0043-wykrywanie-zmian-stref.md)) |
| Publiczny Photon w demo wyszukiwania | Niski | Pamięć podręczna 24 h, limit 30 zapytań na minutę na klienta, wariant błędu w aplikacji; własny kontener to zmiana `PHOTON_URL` ([ADR 0045](../adr/0045-wyszukiwanie-miejsc-photon.md)) |
| Dwa procesy OSRM (rower i pieszo) | Niski | Około 1 GB pamięci i 1,6 GB danych na komputerze dewelopera; bez OSRM linia prosta ([ADR 0048](../adr/0048-trasy-dla-klienta-z-osrm.md)) |
| Przejazdy z iteracji 3 i 4 bez obciążenia portfela | Niski | Zostają nierozliczone (stan rozliczenia `NONE`, pytanie 12); nowe przykładowe przejazdy w danych startowych są rozliczone z portfela ([ADR 0049](../adr/0049-rozliczenie-przejazdu.md)) |

Dług techniczny jest dopisywany w dzienniku w chwili, gdy świadomie go zaciągamy.
