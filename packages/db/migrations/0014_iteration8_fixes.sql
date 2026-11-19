-- 0014: poprawki po przeglądzie iteracji 8. Migracja 0013 jest wykonana, więc zmiany jej obiektów idą tu.
-- 1. Przyczyna przedziału historii stanów: przejazd zaczyna się przy rezerwacji albo utworzeniu (faza UNLOCKING
--    przed `started_at`), a rezerwacja wygasła i nieudane odblokowanie (bez `ended_at`) kończą się w chwili przejścia
--    do EXPIRED albo UNLOCK_FAILED, nie trwają bez końca (ADR 0074).
-- 2. Czasy w milisekundach w widokach list jako bigint (integer przepełnia się po 24,8 doby).
-- 3. Saldo portfela w chwili: ostatni wpis klienta po `id`, tak jak ciągłość księgi pilnowana przez wyzwalacz.
-- 4. Przedział szeregu raportu: `bucket` to data początku przedziału po przycięciu do okresu (pierwszy tydzień okresu
--    od 1 października to „tydzień od 01.10.2026”, nie od 28 września).
-- 5. Wykorzystanie floty: kategorie czasu zaokrąglane z sum narastających, więc ich suma równa się `tracked_seconds`
--    (podstawa wskaźników w packages/core to czas z historią stanów poza RETIRED; doprecyzowanie ADR 0074).

-- =====================================================================
-- Przyczyna w historii stanów (ADR 0074)
-- =====================================================================

-- Kolumny bez zmian, zmienia się tylko dopasowanie przejazdu (`rn`). Początek przejazdu to rezerwacja albo
-- utworzenie wiersza (przejazd bez rezerwacji zaczyna się w UNLOCKING, zanim `started_at` zapisze potwierdzenie
-- odblokowania). Koniec to `ended_at`; dla EXPIRED i UNLOCK_FAILED bez `ended_at` chwila przejścia do tego stanu
-- (zdarzenie STATE_CHANGED, a bez zdarzenia `updated_at`); przejazd w toku trwa do `infinity`. Wcześniej taki
-- przejazd był kandydatem dla wszystkich późniejszych przedziałów i wygrywał z nowszym przejazdem bez rezerwacji,
-- którego `started_at` wypadał po końcu przedziału fazy odblokowania.
CREATE OR REPLACE VIEW v_scooter_status_history AS
SELECT h.id, h.scooter_id, sc.number AS scooter_number, sc.model_id, h.status, h.online, h.valid_from, h.valid_to,
       h.valid_to IS NULL AS is_open,
       floor(extract(epoch FROM COALESCE(h.valid_to, now()) - h.valid_from))::bigint AS duration_seconds,
       fn_scooter_time_category(h.status, h.online) AS category,
       CASE
           WHEN rn.id IS NOT NULL THEN CASE WHEN h.status = 'RESERVED' THEN 'RESERVATION' ELSE 'RENTAL' END
           WHEN tk.id IS NOT NULL THEN 'SERVICE_TASK'
           WHEN tc.id IS NOT NULL THEN CASE WHEN tc.auto_kind = 'OFFLINE' THEN 'AUTO_OFFLINE' ELSE 'TICKET' END
           WHEN au.id IS NOT NULL THEN 'STAFF'
           WHEN NOT h.online THEN 'NO_TELEMETRY'
           ELSE 'SYSTEM' END AS reason,
       rn.id AS reason_rental_id, rn.number AS reason_rental_number,
       tk.id AS reason_task_id, tk.number AS reason_task_number, tk.type AS reason_task_type,
       tk.assignee_id AS reason_task_assignee_id, ta.name AS reason_task_assignee_name,
       tc.id AS reason_ticket_id, tc.number AS reason_ticket_number, tc.auto_kind AS reason_ticket_auto_kind,
       au.id AS reason_audit_id, au.action AS reason_audit_action, au.staff_id AS reason_staff_id,
       ast.name AS reason_staff_name
FROM scooter_status_history h
JOIN scooters sc ON sc.id = h.scooter_id
LEFT JOIN LATERAL (
    SELECT r.id, r.number FROM rentals r
    CROSS JOIN LATERAL (
        SELECT COALESCE(r.reserved_at, r.created_at) AS began,
               COALESCE(r.ended_at,
                        CASE WHEN r.state IN ('EXPIRED', 'UNLOCK_FAILED') THEN COALESCE(
                            (SELECT min(e.created_at) FROM rental_events e
                             WHERE e.rental_id = r.id AND e.type = 'STATE_CHANGED' AND e.to_state = r.state),
                            r.updated_at) END,
                        'infinity') AS finished) p
    WHERE h.status IN ('IN_USE', 'RESERVED') AND r.scooter_id = h.scooter_id
      AND p.began < COALESCE(h.valid_to, 'infinity') AND p.finished > h.valid_from
    ORDER BY p.began DESC LIMIT 1) rn ON true
