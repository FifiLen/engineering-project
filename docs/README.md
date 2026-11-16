# Dokumentacja systemu wypożyczania hulajnóg elektrycznych

Projekt inżynierski. System składa się z aplikacji mobilnej dla użytkowników, aplikacji webowej (strona promocyjna i panel operatora), backendu oraz symulatora floty hulajnóg.

Dokumentacja jest częścią repozytorium i zmienia się razem z kodem. Każda iteracja kończy się aktualizacją dokumentów, których dotyczyła.

## Struktura

| Katalog | Zawartość |
|---|---|
| [`arc42/`](arc42/) | Dokumentacja architektury według szablonu arc42, z diagramami C4 i sekwencji w Mermaid |
| [`adr/`](adr/) | Zapisy decyzji architektonicznych (ADR), jedna decyzja na plik |
| [`kontrakty/`](kontrakty/) | Kontrakty komunikacji: AsyncAPI dla MQTT, później OpenAPI (REST) i zdarzenia WebSocket |
| [`model-danych/`](model-danych/) | Model danych: diagram ER i schemat SQL |
| [`iteracje/`](iteracje/) | Plan iteracji, definicja „zrobione” i plany poszczególnych iteracji |
| [`dziennik.md`](dziennik.md) | Dziennik prac: co powstało w każdej iteracji i co zmieniło się względem planu |
| [`projekt/`](projekt/README.md) | Projekt graficzny: makiety (PNG i HTML), design system, tokeny, rendery, ikona, model 3D |
| [`wymagania-uczelni.md`](wymagania-uczelni.md) | Wymagania uczelni, analiza zgodności i pytania do prowadzącego |

## Powiązanie z pracą inżynierską

| Rozdział pracy | Źródło w dokumentacji |
|---|---|
| Wstęp, cel i zakres pracy | arc42 §1, §3 |
| Analiza wymagań | wymagania-uczelni.md, arc42 §1, §10; projekt/ (makiety i mapa przepływów) |
| Przegląd i wybór technologii | ADR 0003–0019, arc42 §4 |
| Projekt systemu | arc42 §5, §6, §8; model danych; kontrakty |
| Implementacja | dziennik, arc42 §5 (komponenty), kod |
| Wdrożenie | arc42 §7 |
| Testy i weryfikacja | arc42 §10, wyniki testów z iteracji 9 |
| Podsumowanie, ograniczenia i rozwój | arc42 §11, dziennik |

## Zasady

- Decyzja architektoniczna bez ADR nie istnieje. Zmiana wcześniejszej decyzji to nowy ADR, który zastępuje poprzedni.
- Diagramy są pisane jako kod (Mermaid), żeby dało się je przeglądać w historii zmian.
- Wartości jeszcze nieustalone są oznaczone w nawiasach kwadratowych, np. `[CENA]`.
