# Plan iteracji

Każda iteracja to pionowy przekrój przez system i kończy się działającym demem.

| Nr | Iteracja | Efekt do pokazania |
|---|---|---|
| 0 | Fundament | Monorepo, Docker Compose, CI, migracje, dane startowe dla Rybnika, szkielet dokumentacji |
| 1 | Symulator i telemetria | Wirtualne hulajnogi jeżdżą po Rybniku, mapa floty w panelu na żywo |
| 2 | Konta | Logowanie kodem SMS, rejestracja w aplikacji |
| 3 | Wypożyczenie | Mapa i skanowanie w aplikacji, odblokowanie i zakończenie z komendami MQTT |
| 4 | Strefy | Wolna jazda, zakaz, parkowanie; edytor stref w panelu |
| 5 | Płatności | Cennik, portfel, Stripe, rozliczenie przejazdu |
| 6 | Operacje i awarie | Zgłoszenia, utrata łączności, powiadomienia push |
| 7 | Domknięcie klientów | Pozostałe ekrany panelu, strona promocyjna |
| 8 | Jakość i obrona | Testy obciążeniowe, przegląd bezpieczeństwa, dokumentacja końcowa, scenariusz demo |

## Definicja „zrobione”

- Kod scalony z gałęzią główną, CI przechodzi.
- Testy dla nowej logiki (jednostkowe, a dla przepływów między modułami integracyjne).
- Zaktualizowane diagramy i kontrakty (OpenAPI, AsyncAPI), jeśli iteracja je zmienia.
- ADR dla każdej nowej decyzji architektonicznej.
- Wpis w [dzienniku](../dziennik.md).
- Scenariusz demo, który da się powtórzyć krok po kroku.
