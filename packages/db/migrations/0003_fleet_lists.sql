-- 0003: listy floty i modeli w panelu (ADR 0031) oraz status floty widoczny dla operatora.
-- Ta sama reguła statusu jest w packages/core (fleet/fleet-status.ts); zgodność pilnuje test bazy.

-- Próg niskiej baterii: hulajnoga, której nie da się wypożyczyć z powodu baterii, ma niską baterię.
-- Wartość pochodzi z obowiązującej wersji cennika (ADR 0015).
CREATE FUNCTION fn_low_battery_threshold() RETURNS smallint
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT min_battery_pct FROM tariffs WHERE valid_from <= now()
                     ORDER BY valid_from DESC, version DESC LIMIT 1), 0)::smallint
$$;

-- Status floty: stan hulajnogi z bazy uzupełniony o łączność i baterię.
-- Kolejność: wycofana, serwis, offline, przejazd (rezerwacja, jazda), niska bateria, dostępna.
CREATE FUNCTION fn_fleet_status(p_status scooter_status, p_online boolean, p_battery_pct smallint,
                                p_low_battery_threshold smallint) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_status = 'RETIRED' THEN 'RETIRED'
        WHEN p_status = 'MAINTENANCE' THEN 'MAINTENANCE'
        WHEN NOT p_online THEN 'OFFLINE'
        WHEN p_status IN ('RESERVED', 'IN_USE') THEN p_status::text
        WHEN COALESCE(p_battery_pct, 0) < p_low_battery_threshold THEN 'LOW_BATTERY'
        ELSE 'AVAILABLE'
    END
$$;

-- Lista floty w panelu: v_fleet_status ze statusem floty, współrzędnymi do mapy i wersją rekordu
-- (operacje grupowe z blokadą optymistyczną, ADR 0031).
CREATE VIEW v_fleet_list AS
SELECT f.*,
       fn_fleet_status(f.status, f.online, f.battery_pct, t.threshold) AS fleet_status,
       ST_Y(f.position) AS lat,
       ST_X(f.position) AS lon,
       m.range_km AS model_range_km,
       s.version
FROM v_fleet_status f
JOIN scooters s ON s.id = f.id
JOIN scooter_models m ON m.id = f.model_id
CROSS JOIN (SELECT fn_low_battery_threshold() AS threshold) t;

-- Modele hulajnóg z liczbą przypisanych hulajnóg (lista w panelu i reguła usuwania modelu).
CREATE VIEW v_scooter_models AS
SELECT m.id, m.code, m.name, m.manufacturer, m.max_speed_kmh, m.battery_wh, m.range_km, m.weight_kg,
       m.description, m.photo_media_id, m.active, m.created_at, m.updated_at, m.version,
       (SELECT count(*) FROM scooters s WHERE s.model_id = m.id) AS scooters_total,
       (SELECT count(*) FROM scooters s WHERE s.model_id = m.id AND s.status <> 'RETIRED') AS scooters_active
FROM scooter_models m;

-- Lista floty jest sortowana po ostatnim sygnale; komendy czytane od najnowszych dla hulajnogi już mają indeks.
CREATE INDEX scooters_last_seen_idx ON scooters (last_seen_at DESC NULLS LAST);
-- Przekroczenie czasu potwierdzenia komendy szuka tylko komend bez odpowiedzi.
CREATE INDEX scooter_commands_pending_idx ON scooter_commands (sent_at) WHERE status = 'SENT';
