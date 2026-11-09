-- System wypożyczania hulajnóg elektrycznych
-- Schemat bazy danych, wersja 1 (PostgreSQL 16 + PostGIS 3)
--
-- Konwencje:
--   * identyfikatory: uuid (generowane w bazie przez gen_random_uuid())
--   * kwoty: liczby całkowite w groszach (bigint), nigdy float
--   * czas: timestamptz, zapisywany w UTC
--   * geometria: WGS 84 (SRID 4326), pozycje jako Point, strefy jako MultiPolygon

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================================
-- Typy wyliczeniowe
-- =====================================================================

CREATE TYPE user_status        AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');
CREATE TYPE consent_type       AS ENUM ('TERMS', 'PRIVACY', 'MARKETING', 'AGE');
CREATE TYPE staff_role         AS ENUM ('ADMIN', 'DISPATCHER', 'SERVICE');
CREATE TYPE platform           AS ENUM ('IOS', 'ANDROID');
CREATE TYPE place_label        AS ENUM ('HOME', 'WORK', 'CUSTOM');

CREATE TYPE scooter_variant    AS ENUM ('GRAFIT', 'BETON', 'KOBALT');
CREATE TYPE scooter_status     AS ENUM ('AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'RETIRED');
CREATE TYPE command_type       AS ENUM ('UNLOCK', 'LOCK', 'SPEED_LIMIT', 'STOP_GRADUALLY', 'RING', 'LIGHTS');
CREATE TYPE command_status     AS ENUM ('SENT', 'ACKED', 'REJECTED', 'TIMEOUT');

CREATE TYPE zone_type          AS ENUM ('SERVICE_AREA', 'PARKING', 'SLOW', 'NO_RIDE');

CREATE TYPE rental_state       AS ENUM ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING',
                                        'ENDED', 'EXPIRED', 'UNLOCK_FAILED', 'UNPAID');
CREATE TYPE rental_event_type  AS ENUM ('STATE_CHANGED', 'ZONE_ENTERED', 'ZONE_EXITED', 'BATTERY_LOW',
                                        'CONNECTION_LOST', 'CONNECTION_RESTORED', 'PHOTO_UPLOADED');
CREATE TYPE payment_source     AS ENUM ('WALLET', 'CARD');

CREATE TYPE ledger_entry_type  AS ENUM ('TOPUP', 'RIDE_CHARGE', 'REFUND', 'ADJUSTMENT');
CREATE TYPE payment_purpose    AS ENUM ('TOPUP', 'RIDE');
CREATE TYPE payment_method_kind AS ENUM ('CARD', 'BLIK');
CREATE TYPE payment_status     AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

CREATE TYPE ticket_source      AS ENUM ('USER', 'AUTO', 'STAFF');
CREATE TYPE ticket_status      AS ENUM ('NEW', 'IN_PROGRESS', 'AT_SERVICE', 'RESOLVED');
CREATE TYPE ticket_category    AS ENUM ('BRAKES', 'LIGHTS', 'WHEEL', 'HANDLEBAR', 'QR_CODE', 'BATTERY', 'CONNECTION', 'OTHER');
CREATE TYPE file_purpose       AS ENUM ('PARKING_PHOTO', 'TICKET_PHOTO');

-- =====================================================================
-- Konta
-- =====================================================================

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           text UNIQUE,                    -- E.164, NULL po usunięciu konta
    email           text UNIQUE,
    name            text,
    status          user_status NOT NULL DEFAULT 'ACTIVE',
    created_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CHECK (status <> 'DELETED' OR (phone IS NULL AND email IS NULL))
);

CREATE TABLE consents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    type            consent_type NOT NULL,
    document_version text NOT NULL,                 -- np. wersja regulaminu
    accepted_at     timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz
);
CREATE INDEX consents_user_idx ON consents (user_id, type);

