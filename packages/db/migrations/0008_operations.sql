-- 0008: operacje i serwis (iteracja 6): zgłoszenia z numerem, odpowiedzią dla klienta i zgłoszeniami automatycznymi
-- bez duplikatów, aktor systemu w dzienniku audytu, przyczyna stanu hulajnogi i wyłączenie z ruchu po przejeździe,
-- przejścia zadań serwisowych, ruchy magazynowe z procedurami, powrót do floty, tryb zakończenia przejazdu
-- i opłata za odholowanie, pliki, powiadomienia z szablonów z wersjami, widoki list w panelu
-- (ADR 0055–0060). Reguły liczy packages/core, a baza pilnuje tych, których nie może obejść równoległa transakcja.

-- Nowe wartości istniejących typów. Postgres nie pozwala ich użyć przed zatwierdzeniem tej transakcji, więc
-- widoki, funkcje SQL, ograniczenia i indeksy niżej porównują je jako tekst (`type::text`) albo omijają je
-- warunkiem na starych wartościach; procedury i wyzwalacze (plpgsql) odwołują się do nich dopiero przy wykonaniu.
ALTER TYPE ticket_category ADD VALUE 'BILLING';            -- „Rozliczenie”: reklamacja opłaty (pytanie 6)
ALTER TYPE ticket_category ADD VALUE 'OUT_OF_ZONE';        -- „Poza strefą”: zgłoszenie automatyczne (pytanie 3)
ALTER TYPE rental_event_type ADD VALUE 'BILLING_STOPPED';  -- naliczanie zatrzymane po 30 min bez łączności (ADR 0056)
ALTER TYPE rental_event_type ADD VALUE 'MOVED_AFTER_END';  -- ruch ponad 200 m po żądaniu zakończenia (ADR 0056)
ALTER TYPE ledger_entry_type ADD VALUE 'TOWING_FEE';       -- opłata za odholowanie (ADR 0060)
ALTER TYPE command_type ADD VALUE 'BATTERY_SWAPPED';       -- kontrakt MQTT 1.3.0 (ADR 0059)

CREATE TYPE audit_actor          AS ENUM ('STAFF', 'SYSTEM');
CREATE TYPE ticket_auto_kind     AS ENUM ('OFFLINE', 'BATTERY_CRITICAL', 'OUT_OF_ZONE');
CREATE TYPE scooter_status_reason AS ENUM ('URGENT_TICKET', 'SERVICE_TASK', 'BATTERY_BELOW_THRESHOLD', 'OFFLINE',
                                           'THEFT', 'DAMAGE', 'END_OF_LIFE', 'OTHER');
CREATE TYPE part_movement_kind   AS ENUM ('RECEIPT', 'ADJUSTMENT', 'USE', 'RETURN');
CREATE TYPE part_adjust_reason   AS ENUM ('STOCKTAKE', 'DAMAGED', 'LOST', 'OTHER');
CREATE TYPE rental_end_mode      AS ENUM ('CUSTOMER', 'CUSTOMER_OFFLINE', 'REMOTE', 'UNCONFIRMED');
CREATE TYPE file_status          AS ENUM ('READY', 'DELETED');
CREATE TYPE notification_status  AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- =====================================================================
-- Dziennik audytu: wpisy systemu bez operatora (ADR 0055)
-- =====================================================================

-- Zgłoszenia automatyczne, automatyczne MAINTENANCE, powrót do floty i automatyczne zamknięcie zgłoszenia zapisuje
-- system; oś czasu (D6) odróżnia je od działań operatorów.
ALTER TABLE audit_log ALTER COLUMN staff_id DROP NOT NULL,
                      ADD COLUMN actor audit_actor NOT NULL DEFAULT 'STAFF',
                      ADD CONSTRAINT audit_log_actor_staff CHECK ((actor = 'STAFF') = (staff_id IS NOT NULL));

-- Autor wpisu systemu nie istnieje: `staff_name` jest NULL, a panel pokazuje „System” z pliku tłumaczeń (ADR 0032).
-- Kolumna `actor` dopisana na końcu (CREATE OR REPLACE VIEW nie zmienia istniejących).
CREATE OR REPLACE VIEW v_audit_log AS
SELECT a.id, a.created_at, a.staff_id, s.name AS staff_name, s.email AS staff_email,
       a.action, a.entity_type, a.entity_id, a.data, a.actor
FROM audit_log a
LEFT JOIN staff s ON s.id = a.staff_id;

-- =====================================================================
-- Zgłoszenia (ADR 0055)
-- =====================================================================

CREATE SEQUENCE ticket_number_seq START 1000;

ALTER TABLE tickets ADD COLUMN number                 bigint UNIQUE DEFAULT nextval('ticket_number_seq'),   -- Z-1042
                    ADD COLUMN auto_kind              ticket_auto_kind,
                    ADD COLUMN customer_reply         text CHECK (char_length(customer_reply) BETWEEN 1 AND 500),
                    ADD COLUMN customer_reply_at      timestamptz,
                    ADD COLUMN customer_reply_read_at timestamptz,
                    ADD COLUMN resolution_note        text;
UPDATE tickets SET resolved_at = COALESCE(resolved_at, updated_at) WHERE status = 'RESOLVED';
UPDATE tickets SET resolved_at = NULL WHERE status <> 'RESOLVED';
UPDATE tickets SET urgent = categories && ARRAY['BRAKES', 'WHEEL', 'HANDLEBAR']::ticket_category[];
ALTER TABLE tickets ALTER COLUMN number SET NOT NULL,
    -- Pilność wynika z kategorii (pytanie 4); regułę liczy core, baza ją sprawdza.
    ADD CONSTRAINT tickets_urgent_from_categories
        CHECK (urgent = (categories && ARRAY['BRAKES', 'WHEEL', 'HANDLEBAR']::ticket_category[])),
    ADD CONSTRAINT tickets_auto_kind_source CHECK ((source = 'AUTO') = (auto_kind IS NOT NULL)),
    -- Rodzaj zgłoszenia automatycznego ma swoją kategorię (AUTO_TICKET_CATEGORY w core).
    ADD CONSTRAINT tickets_auto_kind_category CHECK (
        auto_kind IS NULL OR categories::text[] @> ARRAY[CASE auto_kind WHEN 'OFFLINE' THEN 'CONNECTION'
                                                                         WHEN 'BATTERY_CRITICAL' THEN 'BATTERY'
                                                                         ELSE 'OUT_OF_ZONE' END]),
    -- Brak łączności i „poza strefą” zgłasza system albo operator, nie klient.
    ADD CONSTRAINT tickets_system_categories CHECK (
        source <> 'USER' OR NOT (categories::text[] && ARRAY['CONNECTION', 'OUT_OF_ZONE'])),
    -- Reklamacja opłaty dotyczy przejazdu.
    ADD CONSTRAINT tickets_billing_has_rental CHECK (NOT ('BILLING' = ANY (categories::text[])) OR rental_id IS NOT NULL),
    ADD CONSTRAINT tickets_user_has_reporter CHECK (source <> 'USER' OR reported_by IS NOT NULL),
    ADD CONSTRAINT tickets_reply_consistent CHECK (
        (customer_reply IS NULL) = (customer_reply_at IS NULL)
        AND (customer_reply_read_at IS NULL OR customer_reply_at IS NOT NULL)),
    ADD CONSTRAINT tickets_resolved_at CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL));

