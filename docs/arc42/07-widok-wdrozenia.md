# 7. Widok wdrożenia

## 7.1. Środowisko deweloperskie

Docker Compose uruchamia: PostgreSQL z PostGIS, Mosquitto, SeaweedFS (magazyn zgodny z S3), OSRM (wycinek województwa śląskiego z Geofabrik). Backend, aplikacja webowa i symulator działają lokalnie w trybie deweloperskim. Aplikacja mobilna działa w Expo na telefonie lub emulatorze.

SMS-y w tym środowisku nie są wysyłane, kod trafia do logów backendu.

## 7.2. Środowisko demonstracyjne

```mermaid
flowchart TB
    subgraph VPS["Serwer VPS (Docker Compose)"]
        C["Caddy<br/>HTTPS"]
        API["Backend API"]
        WEB["Next.js"]
        SIM["Symulator"]
        DB[("PostgreSQL + PostGIS")]
        MQ["Mosquitto"]
        FS[("SeaweedFS (S3)")]
        OSRM["OSRM"]
    end
    Internet --> C
    C --> API
    C --> WEB
    API --> DB
    API --> MQ
    SIM --> MQ
    API --> FS
    API --> OSRM
    SIM --> OSRM
```

## 7.3. Ciągła integracja

GitHub Actions dla każdej zmiany: lint, sprawdzenie typów, testy jednostkowe i integracyjne (Testcontainers), budowanie obrazów. Wdrożenie na VPS ręcznie lub po oznaczeniu wersji.
