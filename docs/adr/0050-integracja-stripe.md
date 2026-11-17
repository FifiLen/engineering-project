# ADR 0050: Integracja ze Stripe

- **Status:** zaakceptowana
- **Data:** 2026-11-17

## Kontekst

[ADR 0018](0018-platnosci-stripe.md) wybrał Stripe w trybie testowym za adapterem: środki trafiają do portfela tylko po zweryfikowanym webhooku, webhooki są zapisywane w `payment_webhook_events` i przetwarzane idempotentnie. Iteracja 5 potrzebuje pięciu przepływów: zapisania karty, doładowania kartą i BLIK-iem, obciążenia karty za przejazd bez udziału klienta ([ADR 0049](0049-rozliczenie-przejazdu.md)), zwrotu ([ADR 0054](0054-zwroty-i-korekty-salda.md)) i sprawdzenia statusu, gdy webhook nie przyjdzie (makieta `tech-doladowanie`). Autor przyjął atrapę operatora obok Stripe (D1) i BLIK przez Stripe, jeśli działa w trybie testowym (D2).

Sprawdzone 17 listopada 2026:
- **Biblioteka `stripe`:** wersja 23.1.0 z 29 października 2026, najnowsza i starsza niż 3 dni.
- **BLIK według dokumentacji Stripe:**
  - tylko PLN, klient z Polski, konto m.in. z Polski;
  - w trybie testowym działa każdy 6-cyfrowy kod, a odmowy i przekroczenie czasu wywołuje się wzorcem e-maila w danych płatnika;
  - kod ważny 2 min, klient ma 60 s na potwierdzenie w banku;
  - przepływ asynchroniczny (`requires_action` z `blik_authorize`, potem `payment_intent.succeeded` albo `payment_intent.payment_failed`);
  - zapisanie BLIK do płatności cyklicznych wymaga mandatu.
- **Karty testowe:** 4242 4242 4242 4242 (sukces), 4000 0000 0000 0002 (odmowa), 4000 0000 0000 3220 (wymaga 3-D Secure), 4000 0000 0000 0341 (zapis się udaje, obciążenie nie), 4000 0000 0000 9995 (brak środków).
- **Zapis karty:** SetupIntent z `usage: off_session` (domyślne) uwierzytelnia kartę do późniejszych płatności. Nieudana płatność bez udziału klienta kończy się błędem 402 i stanem `requires_payment_method`; przy `authentication_required` klient potwierdza ją później w aplikacji.
- **Webhooki:** podpis liczony z surowej treści żądania (nagłówek `Stripe-Signature`, tolerancja 5 min); kolejność nie jest gwarantowana; to samo zdarzenie może przyjść kilka razy; w trybie testowym są trzy ponowienia w ciągu kilku godzin.

## Rozważane opcje

1. **Wywołania Stripe bezpośrednio z serwisów modułów.** Mniej kodu, ale bez atrapy, z kluczem w testach i CI oraz z logiką płatności zależną od jednego dostawcy.
2. **Port `PaymentProvider` z implementacją Stripe i atrapą w procesie**, wspólny punkt webhooka i przetwarzanie zdarzeń w kolejce.
3. **Stripe Checkout (strona Stripe zamiast formularzy w aplikacji).** Mniej pracy w klientach, ale przekierowanie poza aplikację i brak płatności bez udziału klienta za przejazd w tym samym modelu.

## Decyzja

**Opcja 2.** Szczegóły:

- **Port `PaymentProvider`** w module Płatności z metodami:
  - `ensureCustomer`;
  - `createSetupIntent`;
  - `createPayment` (doładowanie, spłata, z udziałem klienta);
  - `chargeOffSession` (przejazd kartą);
  - `refund`;
  - `retrievePayment` (sprawdzenie statusu);
  - `detachPaymentMethod`;
  - `parseWebhook` (weryfikacja podpisu).
- **Implementacje:**
  - `StripePaymentProvider` na `stripe` 23.1.0 (wersja przypięta, wersja API ustawiona jawnie w konfiguracji klienta);
  - `FakePaymentProvider` w procesie API.

  Wybór przez `PAYMENT_PROVIDER` (`fake` domyślnie, `stripe` po wpisaniu kluczy). Konfiguracja odrzuca klucz `sk_live_` przy starcie: projekt nie obsługuje prawdziwych pieniędzy.
- **Klient Stripe:** jeden obiekt Customer na klienta, którego identyfikator zapisuje migracja 0007 (`payment_customers`: klient, operator, identyfikator u operatora). Customer powstaje przy pierwszej karcie albo płatności.
- **Zapis karty:** `POST /me/payment-methods/setup` tworzy SetupIntent i zwraca `clientSecret`. Kartę potwierdza aplikacja przez Stripe.js albo SDK ([ADR 0051](0051-platnosci-w-aplikacji.md)), więc numer karty nie przechodzi przez API.
  - Webhook `setup_intent.succeeded` zapisuje `payment_methods` (token, marka, cztery cyfry, ważność); pierwsza karta jest domyślna.
  - Usunięcie karty to `detach` u operatora i `removed_at` w bazie.