-- Najwyżej jedno otwarte zgłoszenie automatyczne danego rodzaju na hulajnogę; zgłoszenia bez rodzaju (NULL)
-- nie konfliktują. Zadanie w tle wstawia je przez ON CONFLICT (scooter_id, auto_kind) WHERE status <> 'RESOLVED'.
CREATE UNIQUE INDEX tickets_one_open_auto_per_scooter ON tickets (scooter_id, auto_kind) WHERE status <> 'RESOLVED';
CREATE INDEX tickets_scooter_open_idx ON tickets (scooter_id) WHERE status <> 'RESOLVED';
CREATE INDEX tickets_scooter_idx ON tickets (scooter_id, created_at DESC);
CREATE INDEX tickets_reporter_idx ON tickets (reported_by, created_at DESC) WHERE reported_by IS NOT NULL;
CREATE INDEX tickets_rental_idx ON tickets (rental_id) WHERE rental_id IS NOT NULL;

-- RESOLVED jest stanem końcowym (nowy problem to nowe zgłoszenie); data rozwiązania ustawia się sama.
-- Pozostałe przejścia (NEW, IN_PROGRESS, AT_SERVICE) sprawdza core.
CREATE FUNCTION trg_ticket_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'RESOLVED' AND NEW.status <> 'RESOLVED' THEN
        RAISE EXCEPTION 'INVALID_TICKET_TRANSITION' USING ERRCODE = 'raise_exception',
            DETAIL = format('%s->%s', OLD.status, NEW.status);
    END IF;
    IF NEW.status = 'RESOLVED' AND (TG_OP = 'INSERT' OR OLD.status <> 'RESOLVED') THEN
        NEW.resolved_at := COALESCE(NEW.resolved_at, now());
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER tickets_rules BEFORE INSERT OR UPDATE OF status ON tickets
    FOR EACH ROW EXECUTE FUNCTION trg_ticket_rules();

-- Kolejność zdjęć i limit 3 na zgłoszenie (ADR 0055, ADR 0057).
ALTER TABLE ticket_photos ADD COLUMN position smallint;
UPDATE ticket_photos p SET position = n.rn
FROM (SELECT ticket_id, file_id, row_number() OVER (PARTITION BY ticket_id ORDER BY file_id) AS rn FROM ticket_photos) n
WHERE n.ticket_id = p.ticket_id AND n.file_id = p.file_id;
ALTER TABLE ticket_photos ALTER COLUMN position SET NOT NULL,
                          ADD CONSTRAINT ticket_photos_position_range CHECK (position BETWEEN 1 AND 3),
                          ADD CONSTRAINT ticket_photos_one_per_position UNIQUE (ticket_id, position);
CREATE INDEX ticket_photos_file_idx ON ticket_photos (file_id);

-- Zwrot z reklamacji trafia na oś czasu zgłoszenia (pytanie 6). API ustawia `ticket_id` w transakcji zwrotu.
ALTER TABLE refunds ADD COLUMN ticket_id uuid REFERENCES tickets(id),
                    ADD CONSTRAINT refunds_ticket_has_rental CHECK (ticket_id IS NULL OR rental_id IS NOT NULL);
CREATE INDEX refunds_ticket_idx ON refunds (ticket_id) WHERE ticket_id IS NOT NULL;

-- =====================================================================
-- Hulajnogi: przyczyna stanu i wyłączenie z ruchu po przejeździe (ADR 0055)
-- =====================================================================

ALTER TABLE scooters ADD COLUMN status_reason     scooter_status_reason,
                     ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now();
UPDATE scooters SET status_changed_at = updated_at;
ALTER TABLE scooters ADD CONSTRAINT scooters_status_reason_matches CHECK (
    status_reason IS NULL
    OR (status = 'MAINTENANCE' AND status_reason IN ('URGENT_TICKET', 'SERVICE_TASK', 'BATTERY_BELOW_THRESHOLD', 'OFFLINE', 'OTHER'))
    OR (status = 'RETIRED' AND status_reason IN ('THEFT', 'DAMAGE', 'END_OF_LIFE', 'OTHER')));

-- Powód zatrzymania hulajnogi w serwisie: otwarte pilne zgłoszenie albo otwarte zadanie serwisowe; NULL, gdy
-- nic jej nie zatrzymuje (pytanie 4). Tę samą regułę stosuje API przy wolnej hulajnodze.
CREATE FUNCTION fn_scooter_service_hold(p_scooter_id uuid) RETURNS scooter_status_reason
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM tickets t WHERE t.scooter_id = p_scooter_id AND t.urgent AND t.status <> 'RESOLVED')
            THEN 'URGENT_TICKET'::scooter_status_reason
        WHEN EXISTS (SELECT 1 FROM service_tasks st WHERE st.scooter_id = p_scooter_id AND st.status IN ('OPEN', 'IN_PROGRESS'))
            THEN 'SERVICE_TASK'::scooter_status_reason
    END
$$;

-- Zmiana stanu zapisuje czas zmiany i czyści przyczynę poza MAINTENANCE i RETIRED. Koniec rezerwacji albo
-- przejazdu (RESERVED albo IN_USE → AVAILABLE, z API i z sp_expire_reservations) przy otwartym pilnym zgłoszeniu
-- albo zadaniu daje MAINTENANCE z przyczyną i wpis systemu w dzienniku audytu, w tej samej transakcji co
-- zakończenie (ADR 0055: bez osobnej flagi „do serwisu”). Inne przejścia do AVAILABLE (powrót do floty) sprawdza
-- `fn_scooter_return_blockers`, więc wyzwalacz ich nie zmienia.
CREATE FUNCTION trg_scooter_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    hold      scooter_status_reason;
    last_ride uuid;
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status IN ('RESERVED', 'IN_USE') AND NEW.status = 'AVAILABLE' THEN
        hold := fn_scooter_service_hold(NEW.id);
        IF hold IS NOT NULL THEN
            NEW.status := 'MAINTENANCE';
            NEW.status_reason := hold;
            SELECT r.id INTO last_ride FROM rentals r WHERE r.scooter_id = NEW.id ORDER BY r.created_at DESC LIMIT 1;
            INSERT INTO audit_log (actor, staff_id, action, entity_type, entity_id, data)
            VALUES ('SYSTEM', NULL, 'scooter.sent_to_service', 'scooter', NEW.id,
                    jsonb_build_object('changes', jsonb_build_object('status', jsonb_build_array(OLD.status, 'MAINTENANCE')),
                                       'reason', hold, 'rentalId', last_ride));
        END IF;
    END IF;
    NEW.status_changed_at := now();
    IF NEW.status NOT IN ('MAINTENANCE', 'RETIRED') THEN
        NEW.status_reason := NULL;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER scooters_status BEFORE UPDATE OF status ON scooters
    FOR EACH ROW EXECUTE FUNCTION trg_scooter_status();

-- Przeszkody powrotu do floty (pytanie 5): otwarte zadania, brak łączności, bateria poniżej progu z obowiązującej
-- wersji cennika (`fn_low_battery_threshold`, jak status floty z 0003). Ta sama reguła i te same kody co
-- `returnToFleetBlockers` w core; pusta tablica znaczy „może wrócić”, NULL: nie ma takiej hulajnogi.
CREATE FUNCTION fn_scooter_return_blockers(p_scooter_id uuid) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM service_tasks st
                          WHERE st.scooter_id = s.id AND st.status IN ('OPEN', 'IN_PROGRESS')) THEN 'OPEN_TASKS' END,
        CASE WHEN NOT s.online THEN 'OFFLINE' END,
        CASE WHEN COALESCE(s.battery_pct, 0) < fn_low_battery_threshold() THEN 'BATTERY_BELOW_THRESHOLD' END
    ], NULL)
    FROM scooters s WHERE s.id = p_scooter_id