CREATE TABLE otp_codes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           text NOT NULL,
    code_hash       text NOT NULL,
    attempts        smallint NOT NULL DEFAULT 0,
    expires_at      timestamptz NOT NULL,
    consumed_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id),
    refresh_token_hash  text NOT NULL UNIQUE,
    device_name         text,
    expires_at          timestamptz NOT NULL,
    revoked_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE push_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    expo_token      text NOT NULL UNIQUE,
    platform        platform NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_places (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    label           place_label NOT NULL,
    name            text NOT NULL,
    position        geometry(Point, 4326) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL UNIQUE,
    name            text NOT NULL,
    role            staff_role NOT NULL,
    password_hash   text NOT NULL,
    totp_secret_enc text,                           -- zaszyfrowany sekret 2FA
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Cennik (wersjonowany; przejazd zapamiętuje wersję z chwili startu)
-- =====================================================================

CREATE TABLE tariffs (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version                     integer NOT NULL UNIQUE,
    unlock_fee                  bigint NOT NULL CHECK (unlock_fee >= 0),
    minute_rate                 bigint NOT NULL CHECK (minute_rate >= 0),
    pause_minute_rate           bigint NOT NULL CHECK (pause_minute_rate >= 0),
    out_of_zone_fee             bigint NOT NULL CHECK (out_of_zone_fee >= 0),
    free_reservation_minutes    smallint NOT NULL,
    min_wallet_balance          bigint NOT NULL,
    min_battery_pct             smallint NOT NULL CHECK (min_battery_pct BETWEEN 0 AND 100),
    min_user_age                smallint NOT NULL,
    valid_from                  timestamptz NOT NULL,
    created_by                  uuid REFERENCES staff(id),
    created_at                  timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Flota
-- =====================================================================

CREATE TABLE scooters (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number          integer NOT NULL UNIQUE,        -- numer widoczny na hulajnodze, np. 142 → #0142
    serial_number   text NOT NULL UNIQUE,
    variant         scooter_variant NOT NULL,
    status          scooter_status NOT NULL DEFAULT 'AVAILABLE',
    online          boolean NOT NULL DEFAULT false,
    battery_pct     smallint CHECK (battery_pct BETWEEN 0 AND 100),
    position        geometry(Point, 4326),
    last_seen_at    timestamptz,
    firmware        text,
    odometer_m      bigint NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scooters_position_gix ON scooters USING gist (position);
CREATE INDEX scooters_status_idx ON scooters (status);

-- Telemetria: dużo zapisów, czytana głównie po hulajnodze i czasie.
-- Partycjonowana po dniach, stare partycje można usuwać lub archiwizować.
CREATE TABLE telemetry (
    scooter_id      uuid NOT NULL REFERENCES scooters(id),
    recorded_at     timestamptz NOT NULL,
    position        geometry(Point, 4326) NOT NULL,
    battery_pct     smallint NOT NULL,
    speed_kmh       real NOT NULL,
    rental_id       uuid,
    PRIMARY KEY (scooter_id, recorded_at)
) PARTITION BY RANGE (recorded_at);
CREATE TABLE telemetry_default PARTITION OF telemetry DEFAULT;
CREATE INDEX telemetry_rental_idx ON telemetry (rental_id, recorded_at) WHERE rental_id IS NOT NULL;

-- Komendy MQTT; id jest jednocześnie commandId w wiadomości do hulajnogi.
CREATE TABLE scooter_commands (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scooter_id      uuid NOT NULL REFERENCES scooters(id),
    rental_id       uuid,
    type            command_type NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}',
    status          command_status NOT NULL DEFAULT 'SENT',
    issued_by_staff uuid REFERENCES staff(id),
    sent_at         timestamptz NOT NULL DEFAULT now(),
    acked_at        timestamptz
);
CREATE INDEX scooter_commands_scooter_idx ON scooter_commands (scooter_id, sent_at DESC);

-- =====================================================================
-- Strefy
-- =====================================================================

CREATE TABLE zones (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,           -- np. P-12
    name            text NOT NULL,
    type            zone_type NOT NULL,
    geom            geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom)),
    speed_limit_kmh smallint,
    capacity        smallint,
    visible_in_app  boolean NOT NULL DEFAULT true,
    active          boolean NOT NULL DEFAULT true,
    updated_by      uuid REFERENCES staff(id),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (type <> 'SLOW' OR speed_limit_kmh IS NOT NULL),
    CHECK (type = 'PARKING' OR capacity IS NULL)
);
CREATE INDEX zones_geom_gix ON zones USING gist (geom) WHERE active;

-- =====================================================================
-- Przejazdy (wraz z rezerwacją, zgodnie z maszyną stanów)
-- =====================================================================

CREATE SEQUENCE rental_number_seq START 50000;

CREATE TABLE rentals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number              bigint NOT NULL UNIQUE DEFAULT nextval('rental_number_seq'),   -- R-51846
    user_id             uuid NOT NULL REFERENCES users(id),
    scooter_id          uuid NOT NULL REFERENCES scooters(id),
    tariff_id           uuid NOT NULL REFERENCES tariffs(id),
    state               rental_state NOT NULL,
    payment_source      payment_source NOT NULL DEFAULT 'WALLET',
    reserved_at         timestamptz,
    reservation_expires_at timestamptz,
    started_at          timestamptz,            -- potwierdzenie odblokowania przez hulajnogę
    ended_at            timestamptz,            -- potwierdzenie zablokowania
    ride_seconds        integer NOT NULL DEFAULT 0,
    pause_seconds       integer NOT NULL DEFAULT 0,
    distance_m          integer NOT NULL DEFAULT 0,
    start_position      geometry(Point, 4326),
    end_position        geometry(Point, 4326),
    end_zone_id         uuid REFERENCES zones(id),
    route               geometry(LineString, 4326),
    parking_photo_id    uuid,
    total_amount        bigint,                 -- wyliczone przy zakończeniu
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rentals_user_idx ON rentals (user_id, created_at DESC);
CREATE INDEX rentals_scooter_idx ON rentals (scooter_id, created_at DESC);

-- Jedna hulajnoga i jeden użytkownik mogą mieć najwyżej jeden przejazd w stanie niekońcowym.
CREATE UNIQUE INDEX rentals_one_open_per_scooter ON rentals (scooter_id)
    WHERE state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING');
