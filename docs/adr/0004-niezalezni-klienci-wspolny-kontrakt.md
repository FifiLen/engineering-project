# ADR 0004: Niezależni klienci, wspólny jest tylko kontrakt API

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

System ma trzy interfejsy: aplikację mobilną, panel operatora i stronę promocyjną. Pierwsza propozycja zakładała współdzielenie kodu interfejsu między klientami.

## Rozważane opcje

1. **Wspólna biblioteka komponentów dla wszystkich klientów**. Spójność, ale silne powiązanie i kompromisy między mobile a webem.
2. **Niezależni klienci z jednym kontraktem API**. Każdy klient rozwijany i wdrażany osobno; wspólne są tylko typy wynikające z API.

## Decyzja

Klienci nie współdzielą kodu interfejsu. Wspólny jest wyłącznie kontrakt z backendem: specyfikacja OpenAPI, typy zdarzeń Socket.IO i schematy z pakietu `shared`. Spójność wizualną zapewnia design system, a nie wspólny kod.

## Konsekwencje

Pozytywne:

- Klienci mogą korzystać z najlepszych narzędzi dla swojej platformy.
- Zmiana w jednym kliencie nie psuje innych.

Negatywne i ryzyka:

- Niektóre elementy (np. formatowanie kwot) trzeba zaimplementować dwa razy lub umieścić w pakiecie `shared` bez zależności od UI.

## Powiązane

[ADR 0005](0005-react-native-expo.md), [ADR 0006](0006-jedna-aplikacja-nextjs.md)
