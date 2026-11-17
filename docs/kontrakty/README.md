# Kontrakty komunikacji

| Plik | Zakres | Status |
|---|---|---|
| [`asyncapi-mqtt.yaml`](asyncapi-mqtt.yaml) | Komunikacja hulajnoga ↔ backend przez MQTT | wersja 1.1.0 (iteracja 3): termin ważności komendy `expiresAt` i powód `EXPIRED` ([ADR 0038](../adr/0038-wygasanie-komend-mqtt.md)); zaimplementowana w symulatorze i backendzie |
| [`openapi.json`](openapi.json) | REST API dla aplikacji i panelu | wersja 0.3 (iteracja 3): wypożyczenie (mapa, hulajnoga po numerze, rezerwacja, przejazd, historia, profil, usunięcie konta) i przejazdy w panelu; wcześniej logowanie, `/me`, `/legal`, zasoby panelu; generowany z kontrolerów (`pnpm api:openapi`), aktualność pilnuje test API; podgląd na żywo w `/docs` |
| [`asyncapi-realtime.yaml`](asyncapi-realtime.yaml) | Zdarzenia Socket.IO dla aplikacji i panelu | wersja 1.1.0: pokój `fleet` (iteracja 1), pokoje `rentals` (panel) i `user:{id}` (aplikacja) z iteracji 3 |

Kontrakt MQTT jest jedynym źródłem prawdy o protokole urządzenia. Symulator i backend korzystają z tych samych schematów z pakietu `shared`, a ten plik je opisuje.

Podgląd: [AsyncAPI Studio](https://studio.asyncapi.com) (wklejenie zawartości pliku).

Symulator publikuje też swój stan na `simulator/status` (retained, [ADR 0034](../adr/0034-symulator-floty.md)). To temat narzędzia testowego, nie hulajnogi, więc nie należy do kontraktu urządzenia.
