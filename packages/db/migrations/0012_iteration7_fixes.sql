-- 0012: poprawki po przeglądzie iteracji 7. Migracja 0011 jest wykonana, więc zmiany jej obiektów idą tu.
-- 1. Wydruk pamięta, czy jego plik zawiera dane klienta (maskowanie jest wypalone w pliku według zlecającego,
--    a pobrać może inny operator): taki wiersz pobiera, ogląda i ponawia tylko operator z `users.read` (ADR 0068).
-- 2. Adres przycisku bloku treści sprawdza w bazie ta sama reguła co `isAllowedHref` (ADR 0063).
-- 3. Indeksy zadania porządkowego, które kończy wydruki i eksporty porzucone po restarcie API (ADR 0066, ADR 0069).

-- =====================================================================
-- Wydruki z danymi klienta (ADR 0068)
-- =====================================================================

-- Zapisywane przy wypełnieniu szablonu (`documentShowsCustomerData` w core): rodzaj z polami klienta wypełniony
-- bez maskowania (operator z `users.read` albo klient pobierający własny paragon). Do tego czasu `false` (wiersz
-- w kolejce nie ma pliku). Wiersze sprzed migracji nie wiedzą, kto miał `users.read`, więc rodzaje z polami klienta
-- dostają `true` (bezpieczniej: pobierze je tylko operator z `users.read`).
ALTER TABLE generated_documents ADD COLUMN customer_data_visible boolean NOT NULL DEFAULT false;
UPDATE generated_documents SET customer_data_visible = true
WHERE document_type IN ('RECEIPT', 'RENTAL_CONFIRMATION', 'SERVICE_PROTOCOL', 'INCIDENT_REPORT', 'WALLET_ADJUSTMENT');
COMMENT ON COLUMN generated_documents.customer_data_visible IS
    'Plik zawiera dane klienta bez maskowania; pobranie, szczegóły i ponowienie wymagają users.read (ADR 0068)';

-- Widok listy Wygenerowane: nowa kolumna na końcu (CREATE OR REPLACE dopuszcza tylko dopisanie kolumn), żeby panel
-- bez `users.read` nie pokazywał „Pobierz” przy takim wierszu.
CREATE OR REPLACE VIEW v_generated_documents AS
SELECT g.id, g.document_type, g.entity_ref, g.entity_label, g.params, g.format, g.status,
       CASE WHEN g.files_deleted_at IS NOT NULL THEN 'DELETED' ELSE g.status::text END AS state,
       g.template_version_id, v.template_id, t.name AS template_name, v.version_no AS template_version_no,
       g.template_version_id IS NULL AS built_in,
       g.docx_file_id, g.pdf_file_id,
       CASE WHEN g.requested_by_user IS NOT NULL THEN 'CUSTOMER' ELSE 'STAFF' END AS requester_kind,
       g.requested_by_staff, s.name AS staff_name, g.requested_by_user, u.name AS user_name,
       g.error_code, g.error, g.retry_of,
       g.created_at, g.started_at, g.finished_at, g.files_deleted_at,
       CASE WHEN g.finished_at IS NOT NULL AND g.started_at IS NOT NULL
            THEN floor(extract(epoch FROM g.finished_at - g.started_at) * 1000)::integer END AS duration_ms,
       g.customer_data_visible
FROM generated_documents g
LEFT JOIN document_template_versions v ON v.id = g.template_version_id
LEFT JOIN document_templates t ON t.id = v.template_id
LEFT JOIN staff s ON s.id = g.requested_by_staff
LEFT JOIN users u ON u.id = g.requested_by_user;

-- =====================================================================
-- Adres przycisku bloku treści (ADR 0063)
-- =====================================================================

-- Wzorzec `ALLOWED_HREF_PATTERN` z packages/shared/src/markdown/href.ts w składni PostgreSQL: https:// z hostem,
-- mailto:, tel:, kotwica # albo ścieżka od jednego `/`; bez białych znaków, ukośnika wstecznego (przeglądarka czyta
-- `/\host` jak `//host`, czyli obcą domenę) i znaków sterujących, najwyżej 2000 znaków (`HREF_MAX_LENGTH`).
-- Zgodność z `isAllowedHref` sprawdza test bazy na liście adresów.
ALTER TABLE content_blocks
    DROP CONSTRAINT content_blocks_cta_url,
    ADD CONSTRAINT content_blocks_cta_url CHECK (
        char_length(cta_url) <= 2000
        AND cta_url !~ '[[:cntrl:]]'
        AND cta_url ~ '^(https://[^/[:space:]\\][^[:space:]\\]*|mailto:[^[:space:]\\]+|tel:\+?[0-9][0-9-]*|#[^[:space:]\\]*|/([^/[:space:]\\][^[:space:]\\]*)?)$');

-- =====================================================================
-- Zadania porzucone po restarcie API (ADR 0066, ADR 0069)
-- =====================================================================

-- `documents.sweep` i `data-exports.sweep` co 5 minut szukają wierszy w kolejce albo w toku dłużej niż limit
-- (15 min wydruk, 30 min eksport) i kończą je jako FAILED; tabele rosną bez końca, a takich wierszy jest garść.
CREATE INDEX generated_documents_open_idx ON generated_documents (created_at) WHERE status IN ('QUEUED', 'RUNNING');
CREATE INDEX data_exports_open_idx ON data_exports (requested_at) WHERE status IN ('QUEUED', 'RUNNING');
