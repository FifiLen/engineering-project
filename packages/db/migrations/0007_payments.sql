-- 0007: płatności (iteracja 5): rozliczenie przejazdu z portfela albo kartą, zapis do księgi z blokadą
-- portfela, klienci u operatora płatności, zwroty i korekty, paragony z korektą, wersje cennika z VAT,
-- widoki list w panelu (ADR 0049, 0050, 0052, 0053, 0054). Reguły liczy packages/core, a baza pilnuje
-- tych, których nie może obejść równoległa transakcja.

-- Zwrot salda na kartę przed usunięciem konta (ADR 0054). Nowej wartości nie używamy w tej migracji
-- (Postgres nie pozwala na to przed zatwierdzeniem), więc widoki porównują typ jako tekst.
ALTER TYPE ledger_entry_type ADD VALUE 'PAYOUT';

CREATE TYPE refund_reason  AS ENUM ('SCOOTER_FAILURE', 'BILLING_ERROR', 'CUSTOMER_COMPLAINT', 'OTHER', 'BALANCE_PAYOUT');
CREATE TYPE refund_status  AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE ledger_reason  AS ENUM ('COMPLAINT', 'SYSTEM_ERROR', 'GOODWILL', 'OTHER');
CREATE TYPE receipt_kind   AS ENUM ('SALE', 'CORRECTION');

-- =====================================================================
-- Cennik: stawka VAT w wersji, wersje nieedytowalne (ADR 0052, ADR 0053)
-- =====================================================================

ALTER TABLE tariffs ADD COLUMN vat_rate numeric(4, 2) NOT NULL DEFAULT 23.00 CHECK (vat_rate BETWEEN 0 AND 99.99);
ALTER TABLE tariffs ADD CONSTRAINT tariffs_free_reservation_range CHECK (free_reservation_minutes BETWEEN 0 AND 60),
                    ADD CONSTRAINT tariffs_min_user_age_range CHECK (min_user_age BETWEEN 13 AND 99),
                    ADD CONSTRAINT tariffs_min_wallet_balance_check CHECK (min_wallet_balance >= 0);

-- Wersji nie zmienia się (nowa wersja zamiast edycji). Zaplanowana może być najwyżej jedna i dopóki jest,
-- nie powstaje żadna nowa wersja, więc kolejność numerów zgadza się z kolejnością dat obowiązywania.
-- Nową wersję zapisuje się z blokadą tabeli (`LOCK TABLE tariffs`), więc sprawdzenie nie ma wyścigu.
CREATE FUNCTION trg_tariff_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'TARIFF_IMMUTABLE' USING ERRCODE = 'raise_exception';
    END IF;
    IF EXISTS (SELECT 1 FROM tariffs WHERE valid_from > now()) THEN
        RAISE EXCEPTION 'TARIFF_ALREADY_SCHEDULED' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER tariffs_rules BEFORE INSERT OR UPDATE ON tariffs FOR EACH ROW EXECUTE FUNCTION trg_tariff_rules();

-- Usunięcie zaplanowanej wersji: tylko przed datą obowiązywania i tylko gdy żaden przejazd jej nie wskazuje.
CREATE PROCEDURE sp_delete_scheduled_tariff(p_tariff_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    from_at timestamptz;
BEGIN
    SELECT valid_from INTO from_at FROM tariffs WHERE id = p_tariff_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TARIFF_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    IF from_at <= now() THEN
        RAISE EXCEPTION 'TARIFF_NOT_SCHEDULED' USING ERRCODE = 'raise_exception';
    END IF;
    IF EXISTS (SELECT 1 FROM rentals WHERE tariff_id = p_tariff_id) THEN
        RAISE EXCEPTION 'TARIFF_IN_USE' USING ERRCODE = 'raise_exception';
    END IF;
    DELETE FROM tariffs WHERE id = p_tariff_id;
END
$$;

-- =====================================================================
-- Klient u operatora płatności i karta przejazdu (ADR 0049, ADR 0050)
-- =====================================================================

CREATE TABLE payment_customers (
    user_id                 uuid NOT NULL REFERENCES users(id),
    provider                text NOT NULL CHECK (provider IN ('fake', 'stripe')),
    provider_customer_id    text NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider),
    UNIQUE (provider, provider_customer_id)
);

