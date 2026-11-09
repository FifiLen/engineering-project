# ADR 0012: Aktualizacje na żywo przez Socket.IO

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Aplikacja pokazuje stan przejazdu, a panel pozycje floty na żywo. Klient mobilny często traci i odzyskuje połączenie.

## Rozważane opcje

1. **Odpytywanie REST**. Proste, ale opóźnione i obciążające.
2. **Server-Sent Events**. Lekkie, ale jednokierunkowe.
3. **Czysty WebSocket**. Wydajny, ale wznawianie połączenia i pokoje trzeba napisać samemu.
4. **Socket.IO**. Automatyczne wznawianie, pokoje, gotowe bramki w NestJS.

## Decyzja

Socket.IO z pokojami `user:{id}`, `rental:{id}` i `fleet`. Zdarzenia są opisane typami w pakiecie `shared`. Stan źródłowy zawsze można pobrać przez REST, zdarzenia tylko przyspieszają odświeżenie.

## Konsekwencje

Pozytywne:

- Odporność na zrywanie połączenia w terenie.
- Prosta integracja z NestJS.

Negatywne i ryzyka:

- Własny protokół ponad WebSocketem, wymaga klienta Socket.IO.
