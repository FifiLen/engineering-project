# ADR 0019: Uwierzytelnianie: kod SMS dla użytkowników, hasło z TOTP dla operatorów

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

Użytkownicy aplikacji chcą szybko zacząć bez zakładania hasła. Operatorzy mają dostęp do danych i zdalnych komend, więc potrzebują silniejszego logowania.

## Rozważane opcje

1. **E-mail i hasło dla wszystkich**. Standardowe, ale wolniejsze w onboardingu.
2. **Logowanie przez Google lub Apple**. Wygodne, ale wymaga konfiguracji kont deweloperskich.
3. **Kod SMS dla użytkowników, hasło z TOTP dla operatorów**. Szybki start dla użytkowników, dwa składniki dla operatorów.

## Decyzja

Użytkownicy: jednorazowy kod SMS (ważny 5 min, skrót w bazie, limit prób), token dostępowy JWT na 15 min i token odświeżający na 30 dni przechowywany jako skrót w `sessions`. Operatorzy: e-mail, hasło (argon2) i kod TOTP. Bramka SMS jest za adapterem; w środowisku deweloperskim kod trafia do logów.

## Konsekwencje

Pozytywne:

- Szybki onboarding.
- Możliwość unieważnienia sesji.
- Silne logowanie do panelu.

Negatywne i ryzyka:

- Koszt SMS-ów w demo; ryzyko nadużyć ograniczone limitami prób.
