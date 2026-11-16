# ADR 0029: Raporty z parametrami i eksportem do PDF i XLSX

- **Status:** proponowana
- **Data:** 2026-11-16

## Kontekst

Punkt 18 wymagań uczelni wymaga rozbudowanych raportów z eksportem do PDF i Excela. Obecnie panel ma tylko pulpit z bieżącymi liczbami. Operator wypożyczalni potrzebuje typowych zestawień z branży: przychodów, wykorzystania floty, ruchu w strefach, awaryjności i aktywności użytkowników.

Generowanie dokumentu może trwać kilka sekund (duży okres, wykresy), a [ADR 0016](0016-zadania-w-tle-pg-boss.md) przewiduje do takich prac zadania pg-boss. Pliki przechowujemy w magazynie S3 ([ADR 0024](0024-magazyn-plikow-seaweedfs.md)). Ten sam silnik PDF przyda się wydrukom z szablonów ([ADR 0030](0030-wydruki-z-szablonow-docx.md)).

## Rozważane opcje

PDF:

1. **Biblioteka rysująca PDF w Node (np. pdfmake, PDFKit)**. Bez dodatkowego kontenera, ale układ trzeba programować współrzędnymi, a do konwersji DOCX i tak potrzebny byłby LibreOffice.
2. **Gotenberg** (kontener z Chromium i LibreOffice za API HTTP). Raport jako HTML i CSS w stylu design systemu, ten sam kontener zamienia DOCX na PDF.
3. **Puppeteer w procesie API**. HTML jak w opcji 2, ale przeglądarka w procesie backendu zwiększa zużycie pamięci, a DOCX dalej nie jest rozwiązany.

XLSX:

1. **ExcelJS**. Typy kolumn, formaty liczb i dat, style, wiele arkuszy, licencja MIT. Ostatnie wydanie 4.4.0 z października 2023 r.
2. **SheetJS Community Edition**. Rozwijany, ale aktualne wersje są dystrybuowane poza rejestrem npm, a stylowanie komórek wymaga wersji płatnej.
3. **CSV**. Proste, ale to nie jest plik Excela (brak typów, formatów i arkuszy).

## Decyzja

**Gotenberg** dla PDF i **ExcelJS** dla XLSX, oba za adapterem `DocumentRenderer` zdefiniowanym w `packages/core`, więc zamiana biblioteki nie dotyka logiki raportów.

- Gotenberg działa jako kontener w Docker Compose, dostępny tylko w sieci wewnętrznej; obraz przypięty do konkretnej wersji 9.x starszej niż 3 dni, wybranej przy wprowadzeniu modułu.
- **Definicje raportów** w tabeli `report_definitions`: kod, klucz nazwy i opisu w katalogu tekstów ([ADR 0027](0027-tresci-sterowane-z-panelu.md)), schemat parametrów, wymagane uprawnienie `reports.<kod>` ([ADR 0028](0028-uzytkownicy-role-uprawnienia.md)), aktywność. Logika raportu (zapytanie i układ kolumn) jest w kodzie, bo raport to proces z testami, a nie zapytanie wpisywane w panelu.
- **Dane** z widoków i funkcji bazy ([ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md)), np. `v_daily_revenue`, `v_zone_usage`.
- **Uruchomienie**: panel pokazuje podgląd tabeli i wykresu w przeglądarce, a eksport zleca zadanie pg-boss. Tabela `report_runs` zapisuje parametry, status, operatora, czas i odwołania do plików w `files`. Gotowy plik jest dostępny przez podpisany URL, a historia uruchomień jest jednym z ekranów panelu.
- **Raporty na start**: przychody (okres, granulacja, źródło płatności), wykorzystanie floty (czas w użyciu, przestoje, bateria), przejazdy według stref i godzin, awaryjność (zgłoszenia według kategorii i hulajnogi, czas naprawy), użytkownicy (nowi, aktywni, powracający), salda i operacje portfela. Parametry wspólne: okres, strefa, hulajnoga lub model.
- PDF ma nagłówek z parametrami i datą wygenerowania, tabele i wykresy SVG w stylu design systemu. XLSX ma arkusz z danymi o właściwych typach (kwoty jako liczby z formatem złotówek, daty jako daty w strefie Europe/Warsaw) i arkusz z parametrami.

## Konsekwencje

Pozytywne:

- Punkt 18 spełniony; raporty korzystają z widoków bazy, więc punkt 8 ma realne zastosowanie.
- Jeden silnik PDF dla raportów i wydruków.
- Dwie nowe tabele i kilka ekranów panelu (punkty 8 i 14).

Negatywne i ryzyka:

- Kolejny kontener (Gotenberg, kilkaset MB) w środowisku i na VPS.
- ExcelJS nie ma nowych wydań od 2023 r. Biblioteka jest dojrzała, a adapter pozwala ją wymienić; jeśli przy wprowadzeniu modułu okaże się niezgodna z Node lub ESM, wybieramy inną i zapisujemy to w nowym ADR.
- Raporty za długie okresy mogą obciążać bazę; parametry mają limit zakresu, a ciężkie widoki mogą stać się zmaterializowane.

## Powiązane

[ADR 0016](0016-zadania-w-tle-pg-boss.md), [ADR 0024](0024-magazyn-plikow-seaweedfs.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [ADR 0027](0027-tresci-sterowane-z-panelu.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0030](0030-wydruki-z-szablonow-docx.md), [wymagania uczelni](../wymagania-uczelni.md) (punkt 18)