- **Doładowanie i spłata:**
  - API zapisuje `payments` (`PENDING`, `idempotency_key` = identyfikator płatności) i tworzy PaymentIntent z tym samym kluczem idempotencji, kwotą w groszach i `metadata.paymentId`;
  - odpowiedź `202 { paymentId, clientSecret }`;
  - potwierdzenie robi aplikacja: kartą (z 3-D Secure, jeśli trzeba) albo BLIK-iem (`confirmBlikPayment` z kodem);
  - BLIK jednorazowo, bez mandatu. Zapisany BLIK do płatności cyklicznych nie wchodzi do zakresu (D2 spełnione: BLIK działa w trybie testowym).
- **Przejazd kartą:** zadanie pg-boss `payment.charge-ride` tworzy PaymentIntent z `off_session: true`, `confirm: true`, kartą przejazdu i kluczem idempotencji płatności. Błąd 402 od razu zapisuje odmowę z kodem; wynik pozytywny przychodzi webhookiem.
- **Webhook** `POST /payments/webhooks/stripe` (`@Public()`):
  - Nest z `rawBody: true` w `NestFactory.create`, podpis sprawdzany na `req.rawBody` funkcją biblioteki;
  - zła sygnatura daje `400 WEBHOOK_SIGNATURE_INVALID`;
  - zdarzenie trafia do `payment_webhook_events` (`ON CONFLICT (provider_event_id)` zwiększa licznik dostarczeń, nowe kolumny w migracji 0007);
  - odpowiedź 200 od razu, a przetwarzanie w zadaniu pg-boss `payments.webhook`.
- **Przetwarzanie zdarzeń:** obsługiwane są `setup_intent.succeeded`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` i `refund.updated`.
  - Kolejność nie ma znaczenia: zmiany stanu płatności są monotoniczne (`PENDING → SUCCEEDED|FAILED`, `SUCCEEDED → REFUNDED`), a przy wątpliwości handler pobiera obiekt od operatora.
  - Ten sam obiekt i typ zdarzenia przetworzony drugi raz nic nie zmienia.
  - Wynik i błąd przetworzenia są zapisane przy zdarzeniu.
- **Sprawdzenie statusu:** zadanie cykliczne `payments.reconcile` co minutę pobiera od operatora płatności `PENDING` starsze niż 2 min i przetwarza wynik jak webhook.
- **Atrapa:**
  - te same przepływy w procesie, z zasadami kart testowych Stripe (4242 sukces, 0002 odmowa, 3220 wymaga potwierdzenia, 0341 zapis tak, obciążenie nie, 9995 brak środków);
  - BLIK: każdy 6-cyfrowy kod przechodzi oprócz `000000` (odmowa) i `999999` (przekroczenie czasu po 60 s);
  - zdarzenia wysyła przez ten sam punkt webhooka z podpisem HMAC kluczem `FAKE_WEBHOOK_SECRET`, z opóźnieniem około 2 s;
  - dzięki temu testy, CI i demo bez sieci przechodzą tę samą ścieżkę co Stripe.
- **Klucze:**
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` i `STRIPE_PUBLISHABLE_KEY` w `.env` (poza repozytorium);
  - klucz publiczny i nazwa operatora dla klientów z `GET /payments/config`, żeby zmiana operatora nie wymagała nowej wersji aplikacji;
  - lokalne webhooki ze Stripe CLI (`stripe listen --forward-to localhost:3001/payments/webhooks/stripe`), które zakłada i loguje autor.

## Konsekwencje

Pozytywne:

- Środki i statusy zmieniają się wyłącznie po zweryfikowanym zdarzeniu, a powtórzenia i zła kolejność nie psują stanu.
- Testy i CI nie zależą od sieci ani od kluczy; demo działa na atrapie i, po wpisaniu kluczy, na prawdziwym trybie testowym Stripe.
- Dane kart nie przechodzą przez API, więc system nie wchodzi w zakres wymagań PCI dla danych kart poza poziomem SAQ A.

Negatywne i ryzyka:

- Atrapa może się rozjechać ze Stripe. Ograniczenie: te same zdarzenia i kody błędów, a scenariusz demo przechodzi też na Stripe.
- Webhook w środowisku lokalnym wymaga Stripe CLI; bez niego płatności Stripe zostają `PENDING` do sprawdzenia statusu po 2 min.
- Druga wersja API Stripe w przyszłości wymaga świadomej aktualizacji biblioteki i testów.

## Powiązane

[ADR 0018](0018-platnosci-stripe.md) (uzupełnia), [ADR 0037](0037-pg-boss-konfiguracja-i-zadania.md), [ADR 0049](0049-rozliczenie-przejazdu.md), [ADR 0051](0051-platnosci-w-aplikacji.md), [ADR 0054](0054-zwroty-i-korekty-salda.md), makieta `15-techniczne/tech-doladowanie`, [plan iteracji 5](../iteracje/iteracja-05-platnosci.md) (D1, D2)
