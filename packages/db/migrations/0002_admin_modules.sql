-- 0002: uprawnienia, treści, raporty, wydruki, serwis i paragony; widoki, funkcje i procedury.
-- Decyzje: ADR 0026 (co robi baza), 0027 (treści), 0028 (role i uprawnienia),
-- 0029 (raporty), 0030 (wydruki), 0031 (kolumna version w tabelach edytowalnych).
-- Nazwy: widoki v_*, funkcje fn_*, procedury sp_*, funkcje wyzwalaczy trg_*.

-- =====================================================================
-- Typy wyliczeniowe
-- =====================================================================

CREATE TYPE content_status       AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE content_client       AS ENUM ('WEB', 'MOBILE', 'ADMIN');
CREATE TYPE notification_channel AS ENUM ('PUSH', 'SMS');
CREATE TYPE job_status           AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE report_format        AS ENUM ('PDF', 'XLSX', 'CSV');
CREATE TYPE document_type        AS ENUM ('RENTAL_CONFIRMATION', 'SERVICE_PROTOCOL', 'SCOOTER_CARD',
                                          'INCIDENT_REPORT', 'WALLET_ADJUSTMENT', 'RECEIPT');
CREATE TYPE service_task_type    AS ENUM ('REPAIR', 'BATTERY_SWAP', 'INSPECTION', 'RELOCATION');
CREATE TYPE service_task_status  AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE task_priority        AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- Nowe wartości nie są używane w tej migracji (ADD VALUE w transakcji nie pozwala ich użyć przed COMMIT).
ALTER TYPE file_purpose ADD VALUE 'MEDIA';
ALTER TYPE file_purpose ADD VALUE 'DOCUMENT_TEMPLATE';
ALTER TYPE file_purpose ADD VALUE 'GENERATED_DOCUMENT';
ALTER TYPE file_purpose ADD VALUE 'REPORT_EXPORT';

-- =====================================================================
-- Blokada optymistyczna i daty zmian w istniejących tabelach edytowalnych (ADR 0031)
-- =====================================================================

ALTER TABLE users    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
                     ADD COLUMN version    integer     NOT NULL DEFAULT 1;
ALTER TABLE staff    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
                     ADD COLUMN version    integer     NOT NULL DEFAULT 1;
ALTER TABLE scooters ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
                     ADD COLUMN version    integer     NOT NULL DEFAULT 1;
ALTER TABLE zones    ADD COLUMN version    integer     NOT NULL DEFAULT 1;
ALTER TABLE tickets  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
                     ADD COLUMN version    integer     NOT NULL DEFAULT 1;

-- Pliki wgrywane przez operatorów (media, szablony); pliki systemowe nie mają autora.
ALTER TABLE files ADD COLUMN uploaded_by_staff uuid REFERENCES staff(id),
                  ADD COLUMN original_name     text,
                  ADD CONSTRAINT files_one_uploader CHECK (num_nonnulls(uploaded_by, uploaded_by_staff) <= 1);

-- =====================================================================
-- Role i uprawnienia (ADR 0028)
-- =====================================================================

-- Katalog uprawnień pochodzi z kodu (packages/core); tutaj stan początkowy potrzebny do przeniesienia ról.
CREATE TABLE permissions (
    code            text PRIMARY KEY CHECK (code ~ '^[a-z_]+\.[a-z_]+$'),
    module          text NOT NULL,
    description     text NOT NULL
);

CREATE TABLE roles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL UNIQUE,
    description     text,
    is_system       boolean NOT NULL DEFAULT false, -- roli systemowej nie można usunąć
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

CREATE TABLE role_permissions (
    role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_code text NOT NULL REFERENCES permissions(code) ON UPDATE CASCADE,
    PRIMARY KEY (role_id, permission_code)
);

-- Bez ON DELETE CASCADE: roli przypisanej operatorom nie da się usunąć.
CREATE TABLE staff_roles (
    staff_id        uuid NOT NULL REFERENCES staff(id),
    role_id         uuid NOT NULL REFERENCES roles(id),
    assigned_by     uuid REFERENCES staff(id),
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (staff_id, role_id)
);
CREATE INDEX staff_roles_role_idx ON staff_roles (role_id);

