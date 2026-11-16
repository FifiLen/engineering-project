# Plan iteracji

Każda iteracja to pionowy przekrój przez system i kończy się działającym demem.

Plan z 16 listopada 2026 uwzględnia [wymagania uczelni](../wymagania-uczelni.md) i decyzje ADR 0025–0031. Doszły moduły: role i uprawnienia, treści, raporty, wydruki, serwis oraz wspólny wzorzec widoku tabeli w panelu. Moduły przekrojowe powstają w iteracji, w której są pierwszy raz potrzebne, a nie na końcu, żeby kolejne ekrany od razu z nich korzystały.

| Nr | Iteracja | Efekt do pokazania | Wymagania uczelni |
|---|---|---|---|
| 0 | Fundament i dostosowanie | Monorepo, Docker Compose, CI, migracje 0001–0002, `packages/core`, dane startowe dla Rybnika, ADR 0001–0031 | 3b, 3c, 8, 9 |
| 1 | Symulator, telemetria i wzorzec panelu | Wirtualne hulajnogi jeżdżą po Rybniku; mapa floty na żywo; lista floty i modeli na wspólnym widoku tabeli; pliki tłumaczeń w klientach | 12, 14, 17 (etykiety) |
| 2 | Konta i dostęp | Logowanie kodem SMS i rejestracja w aplikacji ze zgodą na wersję regulaminu; logowanie operatorów z TOTP; role, uprawnienia, operatorzy i klienci w panelu; dziennik audytu | 10, 11, 12, 13 |
| 3 | Wypożyczenie | Mapa i skanowanie w aplikacji, rezerwacja z wygaszaniem, odblokowanie i zakończenie z komendami MQTT; przejazdy z osią czasu w panelu | 13 |
| 4 | Strefy | Wolna jazda, zakaz, parkowanie; edytor stref w panelu | 12, 13 |
| 5 | Płatności | Wycena w `packages/core`, wersje cennika w panelu, portfel, Stripe, rozliczenie przejazdu, paragony, korekty salda | 12, 13 |
| 6 | Operacje i serwis | Zgłoszenia, zadania serwisowe i części, powrót hulajnogi do floty, utrata łączności, powiadomienia push z szablonów | 12, 13 |
| 7 | Treści i wydruki | Dokumenty z wersjami, bloki treści, FAQ, aktualności i biblioteka mediów w panelu; strona promocyjna z treści z bazy; szablony DOCX z wersjami, wydruki DOCX i PDF | 17, 19 |
| 8 | Raporty i domknięcie panelu | Sześć raportów z eksportem PDF i XLSX, historia uruchomień; pozostałe tabele z macierzy w [modelu danych](../model-danych/README.md) dostępne w panelu | 12, 14, 18 |
| 9 | Jakość i obrona | Testy obciążeniowe, przegląd bezpieczeństwa, zestawienie z zasadami ICK, spis widoków, dokumentacja końcowa, scenariusz demo | 14, 15, 16 |

Wymagania 1, 2, 4–7 dotyczą całego systemu i są opisane w [wymaganiach uczelni](../wymagania-uczelni.md); iteracja 9 zbiera do nich materiał do pracy.

## Moduły przekrojowe

| Moduł | Decyzja | Pierwsza iteracja | Dalej |
|---|---|---|---|
| Wzorzec widoku tabeli (kontrakt list, komponent tabeli i formularza) | [ADR 0031](../adr/0031-wzorzec-widoku-tabeli-w-panelu.md) | 1: flota i modele hulajnóg | każda iteracja dodaje zasoby swojego modułu; 8: pozostałe tabele |
| Etykiety w plikach tłumaczeń, reguła lintera | [ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md) | 1 | każdy nowy ekran |
| Role i uprawnienia | [ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md) | 2 | każdy punkt panelu ma `@RequirePermission` |
| Treści z bazy | [ADR 0027](../adr/0027-tresci-sterowane-z-panelu.md) | 2: regulamin i polityka z wersjami (zgody) | 6: szablony powiadomień; 7: pełny moduł treści |
| Silnik dokumentów (Gotenberg, zadania pg-boss) | [ADR 0029](../adr/0029-raporty-pdf-xlsx.md), [ADR 0030](../adr/0030-wydruki-z-szablonow-docx.md) | 7: wydruki | 8: raporty, eksport list do XLSX |

## Przed iteracją 1

Ostatni punkt [planu dostosowania](../wymagania-uczelni.md#plan-dostosowania-przed-iteracją-1): makiety nowych ekranów panelu według [design systemu](../projekt/design-system.md), co najmniej wzorzec widoku tabeli z formularzem, bo korzysta z niego już iteracja 1. Makiety ról i uprawnień są potrzebne przed iteracją 2, a treści, mediów, raportów i szablonów przed iteracjami 7 i 8.

## Definicja „zrobione”

- Kod scalony z gałęzią główną, CI przechodzi.
- Testy dla nowej logiki (jednostkowe w `packages/core`, a dla przepływów między modułami i obiektów bazy integracyjne).
- Reguły biznesowe w `packages/core`, dostęp do danych przez repozytoria w `packages/db` ([ADR 0025](../adr/0025-logika-biznesowa-packages-core.md)).
- Nowe ekrany zgodne z makietą; etykiety w plikach tłumaczeń, treści z bazy; nowe tabele dostępne w panelu według wzorca widoku tabeli z uprawnieniami.
- Zaktualizowane diagramy, kontrakty (OpenAPI, AsyncAPI), model danych i tabela zgodności w [wymaganiach uczelni](../wymagania-uczelni.md), jeśli iteracja je zmienia.
- ADR dla każdej nowej decyzji architektonicznej.
- Wpis w [dzienniku](../dziennik.md).
- Scenariusz demo, który da się powtórzyć krok po kroku.