LEFT JOIN LATERAL (
    SELECT t.id, t.number, t.type, t.assignee_id FROM service_tasks t
    WHERE h.status = 'MAINTENANCE' AND t.scooter_id = h.scooter_id
      AND t.created_at < COALESCE(h.valid_to, 'infinity') AND COALESCE(t.completed_at, 'infinity') > h.valid_from
    ORDER BY t.status = 'CANCELLED', t.created_at DESC LIMIT 1) tk ON true
LEFT JOIN staff ta ON ta.id = tk.assignee_id
LEFT JOIN LATERAL (
    SELECT k.id, k.number, k.auto_kind FROM tickets k
    WHERE k.scooter_id = h.scooter_id
      AND (h.status = 'MAINTENANCE' OR (NOT h.online AND k.auto_kind = 'OFFLINE'))
      AND k.created_at < COALESCE(h.valid_to, 'infinity') AND COALESCE(k.resolved_at, 'infinity') > h.valid_from
    ORDER BY (k.auto_kind IS NOT DISTINCT FROM 'OFFLINE') = (NOT h.online) DESC, k.urgent DESC, k.created_at DESC
    LIMIT 1) tc ON true
LEFT JOIN LATERAL (
    SELECT a.id, a.action, a.staff_id FROM audit_log a
    WHERE a.entity_type = 'scooter' AND a.entity_id = h.scooter_id AND a.actor = 'STAFF'
      AND a.created_at BETWEEN h.valid_from - interval '5 seconds' AND h.valid_from + interval '5 seconds'
    ORDER BY abs(extract(epoch FROM a.created_at - h.valid_from)), a.id DESC LIMIT 1) au ON true
LEFT JOIN staff ast ON ast.id = au.staff_id
WHERE h.valid_to IS NULL OR h.valid_to > h.valid_from;

-- =====================================================================
-- Czasy w milisekundach jako bigint
-- =====================================================================

-- CREATE OR REPLACE nie zmienia typu kolumny, więc widoki są usuwane i tworzone od nowa (te same kolumny w tej samej
-- kolejności). Żaden widok ani funkcja od nich nie zależy, a baza nie ma osobnych uprawnień do widoków.
DROP VIEW v_report_run_list;
CREATE VIEW v_report_run_list AS
SELECT rr.id, left(rr.id::text, 8) AS short_id, rr.report_code, d.name AS report_name, d.permission_code,
       rr.format, rr.params, rr.status,
       CASE WHEN rr.file_deleted_at IS NOT NULL THEN 'FILE_DELETED' ELSE rr.status::text END AS state,
       rr.requested_by, s.name AS requested_by_name,
       (SELECT COALESCE(array_agg(r.name ORDER BY r.name), '{}'::text[])
        FROM staff_roles sr JOIN roles r ON r.id = sr.role_id WHERE sr.staff_id = rr.requested_by) AS requested_by_roles,
       rr.file_id, f.size_bytes AS file_size_bytes, rr.row_count, rr.page_count, rr.data_as_of,
       rr.error_code, rr.error, rr.retry_of, rr.created_at, rr.started_at, rr.finished_at,
       CASE WHEN rr.finished_at IS NOT NULL AND rr.started_at IS NOT NULL
            THEN floor(extract(epoch FROM rr.finished_at - rr.started_at) * 1000)::bigint END AS duration_ms,
       rr.file_deleted_at
FROM report_runs rr
JOIN report_definitions d ON d.code = rr.report_code
JOIN staff s ON s.id = rr.requested_by
LEFT JOIN files f ON f.id = rr.file_id;

DROP VIEW v_scooter_command_list;
CREATE VIEW v_scooter_command_list AS
SELECT c.id, c.scooter_id, s.number AS scooter_number, c.type, c.payload, c.source, c.zone_id, z.code AS zone_code,
       z.name AS zone_name, c.issued_by_staff, st.name AS staff_name, c.rental_id, r.number AS rental_number, c.status,
       c.ack_reason, c.sent_at, c.acked_at, c.expires_at,
       CASE WHEN c.acked_at IS NOT NULL THEN floor(extract(epoch FROM c.acked_at - c.sent_at) * 1000)::bigint END
           AS response_ms
