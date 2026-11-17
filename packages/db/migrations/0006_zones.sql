-- 0006: strefy (iteracja 4): reguły geometrii pilnowane przez bazę, bieżące strefy i sterowanie hulajnogi
-- w przejeździe, komendy stref obok komend przejazdu, widoki edytora stref i zajętości parkowania
-- (ADR 0043, 0044, 0047). Wykrywanie zmian i stan docelowy hulajnogi liczy packages/core.

-- Kontrakt MQTT 1.2.0 (ADR 0044): przywrócenie napędu po `stop_gradually`.
ALTER TYPE command_type ADD VALUE 'RELEASE_STOP';

-- =====================================================================
-- Komendy: jedna oczekująca komenda przejazdu dotyczy tylko blokady i odblokowania (ADR 0044)
-- =====================================================================

-- Komendy stref mają `rental_id` (oś czasu przejazdu), ale nie blokują pauzy ani zakończenia.
DROP INDEX scooter_commands_one_pending_per_rental;
CREATE UNIQUE INDEX scooter_commands_one_pending_per_rental ON scooter_commands (rental_id)
    WHERE status = 'SENT' AND rental_id IS NOT NULL AND type IN ('LOCK', 'UNLOCK');

-- Komenda w toku w widoku przejazdu to tylko LOCK albo UNLOCK; reszta jak w 0005.
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
        WHERE c.rental_id = r.id AND c.status = 'SENT' AND c.type IN ('LOCK', 'UNLOCK')) AS pending_command
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

-- =====================================================================
-- Strefy: reguły geometrii (ADR 0047, decyzja D3)
-- =====================================================================

-- Limit prędkości ma tylko strefa wolnej jazdy (0001 wymaga go dla SLOW, tu zakaz dla innych typów).
ALTER TABLE zones ADD CONSTRAINT zones_speed_limit_only_slow CHECK (type = 'SLOW' OR speed_limit_kmh IS NULL);
-- Jeden aktywny obszar działania.
CREATE UNIQUE INDEX zones_one_active_service_area ON zones (type) WHERE active AND type = 'SERVICE_AREA';

-- Strefa w obszarze działania, strefy parkowania bez części wspólnej, typ niezmienny po utworzeniu,
-- obszar działania nie może zniknąć ani odsłonić aktywnych stref. Kody błędów trafiają do API (DATABASE_RULES).
-- Inną strefę rozpoznaje też kod: przy INSERT … ON CONFLICT (code) wyzwalacz BEFORE INSERT widzi nowe id.
CREATE FUNCTION trg_zone_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    area     geometry;
    conflict text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.type <> OLD.type THEN
        RAISE EXCEPTION 'ZONE_TYPE_IMMUTABLE' USING ERRCODE = 'raise_exception';
    END IF;

    IF NEW.type = 'SERVICE_AREA' THEN
        IF TG_OP = 'UPDATE' AND OLD.active AND NOT NEW.active THEN
            RAISE EXCEPTION 'SERVICE_AREA_REQUIRED' USING ERRCODE = 'raise_exception';
        END IF;
        IF NEW.active THEN
            SELECT z.code INTO conflict FROM zones z
            WHERE z.active AND z.type <> 'SERVICE_AREA' AND z.id <> NEW.id AND z.code <> NEW.code
              AND NOT ST_CoveredBy(z.geom, NEW.geom)
            ORDER BY z.code LIMIT 1;
            IF conflict IS NOT NULL THEN
                RAISE EXCEPTION 'ZONE_OUTSIDE_SERVICE_AREA' USING ERRCODE = 'raise_exception', DETAIL = conflict;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF NOT NEW.active THEN
        RETURN NEW;
    END IF;
    SELECT z.geom INTO area FROM zones z WHERE z.active AND z.type = 'SERVICE_AREA';
    IF area IS NULL THEN
        RAISE EXCEPTION 'SERVICE_AREA_REQUIRED' USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT ST_CoveredBy(NEW.geom, area) THEN
        RAISE EXCEPTION 'ZONE_OUTSIDE_SERVICE_AREA' USING ERRCODE = 'raise_exception';
    END IF;
    IF NEW.type = 'PARKING' THEN
        SELECT z.code INTO conflict FROM zones z
        WHERE z.active AND z.type = 'PARKING' AND z.id <> NEW.id AND z.code <> NEW.code
          AND ST_Intersects(z.geom, NEW.geom) AND NOT ST_Touches(z.geom, NEW.geom)
        ORDER BY z.code LIMIT 1;
        IF conflict IS NOT NULL THEN
            RAISE EXCEPTION 'ZONE_OVERLAP' USING ERRCODE = 'raise_exception', DETAIL = conflict;
        END IF;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER zones_rules BEFORE INSERT OR UPDATE ON zones FOR EACH ROW EXECUTE FUNCTION trg_zone_rules();

-- =====================================================================
-- Bieżące strefy i sterowanie hulajnogi w przejeździe (moduł Strefy, ADR 0043 i 0044)
-- =====================================================================

