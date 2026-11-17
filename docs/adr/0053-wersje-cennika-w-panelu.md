# ADR 0053: Wersje cennika w panelu

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

[ADR 0015](0015-wersjonowany-cennik.md) wprowadził tabelę `tariffs` z kolejnymi wersjami i datą `valid_from`; przejazd zapamiętuje `tariff_id` przy utworzeniu, a od iteracji 3 rezerwacja jest pierwszym stanem przejazdu, więc wersja pochodzi z chwili rezerwacji albo startu bez rezerwacji ([ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md)). Dziś jest jedna wersja z danych startowych, a panel nie ma ekranu cennika.

Makiety `25-panel-platnosci/cennik-wersje` i `cennik-nowa-wersja` pokazują:
- listę wersji (obowiązuje, zaplanowana, archiwalne);
- formularz nowej wersji z datą „od teraz” albo „od daty” i porównaniem z obowiązującą;
- usunięcie zaplanowanej wersji (opisane w komentarzu).

Decyzja D6 usuwa z cennika limit strefy wolnej jazdy (od iteracji 4 limit należy do strefy). [ADR 0052](0052-paragony.md) dodaje stawkę VAT do wersji cennika. Opłata „poza strefą” to opłata za odholowanie przez serwis, pobierana od iteracji 6 (pytanie 7).

## Rozważane opcje

1. **Edycja bieżącej wersji z historią w dzienniku audytu.** Prosta, ale łamie ADR 0015: zmiana wpłynęłaby na trwające przejazdy, które wskazują tę wersję.
2. **Nowa wersja z datą obowiązywania**, wersje nieedytowalne, zaplanowaną można usunąć przed jej datą.

## Decyzja

**Opcja 2.** Szczegóły:

- **Obowiązująca wersja** to wersja z najwyższym numerem i `valid_from ≤ teraz` (dziś `currentTariff`). Wersja zaplanowana zaczyna obowiązywać sama, bez zadania w tle.
  - Stan wersji (Obowiązuje, Zaplanowana, Archiwalna) wylicza widok z `valid_from` i czasu bazy.
  - Widok podaje też liczbę przejazdów, które wskazują daną wersję.
- **Nowa wersja** (`POST /admin/tariffs`, `tariffs.write`):
  - numer o jeden większy od największego (unikalny w bazie);
  - `valid_from` teraz albo w przyszłości (core odrzuca przeszłość z zapasem kilku sekund);
  - najwyżej jedna zaplanowana wersja naraz; kolejna wymaga usunięcia poprzedniej (`TARIFF_ALREADY_SCHEDULED`);
  - wpis `tariff.created` w dzienniku audytu z wartościami i różnicą względem obowiązującej.
- **Pola wersji:**
  - odblokowanie, minuta jazdy, minuta pauzy;
  - opłata za odholowanie (dotychczasowe `out_of_zone_fee`, nazwa kolumny bez zmian);
  - bezpłatna rezerwacja w minutach, minimalne saldo, minimalna bateria (0–100%), minimalny wiek;
  - stawka VAT (`vat_rate`, migracja 0007).

  Walidacja w core (`TARIFF_INVALID` z listą pól): kwoty nieujemne w groszach, rezerwacja 0–60 min, wiek 13–99, VAT 0–100. Limitu strefy nie ma (D6).
- **Usunięcie zaplanowanej wersji** (`DELETE /admin/tariffs/{id}`): tylko przed `valid_from` i tylko gdy żaden przejazd jej nie wskazuje. Procedura `sp_delete_scheduled_tariff` z blokadą sprawdza oba warunki. Wpis `tariff.deleted` w dzienniku audytu.
- **Aplikacja:** `GET /tariff` zwraca obowiązującą wersję (ekran `platnosci-cennik`, ekran jazdy). Zaplanowanej wersji klient nie widzi do jej daty.
- **Uprawnienia** bez zmian z migracji 0002: `tariffs.read` (Dyspozytor, Administrator) i `tariffs.write` (Administrator).

## Konsekwencje

Pozytywne:

- Zmiana cen nie wpływa na trwające i zarezerwowane przejazdy, a koszt każdego przejazdu jest odtwarzalny.
- Zaplanowana zmiana cen nie wymaga działania operatora w chwili jej wejścia.
- Panel spełnia wymaganie 12 dla `tariffs` (lista, szczegóły, nowa wersja zamiast edycji).

Negatywne i ryzyka:

- Pomyłka w obowiązującej wersji wymaga nowej wersji „od teraz”, a nie poprawki.
- Kolumna `out_of_zone_fee` ma nazwę z pierwotnego znaczenia; zmiana nazwy byłaby kosztowna, więc znaczenie opisuje dokumentacja.

## Powiązane

[ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md), [ADR 0015](0015-wersjonowany-cennik.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [ADR 0044](0044-komendy-stref-dla-hulajnogi.md) (limit w strefie), [ADR 0052](0052-paragony.md), [plan iteracji 5](../iteracje/iteracja-05-platnosci.md) (pytanie 7, D6)
