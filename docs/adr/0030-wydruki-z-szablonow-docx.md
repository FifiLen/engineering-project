# ADR 0030: Wydruki z szablonów DOCX zmienianych przez użytkownika

- **Status:** proponowana
- **Data:** 2026-11-16

## Kontekst

Punkt 19 wymagań uczelni wymaga parametryzowanych wydruków z szablonów (np. Word), przy czym użytkownik może zmienić szablon. W wypożyczalni są to dokumenty dotyczące jednego obiektu: przejazdu, hulajnogi, zgłoszenia lub zadania serwisowego. Szablon ma być edytowany w zwykłym Wordzie przez osobę bez dostępu do kodu, a wynik pobierany jako DOCX lub PDF.

Raporty ([ADR 0029](0029-raporty-pdf-xlsx.md)) to zestawienia wielu rekordów generowane z HTML; wydruki to dokumenty jednego rekordu oparte na pliku szablonu. Oba korzystają z tego samego kontenera Gotenberg i zadań pg-boss.

## Rozważane opcje

1. **docxtemplater** (MIT). Znaczniki w treści dokumentu (`{rental.number}`, pętle `{#items}…{/items}`, warunki), aktywnie rozwijany. Moduły obrazów i HTML są płatne.
2. **docx-templates**. Podobna składnia, ale wyrażenia w szablonie są wykonywanym kodem JavaScript, więc szablon wgrany przez użytkownika wymagałby izolacji.
3. **Generowanie DOCX z kodu (biblioteka `docx`)**. Pełna kontrola, ale użytkownik nie może zmienić szablonu bez programisty.

## Decyzja

**docxtemplater** z wbudowanym modułem inspekcji szablonu. Konwersja DOCX na PDF przez LibreOffice w kontenerze Gotenberg.

- **Rodzaje dokumentów i ich pola** są katalogiem w `packages/core` ([ADR 0025](0025-logika-biznesowa-packages-core.md)): dla każdego rodzaju opis danych dostępnych w szablonie i funkcja, która je buduje z widoków bazy. Na start: potwierdzenie przejazdu, protokół serwisowy, karta hulajnogi, raport zdarzenia (zgłoszenie z przebiegiem obsługi) i potwierdzenie korekty salda.
- **Dane** (migracja 0002): `document_templates` (rodzaj dokumentu, nazwa, opis, znacznik domyślnego), `document_template_versions` (plik w `files`, numer wersji, autor, data, aktywność; indeks częściowy pozwala na jedną aktywną wersję szablonu) oraz `generated_documents` (rodzaj, obiekt, użyta wersja szablonu, parametry, pliki DOCX i PDF, operator).
- **Zmiana szablonu w panelu**: pobranie aktywnej wersji, edycja w Wordzie, wgranie nowej wersji. Przy wgraniu moduł inspekcji odczytuje znaczniki, a core sprawdza je z katalogiem pól; nieznany znacznik lub błąd składni odrzuca wersję z listą błędów. Następnie podgląd PDF na przykładowych danych, aktywacja i w razie potrzeby powrót do poprzedniej wersji. Dla jednego rodzaju może istnieć kilka szablonów (np. potwierdzenie skrócone i pełne); operator wybiera szablon przy wydruku.
- **Parametry wydruku** podawane przy generowaniu, np. zakres historii na karcie hulajnogi, wariant języka, dołączenie trasy.
- **Lista pól dla autora szablonu** jest dostępna w panelu i jako dokument DOCX z opisem wszystkich znaczników, generowany z katalogu.
- Grafiki stałe (logo) są częścią pliku szablonu. Obrazów zmiennych (zdjęcia zgłoszeń) w szablonach nie wstawiamy, bo moduł obrazów jest płatny; w dokumencie jest odnośnik do zdjęcia.
- Uprawnienia `templates.read`, `templates.write`, `documents.generate` ([ADR 0028](0028-uzytkownicy-role-uprawnienia.md)); zmiany szablonów w `audit_log`.

## Konsekwencje

Pozytywne:

- Punkt 19 spełniony w pełnym zakresie: parametry, wiele szablonów, zmiana szablonu przez użytkownika z kontrolą poprawności.
- Szablony bez wykonywanego kodu, więc wgranie pliku przez operatora nie jest zagrożeniem dla serwera.
- Trzy nowe tabele i kilka ekranów panelu (punkty 8 i 14); wersjonowanie szablonów pozwala odtworzyć, z jakiej wersji powstał dokument.

Negatywne i ryzyka:

- Word potrafi rozbić znacznik na kilka fragmentów tekstu przy edycji; docxtemplater łączy je, ale autor szablonu może trafić na mylące błędy. Instrukcja w panelu i walidacja przy wgraniu ograniczają ten problem.
- Konwersja przez LibreOffice może drobnie zmienić układ względem Worda (czcionki). W kontenerze instalujemy Inter, żeby PDF odpowiadał design systemowi.
- Brak obrazów zmiennych bez płatnego modułu.

## Powiązane

[ADR 0024](0024-magazyn-plikow-seaweedfs.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0026](0026-logika-w-bazie-widoki-funkcje-procedury.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0029](0029-raporty-pdf-xlsx.md), [wymagania uczelni](../wymagania-uczelni.md) (punkt 19)