-- Strefy, w których jest hulajnoga w przejeździe; wiersz znika przy wyjściu ze strefy albo z końcem przejazdu.
CREATE TABLE scooter_zone_presence (
    scooter_id    uuid NOT NULL REFERENCES scooters(id),
    zone_id       uuid NOT NULL REFERENCES zones(id),
    rental_id     uuid NOT NULL REFERENCES rentals(id),
    entered_at    timestamptz NOT NULL,                  -- czas odczytu, który dał wjazd („W strefie od”)
    outside_count smallint NOT NULL DEFAULT 0 CHECK (outside_count >= 0),
    PRIMARY KEY (scooter_id, zone_id)
);
CREATE INDEX scooter_zone_presence_zone_idx ON scooter_zone_presence (zone_id);
CREATE INDEX scooter_zone_presence_rental_idx ON scooter_zone_presence (rental_id);

-- Limit i zatrzymanie wysłane hulajnodze (stan zastosowany). Istnienie wiersza znaczy, że śledzenie stref
-- przejazdu się zaczęło; `*_synced = false` po odrzuconej albo niepotwierdzonej komendzie wymusza ponowienie.
CREATE TABLE scooter_zone_control (
    scooter_id        uuid PRIMARY KEY REFERENCES scooters(id),
    rental_id         uuid NOT NULL REFERENCES rentals(id),
    speed_limit_kmh   smallint CHECK (speed_limit_kmh > 0),
    limit_synced      boolean NOT NULL DEFAULT true,
    limit_command_id  uuid REFERENCES scooter_commands(id),
    stopped           boolean NOT NULL DEFAULT false,
    stop_synced       boolean NOT NULL DEFAULT true,
    stop_command_id   uuid REFERENCES scooter_commands(id),
    started_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX scooter_zone_control_rental_key ON scooter_zone_control (rental_id);

-- =====================================================================
-- Funkcje
-- =====================================================================

-- Aktywne strefy w promieniu od punktu z flagą „punkt w strefie” (histereza wyjazdu, ADR 0043).
CREATE FUNCTION fn_zones_near_point(p_lon double precision, p_lat double precision, p_radius_m double precision)
RETURNS TABLE (id uuid, code text, name text, type zone_type, speed_limit_kmh smallint, inside boolean)
LANGUAGE sql STABLE AS $$
    SELECT z.id, z.code, z.name, z.type, z.speed_limit_kmh,
           ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)) AS inside
    FROM zones z
    WHERE z.active
      AND ST_DWithin(z.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_radius_m)
    ORDER BY z.code
$$;

-- Najbliższa aktywna strefa parkowania: punkt na granicy najbliżej klienta (cel prowadzenia, ADR 0048)
-- i punkt wewnątrz strefy (etykieta na mapie).
CREATE FUNCTION fn_nearest_parking(p_lon double precision, p_lat double precision)
RETURNS TABLE (id uuid, code text, name text, distance_m double precision,
               target_lon double precision, target_lat double precision,
               anchor_lon double precision, anchor_lat double precision)
LANGUAGE sql STABLE AS $$
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326) AS g)
    SELECT z.id, z.code, z.name, ST_Distance(z.geom::geography, p.g::geography),
           ST_X(ST_ClosestPoint(z.geom, p.g)), ST_Y(ST_ClosestPoint(z.geom, p.g)),
           ST_X(ST_PointOnSurface(z.geom)), ST_Y(ST_PointOnSurface(z.geom))
    FROM zones z, p
    WHERE z.active AND z.type = 'PARKING'
    -- Odległość na geografii w metrach: `<->` na geometrii liczy w stopniach i myli kierunki (północ a wschód).
    ORDER BY ST_Distance(z.geom::geography, p.g::geography), z.code
    LIMIT 1
$$;

-- Przejazdy w trakcie, których dotyczy zmiana strefy: hulajnoga w strefie (stan z wykrywania) albo jej
-- ostatnia pozycja w starej lub nowej geometrii (ostrzeżenie przed zapisem w panelu, pytanie 7).
CREATE FUNCTION fn_zone_change_impact(p_zone_id uuid, p_geom geometry)
RETURNS TABLE (rental_id uuid, rental_number bigint, scooter_id uuid, scooter_number integer,
               user_name text, entered_at timestamptz, speed_kmh real)
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.number, s.id, s.number, u.name, pr.entered_at,
           (SELECT t.speed_kmh FROM telemetry t WHERE t.rental_id = r.id ORDER BY t.recorded_at DESC LIMIT 1)
    FROM rentals r
    JOIN scooters s ON s.id = r.scooter_id
    JOIN users u ON u.id = r.user_id
    LEFT JOIN scooter_zone_presence pr ON pr.rental_id = r.id AND pr.zone_id = p_zone_id
    WHERE r.state IN ('ACTIVE', 'PAUSED', 'ENDING')
      AND (pr.zone_id IS NOT NULL
           OR (s.position IS NOT NULL AND (
                 EXISTS (SELECT 1 FROM zones z WHERE z.id = p_zone_id AND ST_Contains(z.geom, s.position))
                 OR (p_geom IS NOT NULL AND ST_Contains(p_geom, s.position)))))
    ORDER BY r.number