$$;

-- Lista floty z przyczyną stanu; kolumny dopisane na końcu, reszta jak w 0003.
CREATE OR REPLACE VIEW v_fleet_list AS
SELECT f.*,
       fn_fleet_status(f.status, f.online, f.battery_pct, t.threshold) AS fleet_status,
       ST_Y(f.position) AS lat,
       ST_X(f.position) AS lon,
       m.range_km AS model_range_km,
       s.version,
       s.status_reason,
       s.status_changed_at
FROM v_fleet_status f
JOIN scooters s ON s.id = f.id
JOIN scooter_models m ON m.id = f.model_id
CROSS JOIN (SELECT fn_low_battery_threshold() AS threshold) t;

-- =====================================================================
-- Zadania serwisowe: cel przewiezienia, anulowanie, przejścia statusu (ADR 0055)
-- =====================================================================

ALTER TABLE service_tasks ADD COLUMN target_zone_id uuid REFERENCES zones(id),
                          ADD COLUMN target_point   geometry(Point, 4326),
                          ADD COLUMN cancel_reason  text,
                          ADD COLUMN cancelled_by   uuid REFERENCES staff(id);
ALTER TABLE service_tasks
    -- Przewiezienie ma dokładnie jeden cel: strefę albo punkt; inne rodzaje nie mają celu.
    ADD CONSTRAINT service_tasks_relocation_target CHECK (
        CASE WHEN type = 'RELOCATION' THEN num_nonnulls(target_zone_id, target_point) = 1
             ELSE target_zone_id IS NULL AND target_point IS NULL END),
    ADD CONSTRAINT service_tasks_done_has_note CHECK (status <> 'DONE' OR btrim(COALESCE(result_note, '')) <> ''),
    ADD CONSTRAINT service_tasks_cancel_reason CHECK (
        (status = 'CANCELLED') = (btrim(COALESCE(cancel_reason, '')) <> '')),
    ADD CONSTRAINT service_tasks_cancelled_by CHECK (status = 'CANCELLED' OR cancelled_by IS NULL);
CREATE INDEX service_tasks_scooter_idx ON service_tasks (scooter_id, created_at DESC);

-- Przejścia: OPEN → IN_PROGRESS → DONE, OPEN | IN_PROGRESS → CANCELLED; nowe zadanie jest OPEN. Wymagana notatka
-- i powód dają czytelny kod przed ograniczeniem CHECK, a daty rozpoczęcia i zakończenia ustawiają się same.
CREATE FUNCTION trg_service_task_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'OPEN' THEN
            RAISE EXCEPTION 'INVALID_TASK_TRANSITION' USING ERRCODE = 'raise_exception',
                DETAIL = format('->%s', NEW.status);
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF NOT ((OLD.status = 'OPEN' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED'))
            OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('DONE', 'CANCELLED'))) THEN
        RAISE EXCEPTION 'INVALID_TASK_TRANSITION' USING ERRCODE = 'raise_exception',
            DETAIL = format('%s->%s', OLD.status, NEW.status);
    END IF;
    IF NEW.status = 'DONE' AND btrim(COALESCE(NEW.result_note, '')) = '' THEN
        RAISE EXCEPTION 'TASK_RESULT_NOTE_REQUIRED' USING ERRCODE = 'raise_exception';
    END IF;
    IF NEW.status = 'CANCELLED' AND btrim(COALESCE(NEW.cancel_reason, '')) = '' THEN
        RAISE EXCEPTION 'TASK_CANCEL_REASON_REQUIRED' USING ERRCODE = 'raise_exception';
    END IF;
    IF NEW.status = 'IN_PROGRESS' THEN
        NEW.started_at := COALESCE(NEW.started_at, now());
    ELSE
        NEW.completed_at := COALESCE(NEW.completed_at, now());
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER service_tasks_rules BEFORE INSERT OR UPDATE OF status ON service_tasks
    FOR EACH ROW EXECUTE FUNCTION trg_service_task_rules();

-- =====================================================================
-- Magazyn części: ruchy i procedury z blokadą wiersza części (ADR 0055)
-- =====================================================================