INSERT INTO permissions (code, module, description) VALUES
    ('dashboard.read',        'dashboard',  'Podgląd pulpitu'),
    ('scooters.read',         'fleet',      'Podgląd floty i modeli hulajnóg'),
    ('scooters.write',        'fleet',      'Dodawanie i edycja hulajnóg i modeli'),
    ('scooters.command',      'fleet',      'Zdalne komendy do hulajnóg'),
    ('telemetry.read',        'fleet',      'Podgląd telemetrii i tras'),
    ('zones.read',            'zones',      'Podgląd stref'),
    ('zones.write',           'zones',      'Tworzenie i edycja stref'),
    ('rentals.read',          'rentals',    'Podgląd przejazdów'),
    ('rentals.manage',        'rentals',    'Zdalne zakończenie przejazdu i zwroty'),
    ('tariffs.read',          'payments',   'Podgląd cennika'),
    ('tariffs.write',         'payments',   'Nowe wersje cennika'),
    ('payments.read',         'payments',   'Podgląd płatności i paragonów'),
    ('wallet.adjust',         'payments',   'Korekty salda portfela'),
    ('users.read',            'accounts',   'Podgląd kont klientów'),
    ('users.manage',          'accounts',   'Blokada, odblokowanie i usunięcie kont klientów'),
    ('tickets.read',          'operations', 'Podgląd zgłoszeń'),
    ('tickets.manage',        'operations', 'Obsługa zgłoszeń'),
    ('service.read',          'service',    'Podgląd zadań serwisowych i części'),
    ('service.manage',        'service',    'Zadania serwisowe i magazyn części'),
    ('staff.read',            'access',     'Podgląd operatorów'),
    ('staff.manage',          'access',     'Zapraszanie i dezaktywacja operatorów'),
    ('roles.manage',          'access',     'Role i uprawnienia'),
    ('audit.read',            'access',     'Dziennik audytu'),
    ('content.read',          'content',    'Podgląd treści'),
    ('content.write',         'content',    'Edycja treści, aktualności i mediów'),
    ('reports.revenue',       'reports',    'Raport przychodów'),
    ('reports.fleet_usage',   'reports',    'Raport wykorzystania floty'),
    ('reports.rides_by_zone', 'reports',    'Raport przejazdów według stref i godzin'),
    ('reports.reliability',   'reports',    'Raport awaryjności'),
    ('reports.users',         'reports',    'Raport użytkowników'),
    ('reports.wallet',        'reports',    'Raport sald i operacji portfela'),
    ('templates.read',        'documents',  'Podgląd szablonów wydruków'),
    ('templates.write',       'documents',  'Wgrywanie i aktywacja szablonów wydruków'),
    ('documents.generate',    'documents',  'Generowanie wydruków'),
    ('simulator.manage',      'simulator',  'Sterowanie symulatorem floty');

INSERT INTO roles (name, description, is_system) VALUES
    ('Administrator', 'Pełny dostęp do panelu', true),
    ('Dyspozytor',    'Flota, przejazdy, klienci i zgłoszenia', false),
    ('Serwisant',     'Zgłoszenia, zadania serwisowe i komendy serwisowe', false);

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.name = 'Administrator';

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
    'dashboard.read', 'scooters.read', 'scooters.command', 'telemetry.read', 'zones.read',
    'rentals.read', 'rentals.manage', 'tariffs.read', 'payments.read', 'users.read',
    'tickets.read', 'tickets.manage', 'service.read', 'content.read',
    'reports.fleet_usage', 'reports.rides_by_zone', 'templates.read', 'documents.generate'])
WHERE r.name = 'Dyspozytor';

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
    'dashboard.read', 'scooters.read', 'scooters.command', 'telemetry.read', 'zones.read',
    'tickets.read', 'tickets.manage', 'service.read', 'service.manage',
    'reports.reliability', 'templates.read', 'documents.generate'])
WHERE r.name = 'Serwisant';

-- Przeniesienie dotychczasowych ról z typu wyliczeniowego.
INSERT INTO staff_roles (staff_id, role_id)
SELECT s.id, r.id
FROM staff s
JOIN roles r ON r.name = CASE s.role WHEN 'ADMIN' THEN 'Administrator'
                                     WHEN 'DISPATCHER' THEN 'Dyspozytor'
                                     ELSE 'Serwisant' END;

ALTER TABLE staff DROP COLUMN role;
DROP TYPE staff_role;

-- =====================================================================
-- Treści merytoryczne i media (ADR 0027)
-- =====================================================================

CREATE TABLE media_assets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key             text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_.-]+$'),   -- np. web.home.hero
    file_id         uuid NOT NULL UNIQUE REFERENCES files(id),
    alt_text        text NOT NULL,
    caption         text,
    updated_by      uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

-- Dokumenty z wersjami (regulamin, polityka prywatności, zasady jazdy).
CREATE TABLE content_pages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    name            text NOT NULL,                  -- nazwa robocza w panelu
    consent_type    consent_type UNIQUE,            -- zgoda, której dotyczy dokument (regulamin, prywatność)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

CREATE TABLE content_page_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id         uuid NOT NULL REFERENCES content_pages(id),
    version_no      integer NOT NULL CHECK (version_no > 0),
    title           text NOT NULL,
    body_md         text NOT NULL,
    status          content_status NOT NULL DEFAULT 'DRAFT',
    published_at    timestamptz,
    created_by      uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (page_id, version_no),
    CHECK (status = 'DRAFT' OR published_at IS NOT NULL)
);
-- Dokładnie jedna obowiązująca wersja dokumentu.
CREATE UNIQUE INDEX content_page_versions_one_published ON content_page_versions (page_id)
    WHERE status = 'PUBLISHED';

