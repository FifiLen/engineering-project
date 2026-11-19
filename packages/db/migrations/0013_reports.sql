-- 0013: raporty i domknięcie panelu (iteracja 8, ADR 0071–0076): uprawnienie `reports.manage`, uruchomienia raportów
-- z chwilą danych, kodem błędu, liczbą wierszy i stron oraz retencją pliku, historia stanów hulajnogi z wyzwalaczami
-- i przyczyną w widoku, funkcje raportowe `fn_report_*` z okresem półotwartym [p_from, p_to) i dobami w strefie
-- Europe/Warsaw, indeksy pod raporty, brakujące kolumny z ADR 0076 (źródło zgody i komendy, urządzenie sesji, cel
-- kodu SMS, zapamiętanie sesji operatora, zastąpienie zaproszenia, wersja opisu uprawnienia, dezaktywacja szablonu,
-- `locked` i `buffered` w telemetrii), dezaktywacja i ponowna aktywacja szablonu wydruku, widoki nowych list panelu.
-- Wskaźniki, porównania i udziały liczy packages/core z wierszy tych funkcji; baza agreguje dane w okresie.
--
-- Cel pliku raportu: typ `file_purpose` ma od 0002 wartość `REPORT_EXPORT` (etykieta „Raport” w panelu), więc ta
-- migracja nie dodaje osobnej wartości `REPORT`. Eksport list działa strumieniem bez pliku w magazynie (ADR 0073),
-- więc `LIST_EXPORT` też nie jest potrzebny. Migracja nie dodaje nowych wartości do istniejących typów, więc może
-- używać wszystkich wartości w tej samej transakcji.

-- Nierozłączne przedziały historii stanów pilnuje ograniczenie wykluczające (`scooter_id WITH =` wymaga btree_gist,
-- rozszerzenia z contrib, zaufanego od PostgreSQL 13).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Nowe typy (nie nowe wartości), więc można ich używać w tej migracji.
CREATE TYPE consent_source   AS ENUM ('REGISTRATION', 'APP', 'PANEL');          -- skąd pochodzi zgoda (ADR 0076)
CREATE TYPE otp_purpose      AS ENUM ('LOGIN', 'REGISTER');                     -- cel kodu SMS (ADR 0076)
CREATE TYPE command_source   AS ENUM ('STAFF', 'RENTAL', 'ZONE', 'SYSTEM');     -- źródło komendy MQTT (ADR 0076)
-- Platforma aplikacji przy logowaniu; `platform` z 0001 (tokeny push) nie ma wersji web aplikacji Expo.
CREATE TYPE session_platform AS ENUM ('IOS', 'ANDROID', 'WEB');

-- =====================================================================
-- Uprawnienia: `reports.manage` i opis edytowany w panelu (ADR 0071, ADR 0076)
-- =====================================================================

-- Nazwa, opis, aktywność i kolejność definicji raportów (pytanie 8): tylko Administrator. Parametry i formaty pochodzą
-- z katalogu raportów w packages/core.
INSERT INTO permissions (code, module, description) VALUES
    ('reports.manage', 'reports', 'Nazwy, opisy, aktywność i kolejność definicji raportów');
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'reports.manage' FROM roles r WHERE r.name = 'Administrator' AND r.is_system
ON CONFLICT DO NOTHING;

-- Opis uprawnienia zmienia Administrator na zakładce Role → Uprawnienia z blokadą optymistyczną; `updated_by` pusty
-- znaczy opis z migracji, więc synchronizacja katalogu z kodu nie nadpisze opisu zmienionego w panelu. Opis pokazuje
-- dymek macierzy roli, stąd 160 znaków.
ALTER TABLE permissions
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN updated_by uuid REFERENCES staff(id),
    ADD COLUMN version    integer NOT NULL DEFAULT 1,
    ADD CONSTRAINT permissions_description_check CHECK (btrim(description) <> '' AND char_length(description) <= 160);

-- =====================================================================
-- Definicje i uruchomienia raportów (ADR 0071)
-- =====================================================================

-- Nazwa i opis z panelu trafiają do katalogu, podglądu, PDF i XLSX (plansza `raport-definicja`: 1–80 i 300 znaków).
ALTER TABLE report_definitions
    ADD CONSTRAINT report_definitions_name_check CHECK (btrim(name) <> '' AND char_length(name) <= 80),
    ADD CONSTRAINT report_definitions_description_check CHECK (char_length(description) <= 300);

-- `data_as_of`: czas transakcji odczytu danych (nagłówek i stopka pliku); `error_code` osobno od opisu w `error`
-- (np. REPORT_RENDER_TIMEOUT, REPORT_TIMEOUT); `row_count` wszystkich wierszy tabel raportu, `page_count` stron PDF;
-- `file_deleted_at` po retencji 30 dni (stan „Plik usunięty” to SUCCEEDED z tą datą, wiersz zostaje na zawsze);
-- `retry_of` przy „Ponów” i „Uruchom ponownie z tymi parametrami” (nowy wiersz, pytanie 6). Raporty są w PDF
-- i XLSX; CSV z typu `report_format` zostaje dla eksportu list (pytanie 4).
ALTER TABLE report_runs
    ADD COLUMN data_as_of      timestamptz,
    ADD COLUMN error_code      text,
    ADD COLUMN row_count       integer,
    ADD COLUMN page_count      integer,
    ADD COLUMN file_deleted_at timestamptz,
    ADD COLUMN retry_of        uuid REFERENCES report_runs(id),
    DROP CONSTRAINT report_runs_check1;   -- FAILED wymagał opisu `error`; teraz kodu `error_code`
UPDATE report_runs SET error_code = 'REPORT_FAILED' WHERE status = 'FAILED';
UPDATE report_runs SET finished_at = COALESCE(finished_at, created_at) WHERE status IN ('SUCCEEDED', 'FAILED');
ALTER TABLE report_runs
    ADD CONSTRAINT report_runs_format_check CHECK (format <> 'CSV'),
    ADD CONSTRAINT report_runs_failed_code CHECK (status <> 'FAILED' OR error_code IS NOT NULL),
    ADD CONSTRAINT report_runs_error_code CHECK (error_code ~ '^[A-Z_]+$'),
    ADD CONSTRAINT report_runs_finished CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (finished_at IS NOT NULL)),
    ADD CONSTRAINT report_runs_data_as_of CHECK (status <> 'SUCCEEDED' OR data_as_of IS NOT NULL),
    ADD CONSTRAINT report_runs_counts CHECK (row_count >= 0 AND page_count > 0),
    ADD CONSTRAINT report_runs_file_deleted CHECK (file_deleted_at IS NULL OR status = 'SUCCEEDED'),
    ADD CONSTRAINT report_runs_retry_other CHECK (retry_of <> id);

-- Historia (domyślnie od najnowszych, filtrowana po raportach z uprawnieniem; indeksy raportu i zlecającego są
-- z 0002), porządki `reports.sweep` (wiersze w kolejce i w toku po restarcie API) i `reports.retention` (pliki
-- gotowych raportów starsze niż 30 dni).
CREATE INDEX report_runs_created_idx ON report_runs (created_at DESC);
CREATE INDEX report_runs_open_idx ON report_runs (created_at) WHERE status IN ('QUEUED', 'RUNNING');
CREATE INDEX report_runs_retention_idx ON report_runs (finished_at) WHERE status = 'SUCCEEDED' AND file_deleted_at IS NULL;
CREATE INDEX report_runs_retry_idx ON report_runs (retry_of) WHERE retry_of IS NOT NULL;

-- =====================================================================
-- Kolumny z ADR 0076 (domknięcie macierzy operacji)
-- =====================================================================

-- Zgody: źródło (rejestracja, aplikacja, panel) zapisuje API przy akceptacji; stare wiersze nie mają źródła (lista
-- pokazuje „brak danych”). Operator wycofuje tylko zgodę marketingową; regulamin, polityka i wiek są warunkami konta.
ALTER TABLE consents
    ADD COLUMN source           consent_source,
    ADD COLUMN revoked_by_staff uuid REFERENCES staff(id),
    ADD CONSTRAINT consents_revoked_by_staff CHECK (
        revoked_by_staff IS NULL OR (revoked_at IS NOT NULL AND type = 'MARKETING'));

-- Sesje klienta: platforma i wersja aplikacji z żądania logowania (opcjonalne, stare wiersze bez nich).
ALTER TABLE sessions
    ADD COLUMN platform    session_platform,
    ADD COLUMN app_version text,
    ADD CONSTRAINT sessions_app_version CHECK (btrim(app_version) <> '' AND char_length(app_version) <= 32);

-- Kody SMS: cel ustala API przy wysłaniu (domyślnie logowanie, żeby istniejące wstawienia działały). Stare kody bez
-- konta o tym numerze założonego przed kodem to rejestracja.
ALTER TABLE otp_codes ADD COLUMN purpose otp_purpose NOT NULL DEFAULT 'LOGIN';
UPDATE otp_codes o SET purpose = 'REGISTER'
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.phone = o.phone AND u.created_at <= o.created_at);
CREATE INDEX otp_codes_created_idx ON otp_codes (created_at DESC);

-- Komendy: źródło i strefa komendy strefy. Wyzwalacz `scooter_commands_source` uzupełnia źródło, gdy wstawienie go nie
-- podaje (operator przy `issued_by_staff`, strefa przy komendzie strefy przejazdu, przejazd przy `rental_id`, reszta
-- system), więc dotychczasowe wstawienia działają; strefę (`zone_id`) podaje API przy komendzie strefy.
ALTER TABLE scooter_commands
    ADD COLUMN source  command_source,
    ADD COLUMN zone_id uuid REFERENCES zones(id);
UPDATE scooter_commands SET source = CASE
    WHEN issued_by_staff IS NOT NULL THEN 'STAFF'
    WHEN rental_id IS NOT NULL AND type IN ('SPEED_LIMIT', 'STOP_GRADUALLY', 'RELEASE_STOP') THEN 'ZONE'
    WHEN rental_id IS NOT NULL THEN 'RENTAL'
    ELSE 'SYSTEM' END::command_source;
ALTER TABLE scooter_commands
    ALTER COLUMN source SET NOT NULL,
    ADD CONSTRAINT scooter_commands_staff_source CHECK ((source = 'STAFF') = (issued_by_staff IS NOT NULL)),
    ADD CONSTRAINT scooter_commands_zone_source CHECK (zone_id IS NULL OR source = 'ZONE');
CREATE INDEX scooter_commands_sent_idx ON scooter_commands (sent_at DESC);
CREATE INDEX scooter_commands_zone_idx ON scooter_commands (zone_id) WHERE zone_id IS NOT NULL;

CREATE FUNCTION trg_scooter_command_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source IS NULL THEN
        NEW.source := CASE
            WHEN NEW.issued_by_staff IS NOT NULL THEN 'STAFF'
            WHEN NEW.rental_id IS NOT NULL AND NEW.type IN ('SPEED_LIMIT', 'STOP_GRADUALLY', 'RELEASE_STOP') THEN 'ZONE'
            WHEN NEW.rental_id IS NOT NULL THEN 'RENTAL'
            ELSE 'SYSTEM' END;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER scooter_commands_source BEFORE INSERT ON scooter_commands
    FOR EACH ROW EXECUTE FUNCTION trg_scooter_command_source();

-- Zaproszenia: ponowne wysłanie unieważnia poprzednie i wskazuje następcę (odróżnienie od ręcznego unieważnienia).
-- Stare wiersze: następca to zaproszenie tego samego operatora utworzone w chwili unieważnienia (repozytorium robi
-- oba zapisy w jednej transakcji).
ALTER TABLE staff_invitations
    ADD COLUMN replaced_by uuid REFERENCES staff_invitations(id),
    ADD CONSTRAINT staff_invitations_replaced_is_revoked CHECK (replaced_by IS NULL OR revoked_at IS NOT NULL),
    ADD CONSTRAINT staff_invitations_replaced_other CHECK (replaced_by <> id);
UPDATE staff_invitations i SET replaced_by = (
    SELECT n.id FROM staff_invitations n
    WHERE n.staff_id = i.staff_id AND n.id <> i.id
      AND n.created_at BETWEEN i.revoked_at - interval '5 seconds' AND i.revoked_at + interval '5 seconds'
    ORDER BY n.created_at LIMIT 1)
WHERE i.revoked_at IS NOT NULL;

-- Sesje operatora: „Zapamiętaj to urządzenie” (7 dni zamiast 12 h). Stare wiersze z ważnością dłuższą niż 13 h.
ALTER TABLE staff_sessions ADD COLUMN remembered boolean NOT NULL DEFAULT false;
UPDATE staff_sessions SET remembered = true WHERE expires_at - created_at > interval '13 hours';

