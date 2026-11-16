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
    FS[("SeaweedFS (S3)<br/>zdjęcia")]
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
| Uwierzytelnianie | Kody SMS, tokeny, sesje, logowanie operatorów z TOTP i zaproszenia, globalny strażnik uprawnień ([ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md)) | `otp_codes`, `sessions`, `staff_sessions`, `staff_invitations` |
| Konta | Profil, rejestracja, zgody na wersje dokumentów, blokada, zapisane miejsca, usunięcie konta | `users`, `consents`, `saved_places` |
| Dostęp | Operatorzy, role i macierz uprawnień, dziennik audytu z historią rekordu, dokumenty prawne z wersjami ([ADR 0028](../adr/0028-uzytkownicy-role-uprawnienia.md)) | `staff`, `roles`, `role_permissions`, `staff_roles`, `audit_log`, `content_pages`, `content_page_versions` |
| Flota | Stan hulajnóg i modeli, komendy i potwierdzenia, mapa floty (pokój `fleet`) | `scooters`, `scooter_models`, `scooter_commands` |
| Telemetria | Odbiór MQTT partiami, punkty tras, stan bieżący i przebieg ([ADR 0033](../adr/0033-telemetria-i-status-floty.md)), wykrywanie zmian stref (iteracja 4) | `telemetry` |
| Strefy | Geometrie stref, zapytania przestrzenne | `zones` |
| Wypożyczenia | Maszyna stanów przejazdu, rezerwacje | `rentals`, `rental_events` |
| Płatności | Cennik, portfel, Stripe, webhooki | `tariffs`, `wallets`, `wallet_ledger`, `payments` |
| Powiadomienia | Push, zdarzenia Socket.IO | `notifications`, `push_tokens` |
| Operacje | Zgłoszenia, pliki | `tickets`, `files` |

Moduły komunikują się przez publiczne serwisy i zdarzenia domenowe, nie przez bezpośredni dostęp do tabel innych modułów. Ta zasada pozwala w przyszłości wydzielić moduł do osobnej usługi.

## 5.3. Struktura repozytorium

```
apps/
  mobile/      aplikacja mobilna (Expo)
  web/         strona i panel (Next.js)
  api/         backend (NestJS)
  simulator/   symulator floty
packages/
  core/        logika biznesowa i porty repozytoriów, bez frameworka (ADR 0025)
  shared/      schematy Zod, formaty wiadomości MQTT, typy zdarzeń
  db/          migracje, schemat Drizzle i repozytoria (implementacje portów z core)
docs/          dokumentacja
infra/         Docker Compose, konfiguracja Mosquitto, OSRM, Caddy
```
