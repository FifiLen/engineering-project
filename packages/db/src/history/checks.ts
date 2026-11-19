import type { Pool } from 'pg';

/**
 * Kontrola spójności danych po generatorze historii (ADR 0075). Każde sprawdzenie liczy wiersze naruszające regułę
 * (0 = zgodne); część reguł pilnuje też baza, ale kontrola sprawdza je wprost, żeby wynik był widoczny w terminalu
 * i w teście. Działa na całej bazie, więc obejmuje też dane startowe.
 */
export interface HistoryCheck {
  name: string;
  violations: number;
}

const CHECKS: ReadonlyArray<readonly [string, string]> = [
  [
    'saldo portfela (wallets.balance) równe ostatniemu balance_after i sumie księgi',
    `SELECT count(*) FROM wallets w
     LEFT JOIN LATERAL (SELECT l.balance_after FROM wallet_ledger l WHERE l.user_id = w.user_id ORDER BY l.id DESC LIMIT 1) last ON true
     LEFT JOIN LATERAL (SELECT COALESCE(sum(l.amount), 0) AS total FROM wallet_ledger l WHERE l.user_id = w.user_id) s ON true
     WHERE w.balance <> COALESCE(last.balance_after, 0) OR w.balance <> s.total`,
  ],
  [
    'wpisy księgi klienta w kolejności czasu (identyfikator rośnie z created_at)',
    `SELECT count(*) FROM (
       SELECT created_at < lag(created_at) OVER (PARTITION BY user_id ORDER BY id) AS bad FROM wallet_ledger) x
     WHERE bad`,
  ],
  [
    'balance_after = poprzednie saldo + kwota',
    `SELECT count(*) FROM (
       SELECT balance_after <> COALESCE(lag(balance_after) OVER (PARTITION BY user_id ORDER BY id), 0) + amount AS bad
       FROM wallet_ledger) x
     WHERE bad`,
  ],
  [
    'przejazd ENDED z kwotą ma jeden paragon sprzedaży z tą kwotą',
    `SELECT count(*) FROM rentals r
     WHERE r.state = 'ENDED' AND r.total_amount > 0
       AND (SELECT count(*) FROM receipts rc WHERE rc.rental_id = r.id AND rc.kind = 'SALE' AND rc.total_amount = r.total_amount) <> 1`,
  ],
  [
    'przejazd UNPAID bez paragonu sprzedaży',
    `SELECT count(*) FROM rentals r
     WHERE r.state = 'UNPAID' AND EXISTS (SELECT 1 FROM receipts rc WHERE rc.rental_id = r.id AND rc.kind = 'SALE')`,
  ],
  [
    'suma paragonów z portfela = obciążenia portfela za przejazdy (RIDE_CHARGE i TOWING_FEE)',
    `SELECT CASE WHEN (SELECT COALESCE(sum(total_amount), 0) FROM receipts WHERE kind = 'SALE' AND payment_source = 'WALLET')
                    = -(SELECT COALESCE(sum(amount), 0) FROM wallet_ledger WHERE type IN ('RIDE_CHARGE', 'TOWING_FEE'))
            THEN 0 ELSE 1 END`,
  ],
  [
    'suma paragonów kartą = udane płatności kartą za przejazdy',
    `SELECT CASE WHEN (SELECT COALESCE(sum(total_amount), 0) FROM receipts WHERE kind = 'SALE' AND payment_source = 'CARD')
                    = (SELECT COALESCE(sum(amount), 0) FROM payments WHERE purpose = 'RIDE' AND status IN ('SUCCEEDED', 'REFUNDED'))
            THEN 0 ELSE 1 END`,
  ],
  [
    'suma korekt = minus suma udanych zwrotów za przejazdy',
    `SELECT CASE WHEN (SELECT COALESCE(sum(total_amount), 0) FROM receipts WHERE kind = 'CORRECTION')
                    = -(SELECT COALESCE(sum(amount), 0) FROM refunds WHERE status = 'SUCCEEDED' AND rental_id IS NOT NULL)
            THEN 0 ELSE 1 END`,
  ],
  [
    'doładowania w księdze = udane płatności doładowania',
    `SELECT CASE WHEN (SELECT COALESCE(sum(amount), 0) FROM wallet_ledger WHERE type = 'TOPUP')
                    = (SELECT COALESCE(sum(amount), 0) FROM payments WHERE purpose = 'TOPUP' AND status IN ('SUCCEEDED', 'REFUNDED'))
            THEN 0 ELSE 1 END`,
  ],
  [
    'suma pozycji paragonu = kwota paragonu',
    `SELECT count(*) FROM receipts rc
     WHERE rc.total_amount <> (SELECT COALESCE(sum(i.amount), 0) FROM receipt_items i WHERE i.receipt_id = rc.id)`,
  ],
  [
    'numery paragonów rosną z datą wystawienia',
    `SELECT count(*) FROM (
       SELECT issued_at < lag(issued_at) OVER (ORDER BY split_part(number, '/', 3)::bigint) AS bad FROM receipts) x
     WHERE bad`,
  ],
  [
    'jeden otwarty przedział historii na hulajnogę',
    `SELECT count(*) FROM scooters s
     WHERE (SELECT count(*) FROM scooter_status_history h WHERE h.scooter_id = s.id AND h.valid_to IS NULL) <> 1`,
  ],
  [
    'przedziały historii bez nakładania się i bez luk',
    `SELECT count(*) FROM (
       SELECT valid_from <> lag(valid_to) OVER (PARTITION BY scooter_id ORDER BY valid_from, id) AS bad
       FROM scooter_status_history) x
     WHERE bad`,
  ],
  [
    'przejazd zakończony mieści się w przedziale IN_USE hulajnogi',
    `SELECT count(*) FROM rentals r
     WHERE r.started_at IS NOT NULL AND r.ended_at IS NOT NULL
       AND r.started_at >= (SELECT min(h.valid_from) FROM scooter_status_history h WHERE h.scooter_id = r.scooter_id)
       AND NOT EXISTS (SELECT 1 FROM scooter_status_history h
                       WHERE h.scooter_id = r.scooter_id AND h.status = 'IN_USE'
                         AND h.valid_from <= r.started_at AND h.valid_to >= r.ended_at)`,
  ],
  [
    'stan magazynu = suma ruchów, stock_after zgodny z kolejnością czasu',
    `SELECT (SELECT count(*) FROM spare_parts p
             WHERE p.stock_qty <> (SELECT COALESCE(sum(m.delta), 0) FROM spare_part_movements m WHERE m.part_id = p.id))
          + (SELECT count(*) FROM (
               SELECT stock_after <> sum(delta) OVER (PARTITION BY part_id ORDER BY created_at, id) AS bad
               FROM spare_part_movements) x WHERE bad)`,
  ],
  [
    'koszt części w zadaniach = ruchy USE (bez zwrotów)',
    `SELECT CASE WHEN (SELECT COALESCE(sum(quantity), 0) FROM service_task_parts)
                    = -(SELECT COALESCE(sum(delta), 0) FROM spare_part_movements WHERE kind IN ('USE', 'RETURN'))
            THEN 0 ELSE 1 END`,
  ],
];

