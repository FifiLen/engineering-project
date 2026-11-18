# ADR 0056: Przejazd przy utracie łączności i niskiej baterii

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

Naliczanie przy utracie łączności było otwartą decyzją od iteracji 3. Dziś utrata łączności to tylko zdarzenia `CONNECTION_LOST` i `CONNECTION_RESTORED` na osi czasu przejazdu, bez wpływu na naliczanie. Zakończenie przy hulajnodze offline jest niemożliwe:
- komenda `lock` wygasa po 10 s ([ADR 0038](0038-wygasanie-komend-mqtt.md));
- brak potwierdzenia daje `LOCK_FAILED`;
- przejazd wraca do jazdy, a żądanie zakończenia przestaje się liczyć ([ADR 0036](0036-proces-wypozyczenia-w-api.md), [ADR 0042](0042-wycena-przejazdu.md)).

Klient z hulajnogą bez sieci płaciłby więc do skutku.

Autor rozstrzygnął (pytanie 1 planu iteracji 6, 18 listopada 2026):
- naliczanie trwa, bo hulajnoga działa bez sieci;
- klient może zakończyć przejazd, gdy ostatnia znana pozycja hulajnogi (nie starsza niż 2 min) jest w strefie parkowania;
- naliczanie kończy się przy żądaniu, a blokada czeka na powrót łączności;
- bez powrotu łączności w 10 min przejazd kończy się automatycznie, z naliczaniem do żądania i zgłoszeniem;
- bez żądania klienta naliczanie zatrzymuje się po 30 min braku łączności, a przejazd kończy operator;
- zdjęcie parkowania jest wtedy wymagane (pytanie 9).

Pytanie 2 dotyczy niskiej baterii:
- przy progu z cennika (15%) klient dostaje komunikat z prowadzeniem do strefy;
- przy 5% hulajnoga zwalnia do 10 km/h;
- powiadomienie push idzie, gdy aplikacja jest w tle.

Typ zdarzenia `BATTERY_LOW` istnieje od iteracji 0, ale nikt go nie zapisuje.

## Rozważane opcje

Zakończenie przy hulajnodze offline:

1. **Tylko operator kończy przejazd.** Bez nadużyć, ale klient czeka na telefon i płaci za czas oczekiwania.
2. **Zakończenie od razu bez blokady.** Najwygodniejsze, ale hulajnoga zostaje odblokowana bez przejazdu i można nią jechać za darmo.
3. **Zakończenie warunkowe z ostatniej pozycji, naliczanie do żądania, blokada po powrocie łączności, limit 10 min** (odpowiedź autora). Klient nie płaci za awarię sieci, a hulajnoga zostaje zablokowana, gdy tylko wróci łączność.

Gdzie trzymać tryb zakończenia:

1. **Tylko w zdarzeniach osi czasu.** Wystarcza do wyceny, ale aplikacja i panel musiałyby szukać zdarzenia, żeby wiedzieć, że zdjęcie jest wymagane.
2. **Kolumna `rentals.end_mode`** obok osi czasu. Jeden odczyt dla widoku przejazdu, a oś czasu zostaje źródłem dla wyceny.

## Decyzja

**Opcja 3 i kolumna `end_mode`.**

### Zakończenie bez łączności

- **Warunek** (core, `canEndOffline`):
  - hulajnoga jest offline według statusu z brokera;
  - ostatnia pozycja z telemetrii ma najwyżej 120 s w chwili żądania;
  - pozycja leży w strefie parkowania i poza strefą zakazu.

  Gdy pozycja jest za stara, błąd to `POSITION_STALE`; gdy jest poza strefą, `OUTSIDE_PARKING`, jak dziś. Hulajnoga online kończy przejazd jak dotąd.
- **Żądanie:** `REQUEST_END` (`ACTIVE | PAUSED → ENDING`) z `end_mode = 'CUSTOMER_OFFLINE'` i zdarzeniem żądania z `data.mode = 'OFFLINE'`. Do tego:
  - komenda `lock` z `expiresAt` za 10 min zamiast 10 s, którą broker dostarczy z sesji trwałej po powrocie hulajnogi;
  - zadanie pg-boss `rental.offline-end-timeout` po 10 min.
- **Naliczanie** kończy się w chwili żądania. W trybie offline `LOCK_FAILED` nie unieważnia żądania. To zmiana ADR 0042 w tej jednej sprawie.
- **Wynik:**
  - **potwierdzona blokada w ciągu 10 min:** `COMPLETE_END` (`ENDING → ENDED`), jak dziś;
  - **brak potwierdzenia, odrzucenie albo wygaśnięcie:** nowa akcja `END_UNCONFIRMED` (`ENDING → ENDED`) z rozliczeniem tą samą kwotą i zgłoszeniem automatycznym `OFFLINE` ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)).

  Przez te 10 min przejazd jest otwarty, więc klient nie zacznie nowego.