-- Zapisane są tylko karty; BLIK jest metodą jednorazową (kod przy każdej płatności, ADR 0050).
ALTER TABLE payment_methods ADD COLUMN provider text NOT NULL DEFAULT 'fake' CHECK (provider IN ('fake', 'stripe'));

-- Karta wybrana przy pierwszym stanie przejazdu; obciążana po zakończeniu (`payment_source = CARD`).
ALTER TABLE rentals ADD COLUMN payment_method_id uuid REFERENCES payment_methods(id),
                    ADD CONSTRAINT rentals_card_source_method CHECK (payment_source <> 'CARD' OR payment_method_id IS NOT NULL);

ALTER TABLE payments ADD COLUMN provider text NOT NULL DEFAULT 'fake' CHECK (provider IN ('fake', 'stripe')),
                     ADD COLUMN failure_code text;
-- Jedna płatność za przejazd w toku: zadanie obciążenia, ponowienie i spłata nie obciążą karty dwa razy.
CREATE UNIQUE INDEX payments_one_pending_per_rental ON payments (rental_id)
    WHERE purpose = 'RIDE' AND status = 'PENDING';
-- Sprawdzenie statusu bez webhooka (`payments.reconcile`).
CREATE INDEX payments_pending_idx ON payments (created_at) WHERE status = 'PENDING';
CREATE INDEX payments_rental_idx ON payments (rental_id) WHERE rental_id IS NOT NULL;

-- Webhooki: zdarzenie przypisane do płatności, wynik przetworzenia i liczba dostarczeń (ADR 0050).
ALTER TABLE payment_webhook_events ADD COLUMN provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('fake', 'stripe')),
                                   ADD COLUMN object_id text,
                                   ADD COLUMN payment_id uuid REFERENCES payments(id),
                                   ADD COLUMN deliveries integer NOT NULL DEFAULT 1 CHECK (deliveries > 0),
                                   ADD COLUMN last_received_at timestamptz NOT NULL DEFAULT now(),
                                   ADD COLUMN result text CHECK (result IN ('APPLIED', 'NO_CHANGE', 'IGNORED', 'FAILED')),
                                   ADD COLUMN error text;
CREATE INDEX payment_webhook_events_payment_idx ON payment_webhook_events (payment_id) WHERE payment_id IS NOT NULL;

-- =====================================================================
-- Zwroty (ADR 0054)
-- =====================================================================

