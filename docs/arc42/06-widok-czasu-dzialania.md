# 6. Widok czasu działania

Najważniejsze scenariusze. Pełne wersje graficzne znajdują się na kanwie projektu („Przepływy techniczne”).

## 6.1. Maszyna stanów przejazdu

Przejścia decyduje maszyna stanów w `packages/core`; każde przejście to jedna transakcja z blokadą wiersza hulajnogi i przejazdu ([ADR 0036](../adr/0036-proces-wypozyczenia-w-api.md)). Pauza i wznowienie nie mają stanu przejściowego: stan zmienia się dopiero po potwierdzeniu komendy, a na czas oczekiwania przejazd ma komendę w toku (najwyżej jedną, indeks `scooter_commands_one_pending_per_rental`). Stan `UNPAID` i obciążenie portfela wchodzą w iteracji 5.

```mermaid
stateDiagram-v2
    [*] --> RESERVED: POST /reservations
    [*] --> UNLOCKING: POST /rentals
    RESERVED --> UNLOCKING: POST /rentals
    RESERVED --> EXPIRED: zadanie pg-boss po free_reservation_minutes albo DELETE /reservations/current
    UNLOCKING --> ACTIVE: ack unlock
    UNLOCKING --> UNLOCK_FAILED: odmowa albo brak ack w 10 s
    ACTIVE --> PAUSED: POST /pause, ack lock
    PAUSED --> ACTIVE: POST /resume, ack unlock
    ACTIVE --> ENDING: POST /end w strefie parkowania
    PAUSED --> ENDING: POST /end w strefie parkowania
    ENDING --> ENDED: ack lock (kwota z wyceny, ADR 0042)
    ENDING --> ACTIVE: brak ack lock (LOCK_FAILED)
    ENDING --> PAUSED: brak ack lock przy kończeniu z pauzy
    ACTIVE --> ENDED: zdalne zakończenie (operator)
    PAUSED --> ENDED: zdalne zakończenie (operator)
    ENDING --> ENDED: zdalne zakończenie (operator)
    ENDING --> UNPAID: odmowa płatności (iteracja 5)
    UNPAID --> ENDED: spłata zaległości (iteracja 5)
    ENDED --> [*]
    EXPIRED --> [*]
    UNLOCK_FAILED --> [*]
```

Nieudana pauza i nieudane wznowienie nie zmieniają stanu: zdarzenia `PAUSE_FAILED` i `RESUME_FAILED` są komunikatem dla klienta. Spóźnione potwierdzenie odblokowania, na które nikt nie czeka, uruchamia kompensacyjne `lock` ([ADR 0038](../adr/0038-wygasanie-komend-mqtt.md)).

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
    API->>DB: INSERT rental UNLOCKING, komenda, zadanie pg-boss limitu, COMMIT
    API-->>A: 202 (rentalId, UNLOCKING)
    API->>MQ: scooters/0142/cmd unlock (commandId, expiresAt)
    MQ->>H: komenda
    H->>MQ: scooters/0142/ack (commandId, ok)
    MQ->>API: potwierdzenie
    API->>DB: rental ACTIVE, startedAt
    API-->>A: Socket.IO rental.updated ACTIVE (pokój user:ID)
    Note over API: Brak potwierdzenia w 10 s (zadanie pg-boss): UNLOCK_FAILED, bez opłaty; hulajnoga odrzuci komendę po expiresAt
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

Od iteracji 3 zakończenie liczy kwotę z wersji cennika przejazdu (każda rozpoczęta minuta jazdy i pauzy, koniec naliczania przy żądaniu zakończenia, [ADR 0042](../adr/0042-wycena-przejazdu.md)), ale nie obciąża portfela: obciążenie, paragon i stan `UNPAID` dochodzą w iteracji 5. Zdjęcie parkowania przeszło do iteracji 6 (decyzja D2), więc w diagramie go nie ma.

