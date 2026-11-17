# ADR 0044: Komendy stref dla hulajnogi

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Strefy wpływają na jazdę komendami MQTT, które są już w kontrakcie ([ADR 0011](0011-mqtt-dla-hulajnog.md)):
- `speed_limit` z `params.kmh` w strefie wolnej jazdy;
- `stop_gradually` w strefie zakazu i poza obszarem działania (pytania 2 i 3 w [planie iteracji 4](../iteracje/iteracja-04-strefy.md)).

Przejścia stref wykrywa moduł Strefy ([ADR 0043](0043-wykrywanie-zmian-stref.md)). Do rozstrzygnięcia są cztery problemy:

1. **Jedna oczekująca komenda na przejazd.** Iteracja 3 dopuszcza jedną komendę w statusie `SENT` na przejazd (indeks `scooter_commands_one_pending_per_rental`, [ADR 0036](0036-proces-wypozyczenia-w-api.md)). Komenda limitu z `rental_id` zablokowałaby pauzę albo zakończenie błędem `RENTAL_COMMAND_PENDING`. Komenda bez `rental_id` nie pojawi się na osi czasu przejazdu.
2. **Brak odwrotności `stop_gradually`.** Kontrakt nie mówi, jak przywrócić napęd po wyprowadzeniu hulajnogi ze strefy zakazu. Symulator po `stop_gradually` stoi do `lock`.
3. **Kolejność i ponowienia.** Przy szybkim wjeździe i wyjeździe komendy mogą się wyprzedzać. Komenda bez potwierdzenia (10 s, [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md)) nie może zostawić hulajnogi z limitem, który już nie obowiązuje.
4. **Pauza i zakończenie.** Po `lock` nie wiadomo, czy limit i zatrzymanie dalej obowiązują.

## Rozważane opcje

Dla problemu 1:

1. **Komendy stref bez `rental_id`.** Indeks bez zmian, ale oś czasu i panel przejazdu nie pokazują komend stref.
2. **Indeks ograniczony do `LOCK` i `UNLOCK`.** Komendy stref mają `rental_id` i są na osi czasu, a ograniczenie zostaje tam, gdzie chroni stan przejazdu.

Dla problemu 2:

1. **`stop_gradually` z `params.on: false`.** Nie zmienia typu komendy, ale urządzenie z kontraktem 1.1.0 zignoruje parametr i zatrzyma się drugi raz.
2. **Nowa komenda `release_stop`.** Urządzenie bez wsparcia odpowie `UNKNOWN_COMMAND`, czyli jawnym błędem, a nie odwrotnym działaniem.
3. **`unlock` przywraca napęd.** Myli dwie rzeczy: `unlock` należy do procesu wypożyczenia, a hulajnoga jest już odblokowana (`ALREADY_IN_STATE`).

Dla problemu 3:

1. **Komenda na każde przejście.** Prosta, ale przy utraconej komendzie stan hulajnogi zostaje błędny do następnego przejścia.
2. **Uzgadnianie stanu docelowego.** Backend wylicza, jaki limit i czy zatrzymanie powinny obowiązywać, porównuje to z ostatnim potwierdzonym albo wysłanym stanem i wysyła komendę tylko przy różnicy. Komenda utracona albo odrzucona zostaje ponowiona przy następnym odczycie.

## Decyzja

- **Problem 1, opcja 2.** Migracja 0006 zastępuje indeks `scooter_commands_one_pending_per_rental` wersją z warunkiem `type IN ('LOCK', 'UNLOCK')`. Komendy stref mają `rental_id`, więc są w `v_rental_timeline` i w szczegółach przejazdu. `pendingCommand` w widoku przejazdu i maszyna stanów przejazdu biorą pod uwagę tylko `LOCK` i `UNLOCK`. Obsługa potwierdzeń przejazdu pomija komendy stref, bo uzgadnia je moduł Strefy.
- **Problem 2, opcja 2.** Kontrakt MQTT 1.2.0 dostaje komendę `release_stop`: napęd znów działa, a limit prędkości się nie zmienia. W bazie to nowa wartość `RELEASE_STOP` w `command_type`. Kontrakt 1.2.0 zapisuje też dwie dotąd niejawne zasady:
  - `speed_limit` bez `params.kmh` zdejmuje limit (symulator już tak działa);
  - `lock` kasuje limit i zatrzymanie w urządzeniu.
