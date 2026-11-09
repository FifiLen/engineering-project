# ADR 0002: Symulacja floty zamiast fizycznego sprzętu

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

System steruje hulajnogami: odbiera ich pozycję i stan oraz wysyła komendy. Projekt nie dysponuje flotą ani budżetem na prototyp sprzętowy.

## Rozważane opcje

1. **Prototyp sprzętowy (np. ESP32 z GPS)**. Najbardziej realistyczny, ale kosztowny, czasochłonny i trudny do pokazania w skali.
2. **Atrapa w backendzie**. Najprostsza, ale omija warstwę komunikacji, czyli właśnie to, co jest ciekawe.
3. **Osobny symulator komunikujący się protokołem urządzenia**. Realistyczny protokół, skala dowolna, scenariusze awarii na żądanie.

## Decyzja

Budujemy osobną aplikację symulatora (`apps/simulator`), która dla każdej wirtualnej hulajnogi zestawia własne połączenie MQTT i zachowuje się jak urządzenie: wysyła telemetrię, odpowiada na komendy, traci łączność. Backend nie odróżnia symulatora od prawdziwej hulajnogi.

## Konsekwencje

Pozytywne:

- Testy obciążeniowe z setkami urządzeń.
- Scenariusze awarii (rozładowanie, utrata zasięgu) wywoływane z panelu.
- Podmiana na prawdziwy sprzęt nie wymaga zmian w backendzie, jeśli urządzenie spełnia kontrakt AsyncAPI.

Negatywne i ryzyka:

- Symulator może być zbyt idealny w porównaniu z prawdziwym urządzeniem; łagodzimy to scenariuszami awarii i opóźnień.

## Powiązane

[ADR 0011](0011-mqtt-dla-hulajnog.md), [kontrakt MQTT](../kontrakty/asyncapi-mqtt.yaml)
