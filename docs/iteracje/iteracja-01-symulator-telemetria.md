# Iteracja 1: symulator, telemetria i wzorzec panelu

**Status:** zakończona (16 listopada 2026); CI w GitHub Actions zielone dla commitu `30261a9`

## Cel
Wirtualne hulajnogi jeżdżą po Rybniku i mówią protokołem z [kontraktu MQTT](../kontrakty/asyncapi-mqtt.yaml); backend zapisuje telemetrię i pokazuje flotę na żywo. Powstaje wspólny wzorzec widoku tabeli ([ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md)), na którym działają lista floty i modeli hulajnóg, oraz pliki tłumaczeń w klientach ([ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md)).

Wymagania uczelni: 12 (pierwsze tabele z pełnym CRUD, filtrowaniem i sortowaniem), 14 (pierwsze widoki panelu), 17 (etykiety w plikach tłumaczeń, reguła lintera).

## Zakres
- [x] Symulator: każda hulajnoga z własnym połączeniem MQTT, Last Will, telemetria co 5 s, trasy z OSRM, obsługa komend z potwierdzeniami i idempotencją po `commandId`, stan zapisywany między uruchomieniami ([ADR 0034](../adr/0034-symulator-floty.md))
- [x] `packages/core`: status floty widoczny w panelu (niska bateria, offline), reguły przyjmowania telemetrii (kolejność, przebieg), reguły zmian hulajnóg i modeli, reguły komend, blokada optymistyczna
- [x] `packages/db`: migracja 0003 (status floty, widoki list, indeksy), wspólny mechanizm list z białej listy definicji, repozytoria floty, modeli, telemetrii i komend, strefy jako GeoJSON
- [x] `packages/shared`: definicje zasobów panelu i kontrakt list, zdarzenia Socket.IO, tłumacz etykiet ([ADR 0032](../adr/0032-etykiety-w-plikach-tlumaczen.md))
- [x] API: odbiór MQTT, zapis telemetrii partiami, partycje telemetrii, Socket.IO z pokojem `fleet`, `GET/POST/PATCH/DELETE /admin/scooters` i `/admin/scooter-models`, komendy z panelu, `GET /admin/fleet/map`, `GET /zones` ([ADR 0033](../adr/0033-telemetria-i-status-floty.md))
- [x] Panel: układ z nawigacją boczną, mapa floty na żywo (MapLibre), lista i formularz floty oraz modeli na wspólnym wzorcu
- [x] Pliki tłumaczeń w `apps/web` i `apps/mobile`, reguła lintera zakazująca tekstów w JSX
- [x] Kontrakt zdarzeń Socket.IO ([`asyncapi-realtime.yaml`](../kontrakty/asyncapi-realtime.yaml))

## Poza zakresem (świadomie)
- Logowanie operatorów, `@RequirePermission` i zapis do `audit_log`: iteracja 2. Definicje zasobów mają już wymagane uprawnienia, a zapisy przechodzą przez serwisy aplikacyjne, w których iteracja 2 doda sprawdzenie i dziennik. `audit_log.staff_id` jest wymagane, więc bez logowania nie ma kogo zapisać jako autora.
- Eksport list do XLSX i CSV: iteracja 8 (silnik z [ADR 0029](../adr/0029-raporty-pdf-xlsx.md)).
- Ekran symulatora w panelu i scenariusze awarii: iteracja 6 (utrata łączności). Symulator już publikuje swoje liczniki na `simulator/status`.
- Przejazdy z rezerwacją i odblokowaniem: iteracja 3. Do tego czasu symulator sam generuje przejazdy pokazowe, które backend widzi jako ruch dostępnej hulajnogi.
- Historia zmian w formularzu (z `audit_log`): iteracja 2.

## Scenariusz demo
Wymaga uruchomionej infrastruktury i danych startowych (`pnpm infra:up && pnpm db:migrate && pnpm db:seed`).

1. `pnpm dev` (albo osobno: `pnpm --filter @hulajnogi/api dev`, `pnpm --filter @hulajnogi/simulator dev`, `WEB_PORT=3002 pnpm --filter @hulajnogi/web dev`). Symulator wypisuje: 40 hulajnóg, telemetria co 5 s, 30 przejazdów pokazowych na godzinę.
2. `http://localhost:3000/admin` przekierowuje na mapę floty. Kropka przy tytule świeci na niebiesko (połączenie Socket.IO), szybkie filtry pokazują 40 hulajnóg, a dwie z niską baterią (#0027 i #0036, 11% i 9% w danych startowych; próg to 15% z cennika) są pomarańczowe. Po kilku minutach część hulajnóg jedzie ulicami Rybnika (trasy rowerowe z OSRM).
3. Kliknięcie hulajnogi otwiera kartę: bateria, zasięg, wariant, ostatni sygnał odliczany co sekundę, strefa parkowania, przebieg, oprogramowanie.
4. „Dzwonek”: w „Ostatnich komunikatach” pojawia się „dzwonek: potwierdzono, N ms”. „Zablokuj” na stojącej hulajnodze: „odrzucono” (hulajnoga odpowiada `ALREADY_IN_STATE`).
5. „Do serwisu”: kropka zmienia kolor na czerwony, licznik „Serwis” rośnie o 1; „Przywróć do floty” cofa zmianę.
6. Zatrzymanie symulatora (Ctrl+C): wszystkie hulajnogi przechodzą w „Offline”. Ponowne uruchomienie: wracają online w tych samych miejscach (stan w `apps/simulator/.state/fleet.json`).
7. „Flota”: szybki filtr „Niska bateria”, sortowanie po baterii w nagłówku, „Filtry”: dwa statusy i wariant „Grafit”, przycisk pokazuje liczbę wyników przed zastosowaniem. Adres strony zawiera stan listy; „wstecz” i odświeżenie go zachowują.
8. Konflikt wersji: otwórz #0009, w terminalu zmień rekord:
   `curl -X PATCH localhost:3001/admin/scooters/<id> -H 'content-type: application/json' -d '{"version":1,"firmware":"v2.4.2"}'`,
   w panelu zmień wariant i zapisz. Pojawia się komunikat o zmianie w międzyczasie; „Pokaż różnice” pokazuje oprogramowanie, „Wczytaj aktualną wersję” ładuje wersję 2.
9. „Modele hulajnóg” → „Nowy model”: waga 17,55 daje błąd „Dozwolona dokładność: 0,1” przy polu (ten sam schemat Zod co w API). Model z wagą 17,5 zapisuje się; przypisz do niego hulajnogę i spróbuj usunąć model: zostaje zarchiwizowany („Archiwalny”), a nowej hulajnogi nie da się do niego przypisać (`MODEL_INACTIVE`).
10. Telemetria w bazie: `docker exec hulajnogi-postgres-1 psql -U hulajnogi -c "SELECT tableoid::regclass, count(*) FROM telemetry GROUP BY 1"` pokazuje punkty w partycji bieżącego dnia.

## Wynik
Opis wykonanych prac, weryfikacji i długu technicznego: [dziennik](../dziennik.md#iteracja-1-symulator-telemetria-i-wzorzec-panelu-16-listopada-2026).