- **Problem 3, opcja 2.** Reguła w core `desiredZoneControl(rules)` wylicza z bieżących stref ([ADR 0043](0043-wykrywanie-zmian-stref.md) i `evaluatePosition`):
  - `stopped`: zakaz albo poza obszarem;
  - `speedLimitKmh`: najniższy limit wolnej jazdy albo `null`.

  Stan zastosowany jest zapisany przy hulajnodze w module Strefy: limit, zatrzymanie, identyfikator oczekującej komendy i czas potwierdzenia. Zasady uzgadniania:
  - uzgadnianie działa tylko w `ACTIVE`;
  - oczekująca komenda tego samego rodzaju z tą samą wartością blokuje ponowne wysłanie;
  - nowa wartość wysyła nową komendę: najnowszy stan docelowy wygrywa, a komendy jednej hulajnogi idą jednym tematem z QoS 1, więc docierają w kolejności;
  - komenda `REJECTED` albo `TIMEOUT` czyści oczekiwanie, więc następny odczyt ją ponawia;
  - wszystkie komendy mają `expiresAt` jak w [ADR 0038](0038-wygasanie-komend-mqtt.md).
- **Problem 4.** Pauza i zakończenie wysyłają `lock`, który według kontraktu 1.2.0 kasuje limit i zatrzymanie, więc backend przy przejściu do `PAUSED`, `ENDING` i `ENDED` zeruje stan zastosowany. Wznowienie (`ACTIVE` po potwierdzonym `unlock`) od razu uzgadnia stan z bieżącymi strefami, bez czekania na odczyt. Pauza w strefie zakazu jest dozwolona. Po wznowieniu w zakazie hulajnoga dostaje `stop_gradually`, a klient komunikat.
- **Panel nie wysyła tych komend ręcznie** (decyzja D7): `SPEED_LIMIT`, `STOP_GRADUALLY` i `RELEASE_STOP` są poza `PANEL_COMMANDS`, a dziennik komunikacji hulajnogi je pokazuje.

## Konsekwencje

Pozytywne:

- Pauza i zakończenie działają w strefie wolnej jazdy, bo komendy stref nie zajmują miejsca oczekującej komendy przejazdu.
- Utrata jednej komendy nie zostawia trwale złego limitu: następny odczyt ją ponawia.
- Komendy stref są na osi czasu przejazdu z czasem potwierdzenia, co pomaga przy obronie i przy reklamacjach.

Negatywne i ryzyka:

- Kontrakt MQTT zmienia się po raz drugi (1.2.0). Urządzenie z kontraktem 1.1.0 na `release_stop` odpowie `UNKNOWN_COMMAND` i zostanie zatrzymane do `lock`. W projekcie dotyczy to tylko symulatora, który przechodzi na 1.2.0 razem z API.
- Uzgadnianie wymaga przechowywanego stanu zastosowanego. Stan rozjechany po ręcznej zmianie w bazie naprawia dopiero następny odczyt.
- Wznowienie w strefie zakazu odblokowuje hulajnogę, która od razu zwalnia i staje. To zamierzone (przejazd trwa), ale może zaskoczyć klienta, więc komunikat jest obowiązkowy.

## Powiązane

[ADR 0011](0011-mqtt-dla-hulajnog.md), [ADR 0036](0036-proces-wypozyczenia-w-api.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0038](0038-wygasanie-komend-mqtt.md), [ADR 0043](0043-wykrywanie-zmian-stref.md), [ADR 0046](0046-symulator-a-strefy.md), [kontrakt AsyncAPI MQTT](../kontrakty/asyncapi-mqtt.yaml), [plan iteracji 4](../iteracje/iteracja-04-strefy.md) (pytania 2 i 3, D7)