-- Zwrot za przejazd (z portfela albo na kartę) i zwrot salda na kartę z doładowania (`BALANCE_PAYOUT`).
CREATE TABLE refunds (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id),
    rental_id           uuid REFERENCES rentals(id),
    payment_id          uuid REFERENCES payments(id),
    source              payment_source NOT NULL,
    amount              bigint NOT NULL CHECK (amount > 0),
    reason              refund_reason NOT NULL,
    note                text,
    staff_id            uuid REFERENCES staff(id),
    status              refund_status NOT NULL DEFAULT 'PENDING',
    provider_refund_id  text UNIQUE,
    failure_reason      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(rental_id, payment_id) > 0),
    CHECK (source = 'WALLET' OR payment_id IS NOT NULL),
    CHECK (reason <> 'OTHER' OR note IS NOT NULL),
    CHECK ((reason = 'BALANCE_PAYOUT') = (rental_id IS NULL))
);
CREATE INDEX refunds_rental_idx ON refunds (rental_id) WHERE rental_id IS NOT NULL;
CREATE INDEX refunds_payment_idx ON refunds (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX refunds_pending_idx ON refunds (created_at) WHERE status = 'PENDING';

-- =====================================================================
-- Księga: powód korekty, zapis z blokadą portfela, tylko dopisywanie (ADR 0014, ADR 0049, ADR 0054)
-- =====================================================================

ALTER TABLE wallet_ledger ADD COLUMN reason ledger_reason,
                          ADD COLUMN refund_id uuid REFERENCES refunds(id);
-- Jeden wpis zwrotu salda (i jedno odwrócenie) na zwrot u operatora.
CREATE UNIQUE INDEX wallet_ledger_one_entry_per_refund ON wallet_ledger (refund_id, (amount > 0)) WHERE refund_id IS NOT NULL;
-- Jedno uznanie portfela za doładowanie (powtórzony webhook nie dopisze drugiego).
CREATE UNIQUE INDEX wallet_ledger_one_topup_per_payment ON wallet_ledger (payment_id) WHERE type = 'TOPUP';

-- Saldo po operacji to poprzednie saldo z księgi plus kwota; wpisu nie zmienia się ani nie usuwa.
-- Blokada wiersza portfela szereguje równoległe wpisy jednego klienta.
CREATE FUNCTION trg_wallet_ledger_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    previous bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'LEDGER_APPEND_ONLY' USING ERRCODE = 'raise_exception';
    END IF;
    PERFORM 1 FROM wallets WHERE user_id = NEW.user_id FOR UPDATE;
    SELECT l.balance_after INTO previous FROM wallet_ledger l WHERE l.user_id = NEW.user_id ORDER BY l.id DESC LIMIT 1;
    IF NEW.balance_after <> COALESCE(previous, 0) + NEW.amount THEN
        RAISE EXCEPTION 'LEDGER_BALANCE_MISMATCH' USING ERRCODE = 'raise_exception',
            DETAIL = format('previous %s, amount %s, balance_after %s', COALESCE(previous, 0), NEW.amount, NEW.balance_after);
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER wallet_ledger_rules BEFORE INSERT OR UPDATE OR DELETE ON wallet_ledger
    FOR EACH ROW EXECUTE FUNCTION trg_wallet_ledger_rules();

-- Każdy ruch środków przechodzi przez tę procedurę: doładowanie, obciążenie, zwrot, korekta, zwrot salda.
-- Saldo po operacji liczy się z księgi pod blokadą portfela, a pamięć podręczna w `wallets` zmienia się razem z nim.
CREATE PROCEDURE sp_wallet_post(
    p_user_id uuid, p_type ledger_entry_type, p_amount bigint, p_rental_id uuid, p_payment_id uuid,
    p_refund_id uuid, p_staff_id uuid, p_reason ledger_reason, p_note text,
    OUT entry_id bigint, OUT balance_after bigint)
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM wallets WHERE user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    balance_after := fn_wallet_balance(p_user_id) + p_amount;
    INSERT INTO wallet_ledger (user_id, type, amount, balance_after, rental_id, payment_id, refund_id, staff_id, reason, note)
    VALUES (p_user_id, p_type, p_amount, balance_after, p_rental_id, p_payment_id, p_refund_id, p_staff_id, p_reason, p_note)
    RETURNING id INTO entry_id;
    UPDATE wallets SET balance = balance_after, updated_at = now() WHERE user_id = p_user_id;
END
$$;

-- =====================================================================
-- Rozliczenie przejazdu: zapłacona kwota i stan rozliczenia (ADR 0049)
-- =====================================================================

-- Kwota zapłacona za przejazd: obciążenie portfela albo udana płatność kartą (bez odjęcia zwrotów).
CREATE FUNCTION fn_rental_paid_amount(p_rental_id uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT -l.amount FROM wallet_ledger l WHERE l.rental_id = p_rental_id AND l.type = 'RIDE_CHARGE'),
        (SELECT p.amount FROM payments p
         WHERE p.rental_id = p_rental_id AND p.purpose = 'RIDE' AND p.status IN ('SUCCEEDED', 'REFUNDED')
         ORDER BY p.created_at DESC LIMIT 1),
        0)::bigint
$$;

