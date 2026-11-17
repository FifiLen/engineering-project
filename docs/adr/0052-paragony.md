# ADR 0052: Paragony

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Klient dostaje dokument za każdy rozliczony przejazd (makiety `24-mobile-platnosci/paragon`, `25-panel-platnosci/paragony-lista`). Autor przyjął (pytanie 8 w [planie iteracji 5](../iteracje/iteracja-05-platnosci.md)):
- paragon niefiskalny (potwierdzenie sprzedaży) za przejazd;
- doładowanie portfela jako przedpłata z potwierdzeniem bez VAT;
- VAT 23% jako wartość robocza do sprawdzenia;
- w dokumentacji opis drogi do kasy fiskalnej online;
- dokument jako ekran, PDF w iteracji 7, bez e-maila (D7).

Schemat z migracji 0002 ma `receipts` (numer `PAR/RRRR/NNNNNN` z sekwencji, nabywca z chwili wystawienia, suma) i `receipt_items` (opis, ilość, cena jednostkowa, stawka VAT, kwota). Przy makietach wyszły braki:
- rodzaj dokumentu i korekta po zwrocie;
- sposób zapłaty dla przejazdu z portfela, który nie ma płatności u operatora;
- dane sprzedawcy;
- miejsce stawki VAT poza pozycjami paragonu.

## Rozważane opcje

Dla charakteru dokumentu:

1. **Paragon fiskalny przez kasę online.** Zgodne z obrotem prawdziwymi pieniędzmi, ale wymaga urządzenia albo usługi kasy online i rejestracji. Nieproporcjonalne do projektu, który nie obsługuje prawdziwych pieniędzy.
2. **Potwierdzenie sprzedaży (dokument niefiskalny)** w bazie z pozycjami i VAT, z opisem w dokumentacji, co zmienia się w produkcji.

Dla korekty po zwrocie:

1. **Zmiana pierwotnego paragonu.** Prostsze, ale paragony są tylko do dopisywania.
2. **Dokument korygujący** z ujemnymi pozycjami i odwołaniem do pierwotnego.

## Decyzja

Opcja 2 dla charakteru dokumentu i opcja 2 dla korekty. Szczegóły:

- **Kiedy powstaje:** w transakcji, która oznacza przejazd jako opłacony:
  - `ENDED` z portfela;
  - webhook udanej płatności kartą;
  - spłata zaległości ([ADR 0049](0049-rozliczenie-przejazdu.md)).

  Przejazd o kwocie 0 i przejazdy nierozliczone z iteracji 3 i 4 nie mają paragonu. Doładowanie nie dostaje paragonu, tylko potwierdzenie przedpłaty z płatności (bez VAT); VAT jest na paragonie przejazdu, który zużywa saldo.
- **Pozycje** z wyceny (`priceRental`, ADR 0042):
  - odblokowanie (1 × opłata);
  - minuty jazdy (N × stawka);
  - minuty pauzy (M × stawka), tylko gdy były.

  Kwoty w pozycjach są brutto w groszach. VAT liczony od sumy brutto metodą „w stu”: `VAT = round(brutto × stawka / (100 + stawka))`, zaokrąglenie do grosza, połowa w górę (jedna stawka na dokumencie). Netto to brutto minus VAT. Reguła i testy są w core.
- **Stawka VAT** jest kolumną wersji cennika (`tariffs.vat_rate`, migracja 0007; w danych startowych 23,00 jako wartość robocza). Przejazd pamięta wersję cennika, więc paragon użyje stawki z chwili startu ([ADR 0015](0015-wersjonowany-cennik.md)); pozycje kopiują stawkę jak dotąd.
- **Nowe kolumny `receipts`** (migracja 0007):
  - `kind` (`SALE`, `CORRECTION`);
  - `corrects_receipt_id`;
  - `payment_source` (`WALLET`, `CARD`);
  - `seller` (dane sprzedawcy z chwili wystawienia, jsonb).

  Dane sprzedawcy pochodzą z konfiguracji API (`SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_TAX_ID`, w trybie deweloperskim „[dane sprzedawcy]”). Moduł treści w iteracji 7 może je przejąć. Nabywca to imię i telefon klienta z chwili wystawienia.
- **Korekta po zwrocie** ([ADR 0054](0054-zwroty-i-korekty-salda.md)): dokument `CORRECTION` z jedną pozycją „Zwrot za przejazd” z kwotą ujemną i tą samą stawką VAT, z odwołaniem do pierwotnego paragonu. Suma paragonu i korekt nie może być ujemna (procedura z blokadą).
- **Numeracja:** wspólna sekwencja `PAR/RRRR/NNNNNN` dla sprzedaży i korekt, ciągła między latami (rok w numerze to rok wystawienia). Numer nadaje baza.
- **Paragon fiskalny w produkcji:** opis w dokumentacji (arc42 §8.4). Prawdziwy system musiałby ewidencjonować sprzedaż usług osobom fizycznym zgodnie z przepisami, np. kasą online, a dokument w aplikacji byłby wtedy kopią albo potwierdzeniem. Wymóg i stawkę VAT sprawdza autor; projekt tego nie rozstrzyga.

## Konsekwencje

Pozytywne:

- Każdy rozliczony przejazd ma odtwarzalny dokument z pozycjami z tej samej wyceny co kwota.
- Zwroty nie zmieniają wystawionych dokumentów, a ślad korekty jest jawny dla klienta i operatora.
- Stawka VAT jest wersjonowana razem z cenami.

Negatywne i ryzyka:

- Dokument nie jest paragonem fiskalnym; w interfejsie nazywa się „Potwierdzenie sprzedaży” z dopiskiem o niefiskalnym charakterze, a słowo „paragon” zostaje w menu jako nazwa potoczna.
- Stawka VAT 23% jest robocza do czasu sprawdzenia przez autora.

## Powiązane

[ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md), [ADR 0015](0015-wersjonowany-cennik.md), [ADR 0042](0042-wycena-przejazdu.md), [ADR 0049](0049-rozliczenie-przejazdu.md), [ADR 0054](0054-zwroty-i-korekty-salda.md), [ADR 0030](0030-wydruki-z-szablonow-docx.md) (PDF w iteracji 7), [plan iteracji 5](../iteracje/iteracja-05-platnosci.md) (pytanie 8, D7)