$$;

-- Czy w punkcie wolno jeździć: w aktywnym obszarze działania i poza aktywną strefą zakazu
-- (ta sama reguła co `evaluatePosition(...).canRide` w core, tu do filtrów w zapytaniach).
CREATE FUNCTION fn_scooter_can_ride(p_position geometry) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM zones z WHERE z.active AND z.type = 'SERVICE_AREA' AND ST_Contains(z.geom, p_position))
       AND NOT EXISTS (SELECT 1 FROM zones z WHERE z.active AND z.type = 'NO_RIDE' AND ST_Contains(z.geom, p_position))
$$;

-- Wolne hulajnogi w promieniu (jak w 0002) bez stojących w strefie zakazu albo poza obszarem działania
-- (przyczyna OUT_OF_AREA, pytanie 4 w planie iteracji 4).
CREATE OR REPLACE FUNCTION fn_nearest_scooters(p_lon double precision, p_lat double precision,
                                               p_radius_m double precision, p_limit integer, p_min_battery integer)
RETURNS TABLE (id uuid, number integer, battery_pct smallint, distance_m double precision)
LANGUAGE sql STABLE AS $$
    SELECT s.id, s.number, s.battery_pct,
           ST_Distance(s.position::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography) AS distance_m
    FROM scooters s
    WHERE s.status = 'AVAILABLE' AND s.position IS NOT NULL
      AND COALESCE(s.battery_pct, 0) >= p_min_battery
      AND ST_DWithin(s.position::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_radius_m)
      AND fn_scooter_can_ride(s.position)
    ORDER BY distance_m, s.number
    LIMIT p_limit
$$;

-- =====================================================================
-- Widoki
-- =====================================================================

-- Lista stref w edytorze panelu (zasób `zones`): powierzchnia, liczba punktów, zajętość, przejazdy w strefie,
-- użycie w przejazdach (dezaktywacja zamiast usunięcia) i autor ostatniej zmiany.
CREATE VIEW v_zone_list AS
SELECT z.id, z.code, z.name, z.type, z.active, z.visible_in_app, z.speed_limit_kmh, z.capacity,
       z.version, z.updated_at, z.updated_by, st.name AS updated_by_name,
       round(ST_Area(z.geom::geography))::bigint AS area_m2,
       (ST_NPoints(z.geom) - ST_NRings(z.geom))::integer AS points,
       (SELECT count(*) FROM scooters s
        WHERE s.status <> 'RETIRED' AND s.position IS NOT NULL AND ST_Contains(z.geom, s.position))::integer AS scooters_inside,
       (SELECT count(*) FROM scooter_zone_presence pr WHERE pr.zone_id = z.id)::integer AS rides_inside,
       (EXISTS (SELECT 1 FROM rentals r WHERE r.end_zone_id = z.id)
        OR EXISTS (SELECT 1 FROM rental_events e WHERE e.zone_id = z.id)) AS used
FROM zones z
LEFT JOIN staff st ON st.id = z.updated_by;

-- Zajętość aktywnych stref parkowania: pojemność tylko informuje (pytanie 5).
CREATE VIEW v_parking_occupancy AS
SELECT z.id AS zone_id, z.code, z.name, z.capacity,
       count(s.id)::integer AS scooters_count,
       count(s.id) FILTER (WHERE s.status = 'AVAILABLE')::integer AS available_count,
       (z.capacity IS NOT NULL AND count(s.id) >= z.capacity) AS is_full
FROM zones z
LEFT JOIN scooters s ON s.status <> 'RETIRED' AND s.position IS NOT NULL AND ST_Contains(z.geom, s.position)
WHERE z.active AND z.type = 'PARKING'
GROUP BY z.id;

-- =====================================================================
-- Procedury
-- =====================================================================

-- Usunięcie strefy tylko wtedy, gdy nie była użyta w przejazdach ani zdarzeniach; inaczej dezaktywacja.
CREATE PROCEDURE sp_delete_zone(p_zone_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    zone_type zone_type;
BEGIN
    SELECT type INTO zone_type FROM zones WHERE id = p_zone_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ZONE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF zone_type = 'SERVICE_AREA' THEN
        RAISE EXCEPTION 'SERVICE_AREA_REQUIRED' USING ERRCODE = 'raise_exception';
    END IF;
    IF EXISTS (SELECT 1 FROM rentals WHERE end_zone_id = p_zone_id)
       OR EXISTS (SELECT 1 FROM rental_events WHERE zone_id = p_zone_id)
       OR EXISTS (SELECT 1 FROM scooter_zone_presence WHERE zone_id = p_zone_id) THEN
        RAISE EXCEPTION 'ZONE_IN_USE' USING ERRCODE = 'raise_exception';
    END IF;
    DELETE FROM zones WHERE id = p_zone_id;
END
$$;
