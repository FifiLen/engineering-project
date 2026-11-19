-- 0011: treści i wydruki (iteracja 7): bloki w sekcjach z rejestru, kategorie FAQ z widocznością na stronie
-- i w aplikacji, aktualności z wymaganą zajawką i stanem z dat, dane firmy w jednym wierszu zamiast `SELLER_*`,
-- biblioteka mediów z wymiarami i miejscami użycia, wersje szablonów DOCX z aktywacją i przywróceniem, wydruki
-- z formatem, błędem, retencją plików i ponownym użyciem paragonu PDF klienta, eksport danych klienta z limitem
-- raz na dobę, rola Redaktor, publiczne odczyty dla strony i aplikacji, widoki list panelu i widoki danych
-- wydruków (ADR 0062–0069). Reguły liczy packages/core, a baza pilnuje tych, których nie może obejść
-- równoległa transakcja.

-- Nowe wartości istniejących typów. Postgres nie pozwala ich użyć przed zatwierdzeniem tej transakcji, więc
-- ograniczenia i widoki niżej porównują je jako tekst (`document_type::text`), a procedury (plpgsql)
-- odwołują się do nich dopiero przy wykonaniu.
ALTER TYPE document_type ADD VALUE 'SCOOTER_LABEL';   -- naklejka z kodem QR: układ wbudowany bez szablonu (ADR 0068)
ALTER TYPE file_purpose ADD VALUE 'DATA_EXPORT';      -- plik „Pobierz moje dane” (ADR 0069)

-- Nowy typ (nie nowa wartość), więc można go używać w tej migracji.
CREATE TYPE document_format AS ENUM ('DOCX', 'PDF');

-- =====================================================================
-- Uprawnienia i rola Redaktor (ADR 0062, pytanie 6)
-- =====================================================================

-- Dane firmy trafiają na dokumenty sprzedaży, więc zapis ma tylko Administrator; podgląd wymaga `content.read`.
INSERT INTO permissions (code, module, description) VALUES
    ('company.write', 'content', 'Edycja danych firmy (sprzedawca na paragonach, kontakt pomocy)');
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'company.write' FROM roles r WHERE r.name = 'Administrator' AND r.is_system
ON CONFLICT DO NOTHING;

-- Redaktor edytuje treści, FAQ, aktualności i media; szablony wydruków tylko ogląda (`templates.write` ma
-- Administrator). Rola istniejąca pod tą nazwą (utworzona w panelu) dostaje brakujące uprawnienia.
INSERT INTO roles (name, description, is_system) VALUES
    ('Redaktor', 'Treści strony i aplikacji, media i podgląd szablonów wydruków', false)
ON CONFLICT (name) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code = ANY (ARRAY[
    'content.read', 'content.write', 'templates.read', 'dashboard.read'])
WHERE r.name = 'Redaktor'
ON CONFLICT DO NOTHING;

-- =====================================================================
-- Pliki: wymiary obrazów (ADR 0064)
-- =====================================================================

-- Wymiary zapisuje wysyłka grafiki do biblioteki (core `readImageInfo`); inne pliki ich nie mają.
ALTER TABLE files ADD COLUMN width  integer,
                  ADD COLUMN height integer,
                  ADD CONSTRAINT files_dimensions CHECK (
                      (width IS NULL) = (height IS NULL) AND (width IS NULL OR (width > 0 AND height > 0)));

-- =====================================================================
-- Biblioteka mediów (ADR 0064)
-- =====================================================================

-- Klucze systemowe (`scooter.*`, rejestr `SYSTEM_MEDIA_KEYS` w packages/shared) są tylko do odczytu i blokują
-- usunięcie; klucz grafiki z panelu podpowiada nazwa pliku, więc nie zaczyna się od `scooter.`.
ALTER TABLE media_assets ADD COLUMN name      text,
                         ADD COLUMN is_system boolean NOT NULL DEFAULT false;
UPDATE media_assets SET name = key, is_system = key LIKE 'scooter.%';
ALTER TABLE media_assets ALTER COLUMN name SET NOT NULL,
    ADD CONSTRAINT media_assets_name_check CHECK (btrim(name) <> '' AND char_length(name) <= 200),
    ADD CONSTRAINT media_assets_alt_text_length CHECK (char_length(alt_text) BETWEEN 3 AND 250),
    ADD CONSTRAINT media_assets_caption_length CHECK (caption IS NULL OR char_length(caption) <= 200),
    ADD CONSTRAINT media_assets_system_key CHECK (is_system = (key LIKE 'scooter.%'));

-- Klucz nie zmienia się po utworzeniu (adresy w treściach i kod aplikacji szukają grafiki po kluczu), plik
-- grafiki to gotowy obraz celu MEDIA z wymiarami, a grafiki systemowej nie da się usunąć. Użytą grafikę
-- chronią klucze obce z bloków, aktualności i modeli (RESTRICT).
CREATE FUNCTION trg_media_asset_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_system THEN
            RAISE EXCEPTION 'MEDIA_SYSTEM' USING ERRCODE = 'raise_exception', DETAIL = OLD.key;
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.key <> OLD.key THEN
        RAISE EXCEPTION 'MEDIA_KEY_IMMUTABLE' USING ERRCODE = 'raise_exception', DETAIL = OLD.key;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.file_id <> OLD.file_id THEN
        PERFORM 1 FROM files f
        WHERE f.id = NEW.file_id AND f.purpose = 'MEDIA' AND f.status = 'READY' AND f.width IS NOT NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'MEDIA_FILE_INVALID' USING ERRCODE = 'raise_exception';
        END IF;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER media_assets_rules BEFORE INSERT OR UPDATE OR DELETE ON media_assets
    FOR EACH ROW EXECUTE FUNCTION trg_media_asset_rules();

-- Klucze obce do grafik jawnie RESTRICT (ADR 0064); API sprawdza użycia wcześniej i zwraca `MEDIA_IN_USE`
-- z listą miejsc (`v_media_usages`), a naruszenie klucza to ostatnia linia obrony.
ALTER TABLE content_blocks DROP CONSTRAINT content_blocks_media_id_fkey,
    ADD CONSTRAINT content_blocks_media_id_fkey FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
ALTER TABLE news DROP CONSTRAINT news_media_id_fkey,
    ADD CONSTRAINT news_media_id_fkey FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