-- Zgoda wskazuje konkretną wersję dokumentu; document_version zostaje dla zgód sprzed modułu treści.
ALTER TABLE consents ADD COLUMN page_version_id uuid REFERENCES content_page_versions(id);

-- Bloki treści z kluczem: strona promocyjna, ekrany powitalne, opisy w aplikacji.
CREATE TABLE content_blocks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key             text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_.-]+$'),   -- np. mobile.onboarding.rules
    client          content_client NOT NULL,
    title           text,
    body_md         text,
    media_id        uuid REFERENCES media_assets(id),
    cta_label       text,
    cta_url         text,
    sort_order      integer NOT NULL DEFAULT 0,
    status          content_status NOT NULL DEFAULT 'DRAFT',
    updated_by      uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CHECK ((cta_label IS NULL) = (cta_url IS NULL)),
    CHECK (num_nonnulls(title, body_md, media_id) > 0)
);
CREATE INDEX content_blocks_client_idx ON content_blocks (client, status, sort_order);

CREATE TABLE faq_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category        text NOT NULL,
    question        text NOT NULL,
    answer_md       text NOT NULL,
    sort_order      integer NOT NULL DEFAULT 0,
    status          content_status NOT NULL DEFAULT 'DRAFT',
    updated_by      uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);
CREATE INDEX faq_items_status_idx ON faq_items (status, category, sort_order);

CREATE TABLE news (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    title           text NOT NULL,
    lead            text,
    body_md         text NOT NULL,
    media_id        uuid REFERENCES media_assets(id),
    status          content_status NOT NULL DEFAULT 'DRAFT',
    publish_from    timestamptz,
    publish_to      timestamptz,
    created_by      uuid REFERENCES staff(id),
    updated_by      uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CHECK (status <> 'PUBLISHED' OR publish_from IS NOT NULL),
    CHECK (publish_to IS NULL OR publish_from IS NULL OR publish_to > publish_from)
);
CREATE INDEX news_published_idx ON news (publish_from DESC) WHERE status = 'PUBLISHED';

-- Treść powiadomień w formacie ICU MessageFormat, np. „Przejazd zakończony, koszt {amount}”.
CREATE TABLE notification_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL CHECK (code ~ '^[a-z_]+$'),     -- np. ride_ended
    channel         notification_channel NOT NULL,
    title           text,
    body            text NOT NULL,
    description     text,                           -- kiedy wysyłane i jakie parametry
    updated_by      uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    UNIQUE (code, channel),
    CHECK (channel = 'PUSH' OR title IS NULL)       -- SMS nie ma tytułu
);

-- Licznik zmian treści dla ETag i zdarzenia content.updated. Sekwencja nie cofa się przy ROLLBACK,
-- więc wycofana zmiana najwyżej wymusi zbędne odświeżenie po stronie klienta.
CREATE SEQUENCE content_revision_seq;

CREATE FUNCTION trg_content_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM nextval('content_revision_seq');
    RETURN NULL;
END
$$;

CREATE TRIGGER content_pages_revision AFTER INSERT OR UPDATE OR DELETE ON content_pages
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER content_page_versions_revision AFTER INSERT OR UPDATE OR DELETE ON content_page_versions
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER content_blocks_revision AFTER INSERT OR UPDATE OR DELETE ON content_blocks
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER faq_items_revision AFTER INSERT OR UPDATE OR DELETE ON faq_items
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER news_revision AFTER INSERT OR UPDATE OR DELETE ON news
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER notification_templates_revision AFTER INSERT OR UPDATE OR DELETE ON notification_templates
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER media_assets_revision AFTER INSERT OR UPDATE OR DELETE ON media_assets
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();

-- =====================================================================
-- Raporty (ADR 0029)
-- =====================================================================

-- Logika raportu jest w kodzie; wiersz przechowuje nazwę, opis, uprawnienie i parametry widoczne w panelu.
CREATE TABLE report_definitions (
    code            text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
    name            text NOT NULL,
    description     text,
    permission_code text NOT NULL REFERENCES permissions(code) ON UPDATE CASCADE,
    parameters      jsonb NOT NULL DEFAULT '{}',    -- schemat parametrów (JSON Schema) z definicji w kodzie
    formats         report_format[] NOT NULL DEFAULT '{PDF,XLSX}' CHECK (cardinality(formats) > 0),
    active          boolean NOT NULL DEFAULT true,
    sort_order      integer NOT NULL DEFAULT 0,
    updated_by      uuid REFERENCES staff(id),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

CREATE TABLE report_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_code     text NOT NULL REFERENCES report_definitions(code),
    format          report_format NOT NULL,
    params          jsonb NOT NULL DEFAULT '{}',
    status          job_status NOT NULL DEFAULT 'QUEUED',
    requested_by    uuid NOT NULL REFERENCES staff(id),
    file_id         uuid REFERENCES files(id),
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,
    CHECK (status <> 'SUCCEEDED' OR file_id IS NOT NULL),
    CHECK (status <> 'FAILED' OR error IS NOT NULL)
);
CREATE INDEX report_runs_report_idx ON report_runs (report_code, created_at DESC);
CREATE INDEX report_runs_requested_idx ON report_runs (requested_by, created_at DESC);

