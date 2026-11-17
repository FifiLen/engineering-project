# ADR 0049: Rozliczenie przejazdu

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Od iteracji 3 zakończenie przejazdu liczy kwotę z wersji cennika ([ADR 0042](0042-wycena-przejazdu.md)), ale nikogo nie obciąża (`settlement: 'PENDING'`). W iteracji 5 przejazd ma być opłacony z portfela albo kartą ([plan iteracji 5](../iteracje/iteracja-05-platnosci.md)).

Autor rozstrzygnął:
- **Portfel:** obciążenie w transakcji `ENDED`, a saldo może spaść poniżej zera; ujemne saldo blokuje rezerwację i start (pytanie 4, D4).
- **Minimalne saldo:** sprawdzane przy rezerwacji i starcie, chyba że klient wybierze kartę (pytania 2 i 5).
- **Karta:** obciążenie zadaniem po `ENDED`. Odmowa daje `UNPAID`, który blokuje rezerwację i start. Spłata jest kartą albo z portfela, a automatyczne ponowienie jedno, po 24 h (pytanie 6, D4).
- **Stare przejazdy:** przejazdy z iteracji 3 i 4 zostają nierozliczone (pytanie 12).

Maszyna stanów z [ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md) ma dziś akcje `DECLINE_PAYMENT` (`ENDING → UNPAID`) i `SETTLE_DEBT` (`UNPAID → ENDED`). Przy D4 nie da się ich użyć, bo przejazd kartą jest już w `ENDED`, zanim przyjdzie wynik płatności.

Księga portfela jest tylko do dopisywania, a `wallets.balance` to pamięć podręczna ([ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md)). Każdy zapis musi więc liczyć `balance_after` z zablokowanego wiersza portfela.

## Rozważane opcje

Dla stanu po nieudanej płatności kartą:

1. **Przejazd kartą czeka w `ENDING` na wynik płatności.** Zgodne z diagramem §6.1, ale klient czeka na operatora płatności po zablokowaniu hulajnogi, a ekran „Kończenie” trwa dłużej (wbrew D4).
2. **`ENDED → UNPAID` przy odmowie i `UNPAID → ENDED` po spłacie.** Przejazd kończy się od razu, a zaległość to osobny stan przejazdu, który widzi panel (filtr „Nieopłacone”) i aplikacja. `ENDED` przestaje być stanem końcowym, ale tylko dla tego jednego przejścia.
3. **Przejazd zostaje `ENDED`, a zaległość wynika tylko ze statusu płatności.** Mniej zmian w maszynie stanów, ale stan `UNPAID` z typu i z makiet nie byłby używany, a listy przejazdów musiałyby łączyć się z płatnościami.

## Decyzja

**Opcja 2.** Szczegóły:

- **Maszyna stanów:**
  - `DECLINE_PAYMENT` zmienia się na `ENDED → UNPAID`; `SETTLE_DEBT` zostaje `UNPAID → ENDED`;
  - `UNPAID` nie jest stanem otwartym (indeksy jednego otwartego przejazdu go nie obejmują), więc hulajnoga jest wolna od chwili `ENDED`;
  - diagram arc42 §6.1 dostaje poprawione przejście; zmianę ADR 0013 zapisuje ten ADR.
- **Źródło płatności** (`rentals.payment_source`) jest wybierane przy pierwszym stanie przejazdu: rezerwacji albo starcie bez rezerwacji. Start z rezerwacji może je zmienić parametrem `paymentSource`.
  - Domyślnie `WALLET`.
  - `CARD` tylko przy ważnej zapisanej karcie; karta przejazdu jest zapamiętana w przejeździe.
- **Reguła startu i rezerwacji** (core, `ensureCanPay`), sprawdzana pod blokadą wiersza portfela:
  - otwarta zaległość `UNPAID` daje `PAYMENT_OVERDUE`;
  - saldo ujemne daje `INSUFFICIENT_BALANCE` z `reason: 'NEGATIVE_BALANCE'`, także przy karcie;
  - przy `WALLET` saldo poniżej `min_wallet_balance` z wersji cennika daje `INSUFFICIENT_BALANCE` z saldem i minimum;
  - przy `CARD` bez ważnej karty daje `PAYMENT_METHOD_REQUIRED`.
