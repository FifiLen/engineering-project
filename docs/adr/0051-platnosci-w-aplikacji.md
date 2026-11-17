# ADR 0051: Płatności w aplikacji

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

Aplikacja zapisuje kartę, doładowuje portfel kartą i BLIK-iem, spłaca zaległość i obsługuje 3-D Secure (makiety `07-mobile-platnosci`, `24-mobile-platnosci`). Dane karty mają trafiać bezpośrednio do operatora płatności (D3 w [planie iteracji 5](../iteracje/iteracja-05-platnosci.md)), a potwierdzenie robi klient ([ADR 0050](0050-integracja-stripe.md)). Aplikacja działa w dwóch środowiskach: wersja web (podgląd w przeglądarce, na niej sprawdzamy ekrany) i natywna w development build ([ADR 0040](0040-mapa-lokalizacja-aparat-w-aplikacji.md)), której jeszcze nie uruchamialiśmy.

Sprawdzone 17 listopada 2026 (wersje starsze niż 3 dni):

| Pakiet | Wersja | Uwagi |
|---|---|---|
| `@stripe/stripe-js` | 10.3.0 (12.11) | Stripe.js w przeglądarce |
| `@stripe/react-stripe-js` | 7.1.0 (13.11) | komponenty Elements dla React |
| `@stripe/stripe-react-native` | 0.81.0 (wersja z Expo SDK 58 przez `expo install`; najnowsza 0.85.1) | natywny SDK z wtyczką konfiguracji Expo, wymaga development build |

## Rozważane opcje

1. **Tylko natywny SDK.** Spójne z produkcją, ale ekranów płatności nie da się sprawdzić w wersji web, a development build jeszcze nie działa.
2. **Tylko Stripe.js w widoku web (WebView) także natywnie.** Jedna implementacja, ale gorsze doświadczenie, problemy z 3-D Secure w WebView i odstępstwo od wzorców Stripe dla aplikacji.
3. **Dwie implementacje za wspólnym interfejsem**, jak mapa: Stripe.js w wersji web i natywny SDK w development build, plus prosta implementacja dla atrapy operatora.

## Decyzja

**Opcja 3.** Szczegóły:

- **Moduł `src/lib/payments`** z interfejsem:
  - `collectCard(clientSecret)`: formularz karty i potwierdzenie SetupIntent;
  - `confirmCardPayment(clientSecret, paymentMethodId)`: z 3-D Secure, jeśli trzeba;
  - `confirmBlik(clientSecret, code)`;
  - komponent pola karty.
- **Implementacje:**
  - `payments.web.tsx`: `@stripe/stripe-js` i `@stripe/react-stripe-js`, element karty w stylu design systemu;
  - `payments.tsx`: `@stripe/stripe-react-native` (`CardField`, `confirmSetupIntent`, `confirmPayment`, `handleNextAction`), instalowany przez `expo install`, z wtyczką konfiguracji w `app.json`;
  - `payments.fake.ts`: dla atrapy operatora (`GET /payments/config` zwraca `provider: 'fake'`) prosty formularz z numerami kart testowych, które idą do atrapy w API. Tylko w środowisku deweloperskim i tylko numery testowe; z prawdziwym operatorem numer karty nigdy nie trafia do API.
- **BLIK:** kod wpisany na ekranie `platnosci-blik` idzie do `confirmBlik`, a ekran `doladowanie-oczekiwanie` czeka na wynik przez Socket.IO (`wallet.updated`) i odpytuje `GET /payments/{id}` po powrocie aplikacji na pierwszy plan. Licznik 60 s pochodzi z czasu na potwierdzenie w banku.
- **3-D Secure:** arkusz albo przekierowanie z biblioteki operatora. Adres powrotu to schemat aplikacji (natywnie) albo bieżący adres (web); po powrocie ten sam ekran oczekiwania.
- **Klucz publiczny i rodzaj operatora** z `GET /payments/config`, nie ze zmiennych budowania, więc atrapę i Stripe przełącza się bez przebudowy aplikacji.
- **Weryfikacja:** ekrany sprawdzamy w wersji web na atrapie i, po wpisaniu kluczy, na Stripe. Implementacja natywna przechodzi typy i lint, a uruchomienie czeka na development build, jak mapa.

## Konsekwencje

Pozytywne:

- Ekrany płatności można sprawdzić w przeglądarce bez development build i bez kluczy (atrapa).
- Numer karty nie przechodzi przez API przy prawdziwym operatorze; aplikacja korzysta z wzorców operatora dla 3-D Secure i BLIK.

Negatywne i ryzyka:

- Trzy implementacje jednego interfejsu, a natywna jest niesprawdzona do czasu development build (ten sam dług co przy mapie, arc42 §11).
- Wersja SDK z Expo (0.81.0) jest starsza od najnowszej (0.85.1); aktualizacja razem z Expo SDK.
- Formularz atrapy przyjmuje numery kart testowych przez API; dopuszczalne tylko z atrapą, którą konfiguracja wyłącza w produkcji.

## Powiązane

[ADR 0005](0005-react-native-expo.md), [ADR 0040](0040-mapa-lokalizacja-aparat-w-aplikacji.md), [ADR 0050](0050-integracja-stripe.md), makiety `07-mobile-platnosci`, `24-mobile-platnosci`, [plan iteracji 5](../iteracje/iteracja-05-platnosci.md) (D2, D3)
