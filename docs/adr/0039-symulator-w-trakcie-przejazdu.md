# ADR 0039: Symulator w trakcie przejazdu klienta

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

[ADR 0034](0034-symulator-floty.md) ustala przejazdy pokazowe: losowa hulajnoga odblokowuje się sama, jedzie trasą z OSRM i na końcu sama się blokuje. To wystarczało do czasu wypożyczeń. W iteracji 3 przejazd zaczyna klient komendą `unlock`, a kończy komendą `lock`. Hulajnoga, która po odblokowaniu stoi w miejscu, nie da się pokazać na mapie floty, a taka, która sama się blokuje, psuje przejazd: dotrze do celu zablokowana, mimo że przejazd dalej trwa. Do demo potrzebne są też nieudane odblokowanie (plan iteracji 3, krok 8) i przeterminowana komenda ([ADR 0038](0038-wygasanie-komend-mqtt.md)).

## Rozważane opcje

Co robi hulajnoga po odblokowaniu komendą:

1. **Stoi w miejscu.** Najprostsze, ale nie ma czego pokazać, a strefa parkowania przy zakończeniu jest zawsze ta sama co przy starcie.
2. **Jedzie do losowej strefy parkowania** z obszaru działania trasą z OSRM, staje i czeka na blokadę (decyzja D4 autora). Demo pokazuje jazdę na mapie, a próba zakończenia w trakcie drogi pokazuje `OUTSIDE_PARKING`.
3. **Cel wybierany przez operatora.** Najlepsze do demo, ale wymaga ekranu symulatora w panelu (iteracja 6).

Sterowanie awariami:

1. **Zmienne środowiskowe przy starcie.** Wymagają restartu symulatora.
2. **Plik sterujący obserwowany przez symulator** (`apps/simulator/.state/control.json`). Bez dodatkowego serwera, a zmiana działa od razu.
3. **Temat MQTT sterowania symulatorem.** Elegancki, ale miesza kanał urządzeń z narzędziem demo, a tematy hulajnóg zna tylko kontrakt.

## Decyzja

- **Jazda po odblokowaniu:** opcja 2. Po potwierdzonym `unlock` hulajnoga losuje strefę parkowania (ze stref `PARKING` z danych startowych, które symulator czyta tak jak obszar działania), pobiera trasę z OSRM do środka strefy i jedzie z prędkością jak w przejazdach pokazowych. Na końcu trasy staje odblokowana (`v = 0`, `locked: false`) i czeka. `lock` kończy jazdę w dowolnym miejscu, a kolejne `unlock` (wznowienie) kontynuuje tę samą trasę, a na jej końcu nic nie robi.
- **Brak samoczynnej blokady:** samoczynnie blokują się tylko przejazdy pokazowe.
- **Przejazdy pokazowe** domyślnie wyłączone (`SIM_RIDES_PER_HOUR=0`), bo pokazowa hulajnoga ma w bazie status `AVAILABLE` i klient mógłby ją zarezerwować w trakcie jazdy. Można je włączyć zmienną do pokazu samej telemetrii.
- **Sterowanie awariami:** opcja 2. Plik `apps/simulator/.state/control.json` z listami numerów hulajnóg: `offline` (rozłączenie z Last Will i powrót po usunięciu numeru) i `silent` (połączona, wykonuje komendy, ale nie wysyła potwierdzeń). Polecenie `pnpm --filter @hulajnogi/simulator control offline 0142` zmienia plik. Ekran symulatora w panelu (iteracja 6) zastąpi plik.
- **Wygasanie komend:** symulator odrzuca komendę po `expiresAt` z powodem `EXPIRED` ([ADR 0038](0038-wygasanie-komend-mqtt.md)), także komendę dostarczoną przez broker po powrocie online.

## Konsekwencje

Pozytywne:

- Przejazd klienta wygląda w panelu jak prawdziwy: hulajnoga rusza po odblokowaniu, telemetria daje trasę i dystans, a strefa parkowania na końcu pozwala zakończyć przejazd.
- Nieudane odblokowanie i przeterminowaną komendę można pokazać bez restartu symulatora.

Negatywne i ryzyka:

- Klient nie steruje kierunkiem jazdy; demo zawsze kończy się w losowej strefie.
- Plik sterujący jest narzędziem deweloperskim bez uwierzytelnienia; nie istnieje poza komputerem dewelopera.

## Powiązane

[ADR 0034](0034-symulator-floty.md) (zastępuje w części o przejazdach pokazowych i samoczynnej blokadzie), [ADR 0002](0002-symulacja-floty-zamiast-sprzetu.md), [ADR 0038](0038-wygasanie-komend-mqtt.md), [plan iteracji 3](../iteracje/iteracja-03-wypozyczenie.md)
