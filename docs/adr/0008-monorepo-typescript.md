# ADR 0008: Monorepo w TypeScript (pnpm i Turborepo)

- **Status:** zaakceptowana
- **Data:** 2026-11-09

## Kontekst

System składa się z czterech aplikacji (mobile, web, api, simulator) i wspólnych definicji: formatów wiadomości MQTT, zdarzeń i schematu bazy.

## Rozważane opcje

1. **Osobne repozytoria**. Niezależność, ale synchronizacja wspólnych typów jest uciążliwa.
2. **Monorepo pnpm + Turborepo**. Jedno repozytorium, wspólne pakiety, buforowane zadania budowania i testów.

## Decyzja

Jedno repozytorium z pnpm workspaces i Turborepo. Aplikacje w `apps/`, wspólne pakiety w `packages/` (`shared`, `db`). TypeScript w całym projekcie.

## Konsekwencje

Pozytywne:

- Zmiana kontraktu jest widoczna w kompilacji wszystkich zależnych aplikacji.
- Jeden proces CI.

Negatywne i ryzyka:

- Konfiguracja Expo w monorepo wymaga uwagi przy rozwiązywaniu zależności.
