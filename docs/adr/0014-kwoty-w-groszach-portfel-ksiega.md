# ADR 0014: Kwoty w groszach i portfel jako księga

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

System nalicza opłaty, prowadzi saldo portfela i przyjmuje płatności. Błąd w pieniądzach jest najbardziej kosztowny.

## Rozważane opcje

1. **Kwoty jako liczby zmiennoprzecinkowe, saldo jako jedna kolumna**. Proste, ale błędy zaokrągleń i brak historii zmian.
2. **Typ numeric, saldo jako kolumna**. Dokładne kwoty, nadal bez historii.
3. **Liczby całkowite w groszach i księga ruchów**. Dokładne, każdy ruch ma ślad, saldo da się odtworzyć.

## Decyzja

Kwoty są przechowywane jako `bigint` w groszach. Każdy ruch środków to nowy wiersz w `wallet_ledger` z saldem po operacji; kolumna `wallets.balance` jest pamięcią podręczną aktualizowaną w tej samej transakcji. Wpisów w księdze nie modyfikujemy ani nie usuwamy; korekta to nowy wpis.

## Konsekwencje

Pozytywne:

- Brak błędów zaokrągleń.
- Pełny ślad audytowy i możliwość weryfikacji salda.
- Indeks częściowy uniemożliwia podwójne obciążenie za przejazd.

Negatywne i ryzyka:

- Formatowanie kwot w klientach musi dzielić przez 100.
