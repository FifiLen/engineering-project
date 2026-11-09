# ADR 0015: Wersjonowany cennik

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Operator zmienia ceny i zasady w panelu. Zmiana nie może wpłynąć na przejazdy, które już trwają, a koszt przejazdu musi być możliwy do odtworzenia.

## Rozważane opcje

1. **Ceny jako aktualna konfiguracja**. Proste, ale koszt starego przejazdu zależy od dzisiejszych cen.
2. **Wersje cennika z datą obowiązywania**. Każdy przejazd wskazuje wersję obowiązującą przy starcie.

## Decyzja

Tabela `tariffs` z kolejnymi wersjami. Przejazd zapisuje `tariff_id` przy utworzeniu. Wartości oznaczone w makietach w nawiasach (ceny, czas rezerwacji, minimalne saldo, próg baterii, wiek) są kolumnami cennika.

## Konsekwencje

Pozytywne:

- Odtwarzalny koszt każdego przejazdu.
- Historia zmian cen.

Negatywne i ryzyka:

- Panel musi tworzyć nową wersję zamiast edytować istniejącą.