-- Każda zmiana stanu to ruch ze stanem po operacji; suma `delta` części równa się `stock_qty` (dane startowe
-- zakładają stan przyjęciem). Ruchy tylko się dopisuje, jak księgę portfela.
CREATE TABLE spare_part_movements (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    part_id         uuid NOT NULL REFERENCES spare_parts(id),
    kind            part_movement_kind NOT NULL,
    delta           integer NOT NULL CHECK (delta <> 0),
    stock_after     integer NOT NULL CHECK (stock_after >= 0),
    unit_cost       bigint CHECK (unit_cost >= 0),          -- koszt jednostkowy ruchu (przyjęcie, użycie, zwrot)
    task_id         uuid REFERENCES service_tasks(id),
    staff_id        uuid REFERENCES staff(id),              -- NULL: system (zwrot przy anulowaniu bez autora, dane startowe)
    document        text,                                   -- dokument dostawy
    reason          part_adjust_reason,                     -- powód korekty
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT spare_part_movements_task CHECK ((kind IN ('USE', 'RETURN')) = (task_id IS NOT NULL)),
    CONSTRAINT spare_part_movements_sign CHECK (
        (kind = 'USE' AND delta < 0) OR (kind IN ('RECEIPT', 'RETURN') AND delta > 0) OR kind = 'ADJUSTMENT'),
    CONSTRAINT spare_part_movements_reason CHECK ((kind = 'ADJUSTMENT') = (reason IS NOT NULL)),
    CONSTRAINT spare_part_movements_other_note CHECK (reason IS DISTINCT FROM 'OTHER' OR btrim(COALESCE(note, '')) <> ''),
    CONSTRAINT spare_part_movements_document CHECK (kind = 'RECEIPT' OR document IS NULL)
);
CREATE INDEX spare_part_movements_part_idx ON spare_part_movements (part_id, created_at DESC);
CREATE INDEX spare_part_movements_task_idx ON spare_part_movements (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX spare_part_movements_created_idx ON spare_part_movements (created_at DESC);

CREATE FUNCTION trg_spare_part_movements_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'PART_MOVEMENTS_APPEND_ONLY' USING ERRCODE = 'raise_exception';
END
$$;
CREATE TRIGGER spare_part_movements_append_only BEFORE UPDATE OR DELETE ON spare_part_movements
    FOR EACH ROW EXECUTE FUNCTION trg_spare_part_movements_append_only();

-- Przyjęcie dostawy: stan rośnie, opcjonalna nowa cena dotyczy kolejnych użyć. Blokada wiersza części
-- szereguje przyjęcie z równoległym użyciem w zadaniu.
CREATE PROCEDURE sp_part_receive(
    p_part_id uuid, p_quantity integer, p_unit_cost bigint, p_document text, p_staff_id uuid,
    OUT movement_id bigint, OUT stock_after integer)
LANGUAGE plpgsql AS $$
DECLARE
    cost bigint;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'PART_QUANTITY_INVALID' USING ERRCODE = 'raise_exception';
    END IF;
    UPDATE spare_parts SET stock_qty = stock_qty + p_quantity, unit_cost = COALESCE(p_unit_cost, unit_cost),
                           updated_at = now(), version = version + 1
    WHERE id = p_part_id
    RETURNING stock_qty, unit_cost INTO stock_after, cost;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PART_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    INSERT INTO spare_part_movements (part_id, kind, delta, stock_after, unit_cost, staff_id, document)
    VALUES (p_part_id, 'RECEIPT', p_quantity, stock_after, cost, p_staff_id, NULLIF(btrim(p_document), ''))
    RETURNING id INTO movement_id;
END
$$;

-- Korekta stanu (inwentaryzacja, uszkodzenie, zgubienie, inny powód z notatką): nowy stan bez zmiany ceny.
CREATE PROCEDURE sp_part_adjust(
    p_part_id uuid, p_new_qty integer, p_reason part_adjust_reason, p_note text, p_staff_id uuid,
    OUT movement_id bigint, OUT stock_after integer)
LANGUAGE plpgsql AS $$
DECLARE
    current_qty integer;
BEGIN
    IF p_new_qty IS NULL OR p_new_qty < 0 THEN
        RAISE EXCEPTION 'PART_QUANTITY_INVALID' USING ERRCODE = 'raise_exception';
    END IF;
    SELECT stock_qty INTO current_qty FROM spare_parts WHERE id = p_part_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PART_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF current_qty = p_new_qty THEN
        RAISE EXCEPTION 'PART_ADJUST_NO_CHANGE' USING ERRCODE = 'raise_exception';
    END IF;
    UPDATE spare_parts SET stock_qty = p_new_qty, updated_at = now(), version = version + 1 WHERE id = p_part_id;
    stock_after := p_new_qty;
    INSERT INTO spare_part_movements (part_id, kind, delta, stock_after, staff_id, reason, note)
    VALUES (p_part_id, 'ADJUSTMENT', p_new_qty - current_qty, p_new_qty, p_staff_id, p_reason, NULLIF(btrim(p_note), ''))
    RETURNING id INTO movement_id;
END
$$;

-- Użycie części w zadaniu w toku: stan maleje przy dodaniu, nie przy zakończeniu. Kolejność blokad: zadanie, część.
-- Ponowne dodanie tej samej części zwiększa ilość pozycji i zostawia koszt jednostkowy z pierwszego użycia;
-- dokładny koszt każdego użycia jest w ruchu.
CREATE PROCEDURE sp_task_use_part(
    p_task_id uuid, p_part_id uuid, p_quantity integer, p_staff_id uuid,
    OUT line_quantity integer, OUT stock_after integer)
LANGUAGE plpgsql AS $$
DECLARE
    task_status service_task_status;
    part        record;
BEGIN
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'PART_QUANTITY_INVALID' USING ERRCODE = 'raise_exception';
    END IF;
    SELECT status INTO task_status FROM service_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF task_status <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'TASK_NOT_IN_PROGRESS' USING ERRCODE = 'raise_exception';
    END IF;
    SELECT id, stock_qty, unit_cost, active INTO part FROM spare_parts WHERE id = p_part_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PART_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT part.active THEN
        RAISE EXCEPTION 'PART_INACTIVE' USING ERRCODE = 'raise_exception';
    END IF;
    IF part.stock_qty < p_quantity THEN
        RAISE EXCEPTION 'PART_OUT_OF_STOCK' USING ERRCODE = 'raise_exception', DETAIL = format('%s', part.stock_qty);
    END IF;
    UPDATE spare_parts SET stock_qty = stock_qty - p_quantity, updated_at = now(), version = version + 1
    WHERE id = p_part_id
    RETURNING stock_qty INTO stock_after;
    INSERT INTO service_task_parts AS l (task_id, part_id, quantity, unit_cost)
    VALUES (p_task_id, p_part_id, p_quantity, part.unit_cost)
    ON CONFLICT (task_id, part_id) DO UPDATE SET quantity = l.quantity + EXCLUDED.quantity
    RETURNING l.quantity INTO line_quantity;
    INSERT INTO spare_part_movements (part_id, kind, delta, stock_after, unit_cost, task_id, staff_id)
    VALUES (p_part_id, 'USE', -p_quantity, stock_after, part.unit_cost, p_task_id, p_staff_id);
END
$$;

-- Zwrot części z zadania w toku (usunięcie pozycji albo zmniejszenie ilości); p_quantity NULL zwraca całą pozycję.
CREATE PROCEDURE sp_task_return_part(
    p_task_id uuid, p_part_id uuid, p_quantity integer, p_staff_id uuid,
    OUT line_quantity integer, OUT stock_after integer)
LANGUAGE plpgsql AS $$
DECLARE
    task_status service_task_status;
    line        record;
    returned    integer;
BEGIN
    SELECT status INTO task_status FROM service_tasks WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF task_status <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'TASK_NOT_IN_PROGRESS' USING ERRCODE = 'raise_exception';
    END IF;
    SELECT quantity, unit_cost INTO line FROM service_task_parts
    WHERE task_id = p_task_id AND part_id = p_part_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TASK_PART_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    returned := COALESCE(p_quantity, line.quantity);
    IF returned <= 0 THEN
        RAISE EXCEPTION 'PART_QUANTITY_INVALID' USING ERRCODE = 'raise_exception';
    END IF;
    IF returned > line.quantity THEN
        RAISE EXCEPTION 'PART_RETURN_EXCEEDS' USING ERRCODE = 'raise_exception', DETAIL = format('%s', line.quantity);
    END IF;
    line_quantity := line.quantity - returned;
    IF line_quantity = 0 THEN
        DELETE FROM service_task_parts WHERE task_id = p_task_id AND part_id = p_part_id;
    ELSE
        UPDATE service_task_parts SET quantity = line_quantity WHERE task_id = p_task_id AND part_id = p_part_id;
    END IF;
    UPDATE spare_parts SET stock_qty = stock_qty + returned, updated_at = now(), version = version + 1
    WHERE id = p_part_id
    RETURNING stock_qty INTO stock_after;
    INSERT INTO spare_part_movements (part_id, kind, delta, stock_after, unit_cost, task_id, staff_id)
    VALUES (p_part_id, 'RETURN', returned, stock_after, line.unit_cost, p_task_id, p_staff_id);
END
$$;

-- Anulowanie zadania zwraca wszystkie części na stan (ruch RETURN z autorem anulowania) i usuwa pozycje, więc koszt
-- anulowanego zadania nie trafia do raportu awaryjności. Wyzwalacz, a nie procedura: zwrot nie zależy od tego,
-- którą drogą zadanie zostało anulowane. Części blokowane w kolejności identyfikatorów (bez zakleszczeń).
CREATE FUNCTION trg_service_task_cancel_parts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    line      record;
    new_stock integer;
BEGIN
    FOR line IN
        SELECT l.part_id, l.quantity, l.unit_cost FROM service_task_parts l
        WHERE l.task_id = NEW.id ORDER BY l.part_id
    LOOP
        UPDATE spare_parts SET stock_qty = stock_qty + line.quantity, updated_at = now(), version = version + 1
        WHERE id = line.part_id
        RETURNING stock_qty INTO new_stock;
        INSERT INTO spare_part_movements (part_id, kind, delta, stock_after, unit_cost, task_id, staff_id, note)
        VALUES (line.part_id, 'RETURN', line.quantity, new_stock, line.unit_cost, NEW.id, NEW.cancelled_by, NEW.cancel_reason);
    END LOOP;
    DELETE FROM service_task_parts WHERE task_id = NEW.id;
    RETURN NULL;
END
$$;
CREATE TRIGGER service_tasks_cancel_parts AFTER UPDATE OF status ON service_tasks
    FOR EACH ROW WHEN (NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED')
    EXECUTE FUNCTION trg_service_task_cancel_parts();

-- =====================================================================
-- Pliki: stan, suma kontrolna, usunięcie obiektu bez usuwania wiersza (ADR 0057)
-- =====================================================================

ALTER TABLE files ADD COLUMN status     file_status NOT NULL DEFAULT 'READY',
                  ADD COLUMN sha256     text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
                  ADD COLUMN deleted_at timestamptz,
                  ADD CONSTRAINT files_deleted_at CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL));