FROM scooter_commands c
JOIN scooters s ON s.id = c.scooter_id
LEFT JOIN zones z ON z.id = c.zone_id
LEFT JOIN staff st ON st.id = c.issued_by_staff
LEFT JOIN rentals r ON r.id = c.rental_id;

-- =====================================================================
-- Saldo portfela w chwili (`reports.wallet`)
-- =====================================================================

-- Wyzwalacz księgi (0007) liczy saldo po operacji od poprzedniego wpisu klienta według `id`, a `created_at` to czas
-- transakcji: transakcja, która wstawiła wpis później (większe `id`), mogła zacząć się wcześniej. Saldo w chwili
-- `p_at` to więc `balance_after` wpisu z największym `id` spośród wpisów sprzed tej chwili.
CREATE OR REPLACE FUNCTION fn_wallet_balances_at(p_at timestamptz) RETURNS TABLE (user_id uuid, balance bigint)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (l.user_id) l.user_id, l.balance_after
    FROM wallet_ledger l
    WHERE l.created_at < p_at
    ORDER BY l.user_id, l.id DESC
$$;

-- =====================================================================
-- Przedziały szeregu (ADR 0071)
-- =====================================================================

-- Jak w 0013, ale `bucket` to data początku przedziału po przycięciu do okresu (granice okresu to lokalne północe,
-- więc to data `bucket_from` w czasie polskim). Funkcje szeregów łączą przedziały po `bucket` z tej funkcji, więc
-- zmiana obejmuje wszystkie szeregi; doby i pełne tygodnie i miesiące mają tę samą datę co wcześniej.
CREATE OR REPLACE FUNCTION fn_report_buckets(p_from timestamptz, p_to timestamptz, p_granularity text)
RETURNS TABLE (bucket date, bucket_from timestamptz, bucket_to timestamptz)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_granularity IS NULL OR p_granularity NOT IN ('day', 'week', 'month') THEN
        RAISE EXCEPTION 'REPORT_INVALID_GRANULARITY' USING ERRCODE = 'raise_exception', DETAIL = COALESCE(p_granularity, '');
    END IF;
    RETURN QUERY
    SELECT (GREATEST(p_from, d AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw')::date,
           GREATEST(p_from, d AT TIME ZONE 'Europe/Warsaw'),
           LEAST(p_to, (d + ('1 ' || p_granularity)::interval) AT TIME ZONE 'Europe/Warsaw')
    FROM generate_series(date_trunc(p_granularity, p_from AT TIME ZONE 'Europe/Warsaw'),
                         (p_to AT TIME ZONE 'Europe/Warsaw') - interval '1 microsecond',
                         ('1 ' || p_granularity)::interval) d
    WHERE p_to > p_from;
END
$$;

-- =====================================================================
-- Wykorzystanie floty: zaokrąglenie kategorii (ADR 0074)
-- =====================================================================

-- Jak w 0013, ale sekundy kategorii to różnice zaokrąglonych sum narastających (w kolejności IN_RIDE, RESERVED,
-- AVAILABLE, SERVICE, OFFLINE, RETIRED), więc suma kategorii jest dokładnie równa `tracked_seconds` (zaokrąglonej
-- sumie wszystkich). Osobne zaokrąglanie każdej kategorii dawało różnicę do kilku sekund.
CREATE OR REPLACE FUNCTION fn_report_fleet_usage_by_scooter(p_from timestamptz, p_to timestamptz,
                                                            p_model_id uuid DEFAULT NULL, p_scooter_id uuid DEFAULT NULL)
RETURNS TABLE (scooter_id uuid, scooter_number integer, model_id uuid, model_code text, model_name text,
               current_status scooter_status, history_from timestamptz, period_seconds bigint, tracked_seconds bigint,
               in_ride_seconds bigint, reserved_seconds bigint, available_seconds bigint, service_seconds bigint,
               offline_seconds bigint, retired_seconds bigint, untracked_ride_seconds bigint, rides integer,
               ride_seconds bigint, distance_m bigint, revenue_gross bigint, odometer_m bigint)
LANGUAGE sql STABLE AS $$
    WITH b AS (SELECT p_from AS f, GREATEST(p_from, LEAST(p_to, now())) AS t),
    sc AS (
        SELECT s.id, s.number, s.model_id, s.status, s.odometer_m FROM scooters s
        WHERE (s.created_at < p_to
               OR EXISTS (SELECT 1 FROM scooter_status_history x WHERE x.scooter_id = s.id AND x.valid_from < p_to))
          AND (p_model_id IS NULL OR s.model_id = p_model_id) AND (p_scooter_id IS NULL OR s.id = p_scooter_id)),
    hist AS (
        SELECT h.scooter_id, fn_scooter_time_category(h.status, h.online) AS category,
               extract(epoch FROM LEAST(COALESCE(h.valid_to, b.t), b.t) - GREATEST(h.valid_from, b.f)) AS secs
        FROM scooter_status_history h CROSS JOIN b
        WHERE h.scooter_id IN (SELECT id FROM sc)
          AND tstzrange(h.valid_from, h.valid_to) && tstzrange(b.f, b.t)),
    hs AS (
        SELECT scooter_id,
               round(COALESCE(sum(secs) FILTER (WHERE category = 'IN_RIDE'), 0)) AS c1,
               round(COALESCE(sum(secs) FILTER (WHERE category IN ('IN_RIDE', 'RESERVED')), 0)) AS c2,
               round(COALESCE(sum(secs) FILTER (WHERE category IN ('IN_RIDE', 'RESERVED', 'AVAILABLE')), 0)) AS c3,
               round(COALESCE(sum(secs) FILTER (WHERE category IN ('IN_RIDE', 'RESERVED', 'AVAILABLE', 'SERVICE')), 0))
                   AS c4,
               round(COALESCE(sum(secs) FILTER (WHERE category <> 'RETIRED'), 0)) AS c5,
               round(COALESCE(sum(secs), 0)) AS c6
        FROM hist GROUP BY scooter_id),
    hf AS (
        SELECT h.scooter_id, min(h.valid_from) AS history_from FROM scooter_status_history h
        WHERE h.scooter_id IN (SELECT id FROM sc) GROUP BY h.scooter_id),
    rd AS (
        SELECT r.scooter_id, count(*) AS rides, sum(r.ride_seconds) AS ride_seconds, sum(r.distance_m) AS distance_m
        FROM rentals r
        WHERE r.scooter_id IN (SELECT id FROM sc) AND r.started_at >= p_from AND r.started_at < p_to
        GROUP BY r.scooter_id),
    ut AS (
        SELECT r.scooter_id,
               sum(GREATEST(0, extract(epoch FROM LEAST(COALESCE(r.ended_at, b.t), b.t, COALESCE(hf.history_from, b.t))
                                            - GREATEST(r.started_at, b.f)))) AS secs
        FROM rentals r CROSS JOIN b LEFT JOIN hf ON hf.scooter_id = r.scooter_id
        WHERE r.scooter_id IN (SELECT id FROM sc) AND r.started_at IS NOT NULL
          AND r.started_at < LEAST(b.t, COALESCE(hf.history_from, b.t)) AND COALESCE(r.ended_at, b.t) > b.f
        GROUP BY r.scooter_id),
    rv AS (
        SELECT x.scooter_id, sum(rc.total_amount) AS gross
        FROM receipts rc
        JOIN rentals x ON x.id = COALESCE(rc.rental_id, (SELECT o.rental_id FROM receipts o WHERE o.id = rc.corrects_receipt_id))
        WHERE x.scooter_id IN (SELECT id FROM sc) AND rc.issued_at >= p_from AND rc.issued_at < p_to
        GROUP BY x.scooter_id)
    SELECT sc.id, sc.number, sc.model_id, m.code, m.name, sc.status, hf.history_from,
           round(extract(epoch FROM b.t - b.f))::bigint,
           COALESCE(hs.c6, 0)::bigint, COALESCE(hs.c1, 0)::bigint, COALESCE(hs.c2 - hs.c1, 0)::bigint,
           COALESCE(hs.c3 - hs.c2, 0)::bigint, COALESCE(hs.c4 - hs.c3, 0)::bigint, COALESCE(hs.c5 - hs.c4, 0)::bigint,
           COALESCE(hs.c6 - hs.c5, 0)::bigint, round(COALESCE(ut.secs, 0))::bigint,
           COALESCE(rd.rides, 0)::integer, COALESCE(rd.ride_seconds, 0)::bigint, COALESCE(rd.distance_m, 0)::bigint,
           COALESCE(rv.gross, 0)::bigint, sc.odometer_m
    FROM sc CROSS JOIN b
    JOIN scooter_models m ON m.id = sc.model_id
    LEFT JOIN hs ON hs.scooter_id = sc.id
    LEFT JOIN hf ON hf.scooter_id = sc.id
    LEFT JOIN rd ON rd.scooter_id = sc.id
    LEFT JOIN ut ON ut.scooter_id = sc.id
    LEFT JOIN rv ON rv.scooter_id = sc.id
    ORDER BY sc.number
$$;

-- Szereg floty: to samo zaokrąglenie z sum narastających w każdym przedziale (suma kategorii przedziału to czas
-- z historią, podstawa wykorzystania przedziału w packages/core).
CREATE OR REPLACE FUNCTION fn_report_fleet_usage_series(p_from timestamptz, p_to timestamptz, p_granularity text,
                                                        p_model_id uuid DEFAULT NULL, p_scooter_id uuid DEFAULT NULL)
RETURNS TABLE (bucket date, bucket_from timestamptz, bucket_to timestamptz, period_seconds bigint, scooters integer,
               in_ride_seconds bigint, reserved_seconds bigint, available_seconds bigint, service_seconds bigint,
               offline_seconds bigint, retired_seconds bigint, rides integer)
LANGUAGE sql STABLE AS $$
    WITH bk AS (
        SELECT b.bucket, b.bucket_from, b.bucket_to, GREATEST(b.bucket_from, LEAST(b.bucket_to, now())) AS t
        FROM fn_report_buckets(p_from, p_to, p_granularity) b),
    sc AS (
        SELECT s.id FROM scooters s
        WHERE (p_model_id IS NULL OR s.model_id = p_model_id) AND (p_scooter_id IS NULL OR s.id = p_scooter_id)),
    hist AS (
        SELECT bk.bucket, h.scooter_id, fn_scooter_time_category(h.status, h.online) AS category,
               extract(epoch FROM LEAST(COALESCE(h.valid_to, bk.t), bk.t) - GREATEST(h.valid_from, bk.bucket_from)) AS secs
        FROM bk JOIN scooter_status_history h
          ON tstzrange(h.valid_from, h.valid_to) && tstzrange(bk.bucket_from, bk.t)
        WHERE h.scooter_id IN (SELECT id FROM sc)),
    hs AS (
        SELECT bucket, count(DISTINCT scooter_id) AS scooters,
               round(COALESCE(sum(secs) FILTER (WHERE category = 'IN_RIDE'), 0)) AS c1,
               round(COALESCE(sum(secs) FILTER (WHERE category IN ('IN_RIDE', 'RESERVED')), 0)) AS c2,
               round(COALESCE(sum(secs) FILTER (WHERE category IN ('IN_RIDE', 'RESERVED', 'AVAILABLE')), 0)) AS c3,
               round(COALESCE(sum(secs) FILTER (WHERE category IN ('IN_RIDE', 'RESERVED', 'AVAILABLE', 'SERVICE')), 0))
                   AS c4,
               round(COALESCE(sum(secs) FILTER (WHERE category <> 'RETIRED'), 0)) AS c5,
               round(COALESCE(sum(secs), 0)) AS c6
        FROM hist GROUP BY bucket),
    rd AS (
        SELECT bk.bucket, count(r.id) AS rides
        FROM bk JOIN rentals r ON r.started_at >= bk.bucket_from AND r.started_at < bk.bucket_to
        WHERE r.scooter_id IN (SELECT id FROM sc)
        GROUP BY bk.bucket)
    SELECT bk.bucket, bk.bucket_from, bk.bucket_to, round(extract(epoch FROM bk.t - bk.bucket_from))::bigint,
           COALESCE(hs.scooters, 0)::integer, COALESCE(hs.c1, 0)::bigint, COALESCE(hs.c2 - hs.c1, 0)::bigint,
           COALESCE(hs.c3 - hs.c2, 0)::bigint, COALESCE(hs.c4 - hs.c3, 0)::bigint, COALESCE(hs.c5 - hs.c4, 0)::bigint,
           COALESCE(hs.c6 - hs.c5, 0)::bigint, COALESCE(rd.rides, 0)::integer
    FROM bk
    LEFT JOIN hs ON hs.bucket = bk.bucket
    LEFT JOIN rd ON rd.bucket = bk.bucket
    ORDER BY bk.bucket
$$;
