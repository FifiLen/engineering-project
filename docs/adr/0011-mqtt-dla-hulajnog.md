# ADR 0011: MQTT do komunikacji z hulajnogami

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Hulajnogi wysyłają telemetrię co kilka sekund i odbierają komendy. Łączność komórkowa jest zawodna, a backend musi wiedzieć, czy komenda została wykonana i czy urządzenie jest online.

## Rozważane opcje

1. **HTTP z odpytywaniem**. Prosty, ale komendy z opóźnieniem i duży narzut na urządzeniu.
2. **WebSocket**. Dwukierunkowy, ale bez gotowych mechanizmów gwarancji dostarczenia i wykrywania zerwania.
3. **MQTT z brokerem Mosquitto**. Standard IoT: lekki protokół, poziomy QoS, wiadomości Last Will, publikuj–subskrybuj.

## Decyzja

Hulajnogi łączą się z brokerem Mosquitto. Tematy: `scooters/{id}/telemetry`, `scooters/{id}/status` (z Last Will i flagą retained), `scooters/{id}/cmd`, `scooters/{id}/ack`. Komendy mają `commandId` zapisywany w tabeli `scooter_commands`; QoS 1. Pełny kontrakt: [AsyncAPI](../kontrakty/asyncapi-mqtt.yaml).

## Konsekwencje

Pozytywne:

- Broker sam informuje o zerwaniu połączenia urządzenia.
- Potwierdzenia komend z identyfikatorem umożliwiają limit czasu i idempotencję.
- Ten sam protokół dla symulatora i prawdziwego urządzenia.

Negatywne i ryzyka:

- Dodatkowy element infrastruktury.
- Broker jest pojedynczym punktem awarii (akceptowane w projekcie).

## Powiązane

[ADR 0002](0002-symulacja-floty-zamiast-sprzetu.md)