- **Hulajnoga bez przejazdu, która zgłasza się odblokowana:** po powrocie łączności system wysyła `lock` bez `rental_id`. Reguła działa w module Telemetria: status bez otwartego przejazdu z `locked: false` daje komendę.
- **Jazda po żądaniu:** zbuforowana telemetria po powrocie łączności może pokazać ruch po chwili żądania zakończenia. Jeśli dystans przekracza 200 m, przejazd dostaje zdarzenie `MOVED_AFTER_END`. Dyspozytor widzi je na osi czasu i decyduje o korekcie salda ([ADR 0054](0054-zwroty-i-korekty-salda.md)). Kwota nie zmienia się sama.

### Naliczanie bez żądania klienta

- **Liczniki** `rentalCounters` w core: każdy odcinek bez łączności (od `CONNECTION_LOST` do `CONNECTION_RESTORED` albo do końca przejazdu) liczy się najwyżej przez 30 min. Po powrocie łączności naliczanie biegnie dalej.
- **Zadanie** `rental.offline-billing-stop` po 30 min zapisuje zdarzenie `BILLING_STOPPED`. Przejazd trafia na pulpit „Wymaga uwagi” (D1), a operator kończy go zdalnie. Licznik na ekranie jazdy pokazuje zatrzymaną kwotę.

### Tryb zakończenia i zdjęcie

- **`rentals.end_mode`** (`CUSTOMER`, `CUSTOMER_OFFLINE`, `REMOTE`, `UNCONFIRMED`) ustawiane przy żądaniu albo zakończeniu.
- **Zdjęcie parkowania** jest wymagane przy `CUSTOMER_OFFLINE`. Widok przejazdu ma `parkingPhotoRequired`, a aplikacja wraca do ekranu zdjęcia, dopóki go nie ma. Przejazd jest już rozliczony, więc API nie blokuje niczego poza tym ekranem.

### Niska bateria w trakcie jazdy

- **Progi:** `LOW` to `min_battery_pct` z wersji cennika przejazdu (dziś 15%), a `CRITICAL` to stała 5% w core. Każdy próg daje jedno zdarzenie `BATTERY_LOW` z `data.threshold` na przejazd, z odczytu bieżącego, nie z bufora. Spadek przez próg i powrót o 1–2% przy szumie odczytu nie daje drugiego zdarzenia.
- **`LOW`:** komunikat w aplikacji z prowadzeniem do najbliższej strefy parkowania i powiadomienie `battery_low` ([ADR 0058](0058-powiadomienia-push-z-szablonow.md)). Powiadomienie idzie zawsze; aplikacja na pierwszym planie go nie wyświetla, bo ekran jazdy ma własny komunikat.
- **`CRITICAL`:** docelowy limit prędkości to najmniejszy z limitu stref i 10 km/h. Uzgadnianie komend stref ([ADR 0044](0044-komendy-stref-dla-hulajnogi.md)) dostaje drugie źródło limitu bez nowej komendy MQTT (`speed_limit` z `params.kmh`). Limit trwa do końca przejazdu; pauza i wznowienie przywracają go jak limity stref.

## Konsekwencje

Pozytywne:

- Klient nie płaci za awarię sieci ani nie czeka na operatora, a hulajnoga zostaje zablokowana po powrocie łączności.
- Wycena zostaje czystą funkcją osi czasu: nowe reguły to dwa warunki w `rentalCounters`, bez liczników zapisywanych w trakcie jazdy.
- Niska bateria korzysta z gotowego uzgadniania limitów stref.

Negatywne i ryzyka:

- Klient może zakończyć przejazd w strefie i jechać dalej bez sieci. Ryzyko ogranicza `lock` po powrocie łączności i zdarzenie `MOVED_AFTER_END`, ale kwota nie koryguje się sama.
- Przejazd w `ENDING` do 10 min to wyjątek od dotychczasowego „kończenie trwa kilka sekund”. Widoki, testy i ekran kończenia muszą go obsłużyć.
- Hulajnoga, która nie wróci, kończy się `END_UNCONFIRMED` bez blokady. Odnalezienie jej to zgłoszenie `OFFLINE` i praca serwisu.

## Powiązane

[ADR 0042](0042-wycena-przejazdu.md) (zmienia: `LOCK_FAILED` w trybie offline i limit 30 min), [ADR 0036](0036-proces-wypozyczenia-w-api.md) (zmienia: czas oczekiwania w `ENDING` w trybie offline), [ADR 0038](0038-wygasanie-komend-mqtt.md), [ADR 0043](0043-wykrywanie-zmian-stref.md), [ADR 0044](0044-komendy-stref-dla-hulajnogi.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0057](0057-pliki-zdjecia.md), arc42 §6.6, [plan iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) (pytania 1, 2, 9), makiety `koniec-offline`, `koniec-offline-poza-strefa`