-- Retencja zdjęć parkowania (`files.retention`) i usuwanie nieprzypiętych plików (`files.cleanup`).
CREATE INDEX files_ready_purpose_idx ON files (purpose, created_at) WHERE status = 'READY';

-- =====================================================================
-- Przejazdy: tryb zakończenia, opłata za odholowanie, rozliczenie (ADR 0056, ADR 0060)
-- =====================================================================

ALTER TABLE rentals ADD COLUMN end_mode   rental_end_mode,
                    ADD COLUMN towing_fee bigint CHECK (towing_fee > 0),
                    ADD CONSTRAINT rentals_end_mode_state CHECK (end_mode IS NULL OR state IN ('ENDING', 'ENDED', 'UNPAID')),
                    ADD CONSTRAINT rentals_towing_fee_remote CHECK (towing_fee IS NULL OR end_mode = 'REMOTE');
CREATE INDEX rentals_parking_photo_idx ON rentals (parking_photo_id) WHERE parking_photo_id IS NOT NULL;

-- Obciążenia przejazdu (`RIDE_CHARGE`, `TOWING_FEE`): najwyżej jeden wpis danego typu na przejazd. Warunek wymienia
-- typy, które mogą się powtarzać (doładowanie, zwrot, korekta, wypłata), bo nowej wartości `TOWING_FEE` nie wolno
-- użyć w tej transakcji; każdy przyszły typ obciążenia przejazdu też będzie jednorazowy.
CREATE UNIQUE INDEX wallet_ledger_one_fee_per_rental ON wallet_ledger (rental_id, type)
    WHERE rental_id IS NOT NULL AND type NOT IN ('TOPUP', 'REFUND', 'ADJUSTMENT', 'PAYOUT');
-- Rozliczenie przejazdu czyta wpisy po przejeździe i typie jako tekst.
CREATE INDEX wallet_ledger_rental_idx ON wallet_ledger (rental_id) WHERE rental_id IS NOT NULL;

-- Kwota zapłacona za przejazd: obciążenia portfela (przejazd i opłata za odholowanie) albo udana płatność kartą
-- na całą kwotę z opłatą (ADR 0060), bez odjęcia zwrotów. Limit zwrotu w sp_record_refund korzysta z tej funkcji,
-- więc obejmuje też opłatę.
CREATE OR REPLACE FUNCTION fn_rental_paid_amount(p_rental_id uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT -sum(l.amount) FROM wallet_ledger l
         WHERE l.rental_id = p_rental_id AND l.type::text IN ('RIDE_CHARGE', 'TOWING_FEE')),
        (SELECT p.amount FROM payments p
         WHERE p.rental_id = p_rental_id AND p.purpose = 'RIDE' AND p.status IN ('SUCCEEDED', 'REFUNDED')
         ORDER BY p.created_at DESC LIMIT 1),
        0)::bigint
$$;

-- Przejazd z samą opłatą (wycena 0 zł, bez wpisu RIDE_CHARGE) też jest rozliczony z portfela.
CREATE OR REPLACE FUNCTION fn_rental_settlement(p_rental_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM wallet_ledger l WHERE l.rental_id = p_rental_id
                     AND l.type::text IN ('RIDE_CHARGE', 'TOWING_FEE')) THEN 'WALLET_PAID'
        WHEN EXISTS (SELECT 1 FROM payments p WHERE p.rental_id = p_rental_id AND p.purpose = 'RIDE'
                     AND p.status IN ('SUCCEEDED', 'REFUNDED')) THEN 'CARD_PAID'
        ELSE COALESCE((SELECT CASE p.status WHEN 'PENDING' THEN 'CARD_PENDING' ELSE 'FAILED' END
                       FROM payments p WHERE p.rental_id = p_rental_id AND p.purpose = 'RIDE'
                       ORDER BY p.created_at DESC LIMIT 1), 'NONE')
    END
$$;

-- Komendy: oczekująca blokada przy zakończeniu bez łączności ma `expires_at` za 10 min (ADR 0056), więc przekroczenie
-- czasu liczy się od `expires_at`, nie od `sent_at`. Indeks `scooter_commands_one_pending_per_rental` (LOCK/UNLOCK)
-- zostaje: w ENDING przejazd nie wysyła innej komendy blokady ani odblokowania, a `lock` hulajnogi bez przejazdu
-- i `battery_swapped` nie mają `rental_id`.
CREATE INDEX scooter_commands_pending_expiry_idx ON scooter_commands (expires_at) WHERE status = 'SENT';

-- Kolumny trybu zakończenia, opłaty i zdjęcia dopisane na końcu; reszta jak w 0007.
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
        WHERE c.rental_id = r.id AND c.status = 'SENT' AND c.type IN ('LOCK', 'UNLOCK')) AS pending_command,
       fn_rental_settlement(r.id) AS settlement,
       fn_rental_paid_amount(r.id) AS paid_amount,
       (SELECT COALESCE(sum(f.amount), 0)::bigint FROM refunds f WHERE f.rental_id = r.id AND f.status = 'SUCCEEDED') AS refunded_amount,
       (SELECT COALESCE(sum(f.amount), 0)::bigint FROM refunds f WHERE f.rental_id = r.id AND f.status = 'PENDING') AS refund_pending_amount,
       rc.id AS receipt_id,
       rc.number AS receipt_number,
       r.payment_method_id,
       pm.brand AS card_brand,
       pm.last4 AS card_last4,
       p.failure_reason AS card_failure_reason,
       p.id AS card_payment_id,
       r.end_mode,
       r.towing_fee,
       -- Zdjęcie parkowania jest wymagane po zakończeniu bez łączności (ADR 0056, pytanie 9).
       (r.end_mode IN ('CUSTOMER_OFFLINE', 'UNCONFIRMED') AND r.parking_photo_id IS NULL) AS parking_photo_required,
       COALESCE(pf.status = 'DELETED', false) AS parking_photo_deleted,
       (SELECT min(e.created_at) FROM rental_events e
        WHERE e.rental_id = r.id AND e.type::text = 'BILLING_STOPPED') AS billing_stopped_at,
       EXISTS (SELECT 1 FROM rental_events e WHERE e.rental_id = r.id AND e.type::text = 'MOVED_AFTER_END') AS moved_after_end