ALTER TABLE scooter_models DROP CONSTRAINT scooter_models_photo_media_id_fkey,
    ADD CONSTRAINT scooter_models_photo_media_id_fkey FOREIGN KEY (photo_media_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
CREATE INDEX content_blocks_media_idx ON content_blocks (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX news_media_idx ON news (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX scooter_models_photo_media_idx ON scooter_models (photo_media_id) WHERE photo_media_id IS NOT NULL;

-- Publiczny adres grafiki z sumą SHA-256 (D3): zawartość pod adresem się nie zmienia, a zastąpienie pliku daje
-- nowy adres. Rozszerzenia jak w core (`fileStorageKey`).
CREATE FUNCTION fn_media_path(p_media_id uuid, p_sha256 text, p_content_type text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT '/media/' || p_media_id || '/' || p_sha256 || '.'
           || CASE p_content_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END
$$;

-- =====================================================================
-- Bloki treści: sekcje z rejestru i pozycja w sekcji (ADR 0062, D1)
-- =====================================================================

-- `key` to klucz sekcji z rejestru w packages/shared (`web.hero`, `mobile.rules`), więc przestaje być unikalny.
-- Pozycja 0 to blok pojedynczy albo nagłówek sekcji-listy, od 1 elementy listy. Unikalność (key, position) jest
-- odroczona do końca transakcji, więc zmiana kolejności to seria UPDATE w jednej transakcji (bez ON CONFLICT,
-- którego Postgres nie łączy z ograniczeniem odroczonym). Tabela była pusta (seed jej nie wypełniał).
ALTER TABLE content_blocks ADD COLUMN position integer,
                           ADD COLUMN icon     text;
UPDATE content_blocks SET position = 0;
ALTER TABLE content_blocks ALTER COLUMN position SET NOT NULL,
                           ALTER COLUMN position SET DEFAULT 0,
                           DROP CONSTRAINT content_blocks_key_key,
                           DROP CONSTRAINT content_blocks_check1,
                           DROP COLUMN sort_order;
ALTER TABLE content_blocks
    ADD CONSTRAINT content_blocks_position_check CHECK (position >= 0),
    -- Element listy ma treść; pozycja 0 może być pusta, bo nagłówek sekcji-listy niesie stan i wersję sekcji
    -- (`web.stores` nie ma pól nagłówka). Wymagane pola sekcji sprawdza core z rejestru.
    ADD CONSTRAINT content_blocks_has_content CHECK (position = 0 OR num_nonnulls(title, body_md, media_id) > 0),
    ADD CONSTRAINT content_blocks_key_position UNIQUE (key, position) DEFERRABLE INITIALLY DEFERRED,
    -- Klucz sekcji zaczyna się od klienta: `web.` dla WEB, `mobile.` dla MOBILE, `admin.` dla ADMIN.
    ADD CONSTRAINT content_blocks_key_client CHECK (key LIKE lower(client::text) || '.%'),
    -- Zamknięta lista ikon (`CONTENT_ICONS` w packages/shared): nowa ikona to rysunek w obu klientach i migracja.
    ADD CONSTRAINT content_blocks_icon CHECK (icon IN ('rider-single', 'bike-lane', 'parking', 'helmet', 'no-alcohol',
                                                       'map', 'scan', 'wallet', 'battery', 'zone-slow',
                                                       'zone-no-ride', 'phone')),
    ADD CONSTRAINT content_blocks_icon_item CHECK (icon IS NULL OR position > 0),
    -- Adres przycisku jak odnośnik w Markdown (`isAllowedHref`, ADR 0063): https:, mailto:, tel:, kotwica #
    -- albo ścieżka od jednego `/` (nie `//`), bez białych znaków.
    ADD CONSTRAINT content_blocks_cta_url CHECK (cta_url ~ '^(https:|mailto:|tel:|#|/([^/]|$))' AND cta_url !~ '\s');
CREATE INDEX content_blocks_client_idx ON content_blocks (client, key, position);

-- Opublikowany wpis trzeba zarchiwizować przed usunięciem (pytanie 7): usunąć da się tylko szkic albo archiwum.
CREATE FUNCTION trg_content_delete_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'CONTENT_DELETE_PUBLISHED' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN OLD;
END
$$;
CREATE TRIGGER content_blocks_delete_rules BEFORE DELETE ON content_blocks
    FOR EACH ROW EXECUTE FUNCTION trg_content_delete_rules();

-- =====================================================================
-- FAQ: kategorie z kolejnością, widoczność na stronie i w aplikacji (ADR 0062, pytanie 12)
-- =====================================================================

-- Nazwa unikalna bez względu na wielkość liter: zapis pytania z nową nazwą tworzy kategorię, a literówka
-- w wielkości liter trafia do istniejącej. Kategorii z pytaniami nie da się usunąć (klucz obcy).
CREATE TABLE faq_categories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 60),
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX faq_categories_name_key ON faq_categories (lower(name));
CREATE INDEX faq_categories_sort_idx ON faq_categories (sort_order);

-- Kategoria jako tekst z 0002 przechodzi do tabeli (tabela pytań była pusta).
ALTER TABLE faq_items ADD COLUMN category_id uuid REFERENCES faq_categories(id),
                      ADD COLUMN show_on_web boolean NOT NULL DEFAULT true,
                      ADD COLUMN show_in_app boolean NOT NULL DEFAULT true;
INSERT INTO faq_categories (name, sort_order)
SELECT DISTINCT ON (lower(category)) category, 0 FROM faq_items ORDER BY lower(category), category;
UPDATE faq_items f SET category_id = c.id FROM faq_categories c WHERE lower(c.name) = lower(f.category);
ALTER TABLE faq_items ALTER COLUMN category_id SET NOT NULL,
                      DROP COLUMN category,
                      ADD CONSTRAINT faq_items_visible_somewhere CHECK (show_on_web OR show_in_app);
CREATE INDEX faq_items_category_idx ON faq_items (category_id, sort_order);
CREATE TRIGGER faq_items_delete_rules BEFORE DELETE ON faq_items
    FOR EACH ROW EXECUTE FUNCTION trg_content_delete_rules();

-- =====================================================================
-- Aktualności: zajawka, stan z dat, stały adres po publikacji (ADR 0062, ADR 0065)
-- =====================================================================

UPDATE news SET lead = left(title, 280) WHERE lead IS NULL;
ALTER TABLE news ALTER COLUMN lead SET NOT NULL,
                 ADD COLUMN first_published_at timestamptz,
                 ADD CONSTRAINT news_lead_length CHECK (char_length(lead) BETWEEN 1 AND 280);
UPDATE news SET first_published_at = COALESCE(publish_from, updated_at) WHERE status <> 'DRAFT';
ALTER TABLE news ADD CONSTRAINT news_first_published CHECK (status <> 'PUBLISHED' OR first_published_at IS NOT NULL);

-- Pierwsza publikacja zapisuje czas, a od niej slug się nie zmienia, żeby odnośniki do artykułu działały.
CREATE FUNCTION trg_news_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        NEW.first_published_at := OLD.first_published_at;
        IF NEW.slug <> OLD.slug AND OLD.first_published_at IS NOT NULL THEN
            RAISE EXCEPTION 'NEWS_SLUG_LOCKED' USING ERRCODE = 'raise_exception', DETAIL = OLD.slug;
        END IF;
    END IF;
    IF NEW.status = 'PUBLISHED' AND NEW.first_published_at IS NULL THEN
        NEW.first_published_at := now();
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER news_rules BEFORE INSERT OR UPDATE ON news
    FOR EACH ROW EXECUTE FUNCTION trg_news_rules();
CREATE TRIGGER news_delete_rules BEFORE DELETE ON news
    FOR EACH ROW EXECUTE FUNCTION trg_content_delete_rules();

-- Stan aktualności (lista w panelu, strona): ta sama reguła co w packages/core; opublikowana z datą „od”
-- w przyszłości jest zaplanowana, a po dacie „do” wygasła. Czas porównania podaje wywołujący.
CREATE FUNCTION fn_news_state(p_status content_status, p_publish_from timestamptz, p_publish_to timestamptz,
                              p_at timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_status = 'DRAFT' THEN 'DRAFT'
        WHEN p_status = 'ARCHIVED' THEN 'ARCHIVED'
        WHEN p_publish_from > p_at THEN 'SCHEDULED'
        WHEN p_publish_to IS NOT NULL AND p_publish_to <= p_at THEN 'EXPIRED'
        ELSE 'PUBLISHED'
    END
$$;

-- =====================================================================
-- Dane firmy: jeden wiersz zamiast `SELLER_*` (ADR 0062, pytanie 13)
-- =====================================================================

-- Sprzedawca (paragon kopiuje nazwę, adres i NIP w chwili wystawienia), kontakt pomocy (stopka strony, Pomoc
-- w aplikacji, wydruki) i opcjonalne dane rejestrowe (stopka strony spółki, art. 206 § 1 KSH). Sumę kontrolną
-- NIP sprawdza core. Adres jest cały albo pusty.
CREATE TABLE company_profile (
    id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
    name                 text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 200),
    street               text CHECK (btrim(street) <> ''),
    postal_code          text CHECK (postal_code ~ '^\d{2}-\d{3}$'),
    city                 text CHECK (btrim(city) <> ''),
    tax_id               text CHECK (tax_id ~ '^\d{10}$'),
    support_email        text NOT NULL CHECK (btrim(support_email) <> '' AND char_length(support_email) <= 200),
    support_phone        text NOT NULL CHECK (btrim(support_phone) <> '' AND char_length(support_phone) <= 40),
    support_hours        text CHECK (char_length(support_hours) <= 60),
    regon                text CHECK (regon ~ '^(\d{9}|\d{14})$'),
    krs                  text CHECK (krs ~ '^\d{10}$'),
    registry_court       text CHECK (btrim(registry_court) <> ''),
    share_capital_grosze bigint CHECK (share_capital_grosze > 0),
    version              integer NOT NULL DEFAULT 1,
    updated_by           uuid REFERENCES staff(id),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT company_profile_address CHECK (num_nulls(street, postal_code, city) IN (0, 3))
);

-- Wiersz jest zawsze, więc paragon i Pomoc działają po samym `db:migrate`. Wartości deweloperskie jak domyślne
-- `SELLER_*` w konfiguracji API i kontakt pomocy z makiet; prawdziwe dane wpisuje Administrator w panelu.
INSERT INTO company_profile (name, support_email, support_phone, support_hours) VALUES
    ('[dane sprzedawcy]', '[e-mail pomocy]', '[telefon pomocy]', 'Codziennie [8:00–20:00]')
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION trg_company_profile_keep() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'COMPANY_PROFILE_REQUIRED' USING ERRCODE = 'raise_exception';
END
$$;
CREATE TRIGGER company_profile_keep BEFORE DELETE ON company_profile
    FOR EACH ROW EXECUTE FUNCTION trg_company_profile_keep();

-- =====================================================================
-- Licznik treści i dokumenty prawne (ADR 0062)
-- =====================================================================

-- Kategorie FAQ, dane firmy i modele (parametry i zdjęcie na stronie) też zmieniają treść klientów.
CREATE TRIGGER faq_categories_revision AFTER INSERT OR UPDATE OR DELETE ON faq_categories
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER company_profile_revision AFTER INSERT OR UPDATE OR DELETE ON company_profile
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();
CREATE TRIGGER scooter_models_revision AFTER INSERT OR UPDATE OR DELETE ON scooter_models
    FOR EACH STATEMENT EXECUTE FUNCTION trg_content_revision();

-- Zadanie `content.news-boundary` na granicy publikacji aktualności zwiększa licznik bez zmiany wiersza.
CREATE PROCEDURE sp_content_bump_revision()
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM nextval('content_revision_seq');
END
$$;

-- Blokada optymistyczna wersji roboczej dokumentu prawnego (dług z iteracji 2): zapis podaje `version`.
ALTER TABLE content_page_versions ADD COLUMN version integer NOT NULL DEFAULT 1;

-- =====================================================================
-- Szablony wydruków: wersje, aktywacja, przywrócenie, szablon domyślny (ADR 0067)
-- =====================================================================

-- Naklejka z kodem QR to układ wbudowany (ADR 0068), więc nie ma szablonu.
ALTER TABLE document_templates ADD CONSTRAINT document_templates_not_built_in CHECK (document_type::text <> 'SCOOTER_LABEL');

-- Autor i czas aktywacji (stan „Archiwalna” to wersja kiedyś aktywna), ostrzeżenia walidacji (nieużyte pola
-- katalogu), rozmiary pliku i archiwum po rozpakowaniu, podgląd PDF na danych przykładowych.
-- `uploaded_by` NULL: szablon startowy z danych startowych (D4).
ALTER TABLE document_template_versions
    ALTER COLUMN uploaded_by DROP NOT NULL,
    ADD COLUMN activated_at       timestamptz,
    ADD COLUMN activated_by       uuid REFERENCES staff(id),
    ADD COLUMN warnings           jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(warnings) = 'array'),
    ADD COLUMN size_bytes         integer NOT NULL CHECK (size_bytes > 0),
    ADD COLUMN uncompressed_bytes bigint NOT NULL CHECK (uncompressed_bytes > 0),
    ADD COLUMN preview_file_id    uuid REFERENCES files(id),
    ADD CONSTRAINT document_template_versions_active_activated CHECK (NOT is_active OR activated_at IS NOT NULL),
    ADD CONSTRAINT document_template_versions_activated_by CHECK (activated_by IS NULL OR activated_at IS NOT NULL);

-- Plik wersji to szablon celu DOCUMENT_TEMPLATE; plik, pola i rozmiary nie zmieniają się po wgraniu (wydruki
-- wskazują wersję), a usunąć można tylko wersję nigdy nieaktywowaną („Do aktywacji”).
CREATE FUNCTION trg_document_template_version_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.activated_at IS NOT NULL THEN
            RAISE EXCEPTION 'TEMPLATE_VERSION_NOT_PENDING' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM files f WHERE f.id = NEW.file_id AND f.purpose = 'DOCUMENT_TEMPLATE' AND f.status = 'READY';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'TEMPLATE_FILE_INVALID' USING ERRCODE = 'raise_exception';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.template_id <> OLD.template_id OR NEW.version_no <> OLD.version_no OR NEW.file_id <> OLD.file_id
       OR NEW.fields IS DISTINCT FROM OLD.fields OR NEW.size_bytes <> OLD.size_bytes
       OR NEW.uncompressed_bytes <> OLD.uncompressed_bytes OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
       OR NEW.uploaded_at <> OLD.uploaded_at THEN
        RAISE EXCEPTION 'TEMPLATE_VERSION_IMMUTABLE' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER document_template_versions_rules BEFORE INSERT OR UPDATE OR DELETE ON document_template_versions
    FOR EACH ROW EXECUTE FUNCTION trg_document_template_version_rules();

-- Aktywacja i „Przywróć” (aktywacja starszej wersji bez kopiowania pliku). Blokada szablonu szereguje dwie
-- równoległe aktywacje, a indeks `document_template_versions_one_active` z 0002 zostaje ostatnią linią obrony.
-- Aktywacja wersji już aktywnej niczego nie zmienia. Zmienia tylko kolejne wydruki: wcześniejsze wskazują swoją wersję.
CREATE PROCEDURE sp_document_template_activate(p_version_id uuid, p_staff_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    v_template_id uuid;
    v_active      boolean;
BEGIN
    SELECT template_id INTO v_template_id FROM document_template_versions WHERE id = p_version_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TEMPLATE_VERSION_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    PERFORM 1 FROM document_templates WHERE id = v_template_id FOR UPDATE;
    SELECT is_active INTO v_active FROM document_template_versions WHERE id = p_version_id;
    IF v_active THEN
        RETURN;
    END IF;
    UPDATE document_template_versions SET is_active = false WHERE template_id = v_template_id AND is_active;
    UPDATE document_template_versions SET is_active = true, activated_at = now(), activated_by = p_staff_id
    WHERE id = p_version_id;
    UPDATE document_templates SET updated_at = now(), updated_by = COALESCE(p_staff_id, updated_by), version = version + 1
    WHERE id = v_template_id;
END
$$;

-- Szablon domyślny rodzaju dokumentu: wymaga aktywnej wersji i aktywnego szablonu (rodzaj bez szablonu z aktywną
-- wersją nie pokazuje „Drukuj”). Blokada szablonów rodzaju szereguje zmianę domyślnego.
CREATE PROCEDURE sp_document_template_set_default(p_template_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    v_type   document_type;
    v_active boolean;
BEGIN
    SELECT document_type, active INTO v_type, v_active FROM document_templates WHERE id = p_template_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    PERFORM 1 FROM document_templates WHERE document_type = v_type FOR UPDATE;
    IF NOT v_active THEN
        RAISE EXCEPTION 'TEMPLATE_INACTIVE' USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM document_template_versions WHERE template_id = p_template_id AND is_active) THEN
        RAISE EXCEPTION 'TEMPLATE_NO_ACTIVE_VERSION' USING ERRCODE = 'raise_exception';
    END IF;
    UPDATE document_templates SET is_default = false, updated_at = now(), version = version + 1
    WHERE document_type = v_type AND is_default AND id <> p_template_id;
    UPDATE document_templates SET is_default = true, updated_at = now(), version = version + 1
    WHERE id = p_template_id AND NOT is_default;
END
$$;

-- =====================================================================
-- Wygenerowane dokumenty: format, błąd, retencja, naklejka bez szablonu, ponowne użycie paragonu (ADR 0066, 0068)
-- =====================================================================

-- Tabela była pusta. `entity_label` to numer obiektu z chwili zlecenia (lista i wyszukiwanie), `error_code`
-- kod błędu silnika albo szablonu (`RENDER_TIMEOUT`), `error` zostaje na szczegół techniczny, `retry_of` wskazuje
-- wydruk ponawiany przez „Spróbuj ponownie”, a `files_deleted_at` usunięcie plików po 30 dniach (wiersz zostaje).
ALTER TABLE generated_documents
    ALTER COLUMN template_version_id DROP NOT NULL,
    ADD COLUMN format           document_format NOT NULL DEFAULT 'PDF',
    ADD COLUMN entity_label     text,
    ADD COLUMN started_at       timestamptz,
    ADD COLUMN error_code       text,
    ADD COLUMN files_deleted_at timestamptz,
    ADD COLUMN retry_of         uuid REFERENCES generated_documents(id),
    DROP CONSTRAINT generated_documents_check1,   -- SUCCEEDED wymagał DOCX (naklejka go nie ma)
    DROP CONSTRAINT generated_documents_check2;   -- FAILED wymagał `error`; teraz `error_code`
UPDATE generated_documents SET entity_label = entity_ref,
                               error_code = CASE WHEN status = 'FAILED' THEN 'RENDER_FAILED' END,
                               finished_at = CASE WHEN status IN ('SUCCEEDED', 'FAILED') THEN COALESCE(finished_at, created_at) END;
ALTER TABLE generated_documents
    ALTER COLUMN format DROP DEFAULT,
    ALTER COLUMN entity_label SET NOT NULL,
    ADD CONSTRAINT generated_documents_entity_label CHECK (btrim(entity_label) <> ''),
    -- Bez wersji szablonu jest tylko naklejka z kodem QR (rodzaj porównany jako tekst: nowa wartość typu).
    ADD CONSTRAINT generated_documents_template_version CHECK (
        (document_type::text = 'SCOOTER_LABEL') = (template_version_id IS NULL)),
    ADD CONSTRAINT generated_documents_label_pdf CHECK (
        document_type::text <> 'SCOOTER_LABEL' OR (format = 'PDF' AND docx_file_id IS NULL)),
    ADD CONSTRAINT generated_documents_docx_no_pdf CHECK (format = 'PDF' OR pdf_file_id IS NULL),
    -- Gotowy wydruk ma plik w żądanym formacie; przy błędzie PDF zostaje DOCX, stan FAILED i kod.
    ADD CONSTRAINT generated_documents_succeeded_file CHECK (
        status <> 'SUCCEEDED' OR CASE format WHEN 'PDF' THEN pdf_file_id IS NOT NULL ELSE docx_file_id IS NOT NULL END),
    ADD CONSTRAINT generated_documents_failed_code CHECK (status <> 'FAILED' OR error_code IS NOT NULL),
    ADD CONSTRAINT generated_documents_error_code CHECK (error_code ~ '^[A-Z_]+$'),
    ADD CONSTRAINT generated_documents_finished CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (finished_at IS NOT NULL)),
    ADD CONSTRAINT generated_documents_files_deleted CHECK (files_deleted_at IS NULL OR finished_at IS NOT NULL),
    ADD CONSTRAINT generated_documents_retry_other CHECK (retry_of <> id);

-- Dokumenty klienta (`GET /me/documents`), retencja plików (`documents.retention`), lista w panelu i liczba
-- wydruków wersji szablonu.
CREATE INDEX generated_documents_user_idx ON generated_documents (requested_by_user, created_at DESC)
    WHERE requested_by_user IS NOT NULL;
CREATE INDEX generated_documents_retention_idx ON generated_documents (finished_at) WHERE files_deleted_at IS NULL;
CREATE INDEX generated_documents_created_idx ON generated_documents (created_at DESC);
CREATE INDEX generated_documents_template_version_idx ON generated_documents (template_version_id)
    WHERE template_version_id IS NOT NULL;
-- Paragon PDF klienta z tą samą wersją szablonu nie generuje się drugi raz (pytanie 2): `POST /me/receipts/{id}/pdf`
-- wstawia wiersz przez INSERT … ON CONFLICT (entity_ref, template_version_id) WHERE <ten sam warunek> DO NOTHING,
-- a przy konflikcie zwraca istniejący. Wydruk nieudany albo z usuniętymi plikami nie blokuje nowego.
CREATE UNIQUE INDEX generated_documents_receipt_reuse ON generated_documents (entity_ref, template_version_id)
    WHERE document_type = 'RECEIPT' AND format = 'PDF' AND requested_by_user IS NOT NULL
      AND status <> 'FAILED' AND files_deleted_at IS NULL;

-- =====================================================================
-- Eksport danych klienta (ADR 0069, pytanie 14)
-- =====================================================================

-- Plik JSON ważny 7 dni; wiersz zostaje jako ślad zlecenia po usunięciu pliku (`deleted_at`). Nieudane
-- zlecenie ma kod błędu (także `ACCOUNT_DELETED` po usunięciu konta) i nie liczy się do limitu.
CREATE TABLE data_exports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    status          job_status NOT NULL DEFAULT 'QUEUED',
    file_id         uuid UNIQUE REFERENCES files(id),
    size_bytes      integer CHECK (size_bytes > 0),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,
    expires_at      timestamptz,
    error_code      text CHECK (error_code ~ '^[A-Z_]+$'),
    deleted_at      timestamptz,
    CONSTRAINT data_exports_succeeded_file CHECK (status <> 'SUCCEEDED' OR (file_id IS NOT NULL AND expires_at IS NOT NULL)),
    CONSTRAINT data_exports_failed_code CHECK (status <> 'FAILED' OR error_code IS NOT NULL),
    CONSTRAINT data_exports_finished CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (finished_at IS NOT NULL)),
    CONSTRAINT data_exports_expires_after CHECK (expires_at IS NULL OR expires_at > finished_at),
    CONSTRAINT data_exports_deleted_file CHECK (deleted_at IS NULL OR file_id IS NOT NULL)
);
-- Jedno zlecenie w toku na klienta (podwójne kliknięcie, dwa urządzenia).
CREATE UNIQUE INDEX data_exports_one_open ON data_exports (user_id) WHERE status IN ('QUEUED', 'RUNNING');
CREATE INDEX data_exports_user_idx ON data_exports (user_id, requested_at DESC);
-- Usuwanie plików po `expires_at` (`data-exports.purge`).
CREATE INDEX data_exports_purge_idx ON data_exports (expires_at) WHERE status = 'SUCCEEDED' AND deleted_at IS NULL;

