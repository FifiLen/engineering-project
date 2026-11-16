-- 0004: konta i dostęp (iteracja 2): sesje i zaproszenia operatorów, blokada kont, rotacja tokenów
-- odświeżających, zgody na wersje dokumentów, dziennik audytu w panelu (ADR 0019, ADR 0028).
-- Reguły (limity prób, czas blokady, ważność zaproszenia) są w packages/core; baza pilnuje spójności.

CREATE TYPE block_reason AS ENUM ('TERMS_VIOLATION', 'UNPAID_BALANCE', 'SUSPECTED_ABUSE');

-- =====================================================================
-- Klienci: blokada z powodem widocznym dla klienta (notatka operatora jest tylko w audit_log)
-- =====================================================================

ALTER TABLE users ADD COLUMN blocked_at     timestamptz,
                  ADD COLUMN blocked_reason block_reason;
UPDATE users SET blocked_at = updated_at, blocked_reason = 'TERMS_VIOLATION' WHERE status = 'BLOCKED';
ALTER TABLE users ADD CONSTRAINT users_block_consistent
    CHECK ((status = 'BLOCKED') = (blocked_at IS NOT NULL) AND (blocked_at IS NULL) = (blocked_reason IS NULL));

-- =====================================================================
-- Sesje klientów: każdy token odświeżający to osobny wiersz; rotacja tworzy następcę w tej samej
-- rodzinie, a ponowne użycie zastąpionego tokenu unieważnia całą rodzinę (kradzież tokenu).
-- =====================================================================

ALTER TABLE sessions ADD COLUMN family_id    uuid NOT NULL DEFAULT gen_random_uuid(),
                     ADD COLUMN replaced_by  uuid REFERENCES sessions(id),
                     ADD COLUMN last_used_at timestamptz;
ALTER TABLE sessions ADD CONSTRAINT sessions_replaced_is_revoked CHECK (replaced_by IS NULL OR revoked_at IS NOT NULL);
CREATE INDEX sessions_family_idx ON sessions (family_id);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Zgoda na tę samą wersję dokumentu zapisana dwa razy to powtórzone żądanie, nie nowa zgoda.
CREATE UNIQUE INDEX consents_one_active_per_version ON consents (user_id, type, document_version)
    WHERE revoked_at IS NULL;

-- „Najważniejsze zmiany” pokazywane klientowi przy ponownej akceptacji.
ALTER TABLE content_page_versions ADD COLUMN change_summary text;

-- =====================================================================
-- Operatorzy: zaproszenie zamiast hasła nadanego przez administratora, TOTP potwierdzony kodem,
-- blokada po nieudanych próbach logowania
-- =====================================================================

ALTER TABLE staff ALTER COLUMN password_hash DROP NOT NULL;        -- NULL do przyjęcia zaproszenia
ALTER TABLE staff ADD COLUMN totp_confirmed_at timestamptz,
                  ADD COLUMN totp_last_step    bigint,              -- ostatni użyty krok TOTP (bez powtórzeń kodu)
                  ADD COLUMN failed_logins     smallint NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
                  ADD COLUMN locked_until      timestamptz,
                  ADD COLUMN last_login_at     timestamptz;
-- Operatorzy sprzed tej migracji mieli sekret TOTP ustawiony bez potwierdzenia; traktujemy go jako potwierdzony.
UPDATE staff SET totp_confirmed_at = created_at WHERE totp_secret_enc IS NOT NULL;
ALTER TABLE staff ADD CONSTRAINT staff_totp_confirmed_has_secret
    CHECK (totp_confirmed_at IS NULL OR totp_secret_enc IS NOT NULL);

