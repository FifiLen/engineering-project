# ADR 0059: Symulator sterowany z panelu

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0039](0039-symulator-w-trakcie-przejazdu.md) wybrał do sterowania awariami plik `apps/simulator/.state/control.json` z poleceniami `offline`, `silent` i (od [ADR 0046](0046-symulator-a-strefy.md)) `goto`. Odrzucił temat MQTT, bo „miesza kanał urządzeń z narzędziem demo”, a plik miał zastąpić ekran symulatora w panelu w iteracji 6. Symulator publikuje już stan i liczniki na `simulator/status` (retained).

Autor przyjął (18 listopada 2026):
- **D4:** polecenia przez MQTT `simulator/control`, który publikuje tylko backend, z panelu z uprawnieniem `simulator.manage` i z wpisem w dzienniku audytu; plik zostaje dla CLI;
- **pytanie 10, scenariusze:**
  - rozłączenie i powrót wybranej hulajnogi;
  - milczenie na komendy;
  - rozładowanie do 5% w 30 s;
  - jazda do strefy albo punktu;
  - wjazd w strefę zakazu;
- **pytanie 10, bez zmian w locie:** liczba hulajnóg i tempo zmieniają się dopiero po restarcie symulatora;
- **pytanie 8:** zakończenie zadania `BATTERY_SWAP` wysyła do hulajnogi komendę `battery_swapped`, a symulator ustawia baterię na 100%.

Broker deweloperski przyjmuje połączenia anonimowe (`allow_anonymous true`); uwierzytelnianie i ACL są zapowiedziane dla wdrożenia demo.

## Rozważane opcje

Kanał poleceń:

1. **REST w symulatorze.** Osobny serwer HTTP w procesie symulatora, port do otwarcia i adres w konfiguracji API.
2. **MQTT `simulator/control`** (D4). Symulator już ma połączenie z brokerem, a API publikuje komendy do hulajnóg. Obawę z ADR 0039 rozwiązuje osobny prefiks `simulator/` i osobny dokument kontraktu, poza kontraktem urządzeń.

Wymiana baterii:

1. **Tylko polecenie symulatora z panelu.** Nie dotyka kontraktu urządzeń, ale zakończenie zadania w panelu nie zmieniałoby baterii.
2. **Komenda urządzenia `battery_swapped`** (pytanie 8). Prawdziwa hulajnoga z wymienną baterią zgłasza ją sama przez BMS, więc w urządzeniu to tylko potwierdzenie. Symulatorowi daje to jednak ten sam obieg co inne komendy: `commandId`, potwierdzenie, wygasanie.

## Decyzja

Opcja 2 w obu sprawach. Szczegóły:

- **Kontrakt** w nowym dokumencie `docs/kontrakty/asyncapi-symulator.yaml` 1.0.0, osobno od kontraktu urządzeń:
  - `simulator/control` (QoS 1, bez retained): `{ commandId, action, scooter, params, issuedBy, expiresAt }`;
  - `simulator/control/result` (QoS 1): `{ commandId, ok, reason }`;
  - `simulator/status` (retained, istnieje): dochodzą aktywne scenariusze z postępem i czas ostatniej aktualizacji.
- **Akcje:**
  - `disconnect` i `restore` (rozłączenie z Last Will, powrót z dosłaniem bufora telemetrii);
  - `silence` i `unsilence`;
  - `drain { targetPct: 5, durationS: 30 }` (liniowy spadek baterii, potem zwykłe rozładowanie);
  - `goto { zoneId } | { point }`;
  - `enter_no_ride { zoneId }` (najkrótsza trasa do strefy zakazu);
  - `cancel` (przerwanie scenariusza).

  Na hulajnodze działa najwyżej jeden scenariusz; drugi dostaje `ok: false` z `SCENARIO_ACTIVE`.
- **API:**
  - `POST /admin/simulator/commands` z `@RequirePermission('simulator.manage')` publikuje polecenie i zapisuje `simulator.command` w dzienniku audytu;
  - API subskrybuje `simulator/status` i `simulator/control/result` i przekazuje je do pokoju `simulator` w Socket.IO (dołączenie wymaga `simulator.manage`);
  - po 30 s bez stanu panel pokazuje „Symulator nie odpowiada”.
- **Tylko środowisko deweloperskie:** `SIMULATOR_CONTROL_ENABLED` jest domyślnie `true` przy `NODE_ENV=development` i `false` w pozostałych. Przy `false` punkty API zwracają 404, a pozycja w panelu jest ukryta.
- **ACL brokera na demo:** publikować na `simulator/control` może tylko użytkownik backendu, a symulator tylko subskrybuje. Lokalnie broker jest anonimowy, więc ochronę daje uprawnienie w API.
- **Plik `control.json`** zostaje dla CLI (`pnpm --filter @hulajnogi/simulator control …`). Plik i MQTT trafiają do tej samej obsługi w symulatorze; przy sprzecznych poleceniach wygrywa ostatnie.
- **Kontrakt urządzeń 1.3.0** (`asyncapi-mqtt.yaml`): komenda `battery_swapped` bez parametrów.
  - Urządzenie potwierdza ją po wykryciu nowej baterii.
  - Symulator ustawia baterię na 100% i potwierdza od razu.
  - Urządzenie z kontraktem 1.2.0 odpowiada `UNKNOWN_COMMAND`, a zadanie i tak się kończy; powrót do floty sprawdza baterię z telemetrii ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)).
  - W bazie to nowa wartość `BATTERY_SWAPPED` w `command_type`.

## Konsekwencje

Pozytywne:

- Awarie z demo (utrata łączności, milczenie, rozładowanie, strefa zakazu) wywołuje się z panelu, z historią w dzienniku audytu, bez terminala.
- Kontrakt urządzeń zostaje czysty: zmienia się tylko o jedną komendę, a narzędzie demo ma osobny dokument.
- Wymiana baterii przechodzi tę samą drogę co inne komendy, więc obieg serwisowy jest widoczny w telemetrii i na mapie.

Negatywne i ryzyka:

- Lokalnie każdy klient brokera może opublikować polecenie symulatora. Akceptowane w środowisku deweloperskim; demo wymaga ACL.
- Dwa źródła poleceń (plik i MQTT) mogą się nadpisać. Panel pokazuje stan z `simulator/status`, więc rozbieżność jest widoczna.
- Zmiana kontraktu urządzeń wymaga aktualizacji schematów Zod w `packages/shared` i testu zgodności kontraktu.

## Powiązane

[ADR 0039](0039-symulator-w-trakcie-przejazdu.md) (zmienia w części o sterowaniu awariami), [ADR 0034](0034-symulator-floty.md), [ADR 0046](0046-symulator-a-strefy.md), [ADR 0038](0038-wygasanie-komend-mqtt.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [plan iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) (pytania 8, 10; D4), makieta `symulator`
