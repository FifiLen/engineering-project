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
| Telemetria | Odbiór MQTT partiami, punkty tras, stan bieżący i przebieg ([ADR 0033](../adr/0033-telemetria-i-status-floty.md)); po zapisie partii przekazuje odczyty przejazdów modułowi Strefy | `telemetry` |
| Strefy | Geometrie stref i edytor w panelu z regułami geometrii w bazie ([ADR 0047](../adr/0047-edytor-geometrii-w-panelu.md)), bieżące strefy hulajnóg w przejeździe z histerezą ([ADR 0043](../adr/0043-wykrywanie-zmian-stref.md)), stan sterowania hulajnogą ([ADR 0044](../adr/0044-komendy-stref-dla-hulajnogi.md)), zdarzenie `zones.changed` | `zones`, `scooter_zone_presence`, `scooter_zone_control` |
| Mapy (Geo) | Trasy dla klienta z OSRM (rower, pieszo) z linią prostą jako zapasem ([ADR 0048](../adr/0048-trasy-dla-klienta-z-osrm.md)), wyszukiwanie miejsc przez Photon z pamięcią podręczną i limitem ([ADR 0045](../adr/0045-wyszukiwanie-miejsc-photon.md)) | brak (usługi zewnętrzne za adapterami) |
| Wypożyczenia | Mapa wolnych hulajnóg, rezerwacja z wygaszaniem, przejazd z komendami i potwierdzeniami, zdarzenia stref na osi czasu i komendy stref (limit, zatrzymanie) od iteracji 4, wycena, zdalne zakończenie, historia i profil klienta, usunięcie konta (pokoje `user:{id}` i `rentals`, [ADR 0036](../adr/0036-proces-wypozyczenia-w-api.md)); od iteracji 5 reguła płatności przy rezerwacji i starcie, rozliczenie w transakcji `ENDED` przez moduł Płatności i przejścia `UNPAID` z jego wyniku ([ADR 0049](../adr/0049-rozliczenie-przejazdu.md)) | `rentals`, `rental_events` (komendy przejazdu w `scooter_commands` przez moduł Flota) |
| Zadania w tle | Kolejka pg-boss w schemacie `pgboss`: wygaśnięcie rezerwacji, limit potwierdzenia komend, partycje i retencja telemetrii, czyszczenie kodów i sesji ([ADR 0037](../adr/0037-pg-boss-konfiguracja-i-zadania.md)); od iteracji 5 obciążenie karty za przejazd, ponowienie po 24 h, przetwarzanie webhooków i sprawdzanie statusu płatności | schemat `pgboss` |
| Płatności | Port `PaymentProvider` ze Stripe w trybie testowym i atrapą w procesie ([ADR 0050](../adr/0050-integracja-stripe.md)), karty (SetupIntent), doładowanie kartą i BLIK-iem, rozliczenie przejazdu z portfela albo kartą ([ADR 0049](../adr/0049-rozliczenie-przejazdu.md)), webhook z weryfikacją podpisu na surowej treści i sprawdzanie statusu, paragony z VAT i korektą ([ADR 0052](../adr/0052-paragony.md)), wersje cennika ([ADR 0053](../adr/0053-wersje-cennika-w-panelu.md)), zwroty, korekty i zwrot salda ([ADR 0054](../adr/0054-zwroty-i-korekty-salda.md)), zdarzenie `wallet.updated` | `tariffs`, `wallets`, `wallet_ledger`, `payments`, `payment_methods`, `payment_customers`, `payment_webhook_events`, `refunds`, `receipts`, `receipt_items` |
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
