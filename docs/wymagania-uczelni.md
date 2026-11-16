# Wymagania uczelni i analiza zgodności

Źródło: opis projektu „Projekt inżynierski” (specjalność: Programista aplikacji biznesowych). Wymagania są nadrzędne wobec wcześniejszych decyzji: jeśli ADR stoi z nimi w sprzeczności, potrzebny jest nowy ADR.

**Stan analizy:** 2026-11-16, po zakończeniu iteracji 1. Odpowiedzi na pytania do prowadzącego są w sekcji „Pytania do prowadzącego”.

## Wymagania (skrót)

ZSI (Zintegrowany System Informatyczny) dla wybranej branży, który:

1. realizuje konkretne cele biznesowe (użyteczność biznesowa),
2. ma funkcje wzorowane na typowych rozwiązaniach z branży,
3. zawiera: (a) dwie z trzech aplikacji: desktopowa, internetowa, mobilna; (b) projekt operacji na bazie danych; (c) projekt z klasami logiki biznesowej,
4. aplikacje z 3a używają tego samego projektu bazodanowego (3b) i tych samych klas logiki (3c),
5. jest wykonany nowoczesnymi technikami (np. C#, ASP.NET Core, Java),
6. jest zgodny z wzorcami projektowymi (np. MVVM, MVC),
7. ma bazę danych na serwerze bazy danych (np. MS SQL Server, Oracle),
8. ma bazę z **co najmniej 30 tabelami** oraz **widokami, procedurami, funkcjami i indeksami**,
9. korzysta z nowoczesnego ORM (np. Entity Framework),
10. ma mechanizmy autoryzacji (np. wspólne logowanie),
11. ma **moduł zarządzania użytkownikami i grupami uprawnień** dostępny z interfejsu,
12. umożliwia **dodawanie, edycję, usuwanie, wyświetlanie, filtrowanie i sortowanie dla wszystkich tabel**,
13. realizuje kilka rozbudowanych procesów biznesowych domkniętych w 100%,
14. ma **co najmniej 50 rozbudowanych widoków biznesowych**,
15. ma dopracowane i spójne graficznie widoki,
16. spełnia zasady konstrukcji interfejsów z kursu Interakcja Człowiek–Komputer,
17. **wszystkie widoczne teksty, opisy, zdjęcia itd. są sterowane z części administracyjnej** (nic na sztywno w kodzie),
18. generuje **rozbudowane raporty z eksportem do PDF i Excela**,
19. generuje **parametryzowane wydruki z szablonów (np. Word)**, a użytkownik może zmienić szablon.

Warunek zaliczenia: wykonanie, prezentacja i obrona z pytaniami z kodu.

## Zgodność

| Nr | Stan | Jak jest teraz | Co trzeba zrobić |
|---|---|---|---|
| 1 | spełnione | Wypożyczalnia hulajnóg z operatorem floty | Opisać cele biznesowe i mierniki w arc42 §1 |
| 2 | spełnione | Wzorce z usług typu Lime, Bolt, Tier | Krótki przegląd rozwiązań rynkowych w pracy |
| 3a | spełnione | Aplikacja mobilna (Expo) i internetowa (Next.js) | — |
| 3b | spełnione | `packages/db`: migracje, schemat Drizzle, repozytoria; API nie importuje `pg` (pilnuje lint) | Nowe moduły dostają repozytoria w `packages/db` |
| 3c | spełnione | `packages/core`: maszyna stanów przejazdu, reguły stref, katalog i polityka uprawnień, porty repozytoriów; testy jednostkowe bez bazy ([ADR 0025](adr/0025-logika-biznesowa-packages-core.md)) | Rozwijać razem z modułami (wycena w iteracji płatności) |
| 4 | spełnione | Obie aplikacje korzystają z bazy i logiki przez wspólne API | Dostęp przez wspólny backend potwierdzony (pytanie 2); opisać w pracy |
| 5 | spełnione | TypeScript, Node.js, React, React Native | Stos potwierdzony (pytanie 1) |
| 6 | spełnione, do opisania | MVC w API (kontrolery, serwisy), moduły i wstrzykiwanie zależności, Repozytorium, Stan (przejazd), Adapter (SMS, płatności, mapy), Obserwator (zdarzenia), w klientach komponenty i hooki | Rozdział o wzorcach z odniesieniami do kodu |
| 7 | spełnione | PostgreSQL 16 w kontenerze | PostgreSQL potwierdzony (pytanie 1) |
| 8 | spełnione | Po migracji 0003: 46 tabel, 15 widoków, 8 funkcji, 6 procedur, indeksy (GiST, częściowe, unikalne); liczby sprawdza test bazy ([model danych](model-danych/README.md), [ADR 0026](adr/0026-logika-w-bazie-widoki-funkcje-procedury.md)) | Korzystać z widoków, funkcji i procedur w repozytoriach `packages/db` |
| 9 | spełnione | Dostęp do danych w aplikacji przez Drizzle (widoki jako `pgView`, funkcje PostGIS przez `sql`); surowy `pg` tylko w migratorze, seedzie i testach | Dostęp do danych wyłącznie przez Drizzle (PostGIS przez `sql` z Drizzle); Drizzle potwierdzony (pytanie 3) |
| 10 | zaplanowane | ADR 0019: kod SMS dla użytkowników, hasło + TOTP dla operatorów | Jeden moduł uwierzytelniania i jeden format tokenów dla obu aplikacji; rozważyć strefę klienta w webie na tym samym koncie |
| 11 | **brak** | Role operatorów jako stały typ `staff_role` (3 wartości) | Uprawnienia w bazie: role, uprawnienia, przypisania; ekrany w panelu (lista ról, edycja uprawnień, przypisywanie użytkowników) |
| 12 | w toku | Wspólny mechanizm list (`packages/db`), kontrakt list (`packages/shared`), komponenty listy, panelu filtrów i formularza w panelu; pełny CRUD z filtrowaniem i sortowaniem dla `scooters` i `scooter_models` (iteracja 1) | Wspólny wzorzec widoku tabeli (lista z filtrowaniem, sortowaniem, stronicowaniem + formularz) dla każdej tabeli. Tabele tylko do dopisywania mają ograniczone operacje (pytanie 4, [ADR 0031](adr/0031-wzorzec-widoku-tabeli-w-panelu.md)) |
| 13 | zaplanowane | Procesy: wypożyczenie, płatności, zgłoszenia | Domknąć każdy proces od początku do końca; doprojektować proces serwisowy (zgłoszenie → zadanie → naprawa lub wymiana baterii → powrót do floty) |
| 14 | do policzenia | 57 makiet ekranów (aplikacja, panel, strona), część to stany ekranów; w iteracji 1 zaimplementowane: mapa floty z kartą hulajnogi, lista floty, lista modeli, panel filtrów, formularze tworzenia i edycji z konfliktem wersji, stany list (ładowanie, pusta, brak wyników, błąd) | Liczą się wszystkie widoki, także stany i tryb ciemny (pytanie 7). Spis widoków w `docs/projekt/README.md`; nowe ekrany panelu z punktów 11, 12, 17–19 zapewnią zapas |
| 15 | spełnione | Design system, spójne makiety | Pilnować w implementacji |
| 16 | do uzupełnienia | Kontrasty WCAG, cele dotykowe ≥ 44 px, spójne nazewnictwo akcji | Zestawić z materiałami z wykładu ICK (potrzebne od autora) i opisać w pracy |
| 17 | w toku | Etykiety panelu i aplikacji w plikach tłumaczeń, reguła lintera zakazuje tekstów w JSX ([ADR 0032](adr/0032-etykiety-w-plikach-tlumaczen.md)); treści merytoryczne z bazy od iteracji 2 (regulamin) i 7 (moduł treści) | Zakres: treści merytoryczne (pytanie 5). Moduł treści: regulamin, FAQ, aktualności, opisy i grafiki w bazie i magazynie plików z edycją w panelu; klienci pobierają je z API z pamięcią podręczną. Etykiety interfejsu w plikach tłumaczeń, bez tekstów wpisanych wprost w komponenty ([ADR 0027](adr/0027-tresci-sterowane-z-panelu.md)) |
| 18 | **brak** | Pulpit z liczbami, brak raportów | Moduł raportów: przychody, wykorzystanie floty, przejazdy wg stref i godzin, awaryjność, użytkownicy; parametry (okres, strefa), eksport PDF i XLSX |
| 19 | **brak** | — | Szablony DOCX z polami (np. potwierdzenie przejazdu, protokół serwisowy, karta hulajnogi, raport zdarzenia); wgrywanie nowej wersji szablonu w panelu; generowanie DOCX i PDF |

## Pytania do prowadzącego

Odpowiedzi przekazane przez autora 2026-11-16 (pod każdym pytaniem).

1. Czy stos TypeScript (Node.js, NestJS, React, React Native) i PostgreSQL jest akceptowany w miejsce przykładowych C#/Java i MS SQL Server/Oracle?
   **Tak.**
2. Punkt 4: czy wystarczy, że obie aplikacje korzystają z projektu bazodanowego i logiki biznesowej przez wspólny backend (API), skoro aplikacja mobilna nie może łączyć się z bazą bezpośrednio?
   **Tak.**
3. Czy Drizzle ORM spełnia punkt 9?
   **Tak.**
4. Punkt 12: czy tabele z założenia tylko do dopisywania (księga portfela, dziennik audytu, telemetria) mogą mieć ograniczone operacje, np. korekta jako nowy wpis zamiast edycji i usuwania?
   **Tak.**
5. Punkt 17: czy dotyczy wszystkich tekstów interfejsu (np. etykiet przycisków), czy treści merytorycznych (aktualności, opisy, zdjęcia, regulamin, FAQ)?
   **Raczej treści merytorycznych.**
6. Czy symulowana flota (bez fizycznych urządzeń) jest akceptowalna?
   **Tak.**
7. Punkt 14: czy różne stany jednego ekranu (np. pusty, błąd) liczą się jako osobne widoki?
   **Liczy się wszystko, co można zaliczyć jako widok; z aplikacji mobilnej, strony i panelu łącznie limit zostanie przekroczony z zapasem.**

## Plan dostosowania (przed iteracją 1)

1. Zadać pytania prowadzącemu; odpowiedzi zapisać w tym pliku. **Zrobione (2026-11-16).**
2. ADR-y: osobny projekt logiki (`packages/core`), zakres logiki w bazie (widoki, funkcje, procedury), moduł treści, uprawnienia (RBAC), raporty i wydruki. **Zrobione (2026-11-16), zaakceptowane:** [0025](adr/0025-logika-biznesowa-packages-core.md), [0026](adr/0026-logika-w-bazie-widoki-funkcje-procedury.md), [0027](adr/0027-tresci-sterowane-z-panelu.md), [0028](adr/0028-uzytkownicy-role-uprawnienia.md), [0029](adr/0029-raporty-pdf-xlsx.md), [0030](adr/0030-wydruki-z-szablonow-docx.md), [0031](adr/0031-wzorzec-widoku-tabeli-w-panelu.md) (wzorzec widoku tabeli, punkt 12).
3. Migracja `0002`: uprawnienia, treści i media, szablony wydruków i wygenerowane dokumenty, definicje raportów, paragony, modele hulajnóg i zadania serwisowe; widoki, funkcje, procedury. **Zrobione (2026-11-16):** [`0002_admin_modules.sql`](../packages/db/migrations/0002_admin_modules.sql), macierz operacji w panelu w [modelu danych](model-danych/README.md).
4. Refaktoryzacja: `packages/core`, dostęp do danych tylko przez `packages/db` i Drizzle. **Zrobione (2026-11-16).**
5. Aktualizacja planu iteracji o moduły: treści i uprawnienia, raporty i wydruki, serwis. **Zrobione (2026-11-16):** [plan iteracji](iteracje/README.md) 0–9 z przypisaniem wymagań.
6. Makiety nowych ekranów panelu: role i uprawnienia, wzorzec widoku tabeli, edytor treści, biblioteka mediów, raporty, szablony wydruków. **Wzorzec widoku tabeli zrobiony (2026-11-16)**: cztery plansze w [`projekt/`](projekt/README.md#panel-operatora-wzorzec-widoku-tabeli). **Role i uprawnienia zrobione (2026-11-16)**: 12 plansz panelu i 3 aplikacji w [`projekt/`](projekt/README.md#panel-operatora-konta-i-dostęp); pozostałe makiety przed iteracjami, które ich potrzebują ([plan iteracji](iteracje/README.md#przed-iteracją-1)).
