# ADR 0032: Etykiety interfejsu: pliki JSON, wspólny tłumacz i reguła lintera

- **Status:** zaakceptowana
- **Data:** 2026-11-16

## Kontekst

[ADR 0027](0027-tresci-sterowane-z-panelu.md) rozdziela treści merytoryczne (baza, panel) od etykiet interfejsu (pliki tłumaczeń) i zapowiada regułę lintera zakazującą tekstów w JSX. Nie rozstrzyga, jakiej biblioteki używają klienci ani jak działa reguła. Iteracja 1 tworzy pierwsze ekrany panelu i przenosi teksty ekranu startowego aplikacji, więc decyzja jest potrzebna teraz.

Siły:

- Dwa klienci (Next.js 16 i Expo SDK 58) powinni rozumieć etykiety tak samo, w tym liczebniki („1 hulajnoga”, „3 hulajnogi”, „240 hulajnóg”).
- ADR 0027 wybrał już `intl-messageformat` (FormatJS) do szablonów powiadomień z bazy.
- Panel ma na razie jeden język; dodanie drugiego nie może wymagać zmian w komponentach.
- `react/jsx-no-literals` pochodzi z `eslint-plugin-react`, który nie działa z ESLint 10 używanym w repozytorium poza aplikacją mobilną ([dziennik](../dziennik.md), iteracja 0).

## Rozważane opcje

1. **Biblioteki zależne od klienta**: `next-intl` w panelu, `i18next` z `react-i18next` w aplikacji. Gotowe dostawcy kontekstu i obsługa komponentów serwerowych, ale dwa różne formaty, dwie konfiguracje i trzecia biblioteka obok `intl-messageformat`.
2. **Wspólny tłumacz w `packages/shared`** na `intl-messageformat`: każdy klient przekazuje swój plik JSON, komponenty wołają `t('klucz', { parametry })`. Jeden format ICU dla etykiet i szablonów powiadomień, klucze sprawdzane przez TypeScript.
3. **Etykiety w bazie** od razu: odrzucone w ADR 0027.

## Decyzja

Opcja 2.

- `createTranslator(messages, locale)` w `packages/shared/src/i18n.ts`: klucze w notacji kropkowej typowane z pliku JSON, `t.dynamic()` dla kluczy składanych w czasie działania (np. `fleetStatus.${status}`), brak klucza zwraca klucz. Skompilowane komunikaty są pamiętane.
- Pliki: `apps/web/messages/pl.json` (panel i strona) i `apps/mobile/src/i18n/pl.json`. Format ICU MessageFormat, liczebniki przez `plural` z regułami `Intl.PluralRules` dla języka polskiego.
- Etykiety pól zasobów panelu pod kluczami `resource.<zasób>.fields.<pole>`, wartości wyliczeń pod `resource.<zasób>.values.<pole>.<wartość>`, błędy API pod `error.<code>` ([ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), arc42 §8.8).
- Daty, czas względny, liczby i kwoty formatuje `Intl` (strefa Europe/Warsaw) i `formatPln`; nie są etykietami.
- Reguła lintera bez wtyczki: `no-restricted-syntax` z selektorami na węzły tekstowe JSX, literały i szablony z literami w dzieciach elementów oraz atrybuty widoczne dla użytkownika (`placeholder`, `title`, `alt`, `label`, `aria-label`, `accessibilityLabel`, `accessibilityHint`). Ta sama lista selektorów w `eslint.config.mjs` (ESLint 10) i `apps/mobile/eslint.config.js` (ESLint 9).

## Konsekwencje

Pozytywne:

- Jeden mechanizm i jeden format w obu klientach i w szablonach powiadomień; poprawna odmiana liczebników.
- Literówka w kluczu to błąd TypeScript, a tekst wpisany w JSX to błąd lintera w CI.
- Reguła nie zależy od `eslint-plugin-react`, więc działa z ESLint 10.

Negatywne i ryzyka:

- Brak gotowej obsługi wielu języków (wybór języka, ładowanie katalogu na żądanie); przy drugim języku potrzebny będzie kontekst z katalogiem zamiast importu modułu.
- Reguła sprawdza tylko JSX: tekst przekazany przez zmienną z literału w kodzie (np. `const label = 'Zapisz'`) nie zostanie wykryty. Pilnuje tego przegląd kodu.
- Treść merytoryczna ekranu startowego i strony promocyjnej jest do iteracji 7 w plikach tłumaczeń; potem przejdzie do bloków treści z bazy (ADR 0027).

## Powiązane

[ADR 0004](0004-niezalezni-klienci-wspolny-kontrakt.md), [ADR 0023](0023-typescript-6.md), [ADR 0027](0027-tresci-sterowane-z-panelu.md), [ADR 0031](0031-wzorzec-widoku-tabeli-w-panelu.md), [§8.11](../arc42/08-koncepcje-przekrojowe.md), [wymagania uczelni](../wymagania-uczelni.md) (punkt 17)