-- Czas, od którego klient może zlecić kolejny eksport: 24 h od ostatniego zlecenia bez błędu z ostatniej doby;
-- NULL, gdy może już teraz. Tę samą regułę ma core (`dataExportNextAllowedAt`), zgodność sprawdza test.
CREATE FUNCTION fn_data_export_next_allowed_at(p_user_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT max(requested_at) + interval '24 hours' FROM data_exports
    WHERE user_id = p_user_id AND status <> 'FAILED' AND requested_at > now() - interval '24 hours'
$$;

-- Zlecenie eksportu z limitem raz na dobę. Blokada wiersza klienta szereguje równoległe zlecenia, więc limit
-- nie ma wyścigu. Przy limicie DETAIL to czas następnego zlecenia (ISO 8601 w UTC), który API podaje jako
-- `details.nextAllowedAt` z `429 DATA_EXPORT_LIMIT`.
CREATE PROCEDURE sp_data_export_request(p_user_id uuid, OUT export_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
    next_at timestamptz;
BEGIN
    PERFORM 1 FROM users WHERE id = p_user_id AND status <> 'DELETED' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    next_at := fn_data_export_next_allowed_at(p_user_id);
    IF next_at IS NOT NULL THEN
        RAISE EXCEPTION 'DATA_EXPORT_LIMIT' USING ERRCODE = 'raise_exception',
            DETAIL = to_char(next_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;
    INSERT INTO data_exports (user_id) VALUES (p_user_id) RETURNING id INTO export_id;
END
$$;

-- Usunięcie konta: jak w 0005, a do tego zlecenie eksportu w toku kończy się błędem `ACCOUNT_DELETED`
-- w tej samej transakcji (pliki gotowych eksportów usuwa zadanie po zatwierdzeniu, ADR 0069).
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
    UPDATE data_exports SET status = 'FAILED', error_code = 'ACCOUNT_DELETED', finished_at = now()
    WHERE user_id = p_user_id AND status IN ('QUEUED', 'RUNNING');
END
$$;

-- Powiadomienie o gotowym pliku (nowy kod w rejestrze `NOTIFICATION_TEMPLATES`): treść jak w `DEV_NOTIFICATION_TEMPLATES`
-- w packages/db/src/seed.ts, żeby baza po samym `db:migrate` miała szablony wszystkich kodów (jak w 0009). Istniejący
-- szablon zostaje bez zmian, a wersję 1 zapisuje wyzwalacz `notification_templates_version`.
INSERT INTO notification_templates (code, channel, title, body, description) VALUES
    ('data_export_ready', 'PUSH', 'Twoje dane są gotowe',
     $t$Plik z Twoimi danymi jest gotowy do pobrania do {expiresAt}. Znajdziesz go w ustawieniach aplikacji: Pobierz moje dane.$t$,
     $t$Wysyłany po przygotowaniu eksportu danych klienta (ADR 0069), zawsze, bez preferencji. Parametry: expiresAt.$t$)
ON CONFLICT (code, channel) DO NOTHING;

-- =====================================================================
-- Widoki publiczne: strona i aplikacja (ADR 0062, ADR 0064, ADR 0065)
-- =====================================================================

-- Grafiki biblioteki z publicznym adresem względnym (klienci doklejają adres API) i wymiarami (`<img>` bez
-- przesunięcia układu). Grafiki są publiczne z założenia (D3), więc widok nie filtruje użycia.
CREATE VIEW v_public_media AS
SELECT m.id, m.key, m.name, m.alt_text, m.caption, m.is_system,
       f.content_type, f.size_bytes, f.width, f.height, f.sha256,
       fn_media_path(m.id, f.sha256, f.content_type) AS path,
       m.updated_at
FROM media_assets m
JOIN files f ON f.id = m.file_id;

-- Opublikowane bloki klienta z grafiką; element listy tylko z opublikowanym nagłówkiem sekcji.
CREATE VIEW v_public_content_blocks AS
SELECT b.client, b.key, b.position, b.title, b.body_md, b.icon, b.cta_label, b.cta_url,
       b.media_id, m.key AS media_key, m.path AS media_path, m.alt_text AS media_alt_text,
       m.width AS media_width, m.height AS media_height, b.updated_at
FROM content_blocks b
LEFT JOIN v_public_media m ON m.id = b.media_id
WHERE b.status = 'PUBLISHED'
  AND (b.position = 0 OR EXISTS (SELECT 1 FROM content_blocks h
                                 WHERE h.key = b.key AND h.position = 0 AND h.status = 'PUBLISHED'));

-- Opublikowane pytania z kolejnością kategorii; klient filtruje `show_on_web` albo `show_in_app`. Kategoria bez
-- opublikowanych pytań nie pojawia się wcale.
CREATE VIEW v_public_faq AS
SELECT c.id AS category_id, c.name AS category_name, c.sort_order AS category_sort_order,
       f.id, f.question, f.answer_md, f.sort_order, f.show_on_web, f.show_in_app, f.updated_at
FROM faq_items f
JOIN faq_categories c ON c.id = f.category_id
WHERE f.status = 'PUBLISHED';

-- Dane firmy dla stopki strony, Pomocy w aplikacji i wydruków; adres w jednym wierszu jak na paragonie.
CREATE VIEW v_company_public AS
SELECT c.name, c.street, c.postal_code, c.city,
       CASE WHEN c.street IS NOT NULL THEN c.street || ', ' || c.postal_code || ' ' || c.city END AS address,
       c.tax_id, c.support_email, c.support_phone, c.support_hours,
       c.regon, c.krs, c.registry_court, c.share_capital_grosze, c.updated_at
FROM company_profile c;

-- Opublikowane aktualności: kolumny jak w 0002, a na końcu grafika z biblioteki i daty zmian.
CREATE OR REPLACE VIEW v_published_news AS
SELECT n.id, n.slug, n.title, n.lead, n.body_md, n.media_id, n.publish_from, n.publish_to,
       m.key AS media_key, m.path AS media_path, m.alt_text AS media_alt_text, m.caption AS media_caption,
       m.width AS media_width, m.height AS media_height, n.first_published_at, n.updated_at
FROM news n
LEFT JOIN v_public_media m ON m.id = n.media_id
WHERE n.status = 'PUBLISHED' AND n.publish_from <= now()
  AND (n.publish_to IS NULL OR n.publish_to > now());

-- Wersje dokumentów prawnych na stronie (`GET /legal/{slug}/versions`, wersja archiwalna `/{slug}/wersja/{n}`):
-- tylko obowiązująca i archiwalne, nigdy robocze; koniec obowiązywania to publikacja następnej wersji.
CREATE VIEW v_public_document_versions AS
SELECT p.id AS page_id, p.slug, p.name, p.consent_type,
       v.id AS version_id, v.version_no, v.title, v.body_md, v.change_summary, v.status,
       v.published_at,
       (SELECT min(n.published_at) FROM content_page_versions n
        WHERE n.page_id = v.page_id AND n.version_no > v.version_no AND n.published_at IS NOT NULL) AS valid_to,
       v.status = 'PUBLISHED' AS is_current
FROM content_pages p
JOIN content_page_versions v ON v.page_id = p.id
WHERE v.status IN ('PUBLISHED', 'ARCHIVED') AND v.published_at IS NOT NULL;

-- Strona `/h/{numer}` (ADR 0065): numer i model ze zdjęciem hulajnogi, która nie jest wycofana; bez stanu floty
-- (dostępność, bateria, położenie, łączność), bo strona trafia do cache.
CREATE VIEW v_public_scooters AS
SELECT s.number, m.code AS model_code, m.name AS model_name,
       m.photo_media_id, pm.path AS photo_path, pm.alt_text AS photo_alt_text,
       pm.width AS photo_width, pm.height AS photo_height
FROM scooters s
JOIN scooter_models m ON m.id = s.model_id
LEFT JOIN v_public_media pm ON pm.id = m.photo_media_id
WHERE s.status <> 'RETIRED';

-- =====================================================================
-- Widoki list w panelu (wymaganie 12, ADR 0031)
-- =====================================================================

-- Bloki treści z grafiką, autorem i licznikami sekcji (elementy, opublikowane, szkice) do grupowania w panelu.
CREATE VIEW v_content_blocks AS
SELECT b.id, b.key, b.client, b.position, b.position = 0 AS is_header,
       b.title, b.body_md, b.icon, b.cta_label, b.cta_url,
       b.media_id, m.key AS media_key, m.name AS media_name, m.path AS media_path, m.alt_text AS media_alt_text,
       m.width AS media_width, m.height AS media_height,
       b.status,
       (SELECT count(*)::integer FROM content_blocks e WHERE e.key = b.key AND e.position > 0) AS section_items,
       (SELECT count(*)::integer FROM content_blocks e
        WHERE e.key = b.key AND e.position > 0 AND e.status = 'PUBLISHED') AS section_items_published,
       (SELECT count(*)::integer FROM content_blocks e WHERE e.key = b.key AND e.status = 'DRAFT') AS section_drafts,
       b.updated_by, s.name AS updated_by_name, b.created_at, b.updated_at, b.version
FROM content_blocks b
LEFT JOIN v_public_media m ON m.id = b.media_id
LEFT JOIN staff s ON s.id = b.updated_by;

-- Kategorie FAQ z liczbą pytań (usunąć można tylko pustą).
CREATE VIEW v_faq_categories AS
SELECT c.id, c.name, c.sort_order,
       (SELECT count(*)::integer FROM faq_items f WHERE f.category_id = c.id) AS items,
       (SELECT count(*)::integer FROM faq_items f WHERE f.category_id = c.id AND f.status = 'PUBLISHED') AS items_published,
       c.created_at, c.updated_at, c.version
FROM faq_categories c;

-- Pytania FAQ z kategorią i jej kolejnością.
CREATE VIEW v_faq_list AS
SELECT f.id, f.category_id, c.name AS category_name, c.sort_order AS category_sort_order,
       f.question, f.answer_md, f.sort_order, f.status, f.show_on_web, f.show_in_app,
       f.updated_by, s.name AS updated_by_name, f.created_at, f.updated_at, f.version
FROM faq_items f
JOIN faq_categories c ON c.id = f.category_id
LEFT JOIN staff s ON s.id = f.updated_by;

-- Aktualności ze stanem z dat (szkic, zaplanowana, opublikowana, wygasła, archiwum) i grafiką.
CREATE VIEW v_news_list AS
SELECT n.id, n.slug, n.title, n.lead, n.body_md, n.status,
       fn_news_state(n.status, n.publish_from, n.publish_to, now()) AS state,
       n.publish_from, n.publish_to, n.first_published_at,
       n.media_id, m.key AS media_key, m.name AS media_name, m.path AS media_path, m.alt_text AS media_alt_text,
       n.created_by, c.name AS created_by_name, n.updated_by, s.name AS updated_by_name,
       n.created_at, n.updated_at, n.version
FROM news n
LEFT JOIN v_public_media m ON m.id = n.media_id
LEFT JOIN staff c ON c.id = n.created_by
LEFT JOIN staff s ON s.id = n.updated_by;

-- Miejsca użycia grafiki (szczegóły w bibliotece i komunikat `MEDIA_IN_USE`): blok sekcji, aktualność, model.
CREATE VIEW v_media_usages AS
SELECT b.media_id, 'CONTENT_BLOCK'::text AS kind, b.id AS entity_id, b.key AS ref, b.position,
       b.client::text AS client, b.status::text AS status, b.title AS label
FROM content_blocks b
WHERE b.media_id IS NOT NULL
UNION ALL
SELECT n.media_id, 'NEWS', n.id, n.slug, NULL, 'WEB', n.status::text, n.title
FROM news n
WHERE n.media_id IS NOT NULL
UNION ALL
SELECT m.photo_media_id, 'SCOOTER_MODEL', m.id, m.code, NULL, NULL,
       CASE WHEN m.active THEN 'ACTIVE' ELSE 'INACTIVE' END, m.name
FROM scooter_models m
WHERE m.photo_media_id IS NOT NULL;

-- Biblioteka mediów: plik, wymiary, adres, liczba użyć (filtry „Używane” i „Nieużywane”) i autor zmiany.
CREATE VIEW v_media_list AS
SELECT m.id, m.key, m.name, m.alt_text, m.caption, m.is_system,
       m.file_id, f.content_type, f.size_bytes, f.width, f.height, f.sha256, f.original_name,
       fn_media_path(m.id, f.sha256, f.content_type) AS path,
       (SELECT count(*)::integer FROM v_media_usages u WHERE u.media_id = m.id) AS usages,
       m.updated_by, s.name AS updated_by_name, m.created_at, m.updated_at, m.version
FROM media_assets m
JOIN files f ON f.id = m.file_id
LEFT JOIN staff s ON s.id = m.updated_by;

-- Szablony wydruków z aktywną wersją, liczbą wersji i ostatnim wydrukiem.
CREATE VIEW v_document_templates AS
SELECT t.id, t.document_type, t.name, t.description, t.is_default, t.active,
       av.id AS active_version_id, av.version_no AS active_version_no, av.activated_at AS active_since,
       (SELECT count(*)::integer FROM document_template_versions v WHERE v.template_id = t.id) AS versions,
       (SELECT count(*)::integer FROM document_template_versions v
        WHERE v.template_id = t.id AND v.activated_at IS NULL) AS pending_versions,
       (SELECT max(g.created_at) FROM generated_documents g
        JOIN document_template_versions v ON v.id = g.template_version_id
        WHERE v.template_id = t.id) AS last_generated_at,
       t.created_by, t.updated_by, s.name AS updated_by_name, t.created_at, t.updated_at, t.version
FROM document_templates t
LEFT JOIN document_template_versions av ON av.template_id = t.id AND av.is_active
LEFT JOIN staff s ON s.id = t.updated_by;

-- Wersje szablonu ze stanem: ACTIVE, ARCHIVED (kiedyś aktywna), PENDING („Do aktywacji”, tylko tę można usunąć).
CREATE VIEW v_document_template_versions AS
SELECT v.id, v.template_id, t.document_type, t.name AS template_name, t.is_default AS template_is_default,
       v.version_no,
       CASE WHEN v.is_active THEN 'ACTIVE' WHEN v.activated_at IS NOT NULL THEN 'ARCHIVED' ELSE 'PENDING' END AS state,
       v.is_active, v.file_id, f.content_type, f.sha256, v.size_bytes, v.uncompressed_bytes,
       v.fields, v.warnings, v.note,
       v.uploaded_by, u.name AS uploaded_by_name, v.uploaded_at,
       v.activated_at, v.activated_by, a.name AS activated_by_name,
       v.preview_file_id,
       (SELECT count(*)::integer FROM generated_documents g WHERE g.template_version_id = v.id) AS documents
FROM document_template_versions v
JOIN document_templates t ON t.id = v.template_id
JOIN files f ON f.id = v.file_id
LEFT JOIN staff u ON u.id = v.uploaded_by
LEFT JOIN staff a ON a.id = v.activated_by;

-- Wygenerowane dokumenty: stan z DELETED po retencji, szablon z wersją albo układ wbudowany (`built_in`),
-- zlecający (operator albo klient z aplikacji) i czas trwania.
CREATE VIEW v_generated_documents AS
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
            THEN floor(extract(epoch FROM g.finished_at - g.started_at) * 1000)::integer END AS duration_ms
FROM generated_documents g
LEFT JOIN document_template_versions v ON v.id = g.template_version_id
LEFT JOIN document_templates t ON t.id = v.template_id
LEFT JOIN staff s ON s.id = g.requested_by_staff
LEFT JOIN users u ON u.id = g.requested_by_user;

-- Eksporty danych klientów (panel, tylko do odczytu z `users.read`): stan z EXPIRED po ważności i DELETED.
CREATE VIEW v_data_exports AS
SELECT e.id, e.user_id, u.name AS user_name, u.phone AS user_phone, e.status,
       CASE WHEN e.deleted_at IS NOT NULL THEN 'DELETED'
            WHEN e.status = 'SUCCEEDED' AND e.expires_at <= now() THEN 'EXPIRED'
            ELSE e.status::text END AS state,
       e.file_id, e.size_bytes, e.requested_at, e.started_at, e.finished_at, e.expires_at, e.deleted_at, e.error_code
FROM data_exports e
JOIN users u ON u.id = e.user_id;

-- =====================================================================
-- Widoki danych wydruków (ADR 0068): kontrakt modułu, do którego należą dane, dla katalogu rodzajów w core
-- =====================================================================
-- Jeden wiersz na obiekt; listy (pozycje, oś czasu, części, historia) jako tablice JSON w kolejności dokumentu.
-- Kwoty w groszach, czas w UTC, bez formatowania: teksty dla szablonu buduje `build()` z katalogu w core
-- (`formatPln`, daty Europe/Warsaw), a parametry (`includeTimeline`, `historyDays`) stosuje przy budowie.

-- Paragon i korekta (RECEIPT): sprzedawca i nabywca z chwili wystawienia, pozycje, grupy VAT (stawka NULL to
-- „np.”, ADR 0061) i dokument korygowany.
CREATE VIEW v_doc_receipt AS
SELECT rc.id AS receipt_id, rc.number, rc.kind, rc.kind = 'CORRECTION' AS is_correction, rc.issued_at,
       rc.user_id, rc.buyer_name, rc.buyer_phone, rc.buyer_email,
       rc.seller->>'name' AS seller_name, rc.seller->>'address' AS seller_address, rc.seller->>'taxId' AS seller_tax_id,
       rc.payment_source, l.card_brand, l.card_last4,
       rc.total_amount, rc.currency, l.vat_amount, l.net_amount,
       rc.rental_id, l.rental_number, rc.refund_id,
       rc.corrects_receipt_id, l.corrects_number, o.issued_at AS corrects_issued_at,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('lineNo', i.line_no, 'description', i.description,
                                                     'quantity', i.quantity, 'unitPrice', i.unit_price,
                                                     'vatRate', i.vat_rate, 'amount', i.amount) ORDER BY i.line_no), '[]')
        FROM receipt_items i WHERE i.receipt_id = rc.id) AS items,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('vatRate', g.vat_rate, 'gross', g.gross, 'vat', g.vat,
                                                     'net', g.gross - g.vat) ORDER BY g.vat_rate DESC NULLS LAST), '[]')
        FROM (SELECT i.vat_rate, sum(i.amount)::bigint AS gross,
                     COALESCE(fn_vat_from_gross(sum(i.amount)::bigint, i.vat_rate), 0) AS vat
              FROM receipt_items i WHERE i.receipt_id = rc.id GROUP BY i.vat_rate) g) AS vat_groups,
       EXISTS (SELECT 1 FROM receipt_items i WHERE i.receipt_id = rc.id AND i.vat_rate IS NULL) AS has_outside_vat
