# 5. Widok bloków budujących

## 5.1. Kontenery (C4, poziom 2)

```mermaid
flowchart TB
    subgraph Klienci
        M["Aplikacja mobilna<br/>React Native + Expo"]
        W["Aplikacja webowa<br/>Next.js: strona i /admin"]
    end
    API["Backend API<br/>NestJS + Fastify<br/>REST, Socket.IO"]
    DB[("PostgreSQL + PostGIS<br/>dane, kolejka pg-boss")]
    MQ["Broker MQTT<br/>Mosquitto"]
    SIM["Symulator floty<br/>Node.js + mqtt.js"]
    FS[("MinIO<br/>zdjęcia")]
    OSRM["OSRM<br/>trasy"]

    M -- "HTTPS, WebSocket" --> API
    W -- "HTTPS, WebSocket" --> API
    M -- "PUT podpisany URL" --> FS
    API -- "SQL" --> DB
    API -- "MQTT" --> MQ
    SIM -- "MQTT" --> MQ
    SIM -- "HTTP" --> OSRM
    API -- "HTTP" --> OSRM
    API --> FS
```

## 5.2. Moduły backendu (C4, poziom 3)

| Moduł | Odpowiedzialność | Główne tabele |
|---|---|---|
| Uwierzytelnianie | Kody SMS, tokeny, sesje, logowanie operatorów z TOTP | `otp_codes`, `sessions`, `staff` |
| Konta | Profil, zgody, zapisane miejsca, usunięcie konta | `users`, `consents`, `saved_places` |
| Flota | Stan hulajnóg, komendy i potwierdzenia | `scooters`, `scooter_commands` |
| Telemetria | Odbiór MQTT, punkty tras, wykrywanie zmian stref | `telemetry` |
| Strefy | Geometrie stref, zapytania przestrzenne | `zones` |
| Wypożyczenia | Maszyna stanów przejazdu, rezerwacje | `rentals`, `rental_events` |
| Płatności | Cennik, portfel, Stripe, webhooki | `tariffs`, `wallets`, `wallet_ledger`, `payments` |
| Powiadomienia | Push, zdarzenia Socket.IO | `notifications`, `push_tokens` |
| Operacje | Zgłoszenia, pliki, dziennik audytu | `tickets`, `files`, `audit_log` |

Moduły komunikują się przez publiczne serwisy i zdarzenia domenowe, nie przez bezpośredni dostęp do tabel innych modułów. Ta zasada pozwala w przyszłości wydzielić moduł do osobnej usługi.

## 5.3. Struktura repozytorium

```
apps/
  mobile/      aplikacja mobilna (Expo)
  web/         strona i panel (Next.js)
  api/         backend (NestJS)
  simulator/   symulator floty
packages/
  shared/      schematy Zod, formaty wiadomości MQTT, typy zdarzeń
  db/          schemat Drizzle i migracje
docs/          dokumentacja
infra/         Docker Compose, konfiguracja Mosquitto, OSRM, Caddy
```
