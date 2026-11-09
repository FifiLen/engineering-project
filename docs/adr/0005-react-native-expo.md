# ADR 0005: Aplikacja mobilna w React Native z Expo

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Aplikacja mobilna jest rdzeniem systemu: mapa, skanowanie kodu QR, lokalizacja, powiadomienia, płynna obsługa w terenie. Ma działać na iOS i Androidzie.

## Rozważane opcje

1. **Capacitor z Vue lub Reactem**. Wspólny kod z webem, ale interfejs w WebView; gorsze odczucie przy gestach i animacjach.
2. **Flutter**. Bardzo płynny, ale osobny język (Dart) i brak wspólnych typów z backendem.
3. **React Native z Expo**. Natywne komponenty, natywna mapa, TypeScript, łatwe budowanie i dostęp do modułów natywnych.

## Decyzja

Aplikacja mobilna powstaje w React Native z Expo (Expo Router). Mapa przez natywną bibliotekę MapLibre.

## Konsekwencje

Pozytywne:

- Natywne odczucie i wydajność mapy.
- Jeden język z backendem i typy z kontraktu API.
- Możliwość dopisania modułów natywnych (np. licznik przejazdu na ekranie blokady).

Negatywne i ryzyka:

- React Native i React na webie to wciąż dwa różne zestawy komponentów.