FROM receipts rc
JOIN v_receipt_list l ON l.id = rc.id
LEFT JOIN receipts o ON o.id = rc.corrects_receipt_id;

-- Potwierdzenie przejazdu (RENTAL_CONFIRMATION): czasy, dystans, kwoty z rozliczeniem, cennik z chwili startu,
-- strefa i współrzędne początku i końca (adres z odwrotnego wyszukiwania dokłada zadanie) i oś czasu.
CREATE VIEW v_doc_rental AS
SELECT d.id AS rental_id, d.number, d.state, d.user_id, d.user_name, d.user_phone,
       d.scooter_id, d.scooter_number, s.variant AS scooter_variant, m.name AS model_name,
       d.tariff_id, d.tariff_version, t.unlock_fee, t.minute_rate, t.pause_minute_rate, t.vat_rate,
       d.reserved_at, d.started_at, d.ended_at, d.ride_seconds, d.pause_seconds, d.distance_m,
       d.total_amount, d.towing_fee, d.end_mode, d.payment_source, d.card_brand, d.card_last4,
       d.settlement, d.paid_amount, d.refunded_amount, d.receipt_id, d.receipt_number,
       ST_Y(r.start_position) AS start_lat, ST_X(r.start_position) AS start_lon,
       ST_Y(r.end_position) AS end_lat, ST_X(r.end_position) AS end_lon,
       sz.code AS start_zone_code, sz.name AS start_zone_name, d.end_zone_code, d.end_zone_name,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('at', tl.at, 'kind', tl.kind, 'type', tl.type,
                                                     'fromState', tl.from_state, 'toState', tl.to_state,
                                                     'zoneCode', tl.zone_code, 'commandStatus', tl.command_status)
                                  ORDER BY tl.at, tl.event_id NULLS LAST), '[]')
        FROM v_rental_timeline tl WHERE tl.rental_id = d.id) AS timeline
