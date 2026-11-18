# Kontrakty komunikacji

| Plik | Zakres | Status |
|---|---|---|
| [`asyncapi-mqtt.yaml`](asyncapi-mqtt.yaml) | Komunikacja hulajnoga ↔ backend przez MQTT | wersja 1.3.0 (iteracja 6): komenda `battery_swapped` ([ADR 0059](../adr/0059-symulator-sterowany-z-panelu.md)); wcześniej komendy stref (1.2.0, [ADR 0044](../adr/0044-komendy-stref-dla-hulajnogi.md)) i `expiresAt` z powodem `EXPIRED` (1.1.0, [ADR 0038](../adr/0038-wygasanie-komend-mqtt.md)); zaimplementowana w symulatorze i backendzie |
| [`asyncapi-symulator.yaml`](asyncapi-symulator.yaml) | Sterowanie symulatorem floty przez MQTT (narzędzie demo, nie urządzenie) | wersja 1.0.0 (iteracja 6): polecenia scenariuszy na `simulator/control`, wyniki na `simulator/control/result`, stan ze scenariuszami na `simulator/status` ([ADR 0059](../adr/0059-symulator-sterowany-z-panelu.md)); zaimplementowana w symulatorze |
| [`openapi.json`](openapi.json) | REST API dla aplikacji i panelu | wersja 0.4.0: od iteracji 6 pliki (`/files`), zgłoszenia klienta i panelu, zadania serwisowe, magazyn części, karta serwisowa hulajnogi, pulpit „Wymaga uwagi”, tokeny push, szablony i lista powiadomień, symulator (`/admin/simulator/*`), zdjęcie parkowania i opłata za odholowanie; wcześniej płatności i cennik (iteracja 5), strefy i trasy (4), wypożyczenie i przejazdy w panelu (3), logowanie, `/me`, `/legal`, zasoby panelu (2); generowany z kontrolerów (`pnpm api:openapi`), aktualność pilnuje test API; podgląd na żywo w `/docs` |
| [`asyncapi-realtime.yaml`](asyncapi-realtime.yaml) | Zdarzenia Socket.IO dla aplikacji i panelu | wersja 1.4.0 (iteracja 6): pokoje `tickets`, `service` i `simulator` z subskrypcjami, `ticket.updated`, `service-task.updated`, `simulator.status`, `simulator.result`, `notification.created` w pokoju `user:{id}`; wcześniej `wallet.updated` (1.3.0), `zones.changed` (1.2.0), pokoje `rentals` i `user:{id}` (1.1.0), pokój `fleet` (1.0.0) |

Kontrakt MQTT jest jedynym źródłem prawdy o protokole urządzenia. Symulator i backend korzystają z tych samych schematów z pakietu `shared`, a ten plik je opisuje.

Podgląd: [AsyncAPI Studio](https://studio.asyncapi.com) (wklejenie zawartości pliku).

Symulator publikuje też swój stan na `simulator/status` (retained, [ADR 0034](../adr/0034-symulator-floty.md)) i od iteracji 6 przyjmuje polecenia scenariuszy z panelu. To tematy narzędzia testowego, nie hulajnogi, więc mają osobny kontrakt `asyncapi-symulator.yaml` ([ADR 0059](../adr/0059-symulator-sterowany-z-panelu.md)) ze schematami w `packages/shared/src/simulator.ts`.
