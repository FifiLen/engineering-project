# ADR 0072: Wykresy w panelu i w PDF

- **Status:** zaakceptowana
- **Data:** 2026-11-19

## Kontekst

Raporty ([ADR 0071](0071-modul-raportow.md)) i pulpit pokazują wykresy w panelu, a raport PDF powstaje w API z HTML przez Chromium w Gotenbergu. Panel nie ma biblioteki wykresów, a projekt nie używa `dangerouslySetInnerHTML` ([ADR 0063](0063-markdown-w-tresciach.md)). Autor przyjął D2: wspólna geometria w `packages/shared` i dwa renderery.

Plansze `32-panel-raporty`, `33-panel-pulpit` i `34-panel-domkniecie` potrzebują czterech rodzajów:
- słupki w czasie z porównaniem do poprzedniego okresu i dymkiem (przychody, przejazdy według godzin ze znacznikami średniej);
- mapa ciepła 7 × 24 (przejazdy według dnia tygodnia i godziny);
- pasek udziałów (stan floty, udziały czasu hulajnogi);
- oś czasu przedziałów (historia stanów hulajnogi, wiersz na dobę).

Kolory z plansz: słupki `#6B6E75` (kontrast 5,1:1 na białym), poprzedni okres w betonie `#E3E3DE`, kobalt tylko dla bieżącej albo zaznaczonej wartości, znacznik średniej grafitowy (beton na białym ma 1,9:1, a znacznik potrzebuje co najmniej 3:1), rezerwacja `#AEB6FB`, mapa ciepła w pięciu stopniach od betonu do grafitu. Zmiana wobec poprzedniego okresu to strzałka w kolorze tekstu, bez zieleni i czerwieni, bo spadek nie jest błędem.

## Rozważane opcje

1. **Biblioteka w panelu (np. Recharts) i osobny generator SVG w API.** Szybki start w panelu, ale dwa wyglądy do utrzymania i biblioteka zależna od DOM, której API nie użyje.
2. **Biblioteka z renderowaniem SVG po stronie serwera (np. ECharts `renderToSVGString`) w obu miejscach.** Jeden wygląd, ale duża zależność, motyw do nadpisania pod design system i SVG jako tekst, który panel musiałby wstawić przez `dangerouslySetInnerHTML`.
3. **Własna geometria w `packages/shared`** zwracająca kształty jako dane i dwa cienkie renderery. Cztery rodzaje wykresów to mało kodu, a ten sam wynik trafia do panelu i do PDF.

## Decyzja

Opcja 3.

- `packages/shared/src/charts`: funkcje `barSeries`, `heatmap`, `shareBar`, `intervalTimeline` i `niceTicks` przyjmują dane i wymiary i zwracają `ChartModel`: listę kształtów (`rect`, `line`, `text`, `path`) z kolorem z tokenów, opis tekstowy do `aria-label` i dane tabeli „Pokaż jako tabelę”. Bez DOM, bez pomiaru tekstu (szerokości etykiet z liczby znaków i stałego współczynnika dla Inter, rzadsze podziałki przy wąskim wykresie). Testy jednostkowe na geometrii.
- **Panel:** komponent `Chart` zamienia kształty na elementy React SVG (`role="img"`, `aria-label`), dymek i zaznaczenie na najechanie i fokus klawiatury, przycisk „Pokaż jako tabelę” przy każdym wykresie. Bez animacji.
- **API:** `chartToSvg(model)` składa tekst SVG z ucieczką znaków i wstawia go do HTML raportu. W PDF zamkniętego okresu nie ma kobaltu (nie ma bieżącej wartości), a wartości z dymków są w tabelach.
- **Kolory** jak w kontekście, zapisane jako stałe obok tokenów; nowy kolor wykresu wymaga zmiany w `docs/projekt/tokens.json`.
- **Mapa ciepła:** stałe progi zapisane w katalogu raportu (np. poniżej 3, 3–6, 6–10, 10–15, od 15 przejazdów na dzień), a nie kwantyle, żeby ta sama barwa znaczyła to samo w różnych okresach; legenda podaje progi.
- **Oś czasu stanów:** brak łączności przykrywa stan; legenda i kolory takie same jak na pasku stanu floty i na mapie floty (w przejeździe kobalt, serwis czerwień, bez łączności beton, dostępna grafit, rezerwacja jasny kobalt).

## Konsekwencje

Pozytywne:

- Panel i PDF wyglądają tak samo i korzystają z jednego, przetestowanego kodu; brak zależności w API i brak HTML wstawianego do panelu.
- Dostępność z założenia: opis, tabela obok wykresu, fokus klawiatury (punkt 16).
- Wzorzec do opisania w pracy (geometria jako czysta funkcja, dwa adaptery renderujące).

Negatywne i ryzyka:

- Własny kod do utrzymania: każdy nowy rodzaj wykresu to nowa funkcja i testy.
- Szerokość tekstu jest szacowana, więc długie etykiety mogą się nie zmieścić; geometria skraca je wielokropkiem, a pełna wartość jest w dymku i w tabeli.

## Powiązane

[ADR 0007](0007-kierunek-wizualny.md), [ADR 0063](0063-markdown-w-tresciach.md), [ADR 0071](0071-modul-raportow.md), [ADR 0074](0074-historia-stanow-hulajnogi.md), [design system](../projekt/design-system.md), makiety `32-panel-raporty`, `33-panel-pulpit`, `34-panel-domkniecie`