CREATE TABLE staff_invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id        uuid NOT NULL REFERENCES staff(id),
    token_hash      text NOT NULL UNIQUE,
    invited_by      uuid REFERENCES staff(id),                      -- NULL: polecenie w terminalu
    expires_at      timestamptz NOT NULL,
    accepted_at     timestamptz,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(accepted_at, revoked_at) <= 1),
    CHECK (expires_at > created_at)
);
-- Ponowne zaproszenie unieważnia poprzednie: operator ma najwyżej jedno otwarte zaproszenie.
CREATE UNIQUE INDEX staff_invitations_one_open ON staff_invitations (staff_id)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Sesje panelu: token odświeżający w ciasteczku httpOnly, ta sama rotacja co w sesjach klientów.
CREATE TABLE staff_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id            uuid NOT NULL REFERENCES staff(id),
    family_id           uuid NOT NULL DEFAULT gen_random_uuid(),
    refresh_token_hash  text NOT NULL UNIQUE,
    user_agent          text,
    replaced_by         uuid REFERENCES staff_sessions(id),
    expires_at          timestamptz NOT NULL,
    last_used_at        timestamptz,
    revoked_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (replaced_by IS NULL OR revoked_at IS NOT NULL)
);
CREATE INDEX staff_sessions_family_idx ON staff_sessions (family_id);
CREATE INDEX staff_sessions_staff_active_idx ON staff_sessions (staff_id) WHERE revoked_at IS NULL;

-- =====================================================================
-- Dziennik audytu: historia rekordu w formularzu, lista z filtrami w panelu
-- =====================================================================

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_staff_idx ON audit_log (staff_id, created_at DESC);

-- =====================================================================
-- Ostatni operator zarządzający rolami (ADR 0028)
-- =====================================================================

-- Jeśli istnieje choć jedno konto operatora, co najmniej jeden aktywny operator musi mieć roles.manage;
-- inaczej panelem nie da się już zarządzać (dotyczy też dezaktywacji ostatniego aktywnego operatora). Core odrzuca taką zmianę wcześniej z czytelnym błędem, a wyzwalacz odroczony do końca
-- transakcji chroni przed równoległymi zmianami dwóch administratorów.
CREATE FUNCTION fn_check_role_manager() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM staff)
       AND NOT EXISTS (SELECT 1 FROM v_staff_permissions WHERE permission_code = 'roles.manage') THEN
        RAISE EXCEPTION 'LAST_ROLE_MANAGER' USING ERRCODE = 'check_violation',
            DETAIL = 'Co najmniej jeden aktywny operator musi mieć uprawnienie roles.manage';
    END IF;
    RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER staff_role_manager_check AFTER UPDATE OF active ON staff
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_check_role_manager();
CREATE CONSTRAINT TRIGGER staff_roles_role_manager_check AFTER UPDATE OR DELETE ON staff_roles
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_check_role_manager();
CREATE CONSTRAINT TRIGGER role_permissions_role_manager_check AFTER UPDATE OR DELETE ON role_permissions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_check_role_manager();

-- =====================================================================
-- Widoki list w panelu (ADR 0031)
-- =====================================================================

