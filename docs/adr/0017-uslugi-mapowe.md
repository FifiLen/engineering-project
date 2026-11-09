# ADR 0017: Usługi mapowe: MapLibre, OpenFreeMap, Photon i OSRM

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Mapa jest głównym elementem aplikacji i panelu. Potrzebne są kafelki, wyszukiwanie adresów i wyznaczanie tras, a budżet jest bliski zeru.

## Rozważane opcje

1. **Google Maps lub Mapbox**. Bardzo dobra jakość, ale klucze, limity i koszty.
2. **MapTiler**. Darmowy plan z limitami.
3. **Otwarte usługi i samodzielny hosting**. MapLibre z kafelkami OpenFreeMap, geokodowanie Photon, własny OSRM.

## Decyzja

Renderowanie map: MapLibre (natywnie w aplikacji, MapLibre GL JS w panelu), ze wspólnym stylem w palecie projektu. Kafelki: OpenFreeMap. Wyszukiwanie adresów: Photon. Trasy: OSRM w Dockerze z wycinkiem województwa śląskiego; używają go backend (prowadzenie do strefy) i symulator (realistyczne trasy). Każda usługa jest za adapterem.

## Konsekwencje

Pozytywne:

- Brak kosztów i kluczy.
- Ten sam styl mapy w aplikacji i panelu.
- Realistyczne trasy w symulatorze.

Negatywne i ryzyka:

- Publiczne instancje Photon i OpenFreeMap mają zasady uczciwego użytkowania; w razie potrzeby można je hostować samodzielnie.

## Powiązane

[ADR 0020](0020-obszar-dzialania-rybnik.md)