-- Szablony wydruków: data dezaktywacji (`sp_document_template_deactivate`); nieaktywne sprzed migracji z datą zmiany.
ALTER TABLE document_templates ADD COLUMN deactivated_at timestamptz;
UPDATE document_templates SET deactivated_at = updated_at WHERE NOT active;
ALTER TABLE document_templates
    ADD CONSTRAINT document_templates_deactivated CHECK ((deactivated_at IS NULL) = active);

-- Telemetria: pola `locked` i `buffered` z kontraktu MQTT (Telemetry); stare odczyty bez nich. Kolumny dochodzą do
-- wszystkich partycji tabeli partycjonowanej.
ALTER TABLE telemetry
    ADD COLUMN locked   boolean,
    ADD COLUMN buffered boolean;

-- =====================================================================
-- Historia stanów hulajnogi (ADR 0074)
-- =====================================================================

-- Przedziały [valid_from, valid_to) stanu i łączności; przedział otwarty ma `valid_to` NULL. Tylko do dopisywania:
-- jedyna dozwolona zmiana to jednorazowe zamknięcie otwartego przedziału. Przedziały jednej hulajnogi się nie
-- nakładają (ograniczenie wykluczające, które jest też indeksem GiST dla zapytań o okres), więc raport może sumować
-- przedziały przycięte do okresu. Zmiana stanu i łączności w jednej transakcji daje przedział zerowej długości
-- (widok listy go pomija).
CREATE TABLE scooter_status_history (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scooter_id  uuid NOT NULL REFERENCES scooters(id) ON DELETE CASCADE,
    status      scooter_status NOT NULL,
    online      boolean NOT NULL,
    valid_from  timestamptz NOT NULL,
    valid_to    timestamptz,
    CONSTRAINT scooter_status_history_range CHECK (valid_to >= valid_from),
    CONSTRAINT scooter_status_history_no_overlap
        EXCLUDE USING gist (scooter_id WITH =, tstzrange(valid_from, valid_to) WITH &&)
);
CREATE UNIQUE INDEX scooter_status_history_one_open ON scooter_status_history (scooter_id) WHERE valid_to IS NULL;
CREATE INDEX scooter_status_history_scooter_idx ON scooter_status_history (scooter_id, valid_from DESC);
COMMENT ON TABLE scooter_status_history IS
    'Przedziały stanu i łączności hulajnogi z wyzwalaczy na scooters; tylko do dopisywania (ADR 0074)';

-- Zmiana stanu albo łączności zamyka otwarty przedział i otwiera nowy w czasie transakcji (jak procedury). Wyzwalacz
-- jest AFTER, więc widzi stan po wyzwalaczu `scooters_status` (BEFORE), który może zamienić AVAILABLE na MAINTENANCE.
-- Transakcja, która zaczęła się przed zatwierdzeniem innej zmiany tej hulajnogi (czeka na blokadę wiersza), ma
-- starszy `now()`, więc granica to późniejszy z czasu transakcji i początku otwartego przedziału.
CREATE FUNCTION trg_scooter_status_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    at timestamptz := now();
    open_from timestamptz;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT valid_from INTO open_from FROM scooter_status_history
        WHERE scooter_id = NEW.id AND valid_to IS NULL FOR UPDATE;
        IF FOUND THEN
            at := GREATEST(at, open_from);
            UPDATE scooter_status_history SET valid_to = at WHERE scooter_id = NEW.id AND valid_to IS NULL;
        END IF;
    END IF;
    INSERT INTO scooter_status_history (scooter_id, status, online, valid_from) VALUES (NEW.id, NEW.status, NEW.online, at);
    RETURN NULL;
END
$$;
CREATE TRIGGER scooters_status_history_insert AFTER INSERT ON scooters
    FOR EACH ROW EXECUTE FUNCTION trg_scooter_status_history();
-- `setConnection` zapisuje też powtórzony stan łączności (po restarcie API), więc wyzwalacz porównuje wartości.
CREATE TRIGGER scooters_status_history AFTER UPDATE OF status, online ON scooters
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.online IS DISTINCT FROM NEW.online)
    EXECUTE FUNCTION trg_scooter_status_history();

-- Tylko do dopisywania: aktualizacja może wyłącznie raz ustawić `valid_to` otwartego przedziału (nie wcześniej niż
-- `valid_from`); usunąć wiersz może tylko kaskada po usunięciu hulajnogi (hulajnogi bez przejazdów, np. w testach).
CREATE FUNCTION trg_scooter_status_history_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF EXISTS (SELECT 1 FROM scooters WHERE id = OLD.scooter_id) THEN
            RAISE EXCEPTION 'STATUS_HISTORY_APPEND_ONLY' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL OR NEW.valid_to < OLD.valid_from
       OR NEW.id <> OLD.id OR NEW.scooter_id <> OLD.scooter_id OR NEW.status <> OLD.status
       OR NEW.online <> OLD.online OR NEW.valid_from <> OLD.valid_from THEN
        RAISE EXCEPTION 'STATUS_HISTORY_APPEND_ONLY' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER scooter_status_history_rules BEFORE UPDATE OR DELETE ON scooter_status_history
    FOR EACH ROW EXECUTE FUNCTION trg_scooter_status_history_rules();

-- Historia zaczyna się od tej migracji (pytanie 13): przedział otwarty dla każdej istniejącej hulajnogi.
INSERT INTO scooter_status_history (scooter_id, status, online, valid_from)
SELECT id, status, online, now() FROM scooters;

-- Kategoria czasu (rozłączne, suma równa czasowi okresu poza RETIRED; ADR 0074): w przejeździe (IN_USE, także bez
-- łączności: przejazd trwa i jest rozliczany), serwis (MAINTENANCE, także bez łączności), rezerwacja (RESERVED
-- z łącznością), dostępna (AVAILABLE z łącznością), bez łączności (AVAILABLE albo RESERVED bez łączności), wyłączona
-- (RETIRED). Ta sama reguła co w packages/core (wskaźniki: wykorzystanie = IN_RIDE ÷ czas okresu, dostępność =
-- (AVAILABLE + RESERVED + IN_RIDE) ÷ czas okresu).
CREATE FUNCTION fn_scooter_time_category(p_status scooter_status, p_online boolean) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_status = 'IN_USE' THEN 'IN_RIDE'
        WHEN p_status = 'MAINTENANCE' THEN 'SERVICE'
        WHEN p_status = 'RETIRED' THEN 'RETIRED'
        WHEN NOT p_online THEN 'OFFLINE'
        WHEN p_status = 'RESERVED' THEN 'RESERVED'
        ELSE 'AVAILABLE' END
$$;

-- Zakładka „Historia stanów” na karcie hulajnogi (`scooters.read`). Przyczyna to dopasowanie w czasie (pierwsze
-- dopasowanie, ADR 0074): przejazd albo rezerwacja nakładające się na przedział IN_USE/RESERVED, zadanie serwisowe
-- (nieanulowane najpierw), potem zgłoszenie przy MAINTENANCE, zgłoszenie automatyczne OFFLINE przy braku łączności,
-- wpis operatora w dzienniku audytu hulajnogi w chwili `valid_from` (±5 s), inaczej NO_TELEMETRY (bez łączności)
-- albo SYSTEM. Przedziały zerowej długości (dwie zmiany w jednej transakcji) są pominięte.
CREATE VIEW v_scooter_status_history AS
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
    WHERE h.status IN ('IN_USE', 'RESERVED') AND r.scooter_id = h.scooter_id
      AND COALESCE(r.reserved_at, r.started_at, r.created_at) < COALESCE(h.valid_to, 'infinity')
      AND COALESCE(r.ended_at, 'infinity') > h.valid_from
    ORDER BY COALESCE(r.reserved_at, r.started_at, r.created_at) DESC LIMIT 1) rn ON true
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
-- Funkcje raportowe (ADR 0071, D1)
-- =====================================================================
-- Wspólne zasady: okres półotwarty [p_from, p_to) jako timestamptz (granice dób Europe/Warsaw liczy core albo
-- `fn_report_buckets`), kwoty w groszach (bigint), czasy w sekundach, dystans w metrach, liczby jako integer.
-- Funkcje są STABLE i zwracają tabele; podgląd woła je w jednej transakcji REPEATABLE READ READ ONLY, więc wszystkie
-- sekcje widzą te same dane, a `now()` to chwila danych. Porównanie z poprzednim okresem to drugie wywołanie z innym
-- okresem. Funkcje nie zwracają danych osobowych.

-- Przedziały szeregu czasowego: doba, tydzień od poniedziałku albo miesiąc kalendarzowy w strefie Europe/Warsaw,
-- przycięte do okresu (pierwszy i ostatni mogą być niepełne). Doba zmiany czasu ma 23 albo 25 godzin, bo granice to
-- lokalne północe zamienione na timestamptz. `bucket` to data początku przedziału w czasie polskim.
CREATE FUNCTION fn_report_buckets(p_from timestamptz, p_to timestamptz, p_granularity text)
RETURNS TABLE (bucket date, bucket_from timestamptz, bucket_to timestamptz)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_granularity IS NULL OR p_granularity NOT IN ('day', 'week', 'month') THEN
        RAISE EXCEPTION 'REPORT_INVALID_GRANULARITY' USING ERRCODE = 'raise_exception', DETAIL = COALESCE(p_granularity, '');
    END IF;
    RETURN QUERY
    SELECT d::date,
           GREATEST(p_from, d AT TIME ZONE 'Europe/Warsaw'),
           LEAST(p_to, (d + ('1 ' || p_granularity)::interval) AT TIME ZONE 'Europe/Warsaw')
    FROM generate_series(date_trunc(p_granularity, p_from AT TIME ZONE 'Europe/Warsaw'),
                         (p_to AT TIME ZONE 'Europe/Warsaw') - interval '1 microsecond',
                         ('1 ' || p_granularity)::interval) d
    WHERE p_to > p_from;
END
$$;