FROM v_rental_details d
JOIN rentals r ON r.id = d.id
JOIN scooters s ON s.id = d.scooter_id
JOIN scooter_models m ON m.id = s.model_id
JOIN tariffs t ON t.id = d.tariff_id
LEFT JOIN LATERAL (
    SELECT z.code, z.name FROM zones z
    WHERE z.type = 'PARKING' AND r.start_position IS NOT NULL AND ST_Contains(z.geom, r.start_position)
    ORDER BY z.active DESC, z.code LIMIT 1
) sz ON true;

-- Protokół zadania serwisowego (SERVICE_PROTOCOL): części z kosztem z chwili użycia, notatka, wykonawca,
-- zgłoszenie, skutek dla hulajnogi (stan, przyczyna, przeszkody powrotu do floty) i wpisy dziennika zadania.
CREATE VIEW v_doc_service_task AS
SELECT l.id AS task_id, l.number, l.type, l.status, l.priority, l.description, l.result_note, l.cancel_reason,
       l.scooter_id, l.scooter_number, s.serial_number, s.variant AS scooter_variant, m.name AS model_name,
       s.odometer_m, s.status AS scooter_status, s.status_reason AS scooter_status_reason,
       fn_scooter_return_blockers(s.id) AS scooter_return_blockers,
       l.assignee_id, l.assignee_name, l.created_by_name, l.cancelled_by_name,
       l.ticket_id, l.ticket_number, l.ticket_categories, tk.description AS ticket_description,
       l.target_zone_code, l.target_zone_name, l.due_at, l.created_at, l.started_at, l.completed_at,
       l.parts_count, l.parts_cost,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('sku', p.sku, 'name', p.name, 'quantity', p.quantity,
                                                     'unitCost', p.unit_cost, 'amount', p.amount) ORDER BY p.sku), '[]')
        FROM v_service_task_parts p WHERE p.task_id = l.id) AS parts,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'actor', a.actor,
                                                     'staffName', sf.name, 'data', a.data) ORDER BY a.created_at, a.id), '[]')
        FROM audit_log a LEFT JOIN staff sf ON sf.id = a.staff_id
        WHERE a.entity_type = 'service_task' AND a.entity_id = l.id) AS timeline