-- =====================================================================
-- Wydruki z szablonów DOCX (ADR 0030)
-- =====================================================================

CREATE TABLE document_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type   document_type NOT NULL,
    name            text NOT NULL,
    description     text,
    is_default      boolean NOT NULL DEFAULT false,
    active          boolean NOT NULL DEFAULT true,
    created_by      uuid REFERENCES staff(id),
    updated_by      uuid REFERENCES staff(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    UNIQUE (document_type, name),
    CHECK (active OR NOT is_default)
);
CREATE UNIQUE INDEX document_templates_one_default ON document_templates (document_type) WHERE is_default;

CREATE TABLE document_template_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     uuid NOT NULL REFERENCES document_templates(id),
    version_no      integer NOT NULL CHECK (version_no > 0),
    file_id         uuid NOT NULL UNIQUE REFERENCES files(id),
    fields          text[] NOT NULL DEFAULT '{}',   -- znaczniki odczytane z pliku przy wgraniu
    is_active       boolean NOT NULL DEFAULT false,
    note            text,
    uploaded_by     uuid NOT NULL REFERENCES staff(id),
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_id, version_no)
);
CREATE UNIQUE INDEX document_template_versions_one_active ON document_template_versions (template_id)
    WHERE is_active;

-- entity_ref to identyfikator obiektu jako tekst (przejazd, hulajnoga, zgłoszenie, zadanie, wpis księgi).
CREATE TABLE generated_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type       document_type NOT NULL,
    template_version_id uuid NOT NULL REFERENCES document_template_versions(id),
    entity_ref          text NOT NULL,
    params              jsonb NOT NULL DEFAULT '{}',
    status              job_status NOT NULL DEFAULT 'QUEUED',
    docx_file_id        uuid REFERENCES files(id),
    pdf_file_id         uuid REFERENCES files(id),
    requested_by_staff  uuid REFERENCES staff(id),
    requested_by_user   uuid REFERENCES users(id),
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    CHECK (num_nonnulls(requested_by_staff, requested_by_user) = 1),
    CHECK (status <> 'SUCCEEDED' OR docx_file_id IS NOT NULL),
    CHECK (status <> 'FAILED' OR error IS NOT NULL)
);
CREATE INDEX generated_documents_entity_idx ON generated_documents (document_type, entity_ref, created_at DESC);

-- =====================================================================
-- Modele hulajnóg, serwis i części
-- =====================================================================

CREATE TABLE scooter_models (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    manufacturer    text,
    max_speed_kmh   smallint CHECK (max_speed_kmh > 0),
    battery_wh      integer CHECK (battery_wh > 0),
    range_km        smallint CHECK (range_km > 0),
    weight_kg       numeric(4, 1) CHECK (weight_kg > 0),
    description     text,
    photo_media_id  uuid REFERENCES media_assets(id),
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

-- Istniejące hulajnogi dostają model podstawowy; parametry uzupełnia operator w panelu.
INSERT INTO scooter_models (code, name) VALUES ('BASE', 'Model podstawowy');
ALTER TABLE scooters ADD COLUMN model_id uuid REFERENCES scooter_models(id);
UPDATE scooters SET model_id = (SELECT id FROM scooter_models WHERE code = 'BASE');
ALTER TABLE scooters ALTER COLUMN model_id SET NOT NULL;
CREATE INDEX scooters_model_idx ON scooters (model_id);

CREATE SEQUENCE service_task_number_seq START 1000;

-- Proces serwisowy: zgłoszenie → zadanie → naprawa lub wymiana baterii → powrót do floty.
CREATE TABLE service_tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number          bigint NOT NULL UNIQUE DEFAULT nextval('service_task_number_seq'),
    scooter_id      uuid NOT NULL REFERENCES scooters(id),
    ticket_id       uuid REFERENCES tickets(id),
    type            service_task_type NOT NULL,
    status          service_task_status NOT NULL DEFAULT 'OPEN',
    priority        task_priority NOT NULL DEFAULT 'NORMAL',
    description     text,
    result_note     text,
    assignee_id     uuid REFERENCES staff(id),
    created_by      uuid REFERENCES staff(id),
    due_at          timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    completed_at    timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CHECK (status <> 'IN_PROGRESS' OR assignee_id IS NOT NULL),
    CHECK ((status IN ('DONE', 'CANCELLED')) = (completed_at IS NOT NULL))
);
-- Najwyżej jedno otwarte zadanie danego rodzaju na hulajnogę.
CREATE UNIQUE INDEX service_tasks_one_open_per_type ON service_tasks (scooter_id, type)
    WHERE status IN ('OPEN', 'IN_PROGRESS');
