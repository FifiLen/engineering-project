# ADR 0073: Eksport list do XLSX i CSV

- **Status:** zaakceptowana
- **Data:** 2026-11-19

## Kontekst

[ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md) przewiduje eksport bieżącego widoku listy do XLSX i CSV, a od iteracji 1 dziennik zapisuje go jako odstępstwo od makiet. Kontrakt list (`ListQueryPipe`, `ListSource` w `packages/db/src/admin/list-query.ts`) zamienia parametry adresu na zapytanie do widoku listy z białą listą pól, filtrów i sortowań z definicji zasobu w `packages/shared/src/admin`. Kontrolery mapują wiersze na odpowiedź i maskują dane klienta bez `users.read`.

Odpowiedzi autora z 19 listopada 2026: pytanie 10 (każda lista, XLSX i CSV, bieżące filtry i sortowanie, do 50 000 wierszy, maskowanie jak w liście, wpis `list.exported`, uprawnienie odczytu zasobu) i D6 (synchronicznie strumieniem, ochrona przed formułami).

Plansza `34-panel-domkniecie/lista-eksport` dołożyła: liczbę wierszy z bieżącego `total` listy, ostrzeżenie o danych osobowych tylko przy kolumnach z danymi osobowymi, kolumnę klienta „Klient” bez `users.read`, CSV ze średnikiem i przecinkiem dziesiętnym, limit sprawdzany w panelu i w API.

Etykiety kolumn i wartości wyliczeń są w `apps/web/messages/pl.json` ([ADR 0032](0032-etykiety-w-plikach-tlumaczen.md)), a nie w API.

Sprawdzone 19 listopada 2026: ExcelJS 4.4.0 zapisuje strumieniowo 50 000 wierszy w 0,46 s, plik ma 1,06 MB ([ADR 0071](0071-modul-raportow.md)). Panel pobiera pliki z nagłówkiem autoryzacji przez `fetch` i `saveBlob` (`components/admin/prints/prints-common.tsx`).

## Rozważane opcje

1. **Zadanie w tle z plikiem w magazynie** (jak raporty). Historia i ponowne pobranie, ale kolejna tabela albo cel pliku, opóźnienie i plik z danymi osobowymi leżący w magazynie.
2. **Synchronicznie strumieniem w odpowiedzi** (D6). Plik powstaje w czasie pobierania i nigdzie nie zostaje; limit wierszy ogranicza czas.

Etykiety:

1. **Kopia etykiet w API** (jak teksty wyliczeń wydruków). Druga kopia `pl.json` dla 32 zasobów.
2. **Etykiety z panelu w żądaniu.** Panel i tak zna nagłówki i teksty wartości; API sprawdza tylko, czy pola są w definicji zasobu.

## Decyzja

Opcja 2 w obu sprawach.

- **Punkt:** `POST /admin/{zasób}/export` dla każdego zasobu z `ListSource`, w treści: `query` (te same parametry co adres listy), `format` (`xlsx` albo `csv`) i `columns` (pole z definicji zasobu, etykieta do 80 znaków, teksty wartości dla pól typu `enum`). `POST`, bo żądanie zapisuje wpis w dzienniku audytu i niesie etykiety w treści.
- **Dostęp i dane:** uprawnienie odczytu zasobu, ten sam `ListSource`, warunek stały, filtry i mapowanie wierszy co lista, więc maskowanie działa tak samo (bez `users.read` wartość „Klient”). Kolumny spoza definicji dają `400 VALIDATION_FAILED`.
- **Limit:** najpierw liczba wierszy; powyżej 50 000 `422 LIST_EXPORT_LIMIT` z `details: { count, limit }`. Panel wyłącza przycisk przy `total` powyżej limitu, a API sprawdza ponownie.
- **Odczyt:** jedna transakcja `REPEATABLE READ READ ONLY`, partie po 1000 wierszy w stałej kolejności (sortowanie listy i identyfikator), zapis do odpowiedzi w trakcie odczytu.
- **XLSX:** ExcelJS `WorkbookWriter`, jeden arkusz z nazwą zasobu, zamrożony nagłówek, autofiltr, typy z definicji pola: liczby jako liczby, kwoty jako liczby w złotych z formatem, daty jako daty Excela w czasie polskim, tekst jako tekst (komórka tekstowa nie jest formułą).
- **CSV:** UTF-8 z BOM, średnik, przecinek dziesiętny, CRLF, cudzysłowy według RFC 4180, daty `dd.mm.rrrr gg:mm` w czasie polskim. Tekst zaczynający się od `=`, `+`, `-`, `@`, tabulatora albo powrotu karetki dostaje apostrof z przodu (wstrzyknięcie formuł przy otwarciu w arkuszu); liczby ujemne są liczbami, więc tej zmiany nie dostają.
- **Odpowiedź:** `content-disposition: attachment; filename="{zasób}-{rrrr-mm-dd-ggmm}.{xlsx|csv}"`, `cache-control: private, no-store`; CORS wystawia `content-disposition`. Panel zapisuje plik przez `saveBlob`.
- **Dane osobowe:** pole `personal: true` w `FieldDefinition`; panel pokazuje ostrzeżenie, gdy eksport zawiera takie kolumny, a API zapisuje wpis `list.exported` (zasób, filtry, sortowanie, kolumny, format, liczba wierszy) dla każdego eksportu.
- **Wyjątki:** telemetria eksportuje zakres najwyżej 24 h z parametrami listy kursorowej ([ADR 0076](0076-domkniecie-macierzy-operacji.md)); tabele w szczegółach rekordu (pozycje paragonu, części zadania) nie mają eksportu.

## Konsekwencje

Pozytywne:

- Eksport każdej listy jednym mechanizmem, bez nowej tabeli i bez plików z danymi osobowymi w magazynie.
- Plik ma dokładnie te wiersze, kolejność i maskowanie co lista, a dziennik audytu pokazuje, kto wyniósł jakie dane.

Negatywne i ryzyka:

- Brak historii eksportów list i ponownego pobrania; to świadome (dane się zmieniają, a plik z danymi osobowymi nie powinien zostawać).
- Etykiety z żądania mogą być dowolnym tekstem operatora z uprawnieniem odczytu; trafiają tylko do jego własnego pliku jako tekst z ochroną przed formułami.
- Długi eksport trzyma połączenie i transakcję tylko do odczytu kilka sekund; limit 50 000 wierszy to ogranicza.

## Powiązane

[ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [ADR 0032](0032-etykiety-w-plikach-tlumaczen.md), [ADR 0071](0071-modul-raportow.md), [ADR 0076](0076-domkniecie-macierzy-operacji.md), makieta `34-panel-domkniecie/lista-eksport`