-- Lista operatorów: kolumny dopisane na końcu (CREATE OR REPLACE nie pozwala zmienić kolejności).
-- totp_enabled oznacza teraz TOTP potwierdzony kodem, a nie sam zapisany sekret.
CREATE OR REPLACE VIEW v_staff_overview AS
SELECT s.id, s.email, s.name, s.active, s.totp_confirmed_at IS NOT NULL AS totp_enabled,
       COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}') AS roles,
       s.created_at, s.updated_at,
       CASE WHEN NOT s.active THEN 'DEACTIVATED'
            WHEN s.password_hash IS NULL THEN 'INVITED'
            ELSE 'ACTIVE' END AS status,
       s.last_login_at,
       s.locked_until,
       COALESCE(array_agg(r.id ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '{}') AS role_ids,
       (SELECT count(*) FROM staff_sessions ss
         WHERE ss.staff_id = s.id AND ss.revoked_at IS NULL AND ss.expires_at > now()) AS active_sessions,
       (SELECT max(i.expires_at) FROM staff_invitations i
         WHERE i.staff_id = s.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL) AS invitation_expires_at,
       s.version
FROM staff s
LEFT JOIN staff_roles sr ON sr.staff_id = s.id
LEFT JOIN roles r ON r.id = sr.role_id
GROUP BY s.id;

-- Lista ról z liczbą uprawnień i aktywnych operatorów.
CREATE VIEW v_roles_overview AS
SELECT r.id, r.name, r.description, r.is_system, r.created_at, r.updated_at, r.version,
       (SELECT count(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permissions_count,
       (SELECT count(*) FROM staff_roles sr JOIN staff s ON s.id = sr.staff_id AND s.active
         WHERE sr.role_id = r.id) AS staff_count
FROM roles r;

-- Lista klientów: kolumny dopisane na końcu v_user_activity.
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
       (SELECT max(s.last_used_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
FROM users u
LEFT JOIN (
    SELECT user_id, count(*) AS rides, max(ended_at) AS last_ride_at, sum(total_amount)::bigint AS spent
    FROM rentals WHERE state = 'ENDED' GROUP BY user_id
) r ON r.user_id = u.id
LEFT JOIN wallets w ON w.user_id = u.id;

-- Ostatnia zgoda klienta każdego rodzaju (także wycofana) i to, czy dotyczy obowiązującej wersji dokumentu.
-- Rodzaje bez dokumentu (wiek, marketing) są zawsze aktualne.
CREATE VIEW v_user_consents AS
SELECT DISTINCT ON (c.user_id, c.type)
       c.user_id, c.type, c.id AS consent_id, c.document_version, c.page_version_id,
       v.version_no, c.accepted_at, c.revoked_at,
       cur.version_id AS current_version_id, cur.version_no AS current_version_no,
       c.revoked_at IS NULL AND (cur.version_id IS NULL OR c.page_version_id = cur.version_id) AS is_current
FROM consents c
LEFT JOIN content_page_versions v ON v.id = c.page_version_id
LEFT JOIN v_current_documents cur ON cur.consent_type = c.type
ORDER BY c.user_id, c.type, c.accepted_at DESC;

-- Dziennik audytu z autorem.
CREATE VIEW v_audit_log AS
SELECT a.id, a.created_at, a.staff_id, s.name AS staff_name, s.email AS staff_email,
       a.action, a.entity_type, a.entity_id, a.data
FROM audit_log a
JOIN staff s ON s.id = a.staff_id;

-- =====================================================================
-- Funkcje i procedury (ADR 0026)
-- =====================================================================

-- Obowiązujące dokumenty wymagające zgody, których aktualnej wersji klient nie zaakceptował
-- (ekran ponownej akceptacji w aplikacji).
CREATE FUNCTION fn_user_pending_documents(p_user_id uuid)
RETURNS TABLE (consent_type consent_type, slug text, version_id uuid, version_no integer, title text,
               change_summary text)
LANGUAGE sql STABLE AS $$
    SELECT d.consent_type, d.slug, d.version_id, d.version_no, d.title, v.change_summary
    FROM v_current_documents d
    JOIN content_page_versions v ON v.id = d.version_id
    WHERE d.consent_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM consents c
                      WHERE c.user_id = p_user_id AND c.type = d.consent_type
                        AND c.page_version_id = d.version_id AND c.revoked_at IS NULL)
    ORDER BY d.consent_type
$$;

-- Wylogowanie klienta ze wszystkich urządzeń (blokada konta, zmiana numeru, decyzja operatora).
CREATE PROCEDURE sp_revoke_user_sessions(p_user_id uuid, OUT revoked_count integer)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE sessions SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
    GET DIAGNOSTICS revoked_count = ROW_COUNT;
END
$$;

-- Wylogowanie operatora ze wszystkich urządzeń (dezaktywacja, zmiana e-maila, reset TOTP).
CREATE PROCEDURE sp_revoke_staff_sessions(p_staff_id uuid, OUT revoked_count integer)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE staff_sessions SET revoked_at = now() WHERE staff_id = p_staff_id AND revoked_at IS NULL;
    GET DIAGNOSTICS revoked_count = ROW_COUNT;
END
$$;