CREATE INDEX service_tasks_status_idx ON service_tasks (status, priority, created_at);
CREATE INDEX service_tasks_assignee_idx ON service_tasks (assignee_id) WHERE status IN ('OPEN', 'IN_PROGRESS');
CREATE INDEX service_tasks_ticket_idx ON service_tasks (ticket_id) WHERE ticket_id IS NOT NULL;

CREATE TABLE spare_parts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku             text NOT NULL UNIQUE,
    name            text NOT NULL,
    unit_cost       bigint NOT NULL CHECK (unit_cost >= 0),
    stock_qty       integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    min_stock_qty   integer NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0),
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

-- Koszt jednostkowy zapisany z chwili użycia, jak wersja cennika w przejeździe.
CREATE TABLE service_task_parts (
    task_id         uuid NOT NULL REFERENCES service_tasks(id),
    part_id         uuid NOT NULL REFERENCES spare_parts(id),
    quantity        integer NOT NULL CHECK (quantity > 0),
    unit_cost       bigint NOT NULL CHECK (unit_cost >= 0),
    PRIMARY KEY (task_id, part_id)
);
CREATE INDEX service_task_parts_part_idx ON service_task_parts (part_id);

-- =====================================================================
-- Paragony
-- =====================================================================

CREATE SEQUENCE receipt_number_seq;

CREATE TABLE receipts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number          text NOT NULL UNIQUE DEFAULT
                        'PAR/' || to_char(now() AT TIME ZONE 'Europe/Warsaw', 'YYYY') || '/'
                        || lpad(nextval('receipt_number_seq')::text, 6, '0'),
    user_id         uuid NOT NULL REFERENCES users(id),
    payment_id      uuid UNIQUE REFERENCES payments(id),
    rental_id       uuid REFERENCES rentals(id),
    buyer_name      text,                           -- dane nabywcy z chwili wystawienia
    buyer_email     text,
    total_amount    bigint NOT NULL CHECK (total_amount >= 0),
    currency        char(3) NOT NULL DEFAULT 'PLN',
    issued_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(payment_id, rental_id) > 0)
);
CREATE INDEX receipts_user_idx ON receipts (user_id, issued_at DESC);
CREATE INDEX receipts_rental_idx ON receipts (rental_id) WHERE rental_id IS NOT NULL;

CREATE TABLE receipt_items (
    receipt_id      uuid NOT NULL REFERENCES receipts(id),
    line_no         smallint NOT NULL CHECK (line_no > 0),
    description     text NOT NULL,
    quantity        numeric(10, 3) NOT NULL CHECK (quantity > 0),   -- np. minuty jazdy
    unit_price      bigint NOT NULL,
    vat_rate        numeric(4, 2) NOT NULL CHECK (vat_rate >= 0),  -- w procentach
    amount          bigint NOT NULL,
    PRIMARY KEY (receipt_id, line_no)
);

-- =====================================================================
-- Widoki: modele odczytu dla list w panelu, raportów i wydruków (ADR 0026)
-- =====================================================================

-- Flota z bieżącym przejazdem, strefą parkowania i liczbą przejazdów z 30 dni (makieta „Flota”).
CREATE VIEW v_fleet_status AS
SELECT s.id, s.number, s.serial_number, s.variant, s.status, s.online, s.battery_pct, s.position,
       s.last_seen_at, s.firmware, s.odometer_m, s.model_id,
       m.code AS model_code, m.name AS model_name,
       r.id AS rental_id, r.number AS rental_number, r.state AS rental_state, r.user_id AS rental_user_id,
       pz.code AS parking_zone_code, pz.name AS parking_zone_name,
       (SELECT count(*) FROM tickets t
         WHERE t.scooter_id = s.id AND t.status <> 'RESOLVED') AS open_tickets,
       (SELECT count(*) FROM service_tasks st
         WHERE st.scooter_id = s.id AND st.status IN ('OPEN', 'IN_PROGRESS')) AS open_service_tasks,
       (SELECT count(*) FROM rentals r30
         WHERE r30.scooter_id = s.id AND r30.state = 'ENDED'
           AND r30.ended_at >= now() - interval '30 days') AS rentals_30d
FROM scooters s
JOIN scooter_models m ON m.id = s.model_id
LEFT JOIN rentals r ON r.scooter_id = s.id AND r.state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING')
LEFT JOIN LATERAL (
    SELECT z.code, z.name FROM zones z
    WHERE z.active AND z.type = 'PARKING' AND ST_Contains(z.geom, s.position)
    ORDER BY z.code LIMIT 1
) pz ON true;

CREATE VIEW v_rental_details AS
SELECT r.id, r.number, r.state, r.payment_source, r.reserved_at, r.reservation_expires_at,
       r.started_at, r.ended_at, r.ride_seconds, r.pause_seconds, r.distance_m, r.total_amount,
       r.user_id, u.phone AS user_phone, u.name AS user_name,
       r.scooter_id, s.number AS scooter_number,
       r.tariff_id, t.version AS tariff_version,
       r.end_zone_id, ez.code AS end_zone_code, ez.name AS end_zone_name,
       r.parking_photo_id IS NOT NULL AS has_parking_photo,
       p.status AS card_payment_status,
       l.amount AS wallet_charge,
       r.created_at, r.updated_at
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