CREATE UNIQUE INDEX rentals_one_open_per_user ON rentals (user_id)
    WHERE state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING');

CREATE TABLE rental_events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rental_id       uuid NOT NULL REFERENCES rentals(id),
    type            rental_event_type NOT NULL,
    from_state      rental_state,
    to_state        rental_state,
    zone_id         uuid REFERENCES zones(id),
    data            jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rental_events_rental_idx ON rental_events (rental_id, created_at);

ALTER TABLE telemetry ADD CONSTRAINT telemetry_rental_fk FOREIGN KEY (rental_id) REFERENCES rentals(id);
ALTER TABLE scooter_commands ADD CONSTRAINT scooter_commands_rental_fk FOREIGN KEY (rental_id) REFERENCES rentals(id);

-- =====================================================================
-- Płatności i portfel
-- =====================================================================

CREATE TABLE wallets (
    user_id         uuid PRIMARY KEY REFERENCES users(id),
    balance         bigint NOT NULL DEFAULT 0,      -- pamięć podręczna sumy wpisów w księdze
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_methods (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    provider_ref    text NOT NULL UNIQUE,           -- token u operatora; pełnego numeru karty nie zapisujemy
    brand           text NOT NULL,
    last4           char(4) NOT NULL,
    exp_month       smallint NOT NULL,
    exp_year        smallint NOT NULL,
    is_default      boolean NOT NULL DEFAULT false,
    removed_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_methods_one_default ON payment_methods (user_id)
    WHERE is_default AND removed_at IS NULL;

CREATE TABLE payments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id),
    purpose             payment_purpose NOT NULL,
    rental_id           uuid REFERENCES rentals(id),
    method              payment_method_kind NOT NULL,
    payment_method_id   uuid REFERENCES payment_methods(id),
    amount              bigint NOT NULL CHECK (amount > 0),
    currency            char(3) NOT NULL DEFAULT 'PLN',
    status              payment_status NOT NULL DEFAULT 'PENDING',
    provider_payment_id text UNIQUE,
    idempotency_key     text NOT NULL UNIQUE,
    failure_reason      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (purpose <> 'RIDE' OR rental_id IS NOT NULL)
);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);

-- Księga portfela: tylko dopisywanie, każdy ruch środków to nowy wiersz.
CREATE TABLE wallet_ledger (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES wallets(user_id),
    type            ledger_entry_type NOT NULL,
    amount          bigint NOT NULL CHECK (amount <> 0),   -- dodatnie: wpływ, ujemne: obciążenie
    balance_after   bigint NOT NULL,
    rental_id       uuid REFERENCES rentals(id),
    payment_id      uuid REFERENCES payments(id),
    staff_id        uuid REFERENCES staff(id),
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_ledger_user_idx ON wallet_ledger (user_id, id DESC);
CREATE UNIQUE INDEX wallet_ledger_one_charge_per_rental ON wallet_ledger (rental_id)
    WHERE type = 'RIDE_CHARGE';

-- Odebrane webhooki; unikalny identyfikator zdarzenia zapewnia idempotencję.
CREATE TABLE payment_webhook_events (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider_event_id   text NOT NULL UNIQUE,
    type                text NOT NULL,
    payload             jsonb NOT NULL,
    received_at         timestamptz NOT NULL DEFAULT now(),
    processed_at        timestamptz
);

-- =====================================================================
-- Operacje: pliki, zgłoszenia, powiadomienia, audyt
-- =====================================================================

CREATE TABLE files (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key     text NOT NULL UNIQUE,
    purpose         file_purpose NOT NULL,
    content_type    text NOT NULL,
    size_bytes      integer,
    uploaded_by     uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rentals ADD CONSTRAINT rentals_photo_fk FOREIGN KEY (parking_photo_id) REFERENCES files(id);

CREATE TABLE tickets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scooter_id      uuid NOT NULL REFERENCES scooters(id),
    rental_id       uuid REFERENCES rentals(id),
    reported_by     uuid REFERENCES users(id),
    source          ticket_source NOT NULL,
    categories      ticket_category[] NOT NULL CHECK (cardinality(categories) > 0),
    description     text,
    status          ticket_status NOT NULL DEFAULT 'NEW',
    urgent          boolean NOT NULL DEFAULT false,
    assignee_id     uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz
);
CREATE INDEX tickets_status_idx ON tickets (status, created_at DESC);

CREATE TABLE ticket_photos (
    ticket_id       uuid NOT NULL REFERENCES tickets(id),
    file_id         uuid NOT NULL REFERENCES files(id),
    PRIMARY KEY (ticket_id, file_id)
);

CREATE TABLE notifications (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES users(id),
    type            text NOT NULL,                  -- np. reservation_ending, ride_ended
    payload         jsonb NOT NULL DEFAULT '{}',
    sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id        uuid NOT NULL REFERENCES staff(id),
    action          text NOT NULL,                  -- np. zone.updated, rental.ended_remotely
    entity_type     text NOT NULL,
    entity_id       uuid,
    data            jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);
