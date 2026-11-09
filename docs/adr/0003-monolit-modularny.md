# ADR 0003: Monolit modularny zamiast mikroserwisów

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Backend obejmuje kilka obszarów: konta, flotę, telemetrię, strefy, wypożyczenia, płatności, powiadomienia i operacje. Projekt realizuje jedna osoba.

## Rozważane opcje

1. **Mikroserwisy**. Niezależne wdrażanie i skalowanie, ale dużo pracy infrastrukturalnej, transakcje rozproszone i trudniejsze debugowanie.
2. **Monolit bez podziału**. Najszybszy start, ale z czasem zależności się plączą.
3. **Monolit modularny**. Jedna aplikacja i jedna baza, wyraźne granice modułów z publicznymi interfejsami.

## Decyzja

Backend jest jedną aplikacją podzieloną na moduły odpowiadające obszarom domeny. Moduł nie czyta tabel innego modułu bezpośrednio, tylko przez jego publiczny serwis lub zdarzenia domenowe.

## Konsekwencje

Pozytywne:

- Transakcje bazodanowe obejmują całe operacje biznesowe (np. zakończenie przejazdu z obciążeniem portfela).
- Proste wdrożenie i debugowanie.
- Granice modułów pozwalają w przyszłości wydzielić usługę, np. telemetrię.

Negatywne i ryzyka:

- Wszystkie moduły skalują się razem.
- Granice modułów trzeba pilnować w przeglądzie kodu.