-- Najwcześniejsza data danych źródła raportu (stan „Brak danych” w podglądzie, ADR 0071); NULL, gdy źródło jest puste.
CREATE FUNCTION fn_report_earliest_data(p_report_code text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_report_code IS NULL OR p_report_code NOT IN ('revenue', 'fleet_usage', 'rides_by_zone', 'reliability', 'users', 'wallet') THEN
        RAISE EXCEPTION 'REPORT_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    RETURN CASE p_report_code
        WHEN 'revenue' THEN LEAST(
            (SELECT min(issued_at) FROM receipts),
            (SELECT min(created_at) FROM payments WHERE status IN ('SUCCEEDED', 'REFUNDED')))
        WHEN 'fleet_usage' THEN LEAST(
            (SELECT min(valid_from) FROM scooter_status_history),
            (SELECT min(started_at) FROM rentals WHERE started_at IS NOT NULL))
        WHEN 'rides_by_zone' THEN (SELECT min(started_at) FROM rentals WHERE started_at IS NOT NULL)
        WHEN 'reliability' THEN LEAST((SELECT min(created_at) FROM tickets), (SELECT min(created_at) FROM service_tasks))
        WHEN 'users' THEN (SELECT min(created_at) FROM users)
        WHEN 'wallet' THEN (SELECT min(created_at) FROM wallet_ledger)
    END;
END
$$;

-- ---------------------------------------------------------------------
-- Przychody (`reports.revenue`): sprzedaż z paragonów i wpływy z płatności (pytanie 2)
-- ---------------------------------------------------------------------

-- Grupy stawek VAT paragonów wystawionych w okresie: jeden wiersz na paragon i stawkę, VAT „w stu” liczony od sumy
-- brutto grupy, tak jak na dokumencie (`v_receipt_list`, ADR 0052). Stawka NULL to pozycja poza VAT (opłata za
-- odholowanie jako kara umowna, ADR 0061). Korekta ma kwoty ujemne i liczy się w dniu wystawienia korekty;
-- `rental_id` korekty bez przejazdu pochodzi z paragonu korygowanego.
CREATE FUNCTION fn_report_receipt_groups(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (receipt_id uuid, kind receipt_kind, rental_id uuid, issued_at timestamptz, vat_rate numeric,
               gross bigint, vat bigint)
LANGUAGE sql STABLE AS $$
    SELECT r.id, r.kind, COALESCE(r.rental_id, o.rental_id), r.issued_at, i.vat_rate, sum(i.amount)::bigint,
           COALESCE(fn_vat_from_gross(sum(i.amount)::bigint, i.vat_rate), 0)
    FROM receipts r
    JOIN receipt_items i ON i.receipt_id = r.id
    LEFT JOIN receipts o ON o.id = r.corrects_receipt_id
    WHERE r.issued_at >= p_from AND r.issued_at < p_to
    GROUP BY r.id, o.rental_id, i.vat_rate
$$;

-- Sprzedaż według stawki VAT i rodzaju dokumentu (SALE, CORRECTION): liczba paragonów, brutto, VAT i netto
-- (netto = brutto − VAT; dla stawki NULL netto równe brutto). Suma wierszy to sprzedaż okresu po korektach.
CREATE FUNCTION fn_report_revenue_sales_by_vat(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (vat_rate numeric, kind receipt_kind, receipts integer, gross bigint, vat bigint, net bigint)
LANGUAGE sql STABLE AS $$
    SELECT g.vat_rate, g.kind, count(DISTINCT g.receipt_id)::integer, sum(g.gross)::bigint, sum(g.vat)::bigint,
           (sum(g.gross) - sum(g.vat))::bigint
    FROM fn_report_receipt_groups(p_from, p_to) g
    GROUP BY g.vat_rate, g.kind
    ORDER BY g.vat_rate DESC NULLS LAST, g.kind
$$;

-- Szereg sprzedaży według granulacji (wszystkie przedziały okresu, także puste): sprzedaż i korekty brutto, razem
-- brutto, VAT i netto, część poza VAT, paragony sprzedaży i korekty, przejazdy z paragonem sprzedaży.
CREATE FUNCTION fn_report_revenue_sales_series(p_from timestamptz, p_to timestamptz, p_granularity text)
RETURNS TABLE (bucket date, bucket_from timestamptz, bucket_to timestamptz, sales_gross bigint,
               corrections_gross bigint, gross bigint, vat bigint, net bigint, outside_vat_gross bigint,
               sale_receipts integer, correction_receipts integer, rides integer)
LANGUAGE sql STABLE AS $$
    SELECT b.bucket, b.bucket_from, b.bucket_to,
           COALESCE(sum(g.gross) FILTER (WHERE g.kind = 'SALE'), 0)::bigint,
           COALESCE(sum(g.gross) FILTER (WHERE g.kind = 'CORRECTION'), 0)::bigint,
           COALESCE(sum(g.gross), 0)::bigint,
           COALESCE(sum(g.vat), 0)::bigint,
           COALESCE(sum(g.gross) - sum(g.vat), 0)::bigint,
           COALESCE(sum(g.gross) FILTER (WHERE g.vat_rate IS NULL), 0)::bigint,
           count(DISTINCT g.receipt_id) FILTER (WHERE g.kind = 'SALE')::integer,
           count(DISTINCT g.receipt_id) FILTER (WHERE g.kind = 'CORRECTION')::integer,
           count(DISTINCT g.rental_id) FILTER (WHERE g.kind = 'SALE')::integer
    FROM fn_report_buckets(p_from, p_to, p_granularity) b
    LEFT JOIN fn_report_receipt_groups(p_from, p_to) g ON g.issued_at >= b.bucket_from AND g.issued_at < b.bucket_to
    GROUP BY b.bucket, b.bucket_from, b.bucket_to
    ORDER BY b.bucket
$$;

-- Sprzedaż według strefy końca przejazdu (sekcja raportu przychodów, nie raportu stref: ADR 0071). Strefa NULL to
-- przejazd zakończony poza strefą parkowania. Brutto po korektach z okresu, z częścią poza VAT.
CREATE FUNCTION fn_report_revenue_sales_by_zone(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (zone_id uuid, zone_code text, zone_name text, rides integer, sales_gross bigint,
               corrections_gross bigint, gross bigint, vat bigint, net bigint, outside_vat_gross bigint)
LANGUAGE sql STABLE AS $$
    SELECT z.id, z.code, z.name,
           count(DISTINCT g.rental_id) FILTER (WHERE g.kind = 'SALE')::integer,
           COALESCE(sum(g.gross) FILTER (WHERE g.kind = 'SALE'), 0)::bigint,
           COALESCE(sum(g.gross) FILTER (WHERE g.kind = 'CORRECTION'), 0)::bigint,
           sum(g.gross)::bigint, sum(g.vat)::bigint, (sum(g.gross) - sum(g.vat))::bigint,
           COALESCE(sum(g.gross) FILTER (WHERE g.vat_rate IS NULL), 0)::bigint
    FROM fn_report_receipt_groups(p_from, p_to) g
    JOIN rentals r ON r.id = g.rental_id
    LEFT JOIN zones z ON z.id = r.end_zone_id
    GROUP BY z.id, z.code, z.name
    ORDER BY sum(g.gross) DESC, z.code NULLS LAST
$$;

-- Wpływy: udane płatności u operatora (także później zwrócone, REFUNDED) według celu (doładowanie, przejazd kartą)
-- i metody (karta, BLIK), w chwili utworzenia płatności. Zwroty są osobną sekcją (`fn_report_revenue_refunds`).
CREATE FUNCTION fn_report_revenue_payments(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (purpose payment_purpose, method payment_method_kind, payments integer, amount bigint,
               refunded_payments integer)
LANGUAGE sql STABLE AS $$
    SELECT p.purpose, p.method, count(*)::integer, sum(p.amount)::bigint,
           count(*) FILTER (WHERE p.status = 'REFUNDED')::integer
    FROM payments p
    WHERE p.status IN ('SUCCEEDED', 'REFUNDED') AND p.created_at >= p_from AND p.created_at < p_to
    GROUP BY p.purpose, p.method
    ORDER BY p.purpose, p.method
$$;

-- Zwroty zakończone sukcesem według źródła (portfel: uznanie salda bez wypływu pieniędzy; karta: zwrot u operatora)
-- i powodu (`BALANCE_PAYOUT` to zwrot salda portfela), w chwili zlecenia zwrotu. Kwoty dodatnie.
CREATE FUNCTION fn_report_revenue_refunds(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (source payment_source, reason refund_reason, refunds integer, amount bigint)
LANGUAGE sql STABLE AS $$
    SELECT f.source, f.reason, count(*)::integer, sum(f.amount)::bigint
    FROM refunds f
    WHERE f.status = 'SUCCEEDED' AND f.created_at >= p_from AND f.created_at < p_to
    GROUP BY f.source, f.reason
    ORDER BY f.source, f.reason
$$;

-- ---------------------------------------------------------------------
-- Wykorzystanie floty (`reports.fleet_usage`, ADR 0074)
-- ---------------------------------------------------------------------

-- Na hulajnogę (filtry: model, hulajnoga): sekundy w każdej kategorii czasu z historii stanów przyciętej do okresu
-- (przedział otwarty kończy się teraz), czas okresu (`period_seconds`, do teraz, gdy okres trwa), czas objęty
-- historią (`tracked_seconds`) i początek historii hulajnogi. Dla części okresu sprzed historii (migracja 0013,
-- pytanie 13) `untracked_ride_seconds` to czas przejazdów z `rentals` (od startu do końca, przycięty), więc core
-- liczy czas w przejeździe jako `in_ride_seconds + untracked_ride_seconds`. Przejazdy, czas jazdy i dystans według
-- startu w okresie, przychód brutto z paragonów przejazdów hulajnogi wystawionych w okresie (z korektami). Hulajnoga
-- jest w wyniku, jeśli istniała przed końcem okresu albo ma historię sprzed niego (dane generatora, ADR 0075).
CREATE FUNCTION fn_report_fleet_usage_by_scooter(p_from timestamptz, p_to timestamptz, p_model_id uuid DEFAULT NULL,
                                                 p_scooter_id uuid DEFAULT NULL)
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
        SELECT scooter_id, sum(secs) AS total,
               COALESCE(sum(secs) FILTER (WHERE category = 'IN_RIDE'), 0) AS in_ride,
               COALESCE(sum(secs) FILTER (WHERE category = 'RESERVED'), 0) AS reserved,
               COALESCE(sum(secs) FILTER (WHERE category = 'AVAILABLE'), 0) AS available,
               COALESCE(sum(secs) FILTER (WHERE category = 'SERVICE'), 0) AS service,
               COALESCE(sum(secs) FILTER (WHERE category = 'OFFLINE'), 0) AS offline,
               COALESCE(sum(secs) FILTER (WHERE category = 'RETIRED'), 0) AS retired
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
           round(COALESCE(hs.total, 0))::bigint, round(COALESCE(hs.in_ride, 0))::bigint,
           round(COALESCE(hs.reserved, 0))::bigint, round(COALESCE(hs.available, 0))::bigint,
           round(COALESCE(hs.service, 0))::bigint, round(COALESCE(hs.offline, 0))::bigint,
           round(COALESCE(hs.retired, 0))::bigint, round(COALESCE(ut.secs, 0))::bigint,
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

-- Na model: sumy z `fn_report_fleet_usage_by_scooter` (te same kolumny bez danych pojedynczej hulajnogi).
CREATE FUNCTION fn_report_fleet_usage_by_model(p_from timestamptz, p_to timestamptz, p_model_id uuid DEFAULT NULL)
RETURNS TABLE (model_id uuid, model_code text, model_name text, scooters integer, period_seconds bigint,
               tracked_seconds bigint, in_ride_seconds bigint, reserved_seconds bigint, available_seconds bigint,
               service_seconds bigint, offline_seconds bigint, retired_seconds bigint, untracked_ride_seconds bigint,
               rides integer, ride_seconds bigint, distance_m bigint, revenue_gross bigint)
LANGUAGE sql STABLE AS $$
    SELECT u.model_id, u.model_code, u.model_name, count(*)::integer, max(u.period_seconds)::bigint,
           sum(u.tracked_seconds)::bigint, sum(u.in_ride_seconds)::bigint, sum(u.reserved_seconds)::bigint,
           sum(u.available_seconds)::bigint, sum(u.service_seconds)::bigint, sum(u.offline_seconds)::bigint,
           sum(u.retired_seconds)::bigint, sum(u.untracked_ride_seconds)::bigint, sum(u.rides)::integer,
           sum(u.ride_seconds)::bigint, sum(u.distance_m)::bigint, sum(u.revenue_gross)::bigint
    FROM fn_report_fleet_usage_by_scooter(p_from, p_to, p_model_id, NULL) u
    GROUP BY u.model_id, u.model_code, u.model_name
    ORDER BY u.model_code
$$;

-- Szereg floty według granulacji: sekundy kategorii całej floty (z filtrami) w każdym przedziale, liczba hulajnóg
-- z historią w przedziale i przejazdy rozpoczęte w przedziale. `period_seconds` przedziału do teraz.
CREATE FUNCTION fn_report_fleet_usage_series(p_from timestamptz, p_to timestamptz, p_granularity text,
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
               COALESCE(sum(secs) FILTER (WHERE category = 'IN_RIDE'), 0) AS in_ride,
               COALESCE(sum(secs) FILTER (WHERE category = 'RESERVED'), 0) AS reserved,
               COALESCE(sum(secs) FILTER (WHERE category = 'AVAILABLE'), 0) AS available,
               COALESCE(sum(secs) FILTER (WHERE category = 'SERVICE'), 0) AS service,
               COALESCE(sum(secs) FILTER (WHERE category = 'OFFLINE'), 0) AS offline,
               COALESCE(sum(secs) FILTER (WHERE category = 'RETIRED'), 0) AS retired
        FROM hist GROUP BY bucket),
    rd AS (
        SELECT bk.bucket, count(r.id) AS rides
        FROM bk JOIN rentals r ON r.started_at >= bk.bucket_from AND r.started_at < bk.bucket_to
        WHERE r.scooter_id IN (SELECT id FROM sc)
        GROUP BY bk.bucket)
    SELECT bk.bucket, bk.bucket_from, bk.bucket_to, round(extract(epoch FROM bk.t - bk.bucket_from))::bigint,
           COALESCE(hs.scooters, 0)::integer, round(COALESCE(hs.in_ride, 0))::bigint,
           round(COALESCE(hs.reserved, 0))::bigint, round(COALESCE(hs.available, 0))::bigint,
           round(COALESCE(hs.service, 0))::bigint, round(COALESCE(hs.offline, 0))::bigint,
           round(COALESCE(hs.retired, 0))::bigint, COALESCE(rd.rides, 0)::integer
    FROM bk
    LEFT JOIN hs ON hs.bucket = bk.bucket
    LEFT JOIN rd ON rd.bucket = bk.bucket
    ORDER BY bk.bucket
$$;

-- ---------------------------------------------------------------------
-- Przejazdy według stref i godzin (`reports.rides_by_zone`): bez kwot (ADR 0071)
-- ---------------------------------------------------------------------
-- Przejazd to wypożyczenie ze startem jazdy (`started_at`) w okresie; filtr `p_end_zone_id` (strefa końca) zawęża
-- wszystkie sekcje.

-- Mapa ciepła: dzień tygodnia (ISO, 1 = poniedziałek) × godzina startu w czasie polskim, wszystkie 168 komórek.
-- `rides` to liczba przejazdów, `day_occurrences` liczba wystąpień tego dnia tygodnia w okresie (doby polskie, które
-- przecinają okres), więc core liczy średnią na dzień bez zawyżania dni, które w okresie wypadły częściej. Obie
-- godziny 2:00–2:59 doby zmiany czasu jesienią trafiają do tej samej komórki.
CREATE FUNCTION fn_report_rides_heatmap(p_from timestamptz, p_to timestamptz, p_end_zone_id uuid DEFAULT NULL)
RETURNS TABLE (isodow smallint, hour smallint, rides integer, day_occurrences integer)
LANGUAGE sql STABLE AS $$
    WITH days AS (
        SELECT extract(isodow FROM d)::smallint AS dow, count(*)::integer AS n
        FROM generate_series((p_from AT TIME ZONE 'Europe/Warsaw')::date::timestamp,
                             ((p_to AT TIME ZONE 'Europe/Warsaw') - interval '1 microsecond')::date::timestamp,
                             interval '1 day') d
        WHERE p_to > p_from
        GROUP BY 1),
    r AS (
        SELECT extract(isodow FROM x.started_at AT TIME ZONE 'Europe/Warsaw')::smallint AS dow,
               extract(hour FROM x.started_at AT TIME ZONE 'Europe/Warsaw')::smallint AS hr, count(*) AS rides
        FROM rentals x
        WHERE x.started_at >= p_from AND x.started_at < p_to
          AND (p_end_zone_id IS NULL OR x.end_zone_id = p_end_zone_id)
        GROUP BY 1, 2)
    SELECT gd.d::smallint, gh.h::smallint, COALESCE(r.rides, 0)::integer, COALESCE(days.n, 0)
    FROM generate_series(1, 7) gd(d) CROSS JOIN generate_series(0, 23) gh(h)
    LEFT JOIN days ON days.dow = gd.d
    LEFT JOIN r ON r.dow = gd.d AND r.hr = gh.h
    ORDER BY gd.d, gh.h
$$;

-- Strefa końca: strefa parkowania końca przejazdu (NULL = poza strefą albo przejazd w toku), przejazdy, zakończone,
-- średni i łączny czas jazdy (`ride_seconds`, bez pauz) i dystans zakończonych.
CREATE FUNCTION fn_report_rides_by_end_zone(p_from timestamptz, p_to timestamptz, p_end_zone_id uuid DEFAULT NULL)
RETURNS TABLE (zone_id uuid, zone_code text, zone_name text, zone_type zone_type, rides integer, ended_rides integer,
               avg_ride_seconds numeric, total_ride_seconds bigint, avg_distance_m numeric, total_distance_m bigint)
LANGUAGE sql STABLE AS $$
    SELECT z.id, z.code, z.name, z.type, count(*)::integer,
           count(*) FILTER (WHERE r.ended_at IS NOT NULL)::integer,
           round(avg(r.ride_seconds) FILTER (WHERE r.ended_at IS NOT NULL), 1),
           COALESCE(sum(r.ride_seconds) FILTER (WHERE r.ended_at IS NOT NULL), 0)::bigint,
           round(avg(r.distance_m) FILTER (WHERE r.ended_at IS NOT NULL), 1),
           COALESCE(sum(r.distance_m) FILTER (WHERE r.ended_at IS NOT NULL), 0)::bigint
    FROM rentals r
    LEFT JOIN zones z ON z.id = r.end_zone_id
    WHERE r.started_at >= p_from AND r.started_at < p_to
      AND (p_end_zone_id IS NULL OR r.end_zone_id = p_end_zone_id)
    GROUP BY z.id, z.code, z.name, z.type
    ORDER BY count(*) DESC, z.code NULLS LAST
$$;

-- Wjazdy do stref z osi czasu przejazdów (`ZONE_ENTERED`; `scooter_zone_presence` znika z końcem przejazdu), w chwili
-- wjazdu w okresie: liczba wjazdów, przejazdy z wjazdem, łączny i średni czas w strefie (do wyjazdu z tej strefy,
-- końca przejazdu albo teraz). Wszystkie typy stref; core wybiera strefy zakazu i wolnej jazdy.
CREATE FUNCTION fn_report_rides_zone_entries(p_from timestamptz, p_to timestamptz, p_end_zone_id uuid DEFAULT NULL)
RETURNS TABLE (zone_id uuid, zone_code text, zone_name text, zone_type zone_type, entries integer, rides integer,
               total_seconds_in_zone bigint, avg_seconds_in_zone numeric)
LANGUAGE sql STABLE AS $$
    WITH ent AS (
        SELECT e.rental_id, e.zone_id,
               extract(epoch FROM COALESCE(
                   (SELECT min(x.created_at) FROM rental_events x
                    WHERE x.rental_id = e.rental_id AND x.zone_id = e.zone_id AND x.type = 'ZONE_EXITED'
                      AND x.created_at >= e.created_at),
                   r.ended_at, now()) - e.created_at) AS secs
        FROM rental_events e
        JOIN rentals r ON r.id = e.rental_id
        WHERE e.type = 'ZONE_ENTERED' AND e.zone_id IS NOT NULL AND e.created_at >= p_from AND e.created_at < p_to
          AND (p_end_zone_id IS NULL OR r.end_zone_id = p_end_zone_id))
    SELECT z.id, z.code, z.name, z.type, count(*)::integer, count(DISTINCT ent.rental_id)::integer,
           round(sum(ent.secs))::bigint, round(avg(ent.secs), 1)
    FROM ent JOIN zones z ON z.id = ent.zone_id
    GROUP BY z.id, z.code, z.name, z.type
    ORDER BY z.type, z.code
$$;

-- Zakończenia według trybu (`end_mode`; NULL w przejazdach sprzed 0008) dla przejazdów zakończonych w okresie
-- i liczba zakończeń z opłatą za odholowanie (bez kwoty: raport nie pokazuje przychodu).
CREATE FUNCTION fn_report_rides_end_modes(p_from timestamptz, p_to timestamptz, p_end_zone_id uuid DEFAULT NULL)
RETURNS TABLE (end_mode rental_end_mode, rides integer, towed integer, outside_parking integer)
LANGUAGE sql STABLE AS $$
    SELECT r.end_mode, count(*)::integer, count(*) FILTER (WHERE r.towing_fee IS NOT NULL)::integer,
           count(*) FILTER (WHERE r.end_zone_id IS NULL)::integer
    FROM rentals r
    WHERE r.ended_at >= p_from AND r.ended_at < p_to AND r.started_at IS NOT NULL
      AND (p_end_zone_id IS NULL OR r.end_zone_id = p_end_zone_id)
    GROUP BY r.end_mode
    ORDER BY r.end_mode NULLS LAST
$$;

-- ---------------------------------------------------------------------
-- Awaryjność (`reports.reliability`)
-- ---------------------------------------------------------------------

-- Awaria do MTBF: zgłoszenie z kategorią techniczną (hamulce, światła, koło, kierownica, kod QR, bateria, łączność,
-- inne), z wyjątkiem zgłoszenia automatycznego krytycznej baterii (rozładowanie to nie usterka). Reklamacja opłaty
-- (BILLING) i „poza strefą” (OUT_OF_ZONE) nie są awariami. Zgłoszenia automatyczne OFFLINE liczą się także po
-- zamknięciu (arc42 §11).
CREATE FUNCTION fn_ticket_is_failure(p_categories ticket_category[], p_auto_kind ticket_auto_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT p_categories && ARRAY['BRAKES', 'LIGHTS', 'WHEEL', 'HANDLEBAR', 'QR_CODE', 'BATTERY', 'CONNECTION',
                                 'OTHER']::ticket_category[]
           AND p_auto_kind IS DISTINCT FROM 'BATTERY_CRITICAL'
$$;

-- Zgłoszenia utworzone w okresie według kategorii (zgłoszenie z kilkoma kategoriami liczy się w każdej, więc suma
-- wierszy może przekroczyć liczbę zgłoszeń) i źródła (klient, automatyczne, operator), z pilnymi, rozwiązanymi,
-- otwartymi teraz i średnim czasem rozwiązania w sekundach.
CREATE FUNCTION fn_report_reliability_tickets(p_from timestamptz, p_to timestamptz, p_model_id uuid DEFAULT NULL,
                                              p_scooter_id uuid DEFAULT NULL)
RETURNS TABLE (category ticket_category, source ticket_source, tickets integer, urgent integer, resolved integer,
               open integer, avg_resolution_seconds numeric)
LANGUAGE sql STABLE AS $$
    SELECT c.category, t.source, count(*)::integer, count(*) FILTER (WHERE t.urgent)::integer,
           count(*) FILTER (WHERE t.status = 'RESOLVED')::integer,
           count(*) FILTER (WHERE t.status <> 'RESOLVED')::integer,
           round(avg(extract(epoch FROM t.resolved_at - t.created_at)) FILTER (WHERE t.resolved_at IS NOT NULL), 1)
    FROM tickets t
    JOIN scooters s ON s.id = t.scooter_id
    CROSS JOIN LATERAL unnest(t.categories) c(category)
    WHERE t.created_at >= p_from AND t.created_at < p_to
      AND (p_model_id IS NULL OR s.model_id = p_model_id) AND (p_scooter_id IS NULL OR t.scooter_id = p_scooter_id)
    GROUP BY c.category, t.source
    ORDER BY c.category, t.source
$$;

-- Na hulajnogę: zgłoszenia z okresu (wszystkie, według źródła, automatyczne OFFLINE także zamknięte, pilne, awarie
-- według `fn_ticket_is_failure`), zadania utworzone w okresie, zadania zakończone (DONE) w okresie ze średnim czasem
-- naprawy (od rozpoczęcia, a bez niego od utworzenia, do zakończenia) i kosztem części z chwili użycia, czas w serwisie
-- i w przejeździe z `fn_report_fleet_usage_by_scooter` (z przejazdami sprzed historii). MTBF w godzinach = czas
-- w przejeździe ÷ liczba awarii (NULL bez awarii).
CREATE FUNCTION fn_report_reliability_by_scooter(p_from timestamptz, p_to timestamptz, p_model_id uuid DEFAULT NULL,
                                                 p_scooter_id uuid DEFAULT NULL)
RETURNS TABLE (scooter_id uuid, scooter_number integer, model_id uuid, model_code text, model_name text,
               tickets integer, user_tickets integer, auto_tickets integer, staff_tickets integer,
               offline_tickets integer, urgent_tickets integer, failures integer, tasks_created integer,
               tasks_done integer, avg_repair_seconds numeric, parts_cost bigint, service_seconds bigint,
               in_ride_seconds bigint, mtbf_hours numeric)
LANGUAGE sql STABLE AS $$
    WITH u AS (SELECT * FROM fn_report_fleet_usage_by_scooter(p_from, p_to, p_model_id, p_scooter_id)),
    tk AS (
        SELECT t.scooter_id, count(*) AS tickets,
               count(*) FILTER (WHERE t.source = 'USER') AS user_tickets,
               count(*) FILTER (WHERE t.source = 'AUTO') AS auto_tickets,
               count(*) FILTER (WHERE t.source = 'STAFF') AS staff_tickets,
               count(*) FILTER (WHERE t.auto_kind = 'OFFLINE') AS offline_tickets,
               count(*) FILTER (WHERE t.urgent) AS urgent_tickets,
               count(*) FILTER (WHERE fn_ticket_is_failure(t.categories, t.auto_kind)) AS failures
        FROM tickets t
        WHERE t.scooter_id IN (SELECT scooter_id FROM u) AND t.created_at >= p_from AND t.created_at < p_to
        GROUP BY t.scooter_id),
    tc AS (
        SELECT t.scooter_id, count(*) AS created FROM service_tasks t
        WHERE t.scooter_id IN (SELECT scooter_id FROM u) AND t.created_at >= p_from AND t.created_at < p_to
        GROUP BY t.scooter_id),
    td AS (
        SELECT t.scooter_id, count(*) AS done,
               avg(extract(epoch FROM t.completed_at - COALESCE(t.started_at, t.created_at))) AS repair,
               COALESCE(sum((SELECT sum(l.quantity * l.unit_cost) FROM service_task_parts l WHERE l.task_id = t.id)), 0)
                   AS parts_cost
        FROM service_tasks t
        WHERE t.scooter_id IN (SELECT scooter_id FROM u) AND t.status = 'DONE'
          AND t.completed_at >= p_from AND t.completed_at < p_to
        GROUP BY t.scooter_id)
    SELECT u.scooter_id, u.scooter_number, u.model_id, u.model_code, u.model_name,
           COALESCE(tk.tickets, 0)::integer, COALESCE(tk.user_tickets, 0)::integer,
           COALESCE(tk.auto_tickets, 0)::integer, COALESCE(tk.staff_tickets, 0)::integer,
           COALESCE(tk.offline_tickets, 0)::integer, COALESCE(tk.urgent_tickets, 0)::integer,
           COALESCE(tk.failures, 0)::integer, COALESCE(tc.created, 0)::integer, COALESCE(td.done, 0)::integer,
           round(td.repair, 1), COALESCE(td.parts_cost, 0)::bigint, u.service_seconds,
           u.in_ride_seconds + u.untracked_ride_seconds,
           CASE WHEN COALESCE(tk.failures, 0) > 0
                THEN round((u.in_ride_seconds + u.untracked_ride_seconds) / 3600.0 / tk.failures, 2) END
    FROM u
    LEFT JOIN tk ON tk.scooter_id = u.scooter_id
    LEFT JOIN tc ON tc.scooter_id = u.scooter_id
    LEFT JOIN td ON td.scooter_id = u.scooter_id
    ORDER BY u.scooter_number
$$;

-- Na model: sumy z `fn_report_reliability_by_scooter`; średni czas naprawy ważony liczbą zakończonych zadań, MTBF
-- z sumy czasu w przejeździe i sumy awarii modelu.
CREATE FUNCTION fn_report_reliability_by_model(p_from timestamptz, p_to timestamptz, p_model_id uuid DEFAULT NULL)
RETURNS TABLE (model_id uuid, model_code text, model_name text, scooters integer, tickets integer,
               user_tickets integer, auto_tickets integer, staff_tickets integer, offline_tickets integer,
               urgent_tickets integer, failures integer, tasks_created integer, tasks_done integer,
               avg_repair_seconds numeric, parts_cost bigint, service_seconds bigint, in_ride_seconds bigint,
               mtbf_hours numeric)
LANGUAGE sql STABLE AS $$
    SELECT r.model_id, r.model_code, r.model_name, count(*)::integer, sum(r.tickets)::integer,
           sum(r.user_tickets)::integer, sum(r.auto_tickets)::integer, sum(r.staff_tickets)::integer,
           sum(r.offline_tickets)::integer, sum(r.urgent_tickets)::integer, sum(r.failures)::integer,
           sum(r.tasks_created)::integer, sum(r.tasks_done)::integer,
           round(sum(r.avg_repair_seconds * r.tasks_done) / NULLIF(sum(r.tasks_done) FILTER (WHERE r.avg_repair_seconds IS NOT NULL), 0), 1),
           sum(r.parts_cost)::bigint, sum(r.service_seconds)::bigint, sum(r.in_ride_seconds)::bigint,
           CASE WHEN sum(r.failures) > 0 THEN round(sum(r.in_ride_seconds) / 3600.0 / sum(r.failures), 2) END
    FROM fn_report_reliability_by_scooter(p_from, p_to, p_model_id, NULL) r
    GROUP BY r.model_id, r.model_code, r.model_name
    ORDER BY r.model_code
$$;

-- Zadania serwisowe według rodzaju: utworzone w okresie, zakończone (DONE) i anulowane w okresie, otwarte teraz (z tych
-- utworzonych), średni czas oczekiwania na rozpoczęcie i naprawy zakończonych, koszt części zakończonych.
CREATE FUNCTION fn_report_reliability_tasks(p_from timestamptz, p_to timestamptz, p_model_id uuid DEFAULT NULL,
                                            p_scooter_id uuid DEFAULT NULL)
RETURNS TABLE (task_type service_task_type, created integer, done integer, cancelled integer, open integer,
               avg_wait_seconds numeric, avg_repair_seconds numeric, parts_cost bigint)
LANGUAGE sql STABLE AS $$
    WITH t AS (
        SELECT t.*, (SELECT sum(l.quantity * l.unit_cost) FROM service_task_parts l WHERE l.task_id = t.id) AS cost
        FROM service_tasks t JOIN scooters s ON s.id = t.scooter_id
        WHERE ((t.created_at >= p_from AND t.created_at < p_to) OR (t.completed_at >= p_from AND t.completed_at < p_to))
          AND (p_model_id IS NULL OR s.model_id = p_model_id) AND (p_scooter_id IS NULL OR t.scooter_id = p_scooter_id))
    SELECT tt.type, count(*) FILTER (WHERE t.created_at >= p_from AND t.created_at < p_to)::integer,
           count(*) FILTER (WHERE t.status = 'DONE' AND t.completed_at >= p_from AND t.completed_at < p_to)::integer,
           count(*) FILTER (WHERE t.status = 'CANCELLED' AND t.completed_at >= p_from AND t.completed_at < p_to)::integer,
           count(*) FILTER (WHERE t.status IN ('OPEN', 'IN_PROGRESS') AND t.created_at >= p_from AND t.created_at < p_to)::integer,
           round(avg(extract(epoch FROM t.started_at - t.created_at))
                 FILTER (WHERE t.started_at IS NOT NULL AND t.created_at >= p_from AND t.created_at < p_to), 1),
           round(avg(extract(epoch FROM t.completed_at - COALESCE(t.started_at, t.created_at)))
                 FILTER (WHERE t.status = 'DONE' AND t.completed_at >= p_from AND t.completed_at < p_to), 1),
           COALESCE(sum(t.cost) FILTER (WHERE t.status = 'DONE' AND t.completed_at >= p_from AND t.completed_at < p_to), 0)::bigint
    FROM unnest(enum_range(NULL::service_task_type)) tt(type)
    LEFT JOIN t ON t.type = tt.type
    GROUP BY tt.type
    ORDER BY tt.type
$$;

-- Części zużyte w zadaniach zakończonych (DONE) w okresie: ilość, koszt z chwili użycia, liczba zadań, bieżący stan
-- magazynu względem minimum (`<`, jak `v_spare_part_list` i core).
CREATE FUNCTION fn_report_reliability_parts(p_from timestamptz, p_to timestamptz, p_model_id uuid DEFAULT NULL,
                                            p_scooter_id uuid DEFAULT NULL)
RETURNS TABLE (part_id uuid, sku text, name text, quantity integer, cost bigint, tasks integer, stock_qty integer,
               min_stock_qty integer, below_minimum boolean)
LANGUAGE sql STABLE AS $$
    SELECT p.id, p.sku, p.name, sum(l.quantity)::integer, sum(l.quantity * l.unit_cost)::bigint,
           count(DISTINCT t.id)::integer, p.stock_qty, p.min_stock_qty, p.stock_qty < p.min_stock_qty
    FROM service_tasks t
    JOIN scooters s ON s.id = t.scooter_id
    JOIN service_task_parts l ON l.task_id = t.id
    JOIN spare_parts p ON p.id = l.part_id
    WHERE t.status = 'DONE' AND t.completed_at >= p_from AND t.completed_at < p_to
      AND (p_model_id IS NULL OR s.model_id = p_model_id) AND (p_scooter_id IS NULL OR t.scooter_id = p_scooter_id)
    GROUP BY p.id
    ORDER BY sum(l.quantity * l.unit_cost) DESC, p.sku
$$;

-- Części poniżej minimum teraz (`v_low_stock_parts` po ujednoliceniu na `<`) z kosztem uzupełnienia do minimum
-- po bieżącej cenie. Stan bieżący, bez okresu.
CREATE FUNCTION fn_report_reliability_low_stock()
RETURNS TABLE (part_id uuid, sku text, name text, stock_qty integer, min_stock_qty integer, shortage integer,
               unit_cost bigint, restock_cost bigint)
LANGUAGE sql STABLE AS $$
    SELECT v.id, v.sku, v.name, v.stock_qty, v.min_stock_qty, v.shortage, p.unit_cost, (v.shortage * p.unit_cost)::bigint
    FROM v_low_stock_parts v JOIN spare_parts p ON p.id = v.id
    ORDER BY v.shortage DESC, v.sku
$$;

-- ---------------------------------------------------------------------
-- Użytkownicy (`reports.users`): same liczby, bez danych osobowych
-- ---------------------------------------------------------------------
-- Aktywny klient: co najmniej jeden przejazd ze startem w okresie. Nowy: aktywny, którego pierwszy przejazd w ogóle
-- jest w okresie; powracający: aktywny z przejazdem przed okresem. Blokada: wpis `user.blocked` w dzienniku audytu albo
-- `blocked_at` w okresie (blokady zdjęte przed migracją znamy tylko z dziennika). Usunięcie: `deleted_at`.

CREATE FUNCTION fn_report_users_summary(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (registrations integer, active_users integer, new_users integer, returning_users integer,
               blocked_users integer, deleted_users integer, marketing_granted integer, marketing_revoked integer,
               marketing_active_at_end integer, customers_at_end integer)
LANGUAGE sql STABLE AS $$
    WITH act AS (
        SELECT DISTINCT r.user_id FROM rentals r WHERE r.started_at >= p_from AND r.started_at < p_to),
    ret AS (
        SELECT a.user_id, EXISTS (SELECT 1 FROM rentals e WHERE e.user_id = a.user_id AND e.started_at < p_from) AS is_returning
        FROM act a)
    SELECT
        (SELECT count(*) FROM users u WHERE u.created_at >= p_from AND u.created_at < p_to)::integer,
        (SELECT count(*) FROM ret)::integer,
        (SELECT count(*) FROM ret WHERE NOT ret.is_returning)::integer,
        (SELECT count(*) FROM ret WHERE ret.is_returning)::integer,
        (SELECT count(*) FROM (
            SELECT a.entity_id FROM audit_log a
            WHERE a.action = 'user.blocked' AND a.entity_id IS NOT NULL AND a.created_at >= p_from AND a.created_at < p_to
            UNION
            SELECT u.id FROM users u WHERE u.blocked_at >= p_from AND u.blocked_at < p_to) b)::integer,
        (SELECT count(*) FROM users u WHERE u.deleted_at >= p_from AND u.deleted_at < p_to)::integer,
        (SELECT count(*) FROM consents c WHERE c.type = 'MARKETING' AND c.accepted_at >= p_from AND c.accepted_at < p_to)::integer,
        (SELECT count(*) FROM consents c WHERE c.type = 'MARKETING' AND c.revoked_at >= p_from AND c.revoked_at < p_to)::integer,
        (SELECT count(DISTINCT c.user_id) FROM consents c JOIN users u ON u.id = c.user_id
         WHERE c.type = 'MARKETING' AND c.accepted_at < p_to AND (c.revoked_at IS NULL OR c.revoked_at >= p_to)
           AND (u.deleted_at IS NULL OR u.deleted_at >= p_to))::integer,
        (SELECT count(*) FROM users u WHERE u.created_at < p_to AND (u.deleted_at IS NULL OR u.deleted_at >= p_to))::integer
$$;

-- Szereg użytkowników według granulacji, te same definicje w każdym przedziale (powracający względem początku
-- przedziału).
CREATE FUNCTION fn_report_users_series(p_from timestamptz, p_to timestamptz, p_granularity text)
RETURNS TABLE (bucket date, bucket_from timestamptz, bucket_to timestamptz, registrations integer,
               active_users integer, new_users integer, returning_users integer, blocked_users integer,
               deleted_users integer, marketing_granted integer, marketing_revoked integer)
LANGUAGE sql STABLE AS $$
    SELECT b.bucket, b.bucket_from, b.bucket_to, s.registrations, s.active_users, s.new_users, s.returning_users,
           s.blocked_users, s.deleted_users, s.marketing_granted, s.marketing_revoked
    FROM fn_report_buckets(p_from, p_to, p_granularity) b
    CROSS JOIN LATERAL fn_report_users_summary(b.bucket_from, b.bucket_to) s
    ORDER BY b.bucket
$$;

-- Kohorty miesięczne: klienci zarejestrowani w danym miesiącu okresu (miesiące polskie) i liczba z nich aktywnych
-- (przejazd ze startem) w kolejnych miesiącach okresu; `month_offset` 0 to miesiąc rejestracji. Wiersz dla każdej
-- pary miesięcy, także z zerem; procent wracających liczy core.
CREATE FUNCTION fn_report_users_cohorts(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (cohort_month date, cohort_size integer, month_offset integer, active_users integer)
LANGUAGE sql STABLE AS $$
    WITH months AS (
        SELECT m::date AS month
        FROM generate_series(date_trunc('month', p_from AT TIME ZONE 'Europe/Warsaw'),
                             (p_to AT TIME ZONE 'Europe/Warsaw') - interval '1 microsecond', interval '1 month') m
        WHERE p_to > p_from),
    cohort AS (
        SELECT u.id, date_trunc('month', u.created_at AT TIME ZONE 'Europe/Warsaw')::date AS month
        FROM users u WHERE u.created_at >= p_from AND u.created_at < p_to),
    act AS (
        SELECT DISTINCT r.user_id, date_trunc('month', r.started_at AT TIME ZONE 'Europe/Warsaw')::date AS month
        FROM rentals r WHERE r.user_id IN (SELECT id FROM cohort) AND r.started_at >= p_from AND r.started_at < p_to)
    SELECT cm.month, (SELECT count(*) FROM cohort c WHERE c.month = cm.month)::integer,
           ((extract(year FROM am.month) * 12 + extract(month FROM am.month))
            - (extract(year FROM cm.month) * 12 + extract(month FROM cm.month)))::integer,
           (SELECT count(*) FROM cohort c JOIN act a ON a.user_id = c.id AND a.month = am.month
            WHERE c.month = cm.month)::integer
    FROM months cm JOIN months am ON am.month >= cm.month
    ORDER BY cm.month, am.month
$$;

-- ---------------------------------------------------------------------
-- Portfel (`reports.wallet`): same liczby, bez danych osobowych
-- ---------------------------------------------------------------------

-- Saldo klientów w chwili `p_at`: `balance_after` ostatniego wpisu księgi przed tą chwilą (wyzwalacz księgi pilnuje
-- ciągłości salda, więc to saldo po wszystkich wcześniejszych operacjach). Klient bez wpisów nie ma wiersza (saldo 0).
CREATE FUNCTION fn_wallet_balances_at(p_at timestamptz) RETURNS TABLE (user_id uuid, balance bigint)
LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (l.user_id) l.user_id, l.balance_after
    FROM wallet_ledger l
    WHERE l.created_at < p_at
    ORDER BY l.user_id, l.created_at DESC, l.id DESC
$$;

-- Saldo portfeli na początek i koniec okresu (zobowiązanie wobec klientów), liczba portfeli z saldem różnym od zera
-- i obroty okresu (uznania dodatnie, obciążenia ujemne). `closing_balance − opening_balance = credits + debits`.
CREATE FUNCTION fn_report_wallet_summary(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (opening_balance bigint, closing_balance bigint, opening_nonzero_wallets integer,
               closing_nonzero_wallets integer, entries integer, credits bigint, debits bigint)
LANGUAGE sql STABLE AS $$
    SELECT (SELECT COALESCE(sum(b.balance), 0) FROM fn_wallet_balances_at(p_from) b)::bigint,
           (SELECT COALESCE(sum(b.balance), 0) FROM fn_wallet_balances_at(p_to) b)::bigint,
           (SELECT count(*) FROM fn_wallet_balances_at(p_from) b WHERE b.balance <> 0)::integer,
           (SELECT count(*) FROM fn_wallet_balances_at(p_to) b WHERE b.balance <> 0)::integer,
           count(l.id)::integer,
           COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0)::bigint,
           COALESCE(sum(l.amount) FILTER (WHERE l.amount < 0), 0)::bigint
    FROM (SELECT 1) one
    LEFT JOIN wallet_ledger l ON l.created_at >= p_from AND l.created_at < p_to
$$;

-- Obroty według typu wpisu (doładowanie, przejazd, opłata za odholowanie, zwrot, korekta, zwrot salda): wpisy, uznania,
-- obciążenia i saldo zmian.
CREATE FUNCTION fn_report_wallet_turnover(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (entry_type ledger_entry_type, entries integer, credits bigint, debits bigint, net bigint)
LANGUAGE sql STABLE AS $$
    SELECT l.type, count(*)::integer, COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0)::bigint,
           COALESCE(sum(l.amount) FILTER (WHERE l.amount < 0), 0)::bigint, sum(l.amount)::bigint
    FROM wallet_ledger l
    WHERE l.created_at >= p_from AND l.created_at < p_to
    GROUP BY l.type
    ORDER BY l.type
$$;

-- Korekty salda (ADJUSTMENT) według przyczyny (NULL w korektach sprzed 0007).
CREATE FUNCTION fn_report_wallet_adjustments(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (reason ledger_reason, entries integer, credits bigint, debits bigint, net bigint)
LANGUAGE sql STABLE AS $$
    SELECT l.reason, count(*)::integer, COALESCE(sum(l.amount) FILTER (WHERE l.amount > 0), 0)::bigint,
           COALESCE(sum(l.amount) FILTER (WHERE l.amount < 0), 0)::bigint, sum(l.amount)::bigint
    FROM wallet_ledger l
    WHERE l.type = 'ADJUSTMENT' AND l.created_at >= p_from AND l.created_at < p_to
    GROUP BY l.reason
    ORDER BY l.reason NULLS LAST
$$;

-- Przedziały sald na koniec okresu (`p_to`) dla kont istniejących w tej chwili (także z saldem 0 bez wpisów): poniżej
-- zera, zero, do 10 zł, do 50 zł, do 100 zł, do 200 zł, powyżej 200 zł. Granice w groszach, obie włącznie, NULL to brak
-- granicy. Wszystkie przedziały, także puste.
CREATE FUNCTION fn_report_wallet_balance_ranges(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (range_no integer, min_amount bigint, max_amount bigint, wallets integer, total_amount bigint)
LANGUAGE sql STABLE AS $$
    WITH ranges(no, lo, hi) AS (VALUES
        (1, NULL::bigint, -1::bigint), (2, 0, 0), (3, 1, 1000), (4, 1001, 5000), (5, 5001, 10000),
        (6, 10001, 20000), (7, 20001, NULL)),
    bal AS (
        SELECT COALESCE(b.balance, 0) AS balance
        FROM users u LEFT JOIN fn_wallet_balances_at(p_to) b ON b.user_id = u.id
        WHERE u.created_at < p_to AND (u.deleted_at IS NULL OR u.deleted_at >= p_to))
    SELECT r.no, r.lo, r.hi, count(bal.balance)::integer, COALESCE(sum(bal.balance), 0)::bigint
    FROM ranges r
    LEFT JOIN bal ON (r.lo IS NULL OR bal.balance >= r.lo) AND (r.hi IS NULL OR bal.balance <= r.hi)
    GROUP BY r.no, r.lo, r.hi
    ORDER BY r.no
$$;

-- Zaległości (przejazdy UNPAID, kwota przejazdu jak `v_unpaid_rentals`): teraz (wszystkie), powstałe w okresie
-- (zakończone w okresie i nadal nieopłacone) i spłacone w okresie (udana płatność za przejazd w okresie po wcześniejszej
-- odmowie).
CREATE FUNCTION fn_report_wallet_arrears(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (unpaid_rentals integer, unpaid_users integer, unpaid_amount bigint, period_unpaid_rentals integer,
               period_unpaid_amount bigint, period_repaid_rentals integer, period_repaid_amount bigint)
LANGUAGE sql STABLE AS $$
    SELECT (SELECT count(*) FROM rentals r WHERE r.state = 'UNPAID')::integer,
           (SELECT count(DISTINCT r.user_id) FROM rentals r WHERE r.state = 'UNPAID')::integer,
           (SELECT COALESCE(sum(r.total_amount), 0) FROM rentals r WHERE r.state = 'UNPAID')::bigint,
           (SELECT count(*) FROM rentals r WHERE r.state = 'UNPAID' AND r.ended_at >= p_from AND r.ended_at < p_to)::integer,
           (SELECT COALESCE(sum(r.total_amount), 0) FROM rentals r
            WHERE r.state = 'UNPAID' AND r.ended_at >= p_from AND r.ended_at < p_to)::bigint,
           (SELECT count(DISTINCT p.rental_id) FROM payments p
            WHERE p.purpose = 'RIDE' AND p.status IN ('SUCCEEDED', 'REFUNDED') AND p.created_at >= p_from AND p.created_at < p_to
              AND EXISTS (SELECT 1 FROM payments f WHERE f.rental_id = p.rental_id AND f.purpose = 'RIDE'
                            AND f.status = 'FAILED' AND f.created_at < p.created_at))::integer,
           (SELECT COALESCE(sum(p.amount), 0) FROM payments p
            WHERE p.purpose = 'RIDE' AND p.status IN ('SUCCEEDED', 'REFUNDED') AND p.created_at >= p_from AND p.created_at < p_to
              AND EXISTS (SELECT 1 FROM payments f WHERE f.rental_id = p.rental_id AND f.purpose = 'RIDE'
                            AND f.status = 'FAILED' AND f.created_at < p.created_at))::bigint
$$;

-- ---------------------------------------------------------------------
-- Pulpit i telemetria
-- ---------------------------------------------------------------------

-- Wykres pulpitu „Przejazdy dziś według godzin” (pytanie 9): przejazdy ze startem w każdej godzinie doby `p_day`
-- (czas polski, 24 wiersze) i średnia z czterech poprzednich tych samych dni tygodnia.
CREATE FUNCTION fn_dashboard_rides_by_hour(p_day date)
RETURNS TABLE (hour smallint, rides integer, avg_previous numeric)
LANGUAGE sql STABLE AS $$
    WITH r AS (
        SELECT (x.started_at AT TIME ZONE 'Europe/Warsaw')::date AS d,
               extract(hour FROM x.started_at AT TIME ZONE 'Europe/Warsaw')::integer AS h
        FROM rentals x
        WHERE x.started_at >= ((p_day - 28)::timestamp AT TIME ZONE 'Europe/Warsaw')
          AND x.started_at < ((p_day + 1)::timestamp AT TIME ZONE 'Europe/Warsaw'))
    SELECT g.h::smallint, count(r.d) FILTER (WHERE r.d = p_day)::integer,
           round(count(r.d) FILTER (WHERE r.d IN (p_day - 7, p_day - 14, p_day - 21, p_day - 28)) / 4.0, 2)
    FROM generate_series(0, 23) g(h)
    LEFT JOIN r ON r.h = g.h
    GROUP BY g.h
    ORDER BY g.h
$$;

-- Odczyty telemetrii hulajnogi w zakresie [p_from, p_to) dla listy Flota → Telemetria (ADR 0076): strona `p_limit`
-- wierszy od najnowszych albo od najstarszych, z filtrami baterii poniżej progu i odczytów w przejeździe. Kursor to
-- czas ostatniego wiersza strony: kolejna starsza strona to `p_to` = ten czas, nowsza `p_from` = ten czas + 1 µs.
-- `gap_seconds` to odstęp od poprzedniego odczytu tej hulajnogi (bez względu na filtry, do doby wstecz), liczony po
-- wybraniu strony, żeby zakres 24 h nie wymagał sprawdzania wszystkich odczytów.
CREATE FUNCTION fn_telemetry_readings(p_scooter_id uuid, p_from timestamptz, p_to timestamptz,
                                      p_newest_first boolean DEFAULT true, p_limit integer DEFAULT 50,
                                      p_battery_below smallint DEFAULT NULL, p_in_ride boolean DEFAULT false)
RETURNS TABLE (recorded_at timestamptz, lon double precision, lat double precision, battery_pct smallint,
               speed_kmh real, rental_id uuid, rental_number bigint, locked boolean, buffered boolean,
               gap_seconds numeric)
LANGUAGE sql STABLE AS $$
    SELECT t.recorded_at, ST_X(t.position), ST_Y(t.position), t.battery_pct, t.speed_kmh, t.rental_id, r.number,
           t.locked, t.buffered, extract(epoch FROM t.recorded_at - prev.recorded_at)
    FROM (
        SELECT x.* FROM telemetry x
        WHERE x.scooter_id = p_scooter_id AND x.recorded_at >= p_from AND x.recorded_at < p_to
          AND (p_battery_below IS NULL OR x.battery_pct < p_battery_below)
          AND (NOT p_in_ride OR x.rental_id IS NOT NULL)
        ORDER BY CASE WHEN p_newest_first THEN x.recorded_at END DESC,
                 CASE WHEN NOT p_newest_first THEN x.recorded_at END
        LIMIT p_limit) t
    LEFT JOIN rentals r ON r.id = t.rental_id
    LEFT JOIN LATERAL (
        SELECT p.recorded_at FROM telemetry p
        WHERE p.scooter_id = t.scooter_id AND p.recorded_at < t.recorded_at
          AND p.recorded_at >= t.recorded_at - interval '1 day'
        ORDER BY p.recorded_at DESC LIMIT 1) prev ON true
    ORDER BY CASE WHEN p_newest_first THEN t.recorded_at END DESC,
             CASE WHEN NOT p_newest_first THEN t.recorded_at END
$$;

-- =====================================================================
-- Indeksy pod funkcje raportowe (ADR 0071; pomiary EXPLAIN na danych generatora w iteracji 8/9, D8)
-- =====================================================================

CREATE INDEX receipts_issued_idx ON receipts (issued_at);
CREATE INDEX rentals_started_idx ON rentals (started_at) WHERE started_at IS NOT NULL;
CREATE INDEX rentals_ended_idx ON rentals (ended_at) WHERE ended_at IS NOT NULL;
CREATE INDEX rentals_unpaid_idx ON rentals (ended_at) WHERE state = 'UNPAID';
CREATE INDEX payments_succeeded_created_idx ON payments (created_at) WHERE status IN ('SUCCEEDED', 'REFUNDED');
CREATE INDEX refunds_succeeded_created_idx ON refunds (created_at) WHERE status = 'SUCCEEDED';
CREATE INDEX wallet_ledger_created_idx ON wallet_ledger (created_at);
CREATE INDEX wallet_ledger_user_created_idx ON wallet_ledger (user_id, created_at DESC, id DESC);
CREATE INDEX tickets_created_idx ON tickets (created_at);
CREATE INDEX service_tasks_created_idx ON service_tasks (created_at);
CREATE INDEX service_tasks_completed_idx ON service_tasks (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX users_created_idx ON users (created_at);
CREATE INDEX rental_events_created_idx ON rental_events (created_at DESC);
CREATE INDEX consents_marketing_idx ON consents (accepted_at) WHERE type = 'MARKETING';

-- =====================================================================
-- Szablony wydruków: dezaktywacja i ponowna aktywacja (ADR 0076, dług z iteracji 7)
-- =====================================================================

-- Dezaktywacja z blokadą szablonów rodzaju (ta sama kolejność blokad co `sp_document_template_set_default`). Domyślny
-- szablon z aktywną wersją: `TEMPLATE_IS_DEFAULT` (najpierw trzeba wskazać inny domyślny). Domyślny bez aktywnej
-- wersji traci rolę domyślnego (`CHECK active OR NOT is_default`). Nieaktywny szablon znika z okna „Drukuj”, a jego
-- wersje i wydruki zostają. `changed` = false, gdy szablon był już nieaktywny (bez wpisu w dzienniku audytu).
CREATE PROCEDURE sp_document_template_deactivate(p_template_id uuid, p_staff_id uuid, OUT changed boolean)
LANGUAGE plpgsql AS $$
DECLARE
    v_type    document_type;
    v_active  boolean;
    v_default boolean;
BEGIN
    SELECT document_type INTO v_type FROM document_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    PERFORM 1 FROM document_templates WHERE document_type = v_type FOR UPDATE;
    SELECT active, is_default INTO v_active, v_default FROM document_templates WHERE id = p_template_id;
    IF NOT v_active THEN
        changed := false;
        RETURN;
    END IF;
    IF v_default AND EXISTS (SELECT 1 FROM document_template_versions WHERE template_id = p_template_id AND is_active) THEN
        RAISE EXCEPTION 'TEMPLATE_IS_DEFAULT' USING ERRCODE = 'raise_exception';
    END IF;
    UPDATE document_templates
    SET active = false, is_default = false, deactivated_at = now(), updated_at = now(),
        updated_by = COALESCE(p_staff_id, updated_by), version = version + 1
    WHERE id = p_template_id;
    changed := true;
END
$$;

-- Ponowna aktywacja („Aktywuj ponownie”): szablon wraca jako aktywny, bez roli domyślnego.
CREATE PROCEDURE sp_document_template_reactivate(p_template_id uuid, p_staff_id uuid, OUT changed boolean)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE document_templates
    SET active = true, deactivated_at = NULL, updated_at = now(), updated_by = COALESCE(p_staff_id, updated_by),
        version = version + 1
    WHERE id = p_template_id AND NOT active;
    changed := FOUND;
    IF NOT changed AND NOT EXISTS (SELECT 1 FROM document_templates WHERE id = p_template_id) THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
END
$$;

-- =====================================================================
-- Poprawione widoki (długi z iteracji 6 i 7; CREATE OR REPLACE dopuszcza tylko dopisanie kolumn na końcu)
-- =====================================================================

-- Części poniżej minimum według tej samej reguły co core i `v_spare_part_list` (`<`, arc42 §11); wcześniej `<=`.
CREATE OR REPLACE VIEW v_low_stock_parts AS
SELECT id, sku, name, stock_qty, min_stock_qty, min_stock_qty - stock_qty AS shortage
FROM spare_parts
WHERE active AND stock_qty < min_stock_qty;

-- Paragon i korekta: przyczyna korekty z powodu i notatki zwrotu, którego dotyczy (dług z iteracji 7).
CREATE OR REPLACE VIEW v_doc_receipt AS
SELECT rc.id AS receipt_id, rc.number, rc.kind, rc.kind = 'CORRECTION' AS is_correction, rc.issued_at, rc.user_id,
       rc.buyer_name, rc.buyer_phone, rc.buyer_email,
       rc.seller ->> 'name' AS seller_name, rc.seller ->> 'address' AS seller_address, rc.seller ->> 'taxId' AS seller_tax_id,
       rc.payment_source, l.card_brand, l.card_last4, rc.total_amount, rc.currency, l.vat_amount, l.net_amount,
       rc.rental_id, l.rental_number, rc.refund_id, rc.corrects_receipt_id, l.corrects_number,
       o.issued_at AS corrects_issued_at,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('lineNo', i.line_no, 'description', i.description,
                                                     'quantity', i.quantity, 'unitPrice', i.unit_price,
                                                     'vatRate', i.vat_rate, 'amount', i.amount) ORDER BY i.line_no), '[]'::jsonb)
        FROM receipt_items i WHERE i.receipt_id = rc.id) AS items,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('vatRate', g.vat_rate, 'gross', g.gross, 'vat', g.vat,
                                                     'net', g.gross - g.vat) ORDER BY g.vat_rate DESC NULLS LAST), '[]'::jsonb)
        FROM (SELECT i.vat_rate, sum(i.amount)::bigint AS gross,
                     COALESCE(fn_vat_from_gross(sum(i.amount)::bigint, i.vat_rate), 0) AS vat
              FROM receipt_items i WHERE i.receipt_id = rc.id GROUP BY i.vat_rate) g) AS vat_groups,
       EXISTS (SELECT 1 FROM receipt_items i WHERE i.receipt_id = rc.id AND i.vat_rate IS NULL) AS has_outside_vat,
       f.reason AS correction_reason, f.note AS correction_note
FROM receipts rc
JOIN v_receipt_list l ON l.id = rc.id
LEFT JOIN receipts o ON o.id = rc.corrects_receipt_id
LEFT JOIN refunds f ON f.id = rc.refund_id;

-- Szablony wydruków: liczba pól aktywnej wersji, wydruki z 30 dni i data dezaktywacji (dług z iteracji 7).
CREATE OR REPLACE VIEW v_document_templates AS
SELECT t.id, t.document_type, t.name, t.description, t.is_default, t.active,
       av.id AS active_version_id, av.version_no AS active_version_no, av.activated_at AS active_since,
       (SELECT count(*)::integer FROM document_template_versions v WHERE v.template_id = t.id) AS versions,
       (SELECT count(*)::integer FROM document_template_versions v WHERE v.template_id = t.id AND v.activated_at IS NULL)
           AS pending_versions,
       (SELECT max(g.created_at) FROM generated_documents g
        JOIN document_template_versions v ON v.id = g.template_version_id WHERE v.template_id = t.id) AS last_generated_at,
       t.created_by, t.updated_by, s.name AS updated_by_name, t.created_at, t.updated_at, t.version,
       COALESCE(cardinality(av.fields), 0) AS active_fields,
       (SELECT count(*)::integer FROM generated_documents g
        JOIN document_template_versions v ON v.id = g.template_version_id
        WHERE v.template_id = t.id AND g.created_at >= now() - interval '30 days') AS generated_30d,
       t.deactivated_at
FROM document_templates t
LEFT JOIN document_template_versions av ON av.template_id = t.id AND av.is_active
LEFT JOIN staff s ON s.id = t.updated_by;

-- =====================================================================
-- Widoki nowych list panelu (ADR 0071, ADR 0076 „Miejsca w panelu”)
-- =====================================================================

-- Raporty → Historia (`reports.<kod>` raportu wiersza): stan z „Plik usunięty” (FILE_DELETED: SUCCEEDED po retencji),
-- nazwa raportu z definicji, zlecający z rolami, rozmiar pliku, czas trwania, krótki identyfikator ze stopki pliku.
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
            THEN floor(extract(epoch FROM rr.finished_at - rr.started_at) * 1000)::integer END AS duration_ms,
       rr.file_deleted_at
FROM report_runs rr
JOIN report_definitions d ON d.code = rr.report_code
JOIN staff s ON s.id = rr.requested_by
LEFT JOIN files f ON f.id = rr.file_id;

-- Raporty → Definicje i katalog: definicja z rolami, które mają jej uprawnienie, autorem zmiany i ostatnim uruchomieniem
-- (dowolnego zlecającego, pytanie 7).
CREATE VIEW v_report_definitions AS
SELECT d.code, d.name, d.description, d.permission_code, d.parameters, d.formats, d.active, d.sort_order,
       (SELECT COALESCE(array_agg(r.name ORDER BY r.name), '{}'::text[])
        FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = d.permission_code)
           AS permission_roles,
       d.updated_by, s.name AS updated_by_name, d.updated_at, d.version,
       (SELECT count(*)::integer FROM report_runs rr WHERE rr.report_code = d.code) AS runs,
       lr.id AS last_run_id, lr.created_at AS last_run_at, lr.format AS last_run_format,
       CASE WHEN lr.file_deleted_at IS NOT NULL THEN 'FILE_DELETED' ELSE lr.status::text END AS last_run_state
FROM report_definitions d
LEFT JOIN staff s ON s.id = d.updated_by
LEFT JOIN LATERAL (
    SELECT rr.id, rr.created_at, rr.format, rr.status, rr.file_deleted_at FROM report_runs rr
    WHERE rr.report_code = d.code ORDER BY rr.created_at DESC LIMIT 1) lr ON true;

-- Użytkownicy → Zgody (`users.read`; wycofanie marketingowej `users.manage`): stan liczony jak na karcie klienta.
-- REVOKED (wycofana), SUPERSEDED (starszy wiersz tego rodzaju: klient zaakceptował później inną wersję), CONFIRMED
-- (oświadczenie o wieku), CURRENT (zgoda na obowiązującą wersję albo dokument bez wersji w module treści), OUTDATED
-- („Czeka na wersję N”: opublikowano nowszą wersję).
CREATE VIEW v_consent_list AS
SELECT c.id, c.user_id, u.name AS user_name, u.phone AS user_phone, u.status AS user_status, c.type,
       c.document_version, c.page_version_id, v.version_no, p.slug AS document_slug, v.title AS document_title,
       c.source, c.accepted_at, c.revoked_at, c.revoked_by_staff, s.name AS revoked_by_name,
       cur.version_id AS current_version_id, cur.version_no AS current_version_no,
       latest.id = c.id AS is_latest,
       CASE
           WHEN c.revoked_at IS NOT NULL THEN 'REVOKED'
           WHEN latest.id <> c.id THEN 'SUPERSEDED'
           WHEN c.type = 'AGE' THEN 'CONFIRMED'
           WHEN cur.version_id IS NULL OR c.page_version_id = cur.version_id THEN 'CURRENT'
           ELSE 'OUTDATED' END AS state,
       COALESCE(c.revoked_at, c.accepted_at) AS state_at
FROM consents c
JOIN users u ON u.id = c.user_id
LEFT JOIN content_page_versions v ON v.id = c.page_version_id
LEFT JOIN content_pages p ON p.id = v.page_id
LEFT JOIN v_current_documents cur ON cur.consent_type = c.type
LEFT JOIN staff s ON s.id = c.revoked_by_staff
JOIN LATERAL (
    SELECT l.id FROM consents l WHERE l.user_id = c.user_id AND l.type = c.type
    ORDER BY l.accepted_at DESC, l.id DESC LIMIT 1) latest ON true;

-- Użytkownicy → Sesje (`users.read`; unieważnienie rodziny `users.manage`): jeden wiersz na rodzinę tokenów
-- (`family_id`, jedno logowanie; rotacja tokenu dopisuje wiersz), bez skrótu tokenu. `id` to `family_id`, `short_id`
-- to początek identyfikatora pierwszej sesji rodziny. Stan bieżącego (najnowszego) wiersza: REVOKED, EXPIRED, ACTIVE.
CREATE VIEW v_session_list AS
SELECT f.family_id AS id, left(fs.id::text, 8) AS short_id, fs.id AS first_session_id, cur.id AS current_session_id,
       f.user_id, u.name AS user_name, u.phone AS user_phone, u.status AS user_status,
       cur.device_name, cur.platform, cur.app_version,
       f.created_at, f.last_used_at, cur.expires_at, cur.revoked_at, f.tokens - 1 AS rotations,
       CASE WHEN cur.revoked_at IS NOT NULL THEN 'REVOKED' WHEN cur.expires_at <= now() THEN 'EXPIRED' ELSE 'ACTIVE' END
           AS state
FROM (
    SELECT s.family_id, s.user_id, min(s.created_at) AS created_at, count(*)::integer AS tokens,
           max(COALESCE(s.last_used_at, s.created_at)) AS last_used_at
    FROM sessions s GROUP BY s.family_id, s.user_id) f
JOIN LATERAL (
    SELECT s.id, s.device_name, s.platform, s.app_version, s.expires_at, s.revoked_at FROM sessions s
    WHERE s.family_id = f.family_id ORDER BY s.replaced_by IS NULL DESC, s.created_at DESC, s.id DESC LIMIT 1) cur ON true
JOIN LATERAL (
    SELECT s.id FROM sessions s WHERE s.family_id = f.family_id ORDER BY s.created_at, s.id LIMIT 1) fs ON true
JOIN users u ON u.id = f.user_id;

-- Operatorzy i role → Sesje (`staff.read`; unieważnienie `staff.manage`): jak `v_session_list`, z przeglądarką
-- (`user_agent`, rozbiór w API) i zapamiętaniem urządzenia.
CREATE VIEW v_staff_session_list AS
SELECT f.family_id AS id, left(fs.id::text, 8) AS short_id, fs.id AS first_session_id, cur.id AS current_session_id,
       f.staff_id, st.name AS staff_name, st.email AS staff_email, cur.user_agent, cur.remembered,
       f.created_at, f.last_used_at, cur.expires_at, cur.revoked_at, f.tokens - 1 AS rotations,
       CASE WHEN cur.revoked_at IS NOT NULL THEN 'REVOKED' WHEN cur.expires_at <= now() THEN 'EXPIRED' ELSE 'ACTIVE' END
           AS state
FROM (
    SELECT s.family_id, s.staff_id, min(s.created_at) AS created_at, count(*)::integer AS tokens,
           max(COALESCE(s.last_used_at, s.created_at)) AS last_used_at
    FROM staff_sessions s GROUP BY s.family_id, s.staff_id) f
JOIN LATERAL (
    SELECT s.id, s.user_agent, s.remembered, s.expires_at, s.revoked_at FROM staff_sessions s
    WHERE s.family_id = f.family_id ORDER BY s.replaced_by IS NULL DESC, s.created_at DESC, s.id DESC LIMIT 1) cur ON true
JOIN LATERAL (
    SELECT s.id FROM staff_sessions s WHERE s.family_id = f.family_id ORDER BY s.created_at, s.id LIMIT 1) fs ON true
JOIN staff st ON st.id = f.staff_id;

-- Operatorzy i role → Zaproszenia (`staff.read`; ponowne wysłanie i unieważnienie `staff.manage`), bez skrótu tokenu.
-- Stan: ACCEPTED, REPLACED (unieważnione przez ponowne wysłanie), REVOKED, EXPIRED, PENDING; `is_resend` przy
-- kolejnym zaproszeniu tego samego operatora; zapraszający NULL to polecenie `pnpm db:staff:create`.
CREATE VIEW v_staff_invitation_list AS
SELECT i.id, i.staff_id, st.name AS staff_name, st.email AS staff_email, st.active AS staff_active,
       (SELECT COALESCE(array_agg(r.name ORDER BY r.name), '{}'::text[])
        FROM staff_roles sr JOIN roles r ON r.id = sr.role_id WHERE sr.staff_id = i.staff_id) AS staff_roles,
       i.invited_by, inv.name AS invited_by_name, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, i.replaced_by,
       EXISTS (SELECT 1 FROM staff_invitations e WHERE e.staff_id = i.staff_id AND e.created_at < i.created_at) AS is_resend,
       CASE
           WHEN i.accepted_at IS NOT NULL THEN 'ACCEPTED'
           WHEN i.replaced_by IS NOT NULL THEN 'REPLACED'
           WHEN i.revoked_at IS NOT NULL THEN 'REVOKED'
           WHEN i.expires_at <= now() THEN 'EXPIRED'
           ELSE 'PENDING' END AS state
FROM staff_invitations i
JOIN staff st ON st.id = i.staff_id
LEFT JOIN staff inv ON inv.id = i.invited_by;

-- Użytkownicy → Kody SMS (`users.read`; „Usuń wygasłe” przez `sp_purge_expired_otp` z `users.manage`): bez skrótu
-- kodu, numer zamaskowany w bazie do trzech ostatnich cyfr (pełny numer nie wychodzi z widoku), klient dołączony po
-- numerze (NULL: rejestracja bez konta albo numer po zmianie). Stan: CONSUMED, BLOCKED (5 prób, `OTP_POLICY.maxAttempts`
-- w core), EXPIRED, ACTIVE. `purgeable`: ten sam warunek co procedura usuwania (podgląd liczby w oknie potwierdzenia).
CREATE VIEW v_otp_code_list AS
SELECT o.id,
       CASE WHEN o.phone ~ '^\+48[0-9]{9}$' THEN '+48 ••• ••• ' || right(o.phone, 3)
            ELSE '••• ' || right(o.phone, 3) END AS phone_masked,
       right(o.phone, 3) AS phone_last3,
       u.id AS user_id, u.name AS user_name, o.purpose, o.created_at, o.expires_at, o.attempts, o.consumed_at,
       CASE
           WHEN o.consumed_at IS NOT NULL THEN 'CONSUMED'
           WHEN o.attempts >= 5 THEN 'BLOCKED'
           WHEN o.expires_at <= now() THEN 'EXPIRED'
           ELSE 'ACTIVE' END AS state,
       o.expires_at < now() - interval '1 day' AS purgeable
FROM otp_codes o
LEFT JOIN users u ON u.phone = o.phone;

-- Flota → Komendy (`scooters.read`; wysyłka z karty hulajnogi `scooters.command`): źródło, strefa, operator, przejazd,
-- czas odpowiedzi; klient przejazdu niepokazywany.
CREATE VIEW v_scooter_command_list AS
SELECT c.id, c.scooter_id, s.number AS scooter_number, c.type, c.payload, c.source, c.zone_id, z.code AS zone_code,
       z.name AS zone_name, c.issued_by_staff, st.name AS staff_name, c.rental_id, r.number AS rental_number, c.status,
       c.ack_reason, c.sent_at, c.acked_at, c.expires_at,
       CASE WHEN c.acked_at IS NOT NULL THEN floor(extract(epoch FROM c.acked_at - c.sent_at) * 1000)::integer END
           AS response_ms
FROM scooter_commands c
JOIN scooters s ON s.id = c.scooter_id
LEFT JOIN zones z ON z.id = c.zone_id
LEFT JOIN staff st ON st.id = c.issued_by_staff
LEFT JOIN rentals r ON r.id = c.rental_id;

-- Przejazdy → Zdarzenia (`rentals.read`, tylko odczyt): zdarzenie z przejazdem, hulajnogą, klientem (maskowanie
-- bez `users.read` w API, jak na liście przejazdów) i strefą.
CREATE VIEW v_rental_event_list AS
SELECT e.id, e.rental_id, r.number AS rental_number, r.state AS rental_state, r.scooter_id, s.number AS scooter_number,
       r.user_id, u.name AS user_name, e.type, e.from_state, e.to_state, e.zone_id, z.code AS zone_code,
       z.name AS zone_name, z.type AS zone_type, e.data, e.created_at
FROM rental_events e
JOIN rentals r ON r.id = e.rental_id
JOIN scooters s ON s.id = r.scooter_id
JOIN users u ON u.id = r.user_id
LEFT JOIN zones z ON z.id = e.zone_id;

-- Strefy → Obecność w strefach (`zones.read`, tylko odczyt): bieżące strefy hulajnóg w przejazdach.
CREATE VIEW v_zone_presence_list AS
SELECT p.scooter_id, s.number AS scooter_number, p.zone_id, z.code AS zone_code, z.name AS zone_name,
       z.type AS zone_type, p.rental_id, r.number AS rental_number, p.entered_at, p.outside_count,
       floor(extract(epoch FROM now() - p.entered_at))::bigint AS seconds_in_zone
FROM scooter_zone_presence p
JOIN scooters s ON s.id = p.scooter_id
JOIN zones z ON z.id = p.zone_id
JOIN rentals r ON r.id = p.rental_id;

-- Strefy → Komendy stref (`zones.read`, tylko odczyt): stan sterowania hulajnogą w przejeździe z wynikiem ostatnich
-- komend limitu i zatrzymania.
CREATE VIEW v_zone_control_list AS
SELECT c.scooter_id, s.number AS scooter_number, c.rental_id, r.number AS rental_number, c.speed_limit_kmh,
       c.limit_synced, c.limit_command_id, lc.status AS limit_command_status, c.stopped, c.stop_synced,
       c.stop_command_id, sc.status AS stop_command_status, c.started_at, c.updated_at
FROM scooter_zone_control c
JOIN scooters s ON s.id = c.scooter_id
JOIN rentals r ON r.id = c.rental_id
LEFT JOIN scooter_commands lc ON lc.id = c.limit_command_id
LEFT JOIN scooter_commands sc ON sc.id = c.stop_command_id;

-- Płatności → Klienci operatora (`payments.read`, tylko odczyt): identyfikator klienta u operatora płatności, klient,
-- liczba zapisanych kart i ostatnia płatność.
CREATE VIEW v_payment_customer_list AS
SELECT pc.user_id, u.name AS user_name, u.status AS user_status, pc.provider, pc.provider_customer_id, pc.created_at,
       (SELECT count(*)::integer FROM payment_methods m
        WHERE m.user_id = pc.user_id AND m.provider = pc.provider AND m.removed_at IS NULL) AS payment_methods,
       (SELECT max(p.created_at) FROM payments p WHERE p.user_id = pc.user_id AND p.provider = pc.provider)
           AS last_payment_at
FROM payment_customers pc
JOIN users u ON u.id = pc.user_id;

-- Operatorzy i role → Uprawnienia (`roles.manage`): kod z katalogu w core, grupa, opis (edycja z wersją), role
-- z uprawnieniem, czy ma je rola Administrator, autor zmiany opisu (NULL: opis z migracji).
CREATE VIEW v_permission_list AS
SELECT p.code, p.module, p.description, count(r.id)::integer AS roles_count,
       COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}'::text[]) AS role_names,
       COALESCE(bool_or(r.name = 'Administrator' AND r.is_system), false) AS in_administrator,
       p.updated_at, p.updated_by, s.name AS updated_by_name, p.version
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_code = p.code
LEFT JOIN roles r ON r.id = rp.role_id
LEFT JOIN staff s ON s.id = p.updated_by
GROUP BY p.code, s.name;

-- Karta klienta → Zapisane miejsca (`users.read`, usunięcie `users.manage`): etykieta, nazwa i współrzędne.
CREATE VIEW v_saved_place_list AS
SELECT sp.id, sp.user_id, u.name AS user_name, sp.label, sp.name, ST_X(sp.position) AS lon, ST_Y(sp.position) AS lat,
       sp.created_at
FROM saved_places sp
JOIN users u ON u.id = sp.user_id;
CREATE INDEX saved_places_user_idx ON saved_places (user_id, created_at DESC);

-- Wyjazd ze strefy w `fn_report_rides_zone_entries` (podzapytanie na każdy wjazd: pierwszy `ZONE_EXITED` tej strefy
-- w przejeździe po wjeździe). Pomiar na danych generatora (ADR 0075, 90 dób, ok. 48 tys. wjazdów): 1,9 s → 0,6 s
-- przy domyślnym JIT i 0,50 s → 0,27 s bez JIT.
CREATE INDEX IF NOT EXISTS rental_events_zone_exit_idx ON rental_events (rental_id, zone_id, created_at)
    WHERE type = 'ZONE_EXITED';