-- Saldo z pamięci podręcznej w wallets porównane z sumą księgi; out_of_sync wskazuje rozjazd.
CREATE VIEW v_wallet_balances AS
SELECT w.user_id, u.phone, u.name, u.status AS user_status,
       w.balance AS cached_balance,
       COALESCE(l.ledger_balance, 0) AS ledger_balance,
       w.balance <> COALESCE(l.ledger_balance, 0) AS out_of_sync,
       COALESCE(l.entries, 0) AS entries,
       l.last_entry_at, w.updated_at
FROM wallets w
JOIN users u ON u.id = w.user_id
LEFT JOIN (
    SELECT user_id, sum(amount)::bigint AS ledger_balance, count(*) AS entries, max(created_at) AS last_entry_at
    FROM wallet_ledger GROUP BY user_id
) l ON l.user_id = w.user_id;

-- Przychody według dnia w strefie czasowej operatora.
CREATE VIEW v_daily_revenue AS
WITH rides AS (
    SELECT (ended_at AT TIME ZONE 'Europe/Warsaw')::date AS day, count(*) AS rides,
           sum(total_amount)::bigint AS ride_revenue, sum(ride_seconds)::bigint AS ride_seconds
    FROM rentals WHERE state = 'ENDED' AND ended_at IS NOT NULL GROUP BY 1
), topups AS (
    SELECT (created_at AT TIME ZONE 'Europe/Warsaw')::date AS day, sum(amount)::bigint AS topups
    FROM payments WHERE purpose = 'TOPUP' AND status = 'SUCCEEDED' GROUP BY 1
), refunds AS (
    SELECT (created_at AT TIME ZONE 'Europe/Warsaw')::date AS day, sum(amount)::bigint AS refunds
    FROM wallet_ledger WHERE type = 'REFUND' GROUP BY 1
)
SELECT day,
       COALESCE(rides.rides, 0) AS rides,
       COALESCE(rides.ride_revenue, 0) AS ride_revenue,
       COALESCE(rides.ride_seconds, 0) AS ride_seconds,
       COALESCE(topups.topups, 0) AS topups,
       COALESCE(refunds.refunds, 0) AS refunds
FROM rides
FULL JOIN topups USING (day)
FULL JOIN refunds USING (day);

-- Kolejka otwartych zgłoszeń z ostatnim zadaniem serwisowym.
CREATE VIEW v_ticket_queue AS
SELECT t.id, t.status, t.urgent, t.categories, t.source, t.description, t.created_at,
       now() - t.created_at AS age,
       t.scooter_id, s.number AS scooter_number, s.status AS scooter_status,
       t.rental_id, t.reported_by,
       t.assignee_id, a.name AS assignee_name,
       (SELECT count(*) FROM ticket_photos tp WHERE tp.ticket_id = t.id) AS photos,
       st.id AS service_task_id, st.number AS service_task_number, st.status AS service_task_status
FROM tickets t
JOIN scooters s ON s.id = t.scooter_id
LEFT JOIN staff a ON a.id = t.assignee_id
LEFT JOIN LATERAL (
    SELECT x.id, x.number, x.status FROM service_tasks x
    WHERE x.ticket_id = t.id ORDER BY x.created_at DESC LIMIT 1
) st ON true
WHERE t.status <> 'RESOLVED';

-- Uprawnienia aktywnych operatorów jako suma ich ról (ADR 0028).
CREATE VIEW v_staff_permissions AS
SELECT DISTINCT sr.staff_id, rp.permission_code
FROM staff_roles sr
JOIN staff s ON s.id = sr.staff_id AND s.active
JOIN role_permissions rp ON rp.role_id = sr.role_id;

-- Lista operatorów bez skrótu hasła i sekretu TOTP.
CREATE VIEW v_staff_overview AS
SELECT s.id, s.email, s.name, s.active, s.totp_secret_enc IS NOT NULL AS totp_enabled,
       COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}') AS roles,
       s.created_at, s.updated_at
FROM staff s
LEFT JOIN staff_roles sr ON sr.staff_id = s.id
LEFT JOIN roles r ON r.id = sr.role_id
GROUP BY s.id;

-- Przejazdy zakończone w strefie według dnia.
CREATE VIEW v_zone_usage AS
SELECT z.id AS zone_id, z.code, z.name, z.type,
       (r.ended_at AT TIME ZONE 'Europe/Warsaw')::date AS day,
       count(*) AS rides_ended,
       avg(r.ride_seconds)::integer AS avg_ride_seconds,
       COALESCE(sum(r.total_amount), 0)::bigint AS revenue
FROM rentals r
JOIN zones z ON z.id = r.end_zone_id
WHERE r.state = 'ENDED' AND r.ended_at IS NOT NULL
GROUP BY z.id, day;