FROM rentals r
JOIN users u ON u.id = r.user_id
JOIN scooters s ON s.id = r.scooter_id
JOIN tariffs t ON t.id = r.tariff_id
LEFT JOIN zones ez ON ez.id = r.end_zone_id
LEFT JOIN files pf ON pf.id = r.parking_photo_id
LEFT JOIN receipts rc ON rc.rental_id = r.id AND rc.kind = 'SALE'
LEFT JOIN LATERAL (
    SELECT pay.id, pay.status, pay.failure_reason, pay.payment_method_id FROM payments pay
    WHERE pay.rental_id = r.id AND pay.purpose = 'RIDE'
    ORDER BY pay.created_at DESC LIMIT 1
) p ON true
LEFT JOIN payment_methods pm ON pm.id = COALESCE(p.payment_method_id, r.payment_method_id)
LEFT JOIN wallet_ledger l ON l.rental_id = r.id AND l.type = 'RIDE_CHARGE';

-- Opłata za odholowanie ma paragon przejazdu tak jak obciążenie; reszta jak w 0007.
CREATE OR REPLACE VIEW v_wallet_ledger AS
SELECT l.id, l.created_at, l.user_id, u.name AS user_name, u.phone AS user_phone,
       l.type::text AS type, l.amount, l.balance_after, l.reason, l.note,
       l.rental_id, r.number AS rental_number,
       l.payment_id, p.method AS payment_method, p.provider_payment_id, pm.brand AS card_brand, pm.last4 AS card_last4,
       l.refund_id, f.reason AS refund_reason,
       l.staff_id, s.name AS staff_name,
       COALESCE(rc.id, rcf.id) AS receipt_id, COALESCE(rc.number, rcf.number) AS receipt_number
FROM wallet_ledger l
JOIN users u ON u.id = l.user_id
LEFT JOIN rentals r ON r.id = l.rental_id
LEFT JOIN payments p ON p.id = l.payment_id
LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
LEFT JOIN refunds f ON f.id = l.refund_id
LEFT JOIN staff s ON s.id = l.staff_id
LEFT JOIN receipts rc ON rc.rental_id = l.rental_id AND rc.kind = 'SALE' AND l.type::text IN ('RIDE_CHARGE', 'TOWING_FEE')
LEFT JOIN receipts rcf ON rcf.refund_id = l.refund_id;

-- =====================================================================
-- Powiadomienia: kanał, stan wysyłki, idempotencja, wersje szablonów (ADR 0058)
-- =====================================================================

-- `type` z 0001 to kod szablonu; treść renderuje zadanie `notification.send` z wersji z chwili wysyłki.
ALTER TABLE notifications RENAME COLUMN type TO template_code;
ALTER TABLE notifications ALTER COLUMN sent_at DROP NOT NULL,
                          ALTER COLUMN sent_at DROP DEFAULT,
                          ADD COLUMN channel          notification_channel NOT NULL DEFAULT 'PUSH',
                          ADD COLUMN status           notification_status NOT NULL DEFAULT 'QUEUED',
                          ADD COLUMN error            text,
                          ADD COLUMN dedupe_key       text UNIQUE,              -- np. ride_ended:{rentalId}
                          ADD COLUMN provider_ref     text,                     -- identyfikator u bramki (ticket Expo)
                          ADD COLUMN template_version integer CHECK (template_version > 0),
                          ADD COLUMN title            text,                     -- treść po renderowaniu
                          ADD COLUMN body             text,
                          ADD COLUMN rental_id        uuid REFERENCES rentals(id),
                          ADD COLUMN ticket_id        uuid REFERENCES tickets(id),
                          ADD COLUMN read_at          timestamptz,
                          ADD COLUMN created_at       timestamptz NOT NULL DEFAULT now();
UPDATE notifications SET status = 'SENT', created_at = sent_at WHERE sent_at IS NOT NULL;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_template_code CHECK (template_code ~ '^[a-z_]+$'),
    ADD CONSTRAINT notifications_sent_at CHECK ((status = 'SENT') = (sent_at IS NOT NULL)),
    ADD CONSTRAINT notifications_failed_error CHECK (status <> 'FAILED' OR error IS NOT NULL);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_queued_idx ON notifications (created_at) WHERE status = 'QUEUED';
CREATE INDEX notifications_ticket_idx ON notifications (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX notifications_rental_idx ON notifications (rental_id) WHERE rental_id IS NOT NULL;

-- Token należy do sesji klienta (`sessions`, 0004): wylogowanie usuwa tokeny sesji, a usunięcie wygasłej rodziny
-- sesji (sp_purge_expired_sessions) usuwa też ich tokeny.
ALTER TABLE push_tokens ADD COLUMN session_id   uuid REFERENCES sessions(id) ON DELETE CASCADE,
                        ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);
CREATE INDEX push_tokens_session_idx ON push_tokens (session_id) WHERE session_id IS NOT NULL;

-- Długość źródła szablonu (licznik w edytorze): tytuł 50, treść push 240, SMS 160 znaków.
ALTER TABLE notification_templates
    ADD CONSTRAINT notification_templates_title_length CHECK (title IS NULL OR char_length(title) <= 50),
    ADD CONSTRAINT notification_templates_body_length CHECK (
        char_length(body) <= CASE WHEN channel = 'SMS' THEN 160 ELSE 240 END);

-- Historia treści szablonu: każda wersja to wiersz, przywrócenie to nowa wersja z treścią starej.
CREATE TABLE notification_template_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     uuid NOT NULL REFERENCES notification_templates(id),
    version         integer NOT NULL CHECK (version > 0),
    title           text,
    body            text NOT NULL,
    staff_id        uuid REFERENCES staff(id),              -- NULL: dane startowe
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_id, version)
);
INSERT INTO notification_template_versions (template_id, version, title, body, staff_id, created_at)
SELECT id, version, title, body, updated_by, updated_at FROM notification_templates;

-- Zapis bieżącej wersji przy utworzeniu i zmianie treści; numer to `notification_templates.version` (blokada
-- optymistyczna, ADR 0031), więc zmiana treści bez podniesienia wersji trafia na unikalność (template_id, version).
CREATE FUNCTION trg_notification_template_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body THEN
        INSERT INTO notification_template_versions (template_id, version, title, body, staff_id)
        VALUES (NEW.id, NEW.version, NEW.title, NEW.body, NEW.updated_by);
    END IF;
    RETURN NULL;
END
$$;
CREATE TRIGGER notification_templates_version AFTER INSERT OR UPDATE ON notification_templates
    FOR EACH ROW EXECUTE FUNCTION trg_notification_template_version();

-- =====================================================================
-- Uprawnienia (pytanie 12): Dyspozytor zakłada zadania ze zgłoszenia i obsługuje magazyn
-- =====================================================================

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'service.manage' FROM roles r WHERE r.name = 'Dyspozytor'
ON CONFLICT DO NOTHING;

-- =====================================================================
-- Widoki list w panelu (wymaganie 12, ADR 0031)
-- =====================================================================

