# ADR 0060: Opłata za odholowanie

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

Cennik ma od iteracji 0 pole `out_of_zone_fee` (dane startowe: 20 zł). [ADR 0042](0042-wycena-przejazdu.md) wyłączył je z wyceny: klient nie zakończy przejazdu poza strefą, a przy zdalnym zakończeniu autor nie chciał opłaty. W iteracji 5 autor przesunął decyzję do iteracji 6, a opłatę opisał w cenniku jako odholowanie ([ADR 0053](0053-wersje-cennika-w-panelu.md)).

Hulajnoga zostaje poza strefą parkowania tylko po zdalnym zakończeniu, bo zakończenie bez łączności wymaga pozycji w strefie ([ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md)). Wyjątkiem jest zakończenie bez potwierdzenia blokady, jeśli hulajnoga potem odjechała.

Odpowiedź autora (pytanie 7, 18 listopada 2026):
- przy zdalnym zakończeniu poza strefą operator zaznacza „Pobierz opłatę za odholowanie”;
- opłata obciąża portfel osobnym wpisem i może dać ujemne saldo;
- opłata jest osobną pozycją na paragonie przejazdu;
- system zakłada zadanie `RELOCATION`.

Rozliczenie przejazdu ([ADR 0049](0049-rozliczenie-przejazdu.md)) obciąża portfel wpisem `RIDE_CHARGE` w transakcji `ENDED` albo kartę zadaniem po `ENDED`. Paragon `SALE` powstaje jeden na przejazd ([ADR 0052](0052-paragony.md)).

## Rozważane opcje

1. **Osobna płatność po zakończeniu.** Opłata niezależna od przejazdu, ale przy karcie to druga płatność bez udziału klienta, a przy odmowie druga zaległość. Paragon przejazdu nie miałby tej pozycji.
2. **Opłata jako część rozliczenia przejazdu.**
   - Kwota jest zapisana w przejeździe.
   - Portfel dostaje drugi wpis w tej samej transakcji `ENDED`.
   - Karta jest obciążana jedną płatnością na sumę.
   - Paragon ma dwie pozycje.

   Zgodne z odpowiedzią autora i z jednym paragonem na przejazd.

## Decyzja

**Opcja 2.**

- **Kiedy:** tylko przy zdalnym zakończeniu (`END_REMOTELY`), gdy ostatnia znana pozycja hulajnogi jest poza strefą parkowania.
  - Okno zakończenia (`przejazd-zakoncz-odholowanie`) pokazuje pole „Pobierz opłatę za odholowanie”, domyślnie zaznaczone.
  - Kwota pochodzi z wersji cennika przejazdu, nie z obowiązującej.
  - Wymagane uprawnienie: `rentals.manage`, jak zdalne zakończenie.
  - Dziennik audytu zapisuje opłatę albo jej pominięcie.
- **Zapis:**
  - kolumna `rentals.towing_fee`: grosze, `NULL` bez opłaty;
  - `total_amount` to wycena przejazdu plus opłata;
  - `priceRental` w core dostaje opcjonalną pozycję `towingFee`, więc widok przejazdu, podsumowanie i panel pokazują ją osobno.
- **Portfel:** nowy typ wpisu `TOWING_FEE` w `ledger_entry_type`, dopisywany przez `sp_wallet_post` w tej samej transakcji co `RIDE_CHARGE`. Indeks dopuszcza jeden taki wpis na przejazd, a saldo może spaść poniżej zera.
- **Karta:**
  - jedna płatność `RIDE` na całą kwotę z opłatą;
  - odmowa daje `UNPAID` na całą kwotę, a spłata jest jak dotąd.
- **Rozliczenie, zwroty i paragon:**
  - `fn_rental_paid_amount` i stan rozliczenia uwzględniają `TOWING_FEE`;
  - limit zwrotu ([ADR 0054](0054-zwroty-i-korekty-salda.md)) obejmuje całą kwotę, więc operator może zwrócić samą opłatę zwrotem częściowym;
  - paragon `SALE` ma pozycję „Opłata za odholowanie” ze stawką VAT przejazdu.
- **Zadanie:** zgłoszenie `OUT_OF_ZONE` i zadanie `RELOCATION` do najbliższej strefy parkowania powstają zawsze przy zakończeniu poza strefą, także bez opłaty ([ADR 0055](0055-zgloszenia-i-proces-serwisowy.md)).
- **Klient:** podsumowanie przejazdu i powiadomienie `ride_ended` pokazują opłatę osobno.

## Konsekwencje

Pozytywne:

- Jeden przejazd ma jedno rozliczenie, jeden paragon i jedną ewentualną zaległość, także z opłatą.
- Operator decyduje o opłacie przy każdym przypadku, np. pomija ją przy awarii hulajnogi.
- Zmiana nie dotyka maszyny stanów przejazdu.

Negatywne i ryzyka:

- Opłata za odholowanie może być w prawie podatkowym karą umowną, a nie usługą z VAT. Stawka VAT pozycji to wartość robocza do sprawdzenia przez autora, jak stawka przejazdu (otwarte decyzje w `CLAUDE.md`).
- Przy karcie opłata podnosi kwotę obciążenia bez udziału klienta, a to zwiększa ryzyko odmowy i zaległości.
- Opłata zależy od ostatniej znanej pozycji, która przy hulajnodze offline może być nieaktualna. Okno pokazuje wiek pozycji, a decyzja należy do operatora.

## Powiązane

[ADR 0042](0042-wycena-przejazdu.md) (zmienia: opłata poza strefą przy zdalnym zakończeniu), [ADR 0049](0049-rozliczenie-przejazdu.md), [ADR 0052](0052-paragony.md), [ADR 0053](0053-wersje-cennika-w-panelu.md), [ADR 0054](0054-zwroty-i-korekty-salda.md), [ADR 0055](0055-zgloszenia-i-proces-serwisowy.md), [ADR 0056](0056-przejazd-bez-lacznosci-i-niska-bateria.md), [plan iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) (pytanie 7), makieta `przejazd-zakoncz-odholowanie`
