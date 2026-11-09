# ADR 0020: Obszar działania: Rybnik

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Symulator, strefy i dane testowe muszą leżeć w konkretnym mieście na prawdziwej mapie.

## Rozważane opcje

1. **Fikcyjne miasto**. Brak zależności od danych, ale demo jest mniej przekonujące.
2. **Duże miasto (np. Kraków, Warszawa)**. Rozpoznawalne, ale duże wycinki danych i trudność weryfikacji tras.
3. **Rybnik**. Miasto znane autorowi, co ułatwia weryfikację tras i stref; mały wycinek danych.

## Decyzja

Obszar działania to Rybnik. Pierwsze strefy parkowania: Rynek, dworzec PKP (ul. Dworcowa), Kampus (ul. Rudzka 13), oś handlowa Focus i Plaza; strefa wolnej jazdy w okolicach Rynku. Geometrie z OpenStreetMap, korygowane w edytorze stref. Wielkość floty jest parametrem symulatora.

## Konsekwencje

Pozytywne:

- Autor może zweryfikować realizm tras i stref.
- Konkretne studium przypadku w pracy (np. studenci Kampusu jako grupa docelowa).

Negatywne i ryzyka:

- Wyniki testów zależą od układu ulic jednego miasta.

## Powiązane

[ADR 0017](0017-uslugi-mapowe.md)
