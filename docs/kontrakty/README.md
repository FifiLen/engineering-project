# Kontrakty komunikacji

| Plik | Zakres | Status |
|---|---|---|
| [`asyncapi-mqtt.yaml`](asyncapi-mqtt.yaml) | Komunikacja hulajnoga ↔ backend przez MQTT | wersja 1, przed implementacją |
| `openapi.json` | REST API dla aplikacji i panelu | generowany z kodu backendu od iteracji 2 |
| `asyncapi-realtime.yaml` | Zdarzenia Socket.IO dla aplikacji i panelu | do przygotowania w iteracji 1 |

Kontrakt MQTT jest jedynym źródłem prawdy o protokole urządzenia. Symulator i backend korzystają z tych samych schematów z pakietu `shared`, a ten plik je opisuje.

Podgląd: [AsyncAPI Studio](https://studio.asyncapi.com) (wklejenie zawartości pliku).
