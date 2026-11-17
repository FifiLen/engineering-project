-- 0005: wypożyczenie (iteracja 3): komendy przejazdu z wygaśnięciem, zdarzenia osi czasu, widoki przejazdów
-- w panelu i w aplikacji, portfel przy rejestracji, preferencje powiadomień, czyszczenie sesji (ADR 0036–0038, 0042).
-- Przejścia stanów i wycena są w packages/core; baza pilnuje spójności i daje modele odczytu.

-- Nowe wartości typu można użyć dopiero po zatwierdzeniu tej transakcji, dlatego widoki niżej porównują
-- `type::text`, a procedury (plpgsql) odwołują się do nich dopiero przy wykonaniu.
ALTER TYPE rental_event_type ADD VALUE 'END_REQUESTED';      -- początek ENDING, koniec naliczania (ADR 0042)
ALTER TYPE rental_event_type ADD VALUE 'PAUSE_FAILED';       -- lock pauzy bez potwierdzenia, przejazd zostaje ACTIVE
ALTER TYPE rental_event_type ADD VALUE 'RESUME_FAILED';      -- unlock wznowienia bez potwierdzenia, zostaje PAUSED
ALTER TYPE rental_event_type ADD VALUE 'LOCK_FAILED';        -- lock zakończenia bez potwierdzenia, powrót z ENDING
ALTER TYPE rental_event_type ADD VALUE 'ENDED_REMOTELY';     -- zakończenie przez operatora (D7), koniec naliczania
ALTER TYPE rental_event_type ADD VALUE 'LATE_UNLOCK_LOCKED'; -- spóźnione odblokowanie zablokowane kompensacyjnie (ADR 0038)

-- =====================================================================
-- Komendy: termin ważności (kontrakt MQTT 1.1.0), powód odmowy, jedna komenda w toku na przejazd
-- =====================================================================

ALTER TABLE scooter_commands ADD COLUMN expires_at timestamptz,
                             ADD COLUMN ack_reason text;
ALTER TABLE scooter_commands ADD CONSTRAINT scooter_commands_expiry_after_sent
    CHECK (expires_at IS NULL OR expires_at > sent_at);
-- Pauza w trakcie kończenia albo podwójne „Wznów” trafiają na ten indeks (RENTAL_COMMAND_PENDING, ADR 0036).
CREATE UNIQUE INDEX scooter_commands_one_pending_per_rental ON scooter_commands (rental_id)
    WHERE status = 'SENT' AND rental_id IS NOT NULL;
CREATE INDEX scooter_commands_rental_idx ON scooter_commands (rental_id, sent_at) WHERE rental_id IS NOT NULL;

-- =====================================================================
-- Przejazdy: indeksy list w panelu i wygaszania rezerwacji
-- =====================================================================

CREATE INDEX rentals_state_created_idx ON rentals (state, created_at DESC);
CREATE INDEX rentals_created_idx ON rentals (created_at DESC);
CREATE INDEX rentals_reservation_due_idx ON rentals (reservation_expires_at) WHERE state = 'RESERVED';
ALTER TABLE rentals ADD CONSTRAINT rentals_reservation_has_expiry
    CHECK (state <> 'RESERVED' OR (reserved_at IS NOT NULL AND reservation_expires_at IS NOT NULL));
ALTER TABLE rentals ADD CONSTRAINT rentals_amount_not_negative CHECK (total_amount IS NULL OR total_amount >= 0);

-- =====================================================================
-- Klienci: portfel od rejestracji, preferencje powiadomień z ekranu ustawień
-- =====================================================================