```mermaid
sequenceDiagram
    autonumber
    participant A as Aplikacja
    participant API as Backend API
    participant DB as PostGIS
    participant MQ as Broker MQTT
    A->>API: POST /rentals/current/end
    API->>DB: blokada hulajnogi i przejazdu, strefy w pozycji hulajnogi
    alt poza strefą
        API-->>A: 422 OUTSIDE_PARKING, najbliższa strefa
    else w strefie
        API->>DB: END_REQUESTED, ENDING, komenda lock, zadanie limitu, COMMIT
        API-->>A: 202 ENDING
        API->>MQ: cmd lock (expiresAt)
        alt ack lock
            MQ-->>API: ack
            API->>DB: ENDED: liczniki z osi czasu, kwota, dystans i trasa z telemetrii
            API-->>A: rental.updated ENDED (podsumowanie)
        else brak ack w 10 s
            API->>DB: LOCK_FAILED, powrót do ACTIVE albo PAUSED
            API-->>A: rental.updated z komunikatem, naliczanie trwa
        end
    end
```

Zdalne zakończenie przez operatora z uprawnieniem `rentals.manage` (decyzja D7) nie sprawdza strefy i nie czeka na blokadę: przejazd od razu przechodzi do `ENDED`, naliczanie kończy się w tej chwili (albo przy wcześniejszym żądaniu klienta), komenda `lock` idzie do hulajnogi, a powód trafia na oś czasu i do dziennika audytu w tej samej transakcji.

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

Klient (iteracja 2, [ADR 0019](../adr/0019-uwierzytelnianie.md), [ADR 0035](../adr/0035-sesje-tokeny-i-straznik-uprawnien.md)): kod SMS, sesja z rotacją tokenu odświeżającego, następny ekran z `/me`.

```mermaid
sequenceDiagram
    autonumber
    participant A as Aplikacja
    participant API as Backend API
    participant C as packages/core
    participant DB as PostgreSQL
    participant SMS as Bramka SMS
    A->>API: POST /auth/otp (numer)
    API->>C: normalizePhone, ensureCanIssueOtp (60 s, 5/h)
    API->>DB: skrót HMAC kodu, ważność 5 min
    API->>SMS: kod (w środowisku deweloperskim log API)
    A->>API: POST /auth/otp/verify (numer, kod)
    API->>C: assessOtpAttempt (5 prób)
    API->>DB: zużycie kodu, konto przy pierwszym logowaniu, sesja (skrót tokenu)
    API-->>A: token dostępowy 15 min, odświeżający 30 dni, me.nextStep
    A->>A: token odświeżający w expo-secure-store
    alt nextStep = PROFILE
        A->>API: POST /me/registration (imię, wiek, wersje dokumentów)
    else nextStep = CONSENTS
        A->>API: POST /me/consents (nowe wersje dokumentów)
    end
    Note over A,API: 401 → POST /auth/refresh: nowy token w tej samej rodzinie;<br/>ponowne użycie zastąpionego tokenu unieważnia rodzinę
```

Operator panelu: hasło, drugi krok z kodem TOTP (albo jego konfiguracja), token odświeżający w ciasteczku `httpOnly`.

```mermaid
sequenceDiagram
    autonumber
    participant P as Panel
    participant API as Backend API
    participant C as packages/core
    participant DB as PostgreSQL
    P->>API: POST /admin/auth/login (e-mail, hasło, zapamiętaj)
    API->>DB: konto operatora
    API->>C: ensureStaffCanAttemptLogin, argon2, registerFailedLogin
    API-->>P: mfaToken (5 min), krok TOTP albo TOTP_SETUP z kluczem i adresem otpauth
    P->>API: POST /admin/auth/totp (mfaToken, kod)
    API->>C: totpCandidateSteps ±1, ensureTotpStepUnused
    API->>DB: potwierdzenie TOTP, sesja, wpis staff.signed_in w audit_log
    API-->>P: token dostępowy 15 min + Set-Cookie hj_staff_refresh (12 h albo 7 dni)
    P->>API: żądania z Authorization: Bearer
    API->>DB: uprawnienia z v_staff_permissions (pamięć 10 s)
    Note over P,API: Socket.IO: token w auth.token, pokój fleet wymaga scooters.read
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
