# ADR 0013: Rezerwacja jako stan przejazdu

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Przejazd przechodzi przez rezerwację, odblokowanie, jazdę, pauzę i zakończenie, z kilkoma ścieżkami błędów. Rezerwacja i przejazd dotyczą tej samej hulajnogi i tego samego użytkownika.

## Rozważane opcje

1. **Osobne tabele rezerwacji i przejazdów**. Prostsze tabele, ale dwa źródła prawdy o tym, czy hulajnoga jest zajęta.
2. **Jedna tabela z maszyną stanów**. Rezerwacja jest pierwszym stanem przejazdu.

## Decyzja

Tabela `rentals` z kolumną `state` (RESERVED, UNLOCKING, ACTIVE, PAUSED, ENDING, ENDED, EXPIRED, UNLOCK_FAILED, UNPAID). Przejścia realizuje jedna klasa maszyny stanów w module Wypożyczenia; każde przejście zapisuje zdarzenie w `rental_events`. Indeksy częściowe gwarantują jeden otwarty przejazd na hulajnogę i na użytkownika.

## Konsekwencje

Pozytywne:

- Jedno źródło prawdy o zajętości hulajnogi.
- Oś czasu przejazdu w panelu wynika wprost z tabeli zdarzeń.
- Niedozwolone przejścia są odrzucane w jednym miejscu.

Negatywne i ryzyka:

- Część kolumn ma sens tylko w niektórych stanach.

## Powiązane

[§6.1](../arc42/06-widok-czasu-dzialania.md)
