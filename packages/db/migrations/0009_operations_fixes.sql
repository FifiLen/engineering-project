-- 0009: poprawki po przeglądzie iteracji 6 (ADR 0055–0058): przyczyna stanu hulajnogi zgodna ze stanem przy każdej
-- zmianie stanu, otwarte pilne zgłoszenie jako przeszkoda powrotu do floty, jedno przypięcie pliku, przejęcie
-- powiadomienia przed wysyłką i szablony wszystkich kodów z rejestru, żeby baza po samym `db:migrate` wysyłała
-- SMS z kodem logowania. Migracja 0008 jest wykonana, więc zmiany jej obiektów idą tu (CREATE OR REPLACE).

-- =====================================================================
-- Hulajnogi: przyczyna stanu przy zmianie stanu bez jawnej przyczyny (B)
-- =====================================================================

-- Jak w 0008, a do tego: zmiana stanu bez jawnej zmiany przyczyny (formularz floty, procedury, ręczny UPDATE)
-- dostaje przyczynę zgodną z nowym stanem zamiast błędu `scooters_status_reason_matches`. Wejście do MAINTENANCE
-- albo RETIRED z przyczyną spoza dozwolonych dla tego stanu albo bez przyczyny daje `OTHER` (np. wycofana
-- po kradzieży i przywrócona do serwisu); poza tymi stanami przyczyna znika. Jawną przyczynę (API, okno
-- „Wyłącz z ruchu”) sprawdza dalej CHECK.
CREATE OR REPLACE FUNCTION trg_scooter_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    hold      scooter_status_reason;
    last_ride uuid;
    implicit  boolean := NEW.status_reason IS NOT DISTINCT FROM OLD.status_reason;
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status IN ('RESERVED', 'IN_USE') AND NEW.status = 'AVAILABLE' THEN
        hold := fn_scooter_service_hold(NEW.id);
        IF hold IS NOT NULL THEN
            NEW.status := 'MAINTENANCE';
            NEW.status_reason := hold;
            implicit := false;
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
    ELSIF implicit AND (NEW.status_reason IS NULL
            OR (NEW.status = 'MAINTENANCE' AND NEW.status_reason NOT IN ('URGENT_TICKET', 'SERVICE_TASK',
                                                                         'BATTERY_BELOW_THRESHOLD', 'OFFLINE', 'OTHER'))
            OR (NEW.status = 'RETIRED' AND NEW.status_reason NOT IN ('THEFT', 'DAMAGE', 'END_OF_LIFE', 'OTHER'))) THEN
        NEW.status_reason := 'OTHER';
    END IF;
    RETURN NEW;
END
$$;

-- =====================================================================
-- Powrót do floty: otwarte pilne zgłoszenie jest przeszkodą (C)
-- =====================================================================

-- Te same kody i ta sama kolejność co `returnToFleetBlockers` w core: pilne zgłoszenie (hamulce, koło, kierownica)
-- bez zadania zatrzymuje hulajnogę także przy „Przywróć do floty”. Pierwsza przeszkoda wyznacza przyczynę stanu.
CREATE OR REPLACE FUNCTION fn_scooter_return_blockers(p_scooter_id uuid) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN EXISTS (SELECT 1 FROM tickets t
                          WHERE t.scooter_id = s.id AND t.urgent AND t.status <> 'RESOLVED') THEN 'URGENT_TICKET' END,
        CASE WHEN EXISTS (SELECT 1 FROM service_tasks st
                          WHERE st.scooter_id = s.id AND st.status IN ('OPEN', 'IN_PROGRESS')) THEN 'OPEN_TASKS' END,
        CASE WHEN NOT s.online THEN 'OFFLINE' END,
        CASE WHEN COALESCE(s.battery_pct, 0) < fn_low_battery_threshold() THEN 'BATTERY_BELOW_THRESHOLD' END
    ], NULL)
    FROM scooters s WHERE s.id = p_scooter_id
$$;

-- =====================================================================
-- Pliki: jedno przypięcie pliku (E)
-- =====================================================================

-- Zdjęcie parkowania w jednym przejeździe i zdjęcie zgłoszenia w jednym zgłoszeniu. Blokada wiersza pliku
-- w API wyklucza wyścig przypięcia, a indeksy unikalne są ostatnią linią obrony (błąd `FILE_ALREADY_ATTACHED`).
-- Zastępują zwykłe indeksy z 0008 na tych samych kolumnach.
DROP INDEX rentals_parking_photo_idx;
CREATE UNIQUE INDEX rentals_parking_photo_unique ON rentals (parking_photo_id) WHERE parking_photo_id IS NOT NULL;
DROP INDEX ticket_photos_file_idx;
CREATE UNIQUE INDEX ticket_photos_file_unique ON ticket_photos (file_id);

