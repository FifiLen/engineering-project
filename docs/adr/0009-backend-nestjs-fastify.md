# ADR 0009: Backend w NestJS z adapterem Fastify

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Backend realizuje monolit modularny z REST, WebSocket i klientem MQTT. Potrzebna jest wyraźna struktura modułów, wstrzykiwanie zależności i dobra testowalność.

## Rozważane opcje

1. **Express**. Najpopularniejszy, ale bez struktury i z niewielkim wsparciem dla typów.
2. **Fastify**. Szybki i dobrze typowany, ale strukturę dużej aplikacji trzeba zbudować samemu.
3. **Hono**. Nowoczesny i bardzo lekki, wysoko oceniany przez programistów; najlepszy na edge i małe API.
4. **NestJS z adapterem Fastify**. Moduły, wstrzykiwanie zależności, gotowe bramki WebSocket, dojrzała dokumentacja; adapter Fastify zmniejsza narzut wydajnościowy.

## Decyzja

NestJS 11 z adapterem Fastify na Node 24 LTS. Moduły NestJS odpowiadają modułom domeny z [§5.2](../arc42/05-widok-blokow.md). Klient MQTT (mqtt.js) jest opakowany w osobny moduł infrastrukturalny.

## Konsekwencje

Pozytywne:

- Struktura projektu wynika z frameworka, a nie z własnych konwencji.
- Łatwe testy jednostkowe dzięki wstrzykiwaniu zależności.
- Specyfikacja OpenAPI generowana z kodu.

Negatywne i ryzyka:

- Dekoratory i warstwa abstrakcji zwiększają ilość kodu.
- Mniejsza wydajność niż czysty Fastify, nieistotna w skali projektu.

## Powiązane

[ADR 0003](0003-monolit-modularny.md)
