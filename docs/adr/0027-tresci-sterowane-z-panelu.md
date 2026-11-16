# ADR 0027: Treści merytoryczne i grafiki sterowane z panelu

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

Punkt 17 wymagań uczelni: wszystkie widoczne teksty, opisy i zdjęcia mają być sterowane z części administracyjnej, bez wartości na sztywno w kodzie. Według odpowiedzi na pytanie 5 ([wymagania-uczelni.md](../wymagania-uczelni.md)) chodzi raczej o treści merytoryczne: regulamin, FAQ, aktualności, opisy i zdjęcia, a nie o każdą etykietę przycisku.

Treści występują w każdym kliencie: strona promocyjna składa się prawie wyłącznie z treści, aplikacja ma ekrany startowe, zasady przed pierwszą jazdą, cennik i powiadomienia, a panel pokazuje opisy w formularzach. Decyzja musi więc zapaść przed pierwszym ekranem (iteracja 1).

Dodatkowe siły: aplikacja ma ekran „Brak internetu”, więc ostatnio pobrane treści muszą być dostępne bez sieci; regulamin jest wersjonowany, bo `consents.document_version` wskazuje wersję zaakceptowaną przez użytkownika; [§8.11](../arc42/08-koncepcje-przekrojowe.md) przewiduje teksty interfejsu wydzielone do plików tłumaczeń.

## Rozważane opcje

1. **Wszystkie teksty w bazie, także etykiety interfejsu**. Spełnia najszerszą interpretację, ale każdy przycisk wymaga klucza i wartości startowej w bazie, a ekrany zależą od pobrania katalogu. Przy odpowiedzi na pytanie 5 to koszt bez potrzeby.
2. **Treści merytoryczne w bazie z edycją w panelu, etykiety interfejsu w plikach tłumaczeń**. Treści zmienia operator bez programisty; etykiety są częścią kodu interfejsu, ale nie są wpisane w komponenty.
3. **Zewnętrzny CMS** (np. Strapi, Directus). Gotowy edytor, ale osobna aplikacja i baza poza projektem logiki ([ADR 0025](0025-logika-biznesowa-packages-core.md)) oraz dodatkowy element do utrzymania.

## Decyzja

Opcja 2. Granica: **treść** to wszystko, co operator zmienia z powodów biznesowych (oferta, zasady, komunikaty, zdjęcia); **etykieta** to element obsługi interfejsu (przycisk, nazwa pola, pozycja menu, komunikat walidacji).

**Treści** (moduł Treści, nowe tabele w migracji 0002):

- `content_pages` i `content_page_versions`: dokumenty w Markdown z wersjami (regulamin, polityka prywatności, zasady jazdy); zaakceptowana zgoda wskazuje wersję.
- `content_blocks`: bloki z kluczem (np. `web.home.hero`, `mobile.onboarding.rules`) z tytułem, treścią, grafiką i opcjonalnym przyciskiem. Z nich składa się strona promocyjna, ekrany powitalne i opisy w aplikacji.
- `faq_items` i `news`: pytania i odpowiedzi oraz aktualności z kolejnością, publikacją od–do i statusem.
- `notification_templates`: treść powiadomień push i SMS w formacie ICU MessageFormat z parametrami (np. `Przejazd zakończony, koszt {amount}`).
- `media_assets`: grafiki z kluczem, tekstem alternatywnym i podpisem (zdjęcia na stronie, ilustracje w aplikacji, zdjęcia modeli hulajnóg); plik w magazynie S3 przez istniejącą tabelę `files` ([ADR 0024](0024-magazyn-plikow-seaweedfs.md)).
- Opisy w istniejących i nowych tabelach domeny (np. opis strefy, opis wersji cennika, opis modelu hulajnogi) są edytowane w formularzach tych zasobów ([ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md)).
- Licznik `content_revision` zwiększany przy każdej zmianie.

**Klienci**:

- API udostępnia treści z nagłówkiem `ETag` równym `content_revision`; zmiana treści wysyła zdarzenie Socket.IO `content.updated`.
- Aplikacja mobilna trzyma ostatnio pobrane treści w pamięci urządzenia, więc działają bez sieci. Strona promocyjna renderuje treści po stronie serwera z odświeżaniem po zmianie.
- Formatowanie parametrów: `intl-messageformat` (FormatJS); kwoty i odległości przez formatery z `packages/shared`.

**Etykiety interfejsu**:

- Pliki tłumaczeń w każdym kliencie (zgodnie z [§8.11](../arc42/08-koncepcje-przekrojowe.md) i [ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md)); w komponentach tylko klucze.
- Reguła lintera zakazująca dosłownych tekstów w JSX (np. `react/jsx-no-literals`) w `apps/web` i `apps/mobile`.
- Komunikaty błędów: API zwraca `code`, a klient pokazuje tekst z pliku tłumaczeń pod kluczem `error.<code>`.
- Ponieważ etykiety są już wydzielone i adresowane kluczami, ewentualne przeniesienie ich do bazy wymagałoby zmiany źródła katalogu, a nie przeglądania ekranów.

**Panel**: edytor dokumentów z wersjami i podglądem, bloki treści pogrupowane według klienta i ekranu, FAQ, aktualności, szablony powiadomień z podglądem parametrów, biblioteka mediów. Uprawnienia `content.*` ([ADR 0028](0028-uzytkownicy-role-uprawnienia.md)), zmiany zapisywane w `audit_log`.

**Wyjątki** (opisane w pracy): ikona aplikacji i ekran startowy są wkompilowane w aplikację (wymóg systemów iOS i Android); dane wprowadzane przez użytkowników (nazwy miejsc, opisy zgłoszeń) i dane z systemu (numery hulajnóg, kwoty) nie są treściami.

## Konsekwencje

Pozytywne:

- Punkt 17 spełniony w zakresie z odpowiedzi na pytanie 5; przy obronie można zmienić treść w panelu i pokazać ją na stronie i telefonie.
- Etykiety bez tekstów wpisanych w komponenty, więc w kodzie nie ma napisów na sztywno, a dodanie języka nie wymaga zmian w komponentach.
- Sześć do siedmiu nowych tabel i kilka rozbudowanych ekranów panelu (punkty 8, 12 i 14).

Negatywne i ryzyka:

- Granica między treścią a etykietą wymaga oceny; wątpliwe przypadki traktujemy jako treść.
- Teksty i grafiki z makiet trzeba rozdzielić na dane startowe treści i pliki tłumaczeń.
- Błąd w treści wprowadzonej w panelu (np. zepsuty parametr ICU w szablonie powiadomienia) może zepsuć wiadomość. Panel sprawdza składnię i parametry przed zapisem.
- Jeśli prowadzący zażąda także etykiet w panelu, decyzję zmieni nowy ADR (przeniesienie katalogu etykiet do bazy).

## Powiązane

[ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0012](0012-socket-io.md), [ADR 0024](0024-magazyn-plikow-seaweedfs.md), [ADR 0025](0025-logika-biznesowa-packages-core.md), [ADR 0028](0028-uzytkownicy-role-uprawnienia.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [§8.11](../arc42/08-koncepcje-przekrojowe.md), [wymagania uczelni](../wymagania-uczelni.md) (punkt 17, pytanie 5)