-- Awaryjność hulajnóg: zgłoszenia, zadania serwisowe, czas naprawy i koszt części.
CREATE VIEW v_scooter_reliability AS
SELECT s.id AS scooter_id, s.number, s.model_id, m.name AS model_name, s.odometer_m,
       (SELECT count(*) FROM tickets t WHERE t.scooter_id = s.id) AS tickets_total,
       (SELECT count(*) FROM tickets t WHERE t.scooter_id = s.id AND t.status <> 'RESOLVED') AS tickets_open,
       (SELECT count(*) FROM service_tasks st WHERE st.scooter_id = s.id AND st.status = 'DONE') AS tasks_done,
       (SELECT max(st.completed_at) FROM service_tasks st
         WHERE st.scooter_id = s.id AND st.status = 'DONE') AS last_service_at,
       (SELECT avg(st.completed_at - st.created_at) FROM service_tasks st
         WHERE st.scooter_id = s.id AND st.status = 'DONE' AND st.type = 'REPAIR') AS avg_repair_time,
       (SELECT COALESCE(sum(p.quantity * p.unit_cost), 0)::bigint FROM service_task_parts p
         JOIN service_tasks st ON st.id = p.task_id WHERE st.scooter_id = s.id) AS parts_cost
FROM scooters s
JOIN scooter_models m ON m.id = s.model_id;

CREATE VIEW v_user_activity AS
SELECT u.id, u.phone, u.email, u.name, u.status, u.created_at,
       COALESCE(r.rides, 0) AS rides, r.last_ride_at,
       COALESCE(r.spent, 0) AS total_spent,
       COALESCE(w.balance, 0) AS wallet_balance,
       (SELECT count(*) FROM tickets t WHERE t.reported_by = u.id) AS tickets_reported
FROM users u
LEFT JOIN (
    SELECT user_id, count(*) AS rides, max(ended_at) AS last_ride_at, sum(total_amount)::bigint AS spent
    FROM rentals WHERE state = 'ENDED' GROUP BY user_id
) r ON r.user_id = u.id
LEFT JOIN wallets w ON w.user_id = u.id;

-- Obowiązujące wersje dokumentów (regulamin, prywatność, zasady jazdy).
CREATE VIEW v_current_documents AS
SELECT p.id AS page_id, p.slug, p.consent_type,
       v.id AS version_id, v.version_no, v.title, v.body_md, v.published_at
FROM content_pages p
JOIN content_page_versions v ON v.page_id = p.id AND v.status = 'PUBLISHED';

CREATE VIEW v_published_news AS
SELECT n.id, n.slug, n.title, n.lead, n.body_md, n.media_id, n.publish_from, n.publish_to
FROM news n
WHERE n.status = 'PUBLISHED' AND n.publish_from <= now()
  AND (n.publish_to IS NULL OR n.publish_to > now());

CREATE VIEW v_low_stock_parts AS
SELECT id, sku, name, stock_qty, min_stock_qty, min_stock_qty - stock_qty AS shortage
FROM spare_parts
WHERE active AND stock_qty <= min_stock_qty;

-- =====================================================================
-- Funkcje: obliczenia na danych bez efektów ubocznych (ADR 0026)
-- =====================================================================

-- Aktywne strefy w punkcie, od najbardziej restrykcyjnej; korzysta z indeksu GiST.
CREATE FUNCTION fn_zones_at_point(p_lon double precision, p_lat double precision)
RETURNS TABLE (id uuid, code text, name text, type zone_type, speed_limit_kmh smallint)
LANGUAGE sql STABLE AS $$
    SELECT z.id, z.code, z.name, z.type, z.speed_limit_kmh
    FROM zones z
    WHERE z.active AND ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326))
    ORDER BY CASE z.type WHEN 'NO_RIDE' THEN 0 WHEN 'SLOW' THEN 1 WHEN 'PARKING' THEN 2 ELSE 3 END, z.code
$$;

-- Dostępne hulajnogi w promieniu; próg baterii przekazuje core (wartość z cennika).
CREATE FUNCTION fn_nearest_scooters(p_lon double precision, p_lat double precision,
                                    p_radius_m double precision, p_limit integer, p_min_battery integer)
RETURNS TABLE (id uuid, number integer, battery_pct smallint, distance_m double precision)
LANGUAGE sql STABLE AS $$
    SELECT s.id, s.number, s.battery_pct,
           ST_Distance(s.position::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography) AS distance_m
    FROM scooters s
    WHERE s.status = 'AVAILABLE' AND s.position IS NOT NULL
      AND COALESCE(s.battery_pct, 0) >= p_min_battery
      AND ST_DWithin(s.position::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_radius_m)
    ORDER BY distance_m, s.number
    LIMIT p_limit
$$;

