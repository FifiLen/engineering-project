# ADR 0018: Płatności przez Stripe w trybie testowym

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Użytkownik doładowuje portfel lub płaci kartą za przejazd. Projekt nie obsługuje prawdziwych pieniędzy, ale przepływ powinien być realistyczny, łącznie z webhookami.

## Rozważane opcje

1. **Atrapa operatora płatności**. Pełna kontrola, ale nierealistyczna.
2. **Lokalni operatorzy (PayU, Przelewy24)**. Popularni w Polsce, mniej wygodne narzędzia testowe.
3. **Stripe w trybie testowym**. Karty i BLIK w złotówkach, dokumentacja, narzędzie do lokalnego testowania webhooków.

## Decyzja

Stripe w trybie testowym. Środki trafiają do portfela wyłącznie po zweryfikowanym webhooku. Webhooki są zapisywane w `payment_webhook_events` i przetwarzane idempotentnie. System nie przechowuje pełnych numerów kart, tylko token, markę i cztery ostatnie cyfry. Operator jest za adapterem.

## Konsekwencje

Pozytywne:

- Realistyczny przepływ płatności z webhookami.
- Bezpieczeństwo danych kart po stronie operatora.

Negatywne i ryzyka:

- Zależność od usługi zewnętrznej w demo; dostępność BLIK w trybie testowym do potwierdzenia.

## Powiązane

[ADR 0014](0014-kwoty-w-groszach-portfel-ksiega.md)
