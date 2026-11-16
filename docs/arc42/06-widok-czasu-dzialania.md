# 6. Widok czasu działania

Najważniejsze scenariusze. Pełne wersje graficzne znajdują się na kanwie projektu („Przepływy techniczne”).

## 6.1. Maszyna stanów przejazdu

```mermaid
stateDiagram-v2
    [*] --> RESERVED: POST /reservations
    [*] --> UNLOCKING: POST /rentals
    RESERVED --> UNLOCKING: POST /rentals
    RESERVED --> EXPIRED: limit czasu lub anulowanie
    UNLOCKING --> ACTIVE: ack unlock
    UNLOCKING --> UNLOCK_FAILED: brak ack w 10 s
    ACTIVE --> PAUSED: POST /pause, ack lock
    PAUSED --> ACTIVE: POST /resume, ack unlock
    ACTIVE --> ENDING: POST /end w strefie parkowania
    PAUSED --> ENDING: POST /end w strefie parkowania
    ENDING --> ENDED: ack lock i płatność
    ENDING --> UNPAID: odmowa płatności
    UNPAID --> ENDED: spłata zaległości
    ENDED --> [*]
    EXPIRED --> [*]
    UNLOCK_FAILED --> [*]
```

## 6.2. Rozpoczęcie przejazdu

```mermaid
sequenceDiagram
    autonumber
    participant A as Aplikacja
    participant API as Backend API
    participant DB as PostgreSQL
    participant MQ as Broker MQTT
    participant H as Hulajnoga
    A->>API: POST /rentals (scooterId)
    API->>DB: BEGIN, SELECT scooter FOR UPDATE
    DB-->>API: AVAILABLE, bateria 87%
    API->>DB: INSERT rental UNLOCKING, COMMIT
    API-->>A: 202 (rentalId, UNLOCKING)
    API->>MQ: scooters/0142/cmd unlock (commandId)
    MQ->>H: komenda
    H->>MQ: scooters/0142/ack (commandId, ok)
    MQ->>API: potwierdzenie
    API->>DB: rental ACTIVE, startedAt
    API-->>A: Socket.IO rental.updated ACTIVE
    Note over API: Brak potwierdzenia w 10 s: UNLOCK_FAILED, bez opłaty
```

## 6.3. Telemetria i strefy w trakcie jazdy

Odczyty są zbierane w oknie (domyślnie 1 s), oceniane regułami z `packages/core` i zapisywane jedną transakcją ([ADR 0033](../adr/0033-telemetria-i-status-floty.md)). Wykrywanie stref i komenda limitu prędkości powstają w iteracji 4.

```mermaid
sequenceDiagram
    autonumber
    participant H as Hulajnoga
    participant MQ as Broker MQTT
    participant API as Backend API
    participant DB as PostGIS
    participant P as Panel
    participant A as Aplikacja
    H->>MQ: telemetry (lat, lon, bat, v) co 5 s
    MQ->>API: scooters/+/telemetry
    Note over API: okno 1 s, evaluateTelemetry (core)
    API->>DB: punkty trasy (ON CONFLICT DO NOTHING), stan bieżący, przebieg
    API-->>P: fleet.updates (paczka zmian, pokój fleet)
    API->>DB: ST_Contains(zone.geom, punkt)
    DB-->>API: strefa SLOW
    API->>MQ: cmd speed_limit
    MQ->>H: komenda
    API-->>A: zone_entered SLOW, czas, dystans, koszt
```

## 6.4. Zakończenie i rozliczenie

```mermaid
sequenceDiagram
    autonumber
    participant A as Aplikacja
    participant API as Backend API
    participant DB as PostGIS
    participant FS as SeaweedFS (S3)
    participant MQ as Broker MQTT
    A->>API: POST /rentals/ID/end
    API->>DB: czy pozycja jest w strefie parkowania
    alt poza strefą
        API-->>A: 409 OUTSIDE_PARKING, najbliższa strefa
    else w strefie
        API-->>A: 200 ENDING, uploadUrl
        A->>FS: PUT zdjęcie
        A->>API: POST /rentals/ID/photo
        API->>MQ: cmd lock
        MQ-->>API: ack
        API->>DB: obciążenie portfela, rental ENDED
        API-->>A: rental.ended, paragon
    end
```

## 6.5. Doładowanie portfela

```mermaid
sequenceDiagram
    autonumber
    participant A as Aplikacja
    participant API as Backend API
    participant DB as PostgreSQL
    participant S as Stripe
    A->>API: POST /wallet/topups (kwota, metoda)
    API->>DB: payment PENDING
    API->>S: utworzenie płatności (idempotencyKey)
    API-->>A: 202 PENDING
    S->>API: webhook payment.succeeded (podpisany)
    API->>DB: payment SUCCEEDED, wpis w księdze
    API-->>A: wallet.updated
```

## 6.6. Utrata łączności z hulajnogą

```mermaid
sequenceDiagram
    autonumber
    participant H as Hulajnoga
    participant MQ as Broker MQTT
    participant API as Backend API
    participant A as Aplikacja
    H->>MQ: CONNECT z Last Will (status offline)
    Note over H,MQ: utrata zasięgu, brak keep-alive
    MQ->>API: scooters/0087/status offline
    API-->>A: connection_lost
    H->>MQ: CONNECT, status online
    H->>MQ: zbuforowane punkty trasy
    MQ->>API: telemetria
    API-->>A: connection_restored
```

## 6.7. Logowanie

```mermaid
sequenceDiagram
    autonumber
    participant A as Aplikacja
    participant API as Backend API
    participant DB as PostgreSQL
    participant SMS as Dostawca SMS
    A->>API: POST /auth/otp (phone)
    API->>DB: hash kodu, ważność 5 min
    API->>SMS: wysyłka kodu
    A->>API: POST /auth/otp/verify (phone, code)
    API->>DB: weryfikacja, utworzenie konta jeśli nowe
    API-->>A: access token 15 min, refresh token 30 dni
```

## 6.8. Komenda z panelu

Operator wysyła komendę z karty hulajnogi na mapie floty (iteracja 1). Odblokowanie poza przejazdem jest dozwolone tylko w serwisie (reguła w `packages/core`).

```mermaid
sequenceDiagram
    autonumber
    participant P as Panel
    participant API as Backend API
    participant DB as PostgreSQL
    participant MQ as Broker MQTT
    participant H as Hulajnoga
    P->>API: POST /admin/scooters/ID/commands {type: RING}
    API->>DB: ensurePanelCommandAllowed (core), scooter_commands SENT
    API->>MQ: scooters/0142/cmd {commandId, cmd: ring}
    API-->>P: 202, fleet.command SENT
    MQ->>H: komenda
    H->>MQ: ack {commandId, ok: true}
    MQ->>API: scooters/+/ack
    API->>DB: SENT → ACKED (tylko z SENT)
    API-->>P: fleet.command ACKED
    Note over API,DB: brak potwierdzenia w 10 s: SENT → TIMEOUT
```
