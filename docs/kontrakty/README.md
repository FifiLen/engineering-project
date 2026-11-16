# Kontrakty komunikacji

| Plik | Zakres | Status |
|---|---|---|
| [`asyncapi-mqtt.yaml`](asyncapi-mqtt.yaml) | Komunikacja hulajnoga ↔ backend przez MQTT | wersja 1, zaimplementowana w symulatorze i backendzie (iteracja 1) |
| `openapi.json` | REST API dla aplikacji i panelu | generowany z kodu backendu (`/docs`, `/docs-json`); plik w repozytorium od iteracji 2 |
| [`asyncapi-realtime.yaml`](asyncapi-realtime.yaml) | Zdarzenia Socket.IO dla aplikacji i panelu | wersja 1: pokój `fleet` (iteracja 1); pokoje użytkownika i przejazdu w iteracji 3 |

Kontrakt MQTT jest jedynym źródłem prawdy o protokole urządzenia. Symulator i backend korzystają z tych samych schematów z pakietu `shared`, a ten plik je opisuje.

Podgląd: [AsyncAPI Studio](https://studio.asyncapi.com) (wklejenie zawartości pliku).

Symulator publikuje też swój stan na `simulator/status` (retained, [ADR 0034](../adr/0034-symulator-floty.md)). To temat narzędzia testowego, nie hulajnogi, więc nie należy do kontraktu urządzenia.