export async function checkHistory(pool: Pool): Promise<HistoryCheck[]> {
  const results: HistoryCheck[] = [];
  for (const [name, sql] of CHECKS) {
    const { rows } = await pool.query<Record<string, unknown>>(sql);
    results.push({ name, violations: Number(Object.values(rows[0]!)[0]) });
  }
  return results;
}

/** Sumy kontrolne do porównania dwóch przebiegów z tym samym ziarnem (test determinizmu, ADR 0075). */
export async function historyFingerprint(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<Record<string, string>>(`
    SELECT (SELECT count(*) FROM rentals)::text AS rentals,
           (SELECT count(*) FROM rentals WHERE state = 'UNPAID')::text AS unpaid,
           (SELECT COALESCE(sum(total_amount), 0) FROM rentals)::text AS rentals_total,
           (SELECT COALESCE(sum(distance_m), 0) FROM rentals)::text AS distance,
           (SELECT COALESCE(sum(ride_seconds), 0) FROM rentals)::text AS ride_seconds,
           (SELECT count(*) FROM rental_events)::text AS rental_events,
           (SELECT count(*) FROM scooter_commands)::text AS commands,
           (SELECT count(*) FROM wallet_ledger)::text AS ledger,
           (SELECT COALESCE(sum(amount), 0) FROM wallet_ledger)::text AS ledger_sum,
           (SELECT count(*) FROM receipts)::text AS receipts,
           (SELECT COALESCE(sum(total_amount), 0) FROM receipts)::text AS receipts_sum,
           (SELECT COALESCE(sum(amount), 0) FROM payments WHERE status IN ('SUCCEEDED', 'REFUNDED'))::text AS payments_sum,
           (SELECT COALESCE(sum(amount), 0) FROM refunds)::text AS refunds_sum,
           (SELECT count(*) FROM tickets)::text AS tickets,
           (SELECT count(*) FROM service_tasks)::text AS tasks,
           (SELECT count(*) FROM spare_part_movements)::text AS movements,
           (SELECT count(*) FROM scooter_status_history)::text AS history,
           (SELECT COALESCE(sum(extract(epoch FROM valid_to - valid_from)), 0)::bigint
              FROM scooter_status_history WHERE status = 'IN_USE' AND valid_to IS NOT NULL)::text AS in_use_seconds,
           (SELECT count(*) FROM users)::text AS users,
           (SELECT count(*) FROM consents)::text AS consents`);
  return rows[0]!;
}
