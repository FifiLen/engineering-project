# ADR 0047: Edytor geometrii stref w panelu

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Panel dostaje edytor stref (makiety `23-panel-strefy`, decyzje D1–D3 i D8 w [planie iteracji 4](../iteracje/iteracja-04-strefy.md)). Edytor ma:
- rysować nowy wielokąt;
- przesuwać punkty, dodawać je ze środka krawędzi i usuwać;
- cofać zmiany;
- pokazywać błędy geometrii na mapie i przy polu „Granica”.

Mapa panelu to MapLibre GL JS 6 (`maplibre-gl` 6.18.0, [ADR 0017](0017-uslugi-mapowe.md)). Baza trzyma `MultiPolygon` z `CHECK (ST_IsValid(geom))`. Dane startowe tworzą strefy jako okręgi z `ST_Buffer(…, 'quad_segs=16')`, czyli po 64 punkty, za gęsto do ręcznej edycji.

Biblioteki sprawdzone 17 listopada 2026 w npm (instalujemy tylko wersje starsze niż 3 dni):

| Pakiet | Wersja | Data | Licencja | Uwagi |
|---|---|---|---|---|
| `terra-draw` | 1.39.0 (1.40.0 z 15 listopada jest za nowa) | 2026-10-28 | MIT | tryby rysowania i zaznaczania z przesuwaniem i usuwaniem punktów oraz punktami środkowymi, walidacja wielokąta |
| `terra-draw-maplibre-gl-adapter` | 1.5.0 | 2026-10-06 | MIT | `peerDependencies`: `maplibre-gl >=4`, `terra-draw ^1.0.0` |
| `@mapbox/mapbox-gl-draw` | 1.5.2 | 2026-09-14 | ISC | pisany pod Mapbox GL; z MapLibre działa przez podmianę klas CSS, bez walidacji samoprzecięć |
| `@geoman-io/maplibre-geoman-free` | 0.10.8 | 2026-11-06 | MIT | `maplibre-gl >=6 <7`, wersja przed 1.0 |

## Rozważane opcje

1. **Terra Draw z adapterem MapLibre.** Biblioteka niezależna od dostawcy mapy, z aktywnym rozwojem i walidacją wielokąta. Wymaga własnego paska narzędzi i własnego cofania.
2. **Mapbox GL Draw.** Najbardziej znana, ale zależna od klas i stylów Mapbox; z MapLibre 6 działa obejściem.
3. **Geoman dla MapLibre.** Gotowy pasek narzędzi, ale wersja przed 1.0 i własny wygląd, który trzeba by nadpisać pod design system.
4. **Własny edytor** na zdarzeniach MapLibre. Pełna kontrola, ale dużo kodu do napisania i przetestowania (przeciąganie, punkty środkowe, przyciąganie).

## Decyzja

**Opcja 1:** `terra-draw` 1.39.0 i `terra-draw-maplibre-gl-adapter` 1.5.0, wersje przypięte i sprawdzone ponownie przed instalacją. Szczegóły:

- **Pasek narzędzi i wygląd:** pasek jest własny, jak w makiecie: „Rysuj wielokąt”, „Edytuj punkty”, „Usuń punkt”, „Cofnij”. Tryby Terra Draw: `polygon` i `select` z przeciąganiem, usuwaniem punktów i punktami środkowymi. Kolory i grubości linii pochodzą z tokenów projektu.
- **Model geometrii:**
  - edytor pracuje na `Polygon` bez otworów, bo jedna strefa to jeden wielokąt (D1);
  - API przyjmuje GeoJSON `Polygon`, a baza zapisuje `ST_Multi(...)`;
  - przy odczycie `MultiPolygon` z jedną częścią staje się `Polygon`; strefa wieloczęściowa (dziś żadna) jest w edytorze tylko do odczytu;
  - współrzędne mają 6 miejsc po przecinku, czyli około 0,1 m, jak `activeZonesGeoJson`.
