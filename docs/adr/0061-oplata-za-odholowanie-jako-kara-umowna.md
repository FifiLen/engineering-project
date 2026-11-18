# ADR 0061: Opłata za odholowanie jako kara umowna

- **Status:** zaakceptowana
- **Data:** 2026-11-18

## Kontekst

[ADR 0060](0060-oplata-za-odholowanie.md) dodał opłatę za odholowanie jako pozycję paragonu przejazdu ze stawką VAT przejazdu i zostawił otwarte pytanie, czy to nie kara umowna poza VAT. Autor rozstrzygnął (18 listopada 2026): opłata może być karą umowną.

Kara umowna (art. 483 Kodeksu cywilnego) to odszkodowanie za niewykonanie zobowiązania, a nie wynagrodzenie za usługę, więc nie podlega VAT.

Dziś paragon zakłada jedną stawkę:
- widok `v_receipt_list` (migracja 0007) liczy VAT od sumy wszystkich pozycji stawką `max(vat_rate)`;
- `receiptTotals` w core bierze stawkę pierwszej pozycji;
- korekta przy zwrocie (`correctionItems`) ma jedną pozycję `REFUND` ze stawką przejazdu.

Pozycja bez VAT na takim paragonie zawyżyłaby VAT całego dokumentu.

## Rozważane opcje

Oznaczenie pozycji poza VAT:

1. **Stawka 0%.** Bez zmiany schematu, ale 0% to prawdziwa stawka VAT, inna niż „nie podlega”, a dokument wprowadzałby w błąd.
2. **`vat_rate` puste (`NULL`) jako „nie podlega”.** Wymaga zmiany kolumny i odczytu w kilku miejscach, ale znaczenie jest jednoznaczne.

Zwrot z paragonu z dwiema grupami stawek:

1. **Zwrot najpierw z części z VAT.** Proste, ale arbitralne.
2. **Zwrot najpierw z opłaty.** Też arbitralne, a zwrot za przejazd bez odholowania korygowałby niewłaściwą pozycję.
3. **Podział proporcjonalny** do kwot pozostałych do zwrotu w każdej grupie stawek. Deterministyczny i niezależny od powodu zwrotu, bo okno zwrotu nie pyta, czego zwrot dotyczy.

## Decyzja

Opcja 2 dla oznaczenia i opcja 3 dla zwrotu.

- **Opłata za odholowanie** (`TOWING_FEE`) jest karą umowną poza VAT. Na paragonie przejazdu zostaje osobną pozycją z `vat_rate = NULL` („nie podlega”, w dokumencie skrót „np.”). Księga portfela, płatność kartą na całą kwotę i limit zwrotu zostają jak w ADR 0060.
- **VAT dokumentu** to suma VAT liczonego osobno dla każdej stawki (metoda „w stu” z [ADR 0052](0052-paragony.md) na sumie brutto grupy). Pozycje `NULL` nie mają VAT. Migracja 0010:
  - dopuszcza `NULL` w `receipt_items.vat_rate`;
  - zastępuje widok `v_receipt_list`: `vat_amount` liczony grupami, a `vat_rate` to stawka pozycji z VAT, gdy jest jedna.
- **Korekta przy zwrocie** dzieli kwotę zwrotu między grupy stawek proporcjonalnie do kwot pozostałych do zwrotu w każdej grupie, po wcześniejszych korektach. Zaokrąglenie do grosza; reszta trafia do ostatniej grupy. Każda grupa to osobna pozycja `REFUND` ze swoją stawką.
- **Paragony sprzed zmiany** (z odholowaniem ze stawką przejazdu) zostają bez zmian, bo dokumentów się nie poprawia.

## Konsekwencje

Pozytywne:

- Paragon nie nalicza VAT od kary umownej, a VAT przejazdu jest liczony tylko od usługi.
- Paragon obsługuje wiele stawek, co przyda się też przy innych pozycjach poza VAT.

Negatywne i ryzyka:

- Kwalifikacja podatkowa kary umownej zależy od umowy (regulaminu). Regulamin musi nazywać opłatę karą umowną za pozostawienie hulajnogi poza strefą, a ostateczną ocenę zostawiamy księgowości, tak jak stawkę VAT przejazdu.
- Podział proporcjonalny może dać korektę opłaty przy zwrocie dotyczącym tylko przejazdu. Dokładniejszy wybór, czego dotyczy zwrot, wymagałby zmiany okna zwrotu.
- Widoki, panel i aplikacja muszą obsłużyć stawkę `NULL` (napis „nie podlega” albo „np.” zamiast procentu).

## Powiązane

[ADR 0060](0060-oplata-za-odholowanie.md) (zmienia: stawka VAT opłaty), [ADR 0052](0052-paragony.md) (zmienia: VAT dokumentu liczony grupami stawek, korekta proporcjonalna), [ADR 0054](0054-zwroty-i-korekty-salda.md), [plan iteracji 6](../iteracje/iteracja-06-operacje-serwis.md) (pytanie 7)