-- NONE: bez kwoty albo nierozliczony z iteracji 3 i 4; WALLET_PAID; CARD_PAID; CARD_PENDING; FAILED (UNPAID).
CREATE FUNCTION fn_rental_settlement(p_rental_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM wallet_ledger l WHERE l.rental_id = p_rental_id AND l.type = 'RIDE_CHARGE') THEN 'WALLET_PAID'
        WHEN EXISTS (SELECT 1 FROM payments p WHERE p.rental_id = p_rental_id AND p.purpose = 'RIDE'
                     AND p.status IN ('SUCCEEDED', 'REFUNDED')) THEN 'CARD_PAID'
        ELSE COALESCE((SELECT CASE p.status WHEN 'PENDING' THEN 'CARD_PENDING' ELSE 'FAILED' END
                       FROM payments p WHERE p.rental_id = p_rental_id AND p.purpose = 'RIDE'
                       ORDER BY p.created_at DESC LIMIT 1), 'NONE')
    END
$$;

-- Zwrot: suma zwrotów (bez nieudanych) nie większa niż zapłacona kwota przejazdu albo doładowania.
-- Blokada przejazdu albo płatności szereguje równoległe polecenia zwrotu.
CREATE PROCEDURE sp_record_refund(
    p_user_id uuid, p_rental_id uuid, p_payment_id uuid, p_source payment_source, p_amount bigint,
    p_reason refund_reason, p_note text, p_staff_id uuid, p_status refund_status, OUT refund_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    paid     bigint;
    refunded bigint;
BEGIN
    IF p_rental_id IS NOT NULL THEN
        PERFORM 1 FROM rentals WHERE id = p_rental_id AND user_id = p_user_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'RENTAL_NOT_FOUND' USING ERRCODE = 'no_data_found';
        END IF;
        paid := fn_rental_paid_amount(p_rental_id);
        SELECT COALESCE(sum(amount), 0) INTO refunded FROM refunds WHERE rental_id = p_rental_id AND status <> 'FAILED';
    ELSE
        SELECT amount INTO paid FROM payments
        WHERE id = p_payment_id AND user_id = p_user_id AND purpose = 'TOPUP' AND status IN ('SUCCEEDED', 'REFUNDED')
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PAYMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
        END IF;
        SELECT COALESCE(sum(amount), 0) INTO refunded FROM refunds WHERE payment_id = p_payment_id AND status <> 'FAILED';
    END IF;
    IF refunded + p_amount > paid THEN
        RAISE EXCEPTION 'REFUND_EXCEEDS_PAYMENT' USING ERRCODE = 'raise_exception',
            DETAIL = format('%s', paid - refunded);
    END IF;
    INSERT INTO refunds (user_id, rental_id, payment_id, source, amount, reason, note, staff_id, status)
    VALUES (p_user_id, p_rental_id, p_payment_id, p_source, p_amount, p_reason, p_note, p_staff_id, p_status)
    RETURNING id INTO refund_id;
END
$$;

-- =====================================================================
-- Paragony: rodzaj, korekta, sposób zapłaty, sprzedawca (ADR 0052)
-- =====================================================================

ALTER TABLE receipts DROP CONSTRAINT receipts_total_amount_check;
ALTER TABLE receipts ADD COLUMN kind receipt_kind NOT NULL DEFAULT 'SALE',
                     ADD COLUMN corrects_receipt_id uuid REFERENCES receipts(id),
                     ADD COLUMN refund_id uuid UNIQUE REFERENCES refunds(id),
                     ADD COLUMN payment_source payment_source,
                     ADD COLUMN seller jsonb,
                     ADD COLUMN buyer_phone text,
                     ADD CONSTRAINT receipts_kind_total CHECK (
                         (kind = 'SALE' AND total_amount >= 0 AND corrects_receipt_id IS NULL)
                         OR (kind = 'CORRECTION' AND total_amount < 0 AND corrects_receipt_id IS NOT NULL));
-- Jeden paragon sprzedaży za przejazd (portfel w transakcji ENDED, karta po webhooku, spłata zaległości).
CREATE UNIQUE INDEX receipts_one_sale_per_rental ON receipts (rental_id) WHERE kind = 'SALE' AND rental_id IS NOT NULL;

-- Wystawienie dokumentu z pozycjami (jsonb: [{description, quantity, unitPrice, vatRate, amount}]).
-- Nabywca z chwili wystawienia; suma równa sumie pozycji; korekty nie przekraczają kwoty dokumentu.
CREATE PROCEDURE sp_issue_receipt(
    p_user_id uuid, p_kind receipt_kind, p_rental_id uuid, p_payment_id uuid, p_refund_id uuid,
    p_corrects_receipt_id uuid, p_payment_source payment_source, p_seller jsonb, p_items jsonb,
    OUT receipt_id uuid, OUT receipt_number text)
LANGUAGE plpgsql AS $$
DECLARE
    total     bigint;
    remaining bigint;
BEGIN
    SELECT COALESCE(sum((i->>'amount')::bigint), 0) INTO total FROM jsonb_array_elements(p_items) i;
    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'RECEIPT_EMPTY' USING ERRCODE = 'raise_exception';
    END IF;
    IF p_kind = 'CORRECTION' THEN
        SELECT r.total_amount + COALESCE((SELECT sum(c.total_amount) FROM receipts c WHERE c.corrects_receipt_id = r.id), 0)
        INTO remaining FROM receipts r WHERE r.id = p_corrects_receipt_id AND r.kind = 'SALE' FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'no_data_found';
        END IF;
        IF remaining + total < 0 THEN
            RAISE EXCEPTION 'RECEIPT_CORRECTION_EXCEEDS' USING ERRCODE = 'raise_exception';
        END IF;
    END IF;
    INSERT INTO receipts (user_id, kind, rental_id, payment_id, refund_id, corrects_receipt_id, payment_source, seller,
                          buyer_name, buyer_email, buyer_phone, total_amount)
    SELECT p_user_id, p_kind, p_rental_id, p_payment_id, p_refund_id, p_corrects_receipt_id, p_payment_source, p_seller,
           u.name, u.email, u.phone, total
    FROM users u WHERE u.id = p_user_id
    RETURNING id, number INTO receipt_id, receipt_number;
    INSERT INTO receipt_items (receipt_id, line_no, description, quantity, unit_price, vat_rate, amount)
    SELECT receipt_id, i.ordinality, i.value->>'description', (i.value->>'quantity')::numeric,
           (i.value->>'unitPrice')::bigint, (i.value->>'vatRate')::numeric, (i.value->>'amount')::bigint
    FROM jsonb_array_elements(p_items) WITH ORDINALITY i;
END
$$;

-- VAT dokumentu metodą „w stu” od sumy brutto, zaokrąglenie do grosza połowa w górę (ADR 0052; tę samą
-- regułę ma packages/core, widok paragonów pokazuje wynik bazy).
CREATE FUNCTION fn_vat_from_gross(p_gross bigint, p_rate numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
    SELECT (sign(p_gross) * round(abs(p_gross) * p_rate / (100 + p_rate)))::bigint
$$;

-- =====================================================================
-- Widoki: przejazd z rozliczeniem, listy płatności w panelu, historia portfela (ADR 0031)
-- =====================================================================

-- Kolumny rozliczenia dopisane na końcu; reszta jak w 0006.
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
       p.id AS card_payment_id
FROM rentals r
JOIN users u ON u.id = r.user_id
JOIN scooters s ON s.id = r.scooter_id
JOIN tariffs t ON t.id = r.tariff_id
LEFT JOIN zones ez ON ez.id = r.end_zone_id
LEFT JOIN receipts rc ON rc.rental_id = r.id AND rc.kind = 'SALE'
LEFT JOIN LATERAL (
    SELECT pay.id, pay.status, pay.failure_reason, pay.payment_method_id FROM payments pay
    WHERE pay.rental_id = r.id AND pay.purpose = 'RIDE'
    ORDER BY pay.created_at DESC LIMIT 1
) p ON true
-- Karta ostatniej płatności za przejazd (spłata może być inną kartą), a bez płatności karta wybrana przy starcie.
LEFT JOIN payment_methods pm ON pm.id = COALESCE(p.payment_method_id, r.payment_method_id)
LEFT JOIN wallet_ledger l ON l.rental_id = r.id AND l.type = 'RIDE_CHARGE';

-- Płatności u operatora (doładowania i przejazdy kartą) z klientem, kartą, przejazdem, zwrotami i paragonem.
CREATE VIEW v_payment_list AS
SELECT p.id, p.created_at, p.updated_at, p.status, p.purpose, p.method, p.amount, p.currency, p.provider,
       p.provider_payment_id, p.idempotency_key, p.failure_reason, p.failure_code,
       p.user_id, u.name AS user_name, u.phone AS user_phone,
       p.rental_id, r.number AS rental_number,
       p.payment_method_id, pm.brand AS card_brand, pm.last4 AS card_last4,
       (SELECT COALESCE(sum(f.amount), 0)::bigint FROM refunds f WHERE f.payment_id = p.id AND f.status = 'SUCCEEDED') AS refunded_amount,
       rc.id AS receipt_id, rc.number AS receipt_number,
       (SELECT count(*)::integer FROM payment_webhook_events e WHERE e.payment_id = p.id) AS webhook_events
FROM payments p
JOIN users u ON u.id = p.user_id
LEFT JOIN rentals r ON r.id = p.rental_id
LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
LEFT JOIN receipts rc ON rc.payment_id = p.id AND rc.kind = 'SALE';

-- Księga portfela w panelu i historia portfela w aplikacji: wpis z przejazdem, płatnością, operatorem i paragonem.
CREATE VIEW v_wallet_ledger AS
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
LEFT JOIN receipts rc ON rc.rental_id = l.rental_id AND rc.kind = 'SALE' AND l.type::text = 'RIDE_CHARGE'
LEFT JOIN receipts rcf ON rcf.refund_id = l.refund_id;

-- Paragony i korekty z sumą VAT i netto, przejazdem i dokumentem korygowanym.
CREATE VIEW v_receipt_list AS
SELECT rc.id, rc.number, rc.kind, rc.issued_at, rc.user_id, rc.buyer_name, rc.buyer_phone,
       rc.rental_id, r.number AS rental_number, rc.payment_id, rc.refund_id, rc.payment_source,
       pm.brand AS card_brand, pm.last4 AS card_last4,
       rc.total_amount, rc.currency,
       COALESCE(v.vat_amount, 0)::bigint AS vat_amount,
       (rc.total_amount - COALESCE(v.vat_amount, 0))::bigint AS net_amount,
       v.vat_rate,
       rc.corrects_receipt_id, o.number AS corrects_number,
       (SELECT count(*)::integer FROM receipts c WHERE c.corrects_receipt_id = rc.id) AS corrections
FROM receipts rc
LEFT JOIN rentals r ON r.id = rc.rental_id
LEFT JOIN payments p ON p.id = rc.payment_id
-- Karta tylko na dokumencie opłaconym kartą (spłata zaległości z portfela nie pokazuje odrzuconej karty).
LEFT JOIN payment_methods pm ON rc.payment_source = 'CARD' AND pm.id = COALESCE(p.payment_method_id, r.payment_method_id)
LEFT JOIN receipts o ON o.id = rc.corrects_receipt_id
LEFT JOIN LATERAL (
    SELECT max(i.vat_rate) AS vat_rate, fn_vat_from_gross(sum(i.amount)::bigint, max(i.vat_rate)) AS vat_amount
    FROM receipt_items i WHERE i.receipt_id = rc.id
) v ON true;

-- Wersje cennika ze stanem z `valid_from`, końcem obowiązywania, autorem i liczbą przejazdów (ADR 0053).
CREATE VIEW v_tariff_versions AS
SELECT t.id, t.version, t.unlock_fee, t.minute_rate, t.pause_minute_rate, t.out_of_zone_fee,
       t.free_reservation_minutes, t.min_wallet_balance, t.min_battery_pct, t.min_user_age, t.vat_rate,
       t.valid_from,
       (SELECT min(n.valid_from) FROM tariffs n WHERE n.version > t.version) AS valid_to,
       CASE WHEN t.valid_from > now() THEN 'SCHEDULED'
            WHEN t.version = (SELECT max(c.version) FROM tariffs c WHERE c.valid_from <= now()) THEN 'CURRENT'
            ELSE 'ARCHIVED' END AS state,
       t.created_by, s.name AS created_by_name, t.created_at,
       (SELECT count(*)::integer FROM rentals r WHERE r.tariff_id = t.id) AS rentals_count
FROM tariffs t
LEFT JOIN staff s ON s.id = t.created_by;

-- Metody płatności klientów (panel, tylko do odczytu) ze stanem ważności.
CREATE VIEW v_payment_methods AS
SELECT pm.id, pm.user_id, u.name AS user_name, u.phone AS user_phone, pm.provider, pm.brand, pm.last4,
       pm.exp_month, pm.exp_year, pm.is_default, pm.created_at, pm.removed_at,
       CASE WHEN pm.removed_at IS NOT NULL THEN 'REMOVED'
            WHEN make_date(pm.exp_year, pm.exp_month, 1) + interval '1 month' <= (now() AT TIME ZONE 'Europe/Warsaw')::date THEN 'EXPIRED'
            WHEN make_date(pm.exp_year, pm.exp_month, 1) <= ((now() AT TIME ZONE 'Europe/Warsaw')::date + interval '1 month') THEN 'EXPIRING'
            ELSE 'ACTIVE' END AS state
FROM payment_methods pm
JOIN users u ON u.id = pm.user_id;

-- Webhooki operatora z płatnością, której dotyczą.
CREATE VIEW v_payment_webhook_events AS
SELECT e.id, e.provider, e.provider_event_id, e.type, e.object_id, e.received_at, e.last_received_at,
       e.processed_at, e.deliveries, e.result, e.error,
       e.payment_id, p.purpose AS payment_purpose, p.amount AS payment_amount, p.user_id, u.name AS user_name
FROM payment_webhook_events e
LEFT JOIN payments p ON p.id = e.payment_id
LEFT JOIN users u ON u.id = p.user_id;

-- Zwroty za przejazdy i zwroty salda z operatorem i stanem u operatora płatności.
CREATE VIEW v_refund_list AS
SELECT f.id, f.created_at, f.updated_at, f.status, f.source, f.amount, f.reason, f.note,
       f.user_id, u.name AS user_name, u.phone AS user_phone,
       f.rental_id, r.number AS rental_number, f.payment_id, p.purpose AS payment_purpose,
       f.provider_refund_id, f.failure_reason, f.staff_id, s.name AS staff_name,
       rc.id AS receipt_id, rc.number AS receipt_number
FROM refunds f
JOIN users u ON u.id = f.user_id
LEFT JOIN rentals r ON r.id = f.rental_id
LEFT JOIN payments p ON p.id = f.payment_id
LEFT JOIN staff s ON s.id = f.staff_id
LEFT JOIN receipts rc ON rc.refund_id = f.id;

-- Zaległości klientów: przejazdy UNPAID z kwotą, ostatnią odmową i kartą (mapa w aplikacji, karta klienta).
CREATE VIEW v_unpaid_rentals AS
SELECT r.id AS rental_id, r.number, r.user_id, r.ended_at, r.total_amount, r.payment_method_id,
       pm.brand AS card_brand, pm.last4 AS card_last4,
       p.failure_reason, p.failure_code, p.updated_at AS failed_at,
       (SELECT count(*)::integer FROM payments a WHERE a.rental_id = r.id AND a.purpose = 'RIDE' AND a.status = 'FAILED') AS failed_attempts,
       EXISTS (SELECT 1 FROM payments a WHERE a.rental_id = r.id AND a.purpose = 'RIDE' AND a.status = 'PENDING') AS payment_pending
FROM rentals r
LEFT JOIN payment_methods pm ON pm.id = r.payment_method_id
LEFT JOIN LATERAL (
    SELECT pay.failure_reason, pay.failure_code, pay.updated_at FROM payments pay
    WHERE pay.rental_id = r.id AND pay.purpose = 'RIDE' AND pay.status = 'FAILED'
    ORDER BY pay.created_at DESC LIMIT 1
) p ON true
WHERE r.state = 'UNPAID';

-- Przejazdy klienta w panelu i statystyki: `UNPAID` to przejazd, który się odbył (ADR 0049).
CREATE OR REPLACE VIEW v_user_activity AS
SELECT u.id, u.phone, u.email, u.name, u.status, u.created_at,
       COALESCE(r.rides, 0) AS rides, r.last_ride_at,
       COALESCE(r.spent, 0) AS total_spent,
       COALESCE(w.balance, 0) AS wallet_balance,
       (SELECT count(*) FROM tickets t WHERE t.reported_by = u.id) AS tickets_reported,
       u.blocked_at,
       u.blocked_reason,
       u.updated_at,
       u.version,
       (SELECT count(*) FROM sessions s
         WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions,
       (SELECT max(s.last_used_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
       COALESCE(r.unpaid, 0) AS unpaid_rentals
FROM users u
LEFT JOIN (
    SELECT user_id, count(*) AS rides, max(ended_at) AS last_ride_at, sum(total_amount)::bigint AS spent,
           count(*) FILTER (WHERE state = 'UNPAID') AS unpaid
    FROM rentals WHERE state IN ('ENDED', 'UNPAID') GROUP BY user_id
) r ON r.user_id = u.id
LEFT JOIN wallets w ON w.user_id = u.id;

-- Przychody: przejazdy, które się odbyły (także nieopłacone), doładowania i zwroty za przejazdy z obu źródeł.
CREATE OR REPLACE VIEW v_daily_revenue AS
WITH rides AS (
    SELECT (ended_at AT TIME ZONE 'Europe/Warsaw')::date AS day, count(*) AS rides,
           sum(total_amount)::bigint AS ride_revenue, sum(ride_seconds)::bigint AS ride_seconds
    FROM rentals WHERE state IN ('ENDED', 'UNPAID') AND ended_at IS NOT NULL GROUP BY 1
), topups AS (
    SELECT (created_at AT TIME ZONE 'Europe/Warsaw')::date AS day, sum(amount)::bigint AS topups
    FROM payments WHERE purpose = 'TOPUP' AND status IN ('SUCCEEDED', 'REFUNDED') GROUP BY 1
), refunds AS (
    SELECT (created_at AT TIME ZONE 'Europe/Warsaw')::date AS day, sum(amount)::bigint AS refunds
    FROM refunds WHERE status = 'SUCCEEDED' AND rental_id IS NOT NULL GROUP BY 1
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

-- Statystyki floty i stref: `UNPAID` to przejazd, który się odbył (ADR 0049); kolumny jak w 0002.
CREATE OR REPLACE VIEW v_fleet_status AS
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
         WHERE r30.scooter_id = s.id AND r30.state IN ('ENDED', 'UNPAID')
           AND r30.ended_at >= now() - interval '30 days') AS rentals_30d
FROM scooters s
JOIN scooter_models m ON m.id = s.model_id
LEFT JOIN rentals r ON r.scooter_id = s.id AND r.state IN ('RESERVED', 'UNLOCKING', 'ACTIVE', 'PAUSED', 'ENDING')
LEFT JOIN LATERAL (
    SELECT z.code, z.name FROM zones z
    WHERE z.active AND z.type = 'PARKING' AND ST_Contains(z.geom, s.position)
    ORDER BY z.code LIMIT 1
) pz ON true;

CREATE OR REPLACE VIEW v_zone_usage AS
SELECT z.id AS zone_id, z.code, z.name, z.type,
       (r.ended_at AT TIME ZONE 'Europe/Warsaw')::date AS day,
       count(*) AS rides_ended,
       avg(r.ride_seconds)::integer AS avg_ride_seconds,
       COALESCE(sum(r.total_amount), 0)::bigint AS revenue
FROM rentals r
JOIN zones z ON z.id = r.end_zone_id
WHERE r.state IN ('ENDED', 'UNPAID') AND r.ended_at IS NOT NULL
GROUP BY z.id, day;
