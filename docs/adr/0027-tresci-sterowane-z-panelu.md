# ADR 0027: Teksty, treści i grafiki sterowane z panelu

- **Status:** proponowana
- **Data:** 2026-11-16

## Kontekst

Punkt 17 wymagań uczelni: wszystkie widoczne teksty, opisy i zdjęcia mają być sterowane z części administracyjnej, bez wartości na sztywno w kodzie. Dotyczy to każdego ekranu aplikacji mobilnej, panelu i strony, więc decyzja musi zapaść przed pierwszym ekranem (iteracja 1).

Nie wiadomo jeszcze, czy wymaganie obejmuje wszystkie teksty interfejsu, czy tylko treści merytoryczne (pytanie 5 do prowadzącego). Przerobienie gotowych ekranów pod węższą interpretację byłoby tanie, a pod szerszą drogie: każdy napis trzeba by wtedy wyszukać i przenieść.

Dodatkowe siły: aplikacja ma ekran „Brak internetu”, więc teksty muszą być dostępne bez sieci; regulamin jest wersjonowany, bo `consents.document_version` wskazuje wersję zaakceptowaną przez użytkownika; komunikaty błędów API mają postać `{ code, message, details }`.

## Rozważane opcje

1. **Tylko treści merytoryczne w bazie** (regulamin, FAQ, aktualności, opisy), etykiety interfejsu w kodzie. Najmniej pracy, ale nie spełnia szerszej interpretacji.
2. **Pliki tłumaczeń (JSON) w repozytorium edytowane w panelu**. Znany mechanizm i18n, ale zmiana w panelu wymagałaby zapisu do repozytorium i nowego wdrożenia.
3. **Katalog tekstów w bazie, w kodzie tylko klucze**. Każdy napis ma klucz (np. `rental.end.cta`), wartość jest w bazie z wartością domyślną w danych startowych i edycją w panelu. Treści merytoryczne i grafiki w osobnych tabelach.
4. **Zewnętrzny CMS** (np. Strapi, Directus). Gotowy edytor, ale osobna aplikacja i baza poza projektem logiki ([ADR 0025](0025-logika-biznesowa-packages-core.md)) oraz dodatkowy element do utrzymania.

## Decyzja

Opcja 3, czyli najszersza interpretacja. Spełnia oba możliwe znaczenia punktu 17, a koszt ponosimy raz, przy szkielecie ekranów.

**Dane** (moduł Treści, nowe tabele w migracji 0002):

- `ui_texts`: klucz, język, wartość w formacie ICU MessageFormat (np. `Koszt: {amount}`), zakres (`mobile`, `web`, `admin`, `api`), opis dla redaktora, autor i data zmiany. Język na razie tylko `pl`, ale kolumna jest od początku.
- `content_pages` i `content_page_versions`: strony z treścią w Markdown (regulamin, polityka prywatności, zasady jazdy) z wersjami; zaakceptowana zgoda wskazuje wersję.
- `faq_items` i `news`: pytania i odpowiedzi oraz aktualności z kolejnością, publikacją od–do i statusem.
- `media_assets`: grafiki z kluczem (np. `onboarding.hero`), tekstem alternatywnym i podpisem; plik w magazynie S3 przez istniejącą tabelę `files` ([ADR 0024](0024-magazyn-plikow-seaweedfs.md)).
- Licznik `content_revision` zwiększany przy każdej zmianie.

**Klienci**:

- API udostępnia katalog dla zakresu i języka z nagłówkiem `ETag` równym `content_revision`; zmiana treści wysyła zdarzenie Socket.IO `content.updated`.
- Aplikacja mobilna trzyma ostatni katalog w pamięci urządzenia. Przy budowaniu dołączamy kopię katalogu wygenerowaną z danych startowych, żeby pierwsze uruchomienie bez sieci też miało teksty. Źródłem prawdy jest zawsze baza.
- Formatowanie: `intl-messageformat` (FormatJS) dla parametrów i liczby mnogiej, kwoty i odległości przez formatery z `packages/shared`.
- Komunikaty błędów: API zwraca `code`, a `message` pochodzi z katalogu pod kluczem `error.<code>`.
- Reguła lintera zakazująca dosłownych tekstów w JSX (np. `react/jsx-no-literals`) w `apps/web` i `apps/mobile`. Nowy klucz bez wpisu w danych startowych zatrzymuje test.

**Panel**: edytor tekstów (lista z filtrowaniem po zakresie i ekranie, wyszukiwanie, podgląd parametrów), edytor stron z wersjami, FAQ, aktualności, biblioteka mediów. Uprawnienia `content.*` ([ADR 0028](0028-uzytkownicy-role-uprawnienia.md)), zmiany zapisywane w `audit_log`.

**Wyjątki** (opisane w pracy): ikona aplikacji i ekran startowy są wkompilowane w aplikację (wymóg systemów iOS i Android), dane wprowadzane przez użytkowników (nazwy miejsc, opisy zgłoszeń) i dane z systemu (numery hulajnóg, kwoty) nie są treściami.

## Konsekwencje

Pozytywne:

- Punkt 17 spełniony niezależnie od odpowiedzi prowadzącego; przy obronie można zmienić napis w panelu i pokazać go na telefonie.
- Gotowe przygotowanie do kolejnych języków.
- Cztery do sześciu nowych tabel i kilka rozbudowanych ekranów panelu (punkty 8, 12 i 14).

Negatywne i ryzyka:

- Każdy ekran wymaga dopisania kluczy i wartości startowych; pisanie interfejsu jest wolniejsze.
- Teksty z makiet trzeba przenieść do danych startowych.
- Błąd w treści wprowadzonej w panelu (np. zepsuty parametr ICU) może zepsuć ekran. Panel sprawdza składnię i parametry przed zapisem, a klient przy błędzie pokazuje wartość domyślną.

## Powiązane

[ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0012](0012-socket-io.md), [ADR 0024](0024-magazyn-plikow-seaweedfs.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [wymagania uczelni](../wymagania-uczelni.md) (punkt 17, pytanie 5)