-- Profil i reguła minimalnego salda (iteracja 5) zakładają portfel; tworzy go baza przy każdym nowym kliencie.
CREATE FUNCTION trg_user_wallet() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO wallets (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END
$$;
CREATE TRIGGER users_wallet AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION trg_user_wallet();
-- Klienci sprzed migracji: portfel z saldem 0, bez wpisu w księdze (saldo to suma księgi).
INSERT INTO wallets (user_id) SELECT id FROM users ON CONFLICT (user_id) DO NOTHING;

-- Przełącznik „Promocje” to zgoda MARKETING w consents, więc nie ma tu kolumny.
ALTER TABLE users ADD COLUMN notify_reservation_end boolean NOT NULL DEFAULT true,
                  ADD COLUMN notify_receipts        boolean NOT NULL DEFAULT true;

-- Usunięcie konta: dodatkowo saldo różne od 0 (pytanie 7 w planie iteracji 3); core sprawdza to wcześniej.
CREATE OR REPLACE PROCEDURE sp_anonymize_user(p_user_id uuid)
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM users WHERE id = p_user_id AND status <> 'DELETED' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF EXISTS (SELECT 1 FROM rentals WHERE user_id = p_user_id
               AND state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING')) THEN
        RAISE EXCEPTION 'USER_HAS_OPEN_RENTAL' USING ERRCODE = 'raise_exception';
    END IF;
    IF fn_wallet_balance(p_user_id) <> 0 THEN
        RAISE EXCEPTION 'WALLET_BALANCE_NOT_ZERO' USING ERRCODE = 'raise_exception';
    END IF;

    UPDATE users SET phone = NULL, email = NULL, name = NULL, status = 'DELETED',
                     deleted_at = now(), updated_at = now(), version = version + 1
    WHERE id = p_user_id;
    UPDATE sessions SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
    UPDATE payment_methods SET removed_at = now(), is_default = false
    WHERE user_id = p_user_id AND removed_at IS NULL;
    DELETE FROM push_tokens WHERE user_id = p_user_id;
    DELETE FROM saved_places WHERE user_id = p_user_id;
END
$$;

-- =====================================================================
-- Funkcje
-- =====================================================================

-- Trasa przejazdu z punktów telemetrii (zapisywana w rentals.route przy zakończeniu); NULL przy mniej niż 2 punktach.
CREATE FUNCTION fn_rental_route(p_rental_id uuid) RETURNS geometry
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN count(*) >= 2 THEN ST_MakeLine(position ORDER BY recorded_at) END
    FROM telemetry WHERE rental_id = p_rental_id
$$;

-- =====================================================================
-- Widoki: przejazdy w panelu, oś czasu, historia i statystyki klienta
-- =====================================================================

-- Kolumny dopisane na końcu (CREATE OR REPLACE VIEW nie zmienia istniejących).
-- has_problem: nieudane odblokowanie albo otwarty przejazd z hulajnogą offline lub z niepotwierdzoną komendą
-- po ostatniej zmianie stanu. elapsed_seconds: od potwierdzonego odblokowania do końca albo do teraz.
CREATE OR REPLACE VIEW v_rental_details AS
SELECT r.id, r.number, r.state, r.payment_source, r.reserved_at, r.reservation_expires_at,
       r.started_at, r.ended_at, r.ride_seconds, r.pause_seconds, r.distance_m, r.total_amount,
       r.user_id, u.phone AS user_phone, u.name AS user_name,
       r.scooter_id, s.number AS scooter_number,
       r.tariff_id, t.version AS tariff_version,
       r.end_zone_id, ez.code AS end_zone_code, ez.name AS end_zone_name,
       r.parking_photo_id IS NOT NULL AS has_parking_photo,
       p.status AS card_payment_status,
       l.amount AS wallet_charge,
       r.created_at, r.updated_at,
       s.online AS scooter_online,
       s.battery_pct AS scooter_battery_pct,
       CASE WHEN r.started_at IS NULL THEN 0
            ELSE floor(extract(epoch FROM COALESCE(r.ended_at, now()) - r.started_at))::integer END AS elapsed_seconds,
       (r.state = 'UNLOCK_FAILED'
        OR (r.state IN ('UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING')
            AND (NOT s.online OR EXISTS (
                SELECT 1 FROM rental_events fe
                WHERE fe.rental_id = r.id
                  AND fe.type::text IN ('PAUSE_FAILED', 'RESUME_FAILED', 'LOCK_FAILED')
                  AND fe.created_at >= COALESCE((SELECT max(se.created_at) FROM rental_events se
                                                WHERE se.rental_id = r.id AND se.type = 'STATE_CHANGED'
                                                  AND se.to_state <> 'ENDING'), '-infinity'))))) AS has_problem,
       u.status AS user_status,
       (SELECT c.type FROM scooter_commands c
        WHERE c.rental_id = r.id AND c.status = 'SENT') AS pending_command
FROM rentals r
JOIN users u ON u.id = r.user_id
JOIN scooters s ON s.id = r.scooter_id
JOIN tariffs t ON t.id = r.tariff_id
LEFT JOIN zones ez ON ez.id = r.end_zone_id
LEFT JOIN LATERAL (
    SELECT pay.status FROM payments pay
    WHERE pay.rental_id = r.id AND pay.purpose = 'RIDE'
    ORDER BY pay.created_at DESC LIMIT 1
) p ON true
LEFT JOIN wallet_ledger l ON l.rental_id = r.id AND l.type = 'RIDE_CHARGE';

-- Oś czasu przejazdu: zdarzenia i komendy w jednej kolejności (panel i szczegóły w aplikacji).
-- Wpisy z jednej transakcji mają ten sam czas; kolejność zapisu zdarzeń wyznacza event_id.
CREATE VIEW v_rental_timeline AS
SELECT e.rental_id, e.created_at AS at, 'EVENT'::text AS kind, e.id AS event_id, e.type::text AS type,
       e.from_state, e.to_state, e.data, z.code AS zone_code,
       NULL::uuid AS command_id, NULL::command_status AS command_status,
       NULL::timestamptz AS acked_at, NULL::text AS ack_reason
FROM rental_events e
LEFT JOIN zones z ON z.id = e.zone_id
UNION ALL
SELECT c.rental_id, c.sent_at, 'COMMAND', NULL, c.type::text,
       NULL, NULL, c.payload, NULL,
       c.id, c.status, c.acked_at, c.ack_reason
FROM scooter_commands c
WHERE c.rental_id IS NOT NULL;

-- Historia przejazdów klienta w aplikacji: tylko przejazdy, które się odbyły.
CREATE VIEW v_user_rental_history AS
SELECT r.id, r.user_id, r.number, s.number AS scooter_number, s.variant AS scooter_variant,
       r.started_at, r.ended_at, r.ride_seconds, r.pause_seconds, r.distance_m, r.total_amount,
       ez.code AS end_zone_code, ez.name AS end_zone_name, t.version AS tariff_version
FROM rentals r
JOIN scooters s ON s.id = r.scooter_id
JOIN tariffs t ON t.id = r.tariff_id
LEFT JOIN zones ez ON ez.id = r.end_zone_id
WHERE r.state IN ('ENDED', 'UNPAID');

-- Statystyki profilu: liczba przejazdów, dystans i czas w drodze (jazda i pauza).
CREATE VIEW v_user_ride_stats AS
SELECT u.id AS user_id,
       count(r.id)::integer AS rides_count,
       COALESCE(sum(r.distance_m), 0)::bigint AS distance_m,
       COALESCE(sum(r.ride_seconds + r.pause_seconds), 0)::bigint AS travel_seconds
FROM users u
LEFT JOIN rentals r ON r.user_id = u.id AND r.state IN ('ENDED', 'UNPAID')
GROUP BY u.id;

-- =====================================================================
-- Procedury: czyszczenie danych technicznych (zadanie auth.purge, ADR 0037)
-- =====================================================================

-- Usuwa rodziny sesji (klientów i operatorów), w których wszystkie tokeny wygasły albo zostały unieważnione
-- dawniej niż p_keep_days dni temu, oraz nieprzyjęte zaproszenia wygasłe dawniej niż p_keep_days dni temu.
-- Cała rodzina znika jednym poleceniem, więc odwołania replaced_by wewnątrz rodziny nie blokują usunięcia.
CREATE PROCEDURE sp_purge_expired_sessions(p_keep_days integer, OUT deleted_count integer)
LANGUAGE plpgsql AS $$
DECLARE
    cutoff timestamptz := now() - make_interval(days => p_keep_days);
    n      integer;
BEGIN
    DELETE FROM sessions WHERE family_id IN (
        SELECT family_id FROM sessions GROUP BY family_id
        HAVING max(LEAST(expires_at, COALESCE(revoked_at, expires_at))) < cutoff
    );
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    DELETE FROM staff_sessions WHERE family_id IN (
        SELECT family_id FROM staff_sessions GROUP BY family_id
        HAVING max(LEAST(expires_at, COALESCE(revoked_at, expires_at))) < cutoff
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_count := deleted_count + n;
    DELETE FROM staff_invitations WHERE accepted_at IS NULL AND expires_at < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_count := deleted_count + n;
END
$$;
