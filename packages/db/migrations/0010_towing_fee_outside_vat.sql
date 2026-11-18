-- 0010: opłata za odholowanie jako kara umowna poza VAT (ADR 0061). Pozycja paragonu bez stawki (`vat_rate` NULL,
-- „nie podlega”, w dokumencie „np.”), VAT dokumentu liczony osobno dla każdej stawki i korekta pilnowana w każdej
-- grupie stawek. Paragony sprzed zmiany (odholowanie ze stawką przejazdu) zostają bez zmian. Migracja 0007 jest
-- wykonana, więc zmiany jej obiektów idą tu (CREATE OR REPLACE).

-- =====================================================================
-- Pozycje paragonu: stawka NULL = nie podlega VAT
-- =====================================================================

-- CHECK `vat_rate >= 0` zostaje: NULL go spełnia, a stawka 0% dalej znaczy prawdziwą stawkę zerową.
ALTER TABLE receipt_items ALTER COLUMN vat_rate DROP NOT NULL;
COMMENT ON COLUMN receipt_items.vat_rate IS 'Stawka VAT w procentach; NULL = nie podlega VAT (np. kara umowna, ADR 0061)';

-- =====================================================================
-- Wystawienie dokumentu: korekta nie przekracza żadnej grupy stawek
-- =====================================================================

-- Jak w 0007, a do tego: suma paragonu sprzedaży i wszystkich jego korekt nie może być ujemna w żadnej grupie
-- stawek (NULL to osobna grupa), więc korekta nie zwróci VAT, którego paragon nie naliczył, ani stawki spoza
-- paragonu. Blokada paragonu sprzedaży (FOR UPDATE) szereguje korekty tego samego dokumentu.
CREATE OR REPLACE PROCEDURE sp_issue_receipt(
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
        IF remaining + total < 0 OR EXISTS (
            SELECT 1
            FROM (SELECT i.vat_rate, i.amount
                  FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
                  WHERE r.id = p_corrects_receipt_id OR r.corrects_receipt_id = p_corrects_receipt_id
                  UNION ALL
                  SELECT (e->>'vatRate')::numeric(4, 2), (e->>'amount')::bigint FROM jsonb_array_elements(p_items) e) g
            GROUP BY g.vat_rate
            HAVING sum(g.amount) < 0
        ) THEN
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

-- =====================================================================
-- Lista paragonów: VAT grupami stawek
-- =====================================================================

-- Kolumny jak w 0007. `vat_amount` to suma VAT liczonego osobno dla każdej stawki metodą „w stu” od sumy brutto
-- grupy (`fn_vat_from_gross`, tę samą regułę ma `receiptTotals` w packages/core); pozycje bez stawki nie mają VAT.
-- `vat_rate` to stawka pozycji z VAT, gdy jest jedna (paragon przejazdu z odholowaniem ma 23), a NULL przy kilku
-- stawkach albo bez pozycji z VAT. Netto to brutto minus VAT, więc obejmuje też pozycje poza VAT.
CREATE OR REPLACE VIEW v_receipt_list AS
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
    SELECT CASE WHEN count(DISTINCT g.vat_rate) = 1 THEN max(g.vat_rate) END AS vat_rate,
           sum(g.vat_amount)::bigint AS vat_amount
    FROM (SELECT i.vat_rate, fn_vat_from_gross(sum(i.amount)::bigint, i.vat_rate) AS vat_amount
          FROM receipt_items i WHERE i.receipt_id = rc.id
          GROUP BY i.vat_rate) g
) v ON true;