- **Portfel** (w transakcji `ENDED`, po wycenie):
  - procedura `sp_wallet_post` z `SELECT … FOR UPDATE` na `wallets` dopisuje `RIDE_CHARGE` z kwotą ujemną, liczy `balance_after` i aktualizuje `wallets.balance`;
  - indeks `wallet_ledger_one_charge_per_rental` wyklucza drugie obciążenie;
  - w tej samej transakcji powstaje paragon ([ADR 0052](0052-paragony.md));
  - saldo może spaść poniżej zera.
- **Karta** (`ENDED`, potem zadanie):
  - transakcja `ENDED` zakłada `payments` (`purpose = RIDE`, `PENDING`, `idempotency_key` z identyfikatora płatności) i planuje zadanie pg-boss `payment.charge-ride` ([ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md));
  - zadanie obciąża zapisaną kartę bez udziału klienta ([ADR 0050](0050-integracja-stripe.md));
  - wynik przychodzi z webhooka. Sukces daje paragon i stan rozliczenia „opłacony”. Odmowa (także `authentication_required`) daje `DECLINE_PAYMENT` (`ENDED → UNPAID`) z powodem od operatora i zadanie ponowienia po 24 h;
  - ponowienie i spłata sprawdzają stan pod blokadą przejazdu, więc spłata przed ponowieniem kończy sprawę bez drugiego obciążenia;
  - jedna płatność `RIDE` w toku na przejazd pilnuje indeks częściowy (migracja 0007).
- **Spłata** (`POST /rentals/{id}/pay`):
  - z portfela tylko, gdy saldo pokrywa całą kwotę: `RIDE_CHARGE` i `SETTLE_DEBT` w jednej transakcji;
  - kartą: nowa płatność z udziałem klienta (może wymagać 3-D Secure), a `SETTLE_DEBT` po webhooku.
- **Stan rozliczenia** w `RentalView.settlement` i w panelu:
  - `NONE`: przejazd bez kwoty albo nierozliczony z iteracji 3 i 4;
  - `WALLET_PAID`, `CARD_PENDING`, `CARD_PAID`, `FAILED`.

  Wylicza go widok z księgi i płatności, a nie osobna kolumna.
- **Kwota 0:** bez wpisu w księdze, bez płatności i bez paragonu, stan `NONE`. Dziś nie występuje, bo przejazd kosztuje co najmniej odblokowanie i minutę (ADR 0042).
- **Przejazdy z iteracji 3 i 4** zostają `ENDED` ze stanem rozliczenia `NONE`, bez obciążenia wstecz. Nowe przykładowe przejazdy w danych startowych są rozliczone z portfela.

## Konsekwencje

Pozytywne:

- Pieniądze i stan przejazdu z portfela zmieniają się w jednej transakcji: nie ma przejazdu `ENDED` bez obciążenia ani obciążenia bez `ENDED`.
- Klient kończy jazdę od razu także przy karcie; zaległość jest jawnym stanem z makiet (`mapa-zaleglosc`) i filtrem w panelu.
- Ujemne saldo zamiast dopłaty kartą nie wymaga drugiej płatności w chwili zakończenia.

Negatywne i ryzyka:

- `ENDED` przestaje być stanem końcowym dla przejazdów kartą. Testy maszyny stanów i widoki z warunkiem `state = 'ENDED'` (historia, statystyki) muszą obejmować `UNPAID`.
- Ujemne saldo to ryzyko nieściągalnej kwoty. W projekcie akceptowane, bo kolejny przejazd wymaga doładowania.
- Obciążenie karty bez udziału klienta może wymagać uwierzytelnienia; wtedy jest odmowa i spłata z 3-D Secure w aplikacji.

## Powiązane

[ADR 0013](0013-rezerwacja-jako-stan-przejazdu.md) (zmienia przejście do `UNPAID`), [ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0042](0042-wycena-przejazdu.md), [ADR 0050](0050-integracja-stripe.md), [ADR 0052](0052-paragony.md), [ADR 0054](0054-zwroty-i-korekty-salda.md), arc42 §6.1 i §6.4, [plan iteracji 5](../iteracje/iteracja-05-platnosci.md) (pytania 2, 4–6, 12; D4)