-- Zgłoszenia z hulajnogą, zgłaszającym, przypisanym, zdjęciami, ostatnim zadaniem i zwrotami.
CREATE VIEW v_ticket_list AS
SELECT t.id, t.number, t.status, t.urgent, t.categories, t.source, t.auto_kind, t.description,
       t.scooter_id, s.number AS scooter_number, s.status AS scooter_status,
       t.rental_id, r.number AS rental_number,
       t.reported_by, u.name AS reporter_name, u.phone AS reporter_phone,
       t.assignee_id, a.name AS assignee_name,
       (SELECT count(*)::integer FROM ticket_photos p WHERE p.ticket_id = t.id) AS photos,
       (SELECT count(*)::integer FROM service_tasks x
        WHERE x.ticket_id = t.id AND x.status IN ('OPEN', 'IN_PROGRESS')) AS open_tasks,
       lt.id AS service_task_id, lt.number AS service_task_number, lt.status AS service_task_status,
       (SELECT COALESCE(sum(f.amount), 0)::bigint FROM refunds f
        WHERE f.ticket_id = t.id AND f.status = 'SUCCEEDED') AS refunded_amount,
       t.customer_reply, t.customer_reply_at, t.customer_reply_read_at, t.resolution_note,
       t.created_at, t.updated_at, t.resolved_at, t.version,
       floor(extract(epoch FROM now() - t.created_at))::integer AS age_seconds
FROM tickets t
JOIN scooters s ON s.id = t.scooter_id
LEFT JOIN rentals r ON r.id = t.rental_id
LEFT JOIN users u ON u.id = t.reported_by
LEFT JOIN staff a ON a.id = t.assignee_id
LEFT JOIN LATERAL (
    SELECT x.id, x.number, x.status FROM service_tasks x
    WHERE x.ticket_id = t.id ORDER BY x.created_at DESC LIMIT 1
) lt ON true;

-- Zadania serwisowe z hulajnogą, wykonawcą, zgłoszeniem, celem przewiezienia i kosztem części.
CREATE VIEW v_service_task_list AS
SELECT st.id, st.number, st.type, st.status, st.priority, st.description, st.result_note, st.cancel_reason,
       st.scooter_id, s.number AS scooter_number, s.status AS scooter_status,
       st.assignee_id, a.name AS assignee_name,
       st.created_by, c.name AS created_by_name,
       st.due_at,
       (st.status IN ('OPEN', 'IN_PROGRESS') AND st.due_at IS NOT NULL AND st.due_at < now()) AS overdue,
       st.ticket_id, t.number AS ticket_number, t.categories AS ticket_categories,
       st.target_zone_id, z.code AS target_zone_code, z.name AS target_zone_name,
       ST_Y(st.target_point) AS target_lat, ST_X(st.target_point) AS target_lon,
       COALESCE(pt.parts_count, 0) AS parts_count,
       COALESCE(pt.parts_cost, 0)::bigint AS parts_cost,
       st.cancelled_by, cb.name AS cancelled_by_name,
       st.created_at, st.started_at, st.completed_at, st.updated_at, st.version
FROM service_tasks st
JOIN scooters s ON s.id = st.scooter_id
LEFT JOIN staff a ON a.id = st.assignee_id
LEFT JOIN staff c ON c.id = st.created_by
LEFT JOIN staff cb ON cb.id = st.cancelled_by
LEFT JOIN tickets t ON t.id = st.ticket_id
LEFT JOIN zones z ON z.id = st.target_zone_id
LEFT JOIN LATERAL (
    SELECT count(*)::integer AS parts_count, sum(p.quantity * p.unit_cost) AS parts_cost
    FROM service_task_parts p WHERE p.task_id = st.id
) pt ON true;

-- Części w zadaniu (szczegóły zadania i protokół w iteracji 7) z bieżącym stanem magazynu.
CREATE VIEW v_service_task_parts AS
SELECT l.task_id, st.number AS task_number, l.part_id, p.sku, p.name, l.quantity, l.unit_cost,
       (l.quantity * l.unit_cost)::bigint AS amount, p.stock_qty
FROM service_task_parts l
JOIN service_tasks st ON st.id = l.task_id
JOIN spare_parts p ON p.id = l.part_id;

-- Magazyn: stan względem minimum, zużycie z 30 dni (użycia minus zwroty) i ostatni ruch.
CREATE VIEW v_spare_part_list AS
SELECT p.id, p.sku, p.name, p.unit_cost, p.stock_qty, p.min_stock_qty,
       p.stock_qty < p.min_stock_qty AS below_minimum,
       p.active, p.created_at, p.updated_at, p.version,
       COALESCE((SELECT -sum(m.delta) FROM spare_part_movements m
                 WHERE m.part_id = p.id AND m.kind IN ('USE', 'RETURN')
                   AND m.created_at >= now() - interval '30 days'), 0)::integer AS used_30d,
       lm.created_at AS last_movement_at, lm.kind AS last_movement_kind, lm.delta AS last_movement_delta,
       lm.task_number AS last_movement_task_number,
       EXISTS (SELECT 1 FROM service_task_parts l WHERE l.part_id = p.id) AS used_in_tasks
FROM spare_parts p
LEFT JOIN LATERAL (
    SELECT m.created_at, m.kind, m.delta, st.number AS task_number FROM spare_part_movements m
    LEFT JOIN service_tasks st ON st.id = m.task_id
    WHERE m.part_id = p.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
) lm ON true;

-- Ruchy magazynowe z częścią, zadaniem, hulajnogą i operatorem (historia części, raport w iteracji 8).
CREATE VIEW v_spare_part_movements AS
SELECT m.id, m.created_at, m.part_id, p.sku, p.name AS part_name, m.kind, m.delta, m.stock_after, m.unit_cost,
       m.task_id, st.number AS task_number, st.scooter_id, s.number AS scooter_number,
       m.staff_id, sf.name AS staff_name, m.document, m.reason, m.note
FROM spare_part_movements m
JOIN spare_parts p ON p.id = m.part_id
LEFT JOIN service_tasks st ON st.id = m.task_id
LEFT JOIN scooters s ON s.id = st.scooter_id
LEFT JOIN staff sf ON sf.id = m.staff_id;

-- Szablony powiadomień z autorem zmiany, liczbą wersji i ostatnią wysyłką.
CREATE VIEW v_notification_templates AS
SELECT nt.id, nt.code, nt.channel, nt.title, nt.body, nt.description, nt.version,
       nt.created_at, nt.updated_at, nt.updated_by, s.name AS updated_by_name,
       (SELECT count(*)::integer FROM notification_template_versions v WHERE v.template_id = nt.id) AS versions,
       (SELECT max(n.sent_at) FROM notifications n
        WHERE n.template_code = nt.code AND n.channel = nt.channel AND n.status = 'SENT') AS last_sent_at,
       (SELECT count(*)::integer FROM notifications n
        WHERE n.template_code = nt.code AND n.channel = nt.channel AND n.created_at >= now() - interval '30 days') AS sent_30d
FROM notification_templates nt
LEFT JOIN staff s ON s.id = nt.updated_by;

-- Wersje szablonu (historia w edytorze: porównanie i przywrócenie).
CREATE VIEW v_notification_template_versions AS
SELECT v.id, v.template_id, nt.code, nt.channel, v.version, v.title, v.body, v.staff_id, s.name AS staff_name,
       v.created_at, v.version = nt.version AS is_current
FROM notification_template_versions v
JOIN notification_templates nt ON nt.id = v.template_id
LEFT JOIN staff s ON s.id = v.staff_id;

-- Wysłane powiadomienia (zakładka „Wysłane”) z klientem, przejazdem i zgłoszeniem.
CREATE VIEW v_notification_list AS
SELECT n.id, n.created_at, n.sent_at, n.status, n.channel, n.template_code, n.template_version,
       n.title, n.body, n.error, n.dedupe_key, n.provider_ref, n.read_at, n.payload,
       n.user_id, u.name AS user_name, u.phone AS user_phone,
       n.rental_id, r.number AS rental_number,
       n.ticket_id, t.number AS ticket_number