- **Walidacja ma trzy poziomy, a rozstrzyga baza:**
  - **panel:** walidacja Terra Draw nie pozwala zamknąć wielokąta, który przecina sam siebie, i pokazuje błąd przy polu „Granica”;
  - **core:** sprawdza co najmniej 3 różne punkty, zamknięcie pierścienia, zakres współrzędnych i najmniejszą powierzchnię 100 m² (stała w core); błąd `ZONE_INVALID_GEOMETRY`;
  - **baza (migracja 0006):**
    - `ST_IsValid` (`ZONE_INVALID_GEOMETRY`);
    - strefa w obszarze działania (`ZONE_OUTSIDE_SERVICE_AREA`, wyzwalacz);
    - strefy parkowania bez części wspólnej, czyli `ST_Intersects` bez `ST_Touches` (`ZONE_OVERLAP`, wyzwalacz, D3).

    API mapuje te kody błędów, jak `DATABASE_RULES` w iteracji 3.
- **Cofanie:** stos zmian geometrii w panelu: każda zakończona operacja Terra Draw (dodanie, przesunięcie, usunięcie punktu) zapisuje kopię wielokąta. „Cofnij” i Ctrl+Z zdejmują ostatnią kopię; stos ma najwyżej 50 kopii. Cofanie dotyczy tylko niezapisanych zmian; po zapisie historia jest w dzienniku audytu (D8).
- **Przyciąganie:** do punktów i krawędzi innych stref, jeśli Terra Draw 1.39.0 obsługuje je w trybach `polygon` i `select`; w przeciwnym razie bez przyciągania, bo baza i tak pilnuje nakładania.
- **Typ strefy nie zmienia się po utworzeniu.** Przełącznik typu jest aktywny tylko dla nowej strefy. Zmiana parkowania na zakaz zmieniłaby znaczenie zakończonych przejazdów (`end_zone_id`) i zdarzeń stref, więc trzeba utworzyć nową strefę i dezaktywować starą. Makiety `strefy-lista` i `strefa-wolna-jazda` pokazują aktywny przełącznik w edycji; implementacja go blokuje, a odstępstwo trafi do dziennika.
- **Mniej punktów w danych startowych:** okręgi powstają z `quad_segs=4`, czyli 16 punktów (wystarczy dla promieni 45–180 m). Istniejących baz to nie zmienia, bo dane startowe są deweloperskie i zakłada się je od nowa.
- **Praca kilku operatorów:**
  - wersja rekordu i konflikt `CONFLICT` jak we wzorcu formularza ([ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md));
  - zdarzenie `zones.changed` odświeża mapę u innych operatorów;
  - otwarty formularz ze zmianami nie jest nadpisywany: przy zapisie operator dostaje konflikt wersji.

## Konsekwencje

Pozytywne:

- Rysowanie i edycja działają na tej samej mapie MapLibre co reszta panelu, z wyglądem z design systemu.
- Błędna geometria nie trafi do bazy niezależnie od klienta, bo ostateczne reguły są w bazie i w core.
- Stała liczba punktów w danych startowych ułatwia demo edycji.

Negatywne i ryzyka:

- Dwie nowe zależności panelu, aktualizowane z opóźnieniem trzech dni. Adapter musi nadążać za MapLibre 6; przy problemie zostaje opcja 4 dla samego trybu edycji.
- Własny stos cofania i pasek narzędzi to kod do utrzymania.
- Blokada zmiany typu jest odstępstwem od makiety i wymaga zdania w interfejsie („Typ ustala się przy tworzeniu strefy”).

## Powiązane

[ADR 0017](0017-uslugi-mapowe.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [ADR 0043](0043-wykrywanie-zmian-stref.md), makiety [`23-panel-strefy`](../projekt/README.md#panel-operatora-strefy-iteracja-4), [plan iteracji 4](../iteracje/iteracja-04-strefy.md) (D1–D3, D8)
