# ADR 0001: Zapisywanie decyzji architektonicznych

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Projekt będzie rozwijany przez wiele miesięcy przez jedną osobę i obroniony przed komisją. Uzasadnienia decyzji łatwo zapomnieć, a pytanie „dlaczego tak, a nie inaczej” na obronie jest bardzo prawdopodobne.

## Rozważane opcje

1. **Brak formalnego zapisu**. Najszybsze, ale wiedza ginie.
2. **Opis w jednym dokumencie projektowym**. Łatwo zacząć, trudno śledzić zmiany decyzji w czasie.
3. **Architecture Decision Records**. Krótki plik na decyzję, wersjonowany razem z kodem.

## Decyzja

Każdą istotną decyzję architektoniczną zapisujemy jako ADR w katalogu `docs/adr/` według [szablonu](0000-szablon.md). ADR-ów nie edytujemy po zaakceptowaniu; zmiana decyzji to nowy ADR, który zastępuje poprzedni.

## Konsekwencje

Pozytywne:

- Historia decyzji jest częścią repozytorium.
- Gotowy materiał do rozdziału o wyborze technologii i do odpowiedzi na obronie.

Negatywne i ryzyka:

- Wymaga dyscypliny przy każdej decyzji.