FROM v_service_task_list l
JOIN scooters s ON s.id = l.scooter_id
JOIN scooter_models m ON m.id = s.model_id
LEFT JOIN tickets tk ON tk.id = l.ticket_id;

-- Karta hulajnogi (SCOOTER_CARD): dane, model, przebieg, przejazdy, zadania i zgłoszenia (od najnowszych;
-- okres `historyDays` wybiera build). Adres `/h/{numer}` składa core z `PUBLIC_SITE_URL`.
CREATE VIEW v_doc_scooter AS
SELECT s.id AS scooter_id, s.number, s.serial_number, s.variant, s.status, s.status_reason, s.firmware,
       s.odometer_m, s.created_at,
       m.code AS model_code, m.name AS model_name, m.manufacturer, m.max_speed_kmh, m.range_km, m.battery_wh, m.weight_kg,
       (SELECT count(*)::integer FROM rentals r WHERE r.scooter_id = s.id AND r.state IN ('ENDED', 'UNPAID')) AS rentals_total,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', st.id, 'number', st.number, 'type', st.type,
                                                     'status', st.status, 'priority', st.priority,
                                                     'createdAt', st.created_at, 'completedAt', st.completed_at,
                                                     'resultNote', st.result_note, 'assigneeName', st.assignee_name,
                                                     'partsCost', st.parts_cost) ORDER BY st.created_at DESC), '[]')
        FROM v_service_task_list st WHERE st.scooter_id = s.id) AS service_tasks,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'status', t.status,
                                                     'categories', t.categories, 'source', t.source, 'urgent', t.urgent,
                                                     'createdAt', t.created_at, 'resolvedAt', t.resolved_at)
                                  ORDER BY t.created_at DESC), '[]')
        FROM tickets t WHERE t.scooter_id = s.id) AS tickets,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('endedAt', r.ended_at, 'distanceM', r.distance_m,
                                                     'rideSeconds', r.ride_seconds) ORDER BY r.ended_at DESC), '[]')
        FROM rentals r WHERE r.scooter_id = s.id AND r.state IN ('ENDED', 'UNPAID')) AS rentals