-- =====================================================================
-- Powiadomienia: przejęcie przed wysyłką (H)
-- =====================================================================

-- `notification.send` i `notifications.sweep` przejmują wiersz `QUEUED` jednym UPDATE przed wysyłką, więc ten sam
-- push nie idzie dwa razy. Przejęcie starsze niż 5 min (przerwane wykonanie) może przejąć kolejne wykonanie.
ALTER TABLE notifications ADD COLUMN claimed_at timestamptz;

-- =====================================================================
-- Szablony powiadomień wszystkich kodów z rejestru (D)
-- =====================================================================

-- Treści jak `DEV_NOTIFICATION_TEMPLATES` w packages/db/src/seed.ts (ICU MessageFormat, ADR 0058). Bez nich baza po
-- samym `db:migrate` nie wyśle SMS z kodem (`TEMPLATE_MISSING`) i klient się nie zaloguje. Istniejący szablon zostaje
-- bez zmian; wersję 1 zapisuje wyzwalacz `notification_templates_version`.
INSERT INTO notification_templates (code, channel, title, body, description) VALUES
    ('reservation_ending', 'PUSH', 'Rezerwacja się kończy',
     $t$Rezerwacja hulajnogi {scooterNumber} wygasa za {minutesLeft, plural, one {# minutę} few {# minuty} many {# minut} other {# minuty}}. Zeskanuj kod QR, żeby ruszyć.$t$,
     $t$Wysyłany przed końcem bezpłatnej rezerwacji, gdy klient ma włączone „Koniec rezerwacji”. Parametry: scooterNumber, minutesLeft.$t$),
    ('ride_ended', 'PUSH', 'Przejazd zakończony',
     $t$Przejazd {rideNumber} trwał {minutes, plural, one {# minutę} few {# minuty} other {# minut}}. Koszt: {amount}{hasTowingFee, select, true { (odholowanie {towingFee})} other {}}. {hasReceipt, select, true {Paragon w aplikacji.} other {}}$t$,
     $t$Wysyłany po rozliczeniu przejazdu, gdy klient ma włączone „Paragony”. Parametry: rideNumber, minutes, amount, hasReceipt, towingFee, hasTowingFee.$t$),
    ('payment_failed', 'PUSH', 'Płatność nieudana',
     $t$Nie udało się pobrać {amount} za przejazd {rideNumber}. Spłać zaległość w aplikacji, żeby wypożyczyć kolejną hulajnogę.$t$,
     $t$Wysyłany po odmowie obciążenia karty za przejazd (zaległość). Parametry: rideNumber, amount.$t$),
    ('battery_low', 'PUSH', 'Niska bateria',
     $t$Bateria hulajnogi {scooterNumber}: {batteryPct}%. Zakończ przejazd w najbliższej strefie parkowania.$t$,
     $t$Wysyłany w trakcie jazdy po spadku baterii poniżej progu z cennika. Parametry: scooterNumber, batteryPct.$t$),
    ('ticket_received', 'PUSH', 'Otrzymaliśmy zgłoszenie',
     $t$Zgłoszenie {ticketNumber} dotyczące hulajnogi {scooterNumber} jest u nas. Damy znać, gdy coś się zmieni.$t$,
     $t$Wysyłany po przyjęciu zgłoszenia od klienta. Parametry: ticketNumber, scooterNumber.$t$),
    ('ticket_status_changed', 'PUSH', 'Twoje zgłoszenie',
     $t$Zgłoszenie {ticketNumber}: {status, select, IN_PROGRESS {zajmujemy się nim} AT_SERVICE {hulajnoga jest w serwisie} RESOLVED {rozwiązane} other {nowy status}}. {reply}$t$,
     $t$Wysyłany przy zmianie statusu zgłoszenia z odpowiedzią dla klienta. Parametry: ticketNumber, status, reply.$t$),
    ('login_code', 'SMS', NULL,
     $t$[nazwa]: {code} to Twój kod logowania. Nie podawaj go nikomu.$t$,
     $t$SMS z kodem logowania do aplikacji. Parametry: code.$t$)
ON CONFLICT (code, channel) DO NOTHING;