-- Saldo jako suma księgi (źródło prawdy; wallets.balance to pamięć podręczna).
CREATE FUNCTION fn_wallet_balance(p_user_id uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(sum(amount), 0)::bigint FROM wallet_ledger WHERE user_id = p_user_id
$$;

CREATE FUNCTION fn_staff_has_permission(p_staff_id uuid, p_code text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM v_staff_permissions WHERE staff_id = p_staff_id AND permission_code = p_code)
$$;

-- Długość trasy przejazdu z punktów telemetrii, w metrach.
CREATE FUNCTION fn_rental_distance_m(p_rental_id uuid) RETURNS integer
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(round(ST_Length(ST_MakeLine(position ORDER BY recorded_at)::geography))::integer, 0)
    FROM telemetry WHERE rental_id = p_rental_id
$$;

CREATE FUNCTION fn_content_revision() RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM content_revision_seq
$$;

-- =====================================================================
-- Procedury: operacje na wielu wierszach w jednej transakcji (ADR 0026)
-- =====================================================================

-- Przejście RESERVED → EXPIRED z maszyny stanów przejazdu (ADR 0013); uruchamiane przez pg-boss.
-- Warunek state = 'RESERVED' jest sprawdzany ponownie po zablokowaniu wiersza, więc równoległe
-- odblokowanie wygrywa z wygaszeniem.
CREATE PROCEDURE sp_expire_reservations(OUT expired_count integer)
LANGUAGE plpgsql AS $$
BEGIN
    WITH expired AS (
        UPDATE rentals SET state = 'EXPIRED', updated_at = now()
        WHERE state = 'RESERVED' AND reservation_expires_at <= now()
        RETURNING id, scooter_id
    ), events AS (
        INSERT INTO rental_events (rental_id, type, from_state, to_state, data)
        SELECT id, 'STATE_CHANGED', 'RESERVED', 'EXPIRED', '{"reason": "reservation_timeout"}'::jsonb FROM expired
    ), freed AS (
        UPDATE scooters s SET status = 'AVAILABLE', updated_at = now(), version = s.version + 1
        FROM expired e WHERE s.id = e.scooter_id AND s.status = 'RESERVED'
    )
    SELECT count(*) INTO expired_count FROM expired;
END
$$;

-- Usunięcie konta (arc42 §8.10): dane osobowe znikają, przejazdy, płatności i księga zostają.
CREATE PROCEDURE sp_anonymize_user(p_user_id uuid)
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

-- Dzienne partycje telemetrii (doby w UTC). Wiersze z partycji domyślnej trafiają do nowej partycji,
-- więc procedurę można uruchomić także dla dni, które już mają dane.
CREATE PROCEDURE sp_ensure_telemetry_partitions(p_from date, p_days integer, OUT created_count integer)
LANGUAGE plpgsql AS $$
DECLARE
    d           date;
    part        text;
    lower_bound timestamptz;
    upper_bound timestamptz;
BEGIN
    created_count := 0;
    FOR i IN 0 .. p_days - 1 LOOP
        d := p_from + i;
        part := 'telemetry_' || to_char(d, 'YYYYMMDD');
        CONTINUE WHEN to_regclass(part) IS NOT NULL;
        lower_bound := d::timestamp AT TIME ZONE 'UTC';
        upper_bound := (d + 1)::timestamp AT TIME ZONE 'UTC';
        EXECUTE format('CREATE TABLE %I (LIKE telemetry INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', part);
        EXECUTE format(
            'WITH moved AS (DELETE FROM telemetry_default WHERE recorded_at >= %L AND recorded_at < %L RETURNING *)
             INSERT INTO %I SELECT * FROM moved', lower_bound, upper_bound, part);
        EXECUTE format('ALTER TABLE telemetry ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',
                       part, lower_bound, upper_bound);
        created_count := created_count + 1;
    END LOOP;
END
$$;

-- Retencja telemetrii: usuwa partycje dzienne starsze niż p_keep_days i stare wiersze z partycji domyślnej.
CREATE PROCEDURE sp_purge_telemetry(p_keep_days integer, OUT dropped_count integer)
LANGUAGE plpgsql AS $$
DECLARE
    cutoff date := (now() AT TIME ZONE 'UTC')::date - p_keep_days;
    part   text;
BEGIN
    dropped_count := 0;
    FOR part IN
        SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'telemetry'::regclass AND c.relname ~ '^telemetry_[0-9]{8}$'
          AND to_date(substr(c.relname, 11), 'YYYYMMDD') < cutoff
    LOOP
        EXECUTE format('DROP TABLE %I', part);
        dropped_count := dropped_count + 1;
    END LOOP;
    DELETE FROM telemetry_default WHERE recorded_at < cutoff::timestamp AT TIME ZONE 'UTC';
END
$$;

CREATE PROCEDURE sp_purge_expired_otp(OUT deleted_count integer)
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
END
$$;

-- Naprawa pamięci podręcznej salda na podstawie księgi (rozjazdy widać w v_wallet_balances).
CREATE PROCEDURE sp_rebuild_wallet_balances(OUT fixed_count integer)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE wallets w SET balance = fn_wallet_balance(w.user_id), updated_at = now()
    WHERE w.balance <> fn_wallet_balance(w.user_id);
    GET DIAGNOSTICS fixed_count = ROW_COUNT;
END
$$;