FROM notifications n
JOIN users u ON u.id = n.user_id
LEFT JOIN rentals r ON r.id = n.rental_id
LEFT JOIN tickets t ON t.id = n.ticket_id;

-- Tokeny push z klientem i stanem sesji.
CREATE VIEW v_push_tokens AS
SELECT pt.id, pt.user_id, u.name AS user_name, u.phone AS user_phone, pt.platform, pt.expo_token,
       pt.session_id, COALESCE(ss.revoked_at IS NULL AND ss.expires_at > now(), false) AS session_active,
       pt.created_at, pt.last_seen_at
FROM push_tokens pt
JOIN users u ON u.id = pt.user_id
LEFT JOIN sessions ss ON ss.id = pt.session_id;

-- Pliki z autorem i miejscem użycia (zdjęcie parkowania przejazdu albo zdjęcie zgłoszenia).
CREATE VIEW v_file_list AS
SELECT f.id, f.storage_key, f.purpose, f.status, f.content_type, f.size_bytes, f.sha256, f.original_name,
       f.uploaded_by, u.name AS uploaded_by_name, f.uploaded_by_staff, sf.name AS uploaded_by_staff_name,
       f.created_at, f.deleted_at,
       pr.id AS rental_id, pr.number AS rental_number,
       tp.ticket_id, tk.number AS ticket_number,
       (pr.id IS NOT NULL OR tp.ticket_id IS NOT NULL) AS attached
FROM files f
LEFT JOIN users u ON u.id = f.uploaded_by
LEFT JOIN staff sf ON sf.id = f.uploaded_by_staff
LEFT JOIN LATERAL (SELECT r.id, r.number FROM rentals r WHERE r.parking_photo_id = f.id LIMIT 1) pr ON true
LEFT JOIN LATERAL (SELECT p.ticket_id FROM ticket_photos p WHERE p.file_id = f.id LIMIT 1) tp ON true
LEFT JOIN tickets tk ON tk.id = tp.ticket_id;

-- Oś czasu zgłoszenia (D6): utworzenie przez klienta, wpisy dziennika audytu zgłoszenia, jego zadań i zwrotów
-- (`rental.refunded` z `data.refundId`), wynik zwrotu u operatora płatności i powiadomienia do klienta.
-- Wpisy z jednej transakcji mają ten sam czas; kolejność w obrębie czasu wyznacza `kind_order` i `seq` (kolejność zapisu).
CREATE VIEW v_ticket_timeline AS
SELECT t.id AS ticket_id, t.created_at AS at, 'CREATED'::text AS kind, 0 AS kind_order, 0::bigint AS seq, t.number::text AS ref,
       'ticket.created'::text AS action, 'ticket'::text AS entity_type, t.id AS entity_id,
       'CUSTOMER'::text AS actor, NULL::uuid AS staff_id, NULL::text AS staff_name,
       jsonb_build_object('categories', t.categories, 'rentalId', t.rental_id,
                          'photos', (SELECT count(*) FROM ticket_photos p WHERE p.ticket_id = t.id)) AS data
FROM tickets t
WHERE t.source = 'USER'
UNION ALL
SELECT x.ticket_id, a.created_at, 'AUDIT', 1, a.id, a.id::text, a.action, a.entity_type, a.entity_id,
       a.actor::text, a.staff_id, s.name, a.data
FROM (
    SELECT t.id AS ticket_id, 'ticket'::text AS entity_type, t.id AS entity_id FROM tickets t
    UNION ALL
    SELECT st.ticket_id, 'service_task', st.id FROM service_tasks st WHERE st.ticket_id IS NOT NULL
) x
JOIN audit_log a ON a.entity_type = x.entity_type AND a.entity_id = x.entity_id
LEFT JOIN staff s ON s.id = a.staff_id
UNION ALL
SELECT f.ticket_id, a.created_at, 'AUDIT', 1, a.id, a.id::text, a.action, a.entity_type, a.entity_id,
       a.actor::text, a.staff_id, s.name, a.data
FROM refunds f
JOIN audit_log a ON a.entity_type = 'rental' AND a.entity_id = f.rental_id AND a.data->>'refundId' = f.id::text
LEFT JOIN staff s ON s.id = a.staff_id
WHERE f.ticket_id IS NOT NULL
UNION ALL
SELECT f.ticket_id, f.updated_at, 'REFUND', 2, 0, f.id::text, 'refund.' || lower(f.status::text), 'refund', f.id,
       'SYSTEM', NULL, NULL,
       jsonb_build_object('amount', f.amount, 'source', f.source, 'status', f.status, 'failureReason', f.failure_reason)
FROM refunds f
WHERE f.ticket_id IS NOT NULL AND f.status <> 'PENDING'
UNION ALL
SELECT n.ticket_id, COALESCE(n.sent_at, n.created_at), 'NOTIFICATION', 3, n.id, n.id::text, n.template_code,
       'notification', NULL, 'SYSTEM', NULL, NULL,
       jsonb_build_object('status', n.status, 'channel', n.channel, 'templateVersion', n.template_version, 'error', n.error)
FROM notifications n
WHERE n.ticket_id IS NOT NULL;

-- =====================================================================
-- Pulpit „Wymaga uwagi” (D1)
-- =====================================================================

-- Liczby grup pulpitu: hulajnogi offline w przejeździe, przejazdy z zatrzymanym naliczaniem, krytyczna bateria
-- (wolne, zarezerwowane i w przejeździe), nowe pilne zgłoszenia bez przypisania, nieudane płatności z dzisiejszego
-- dnia w strefie operatora i zaległości. Próg krytycznej baterii przekazuje core (jak próg w fn_nearest_scooters).
CREATE FUNCTION fn_dashboard_attention(p_critical_battery_pct integer)
RETURNS TABLE (offline_in_rental integer, billing_stopped integer, critical_battery integer,
               urgent_new_unassigned integer, failed_payments_today integer, unpaid_rentals integer)
LANGUAGE sql STABLE AS $$
    SELECT
        (SELECT count(*)::integer FROM rentals r JOIN scooters s ON s.id = r.scooter_id
         WHERE r.state IN ('UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING') AND NOT s.online),
        (SELECT count(*)::integer FROM rentals r
         WHERE r.state IN ('ACTIVE', 'PAUSED', 'ENDING')
           AND EXISTS (SELECT 1 FROM rental_events e WHERE e.rental_id = r.id AND e.type::text = 'BILLING_STOPPED')),
        (SELECT count(*)::integer FROM scooters s
         WHERE s.status IN ('AVAILABLE', 'RESERVED', 'IN_USE') AND COALESCE(s.battery_pct, 0) < p_critical_battery_pct),
        (SELECT count(*)::integer FROM tickets t WHERE t.status = 'NEW' AND t.urgent AND t.assignee_id IS NULL),
        (SELECT count(*)::integer FROM payments p
         WHERE p.status = 'FAILED'
           AND (p.updated_at AT TIME ZONE 'Europe/Warsaw')::date = (now() AT TIME ZONE 'Europe/Warsaw')::date),
        (SELECT count(*)::integer FROM rentals r WHERE r.state = 'UNPAID')
$$;