FROM scooters s
JOIN scooter_models m ON m.id = s.model_id;

-- Raport zdarzenia (INCIDENT_REPORT, bez szablonu startowego): przebieg z osi czasu zgłoszenia, odpowiedź dla
-- klienta i zdjęcia jako liczba i daty (bez obrazów, D5).
CREATE VIEW v_doc_ticket AS
SELECT l.id AS ticket_id, l.number, l.status, l.urgent, l.categories, l.source, l.auto_kind, l.description,
       l.scooter_id, l.scooter_number, l.rental_id, l.rental_number,
       l.reported_by, l.reporter_name, l.reporter_phone, l.assignee_name,
       l.customer_reply, l.customer_reply_at, l.resolution_note, l.refunded_amount,
       l.created_at, l.resolved_at, l.photos,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('position', p.position, 'uploadedAt', f.created_at,
                                                     'status', f.status, 'deletedAt', f.deleted_at) ORDER BY p.position), '[]')
        FROM ticket_photos p JOIN files f ON f.id = p.file_id WHERE p.ticket_id = l.id) AS photo_list,
       (SELECT COALESCE(jsonb_agg(jsonb_build_object('at', tl.at, 'kind', tl.kind, 'action', tl.action,
                                                     'actor', tl.actor, 'staffName', tl.staff_name, 'data', tl.data)
                                  ORDER BY tl.at, tl.kind_order, tl.seq), '[]')
        FROM v_ticket_timeline tl WHERE tl.ticket_id = l.id) AS timeline
FROM v_ticket_list l;

-- Potwierdzenie korekty salda (WALLET_ADJUSTMENT, bez szablonu startowego): wpis księgi korekty albo zwrotu
-- na portfel z saldem przed i po, operatorem, powodem i dokumentem.
CREATE VIEW v_doc_wallet_adjustment AS
SELECT l.id AS entry_id, l.created_at, l.user_id, l.user_name, l.user_phone, l.type, l.amount,
       l.balance_after - l.amount AS balance_before, l.balance_after, l.reason, l.note,
       l.staff_id, l.staff_name, l.rental_id, l.rental_number, l.refund_id, l.refund_reason,
       l.receipt_id, l.receipt_number
FROM v_wallet_ledger l
WHERE l.type IN ('ADJUSTMENT', 'REFUND');
