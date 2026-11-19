import { parseArgs } from 'node:util';
import { Pool } from 'pg';
import { checkHistory } from '../history/checks.js';
import { generateHistory, HistoryRefusedError } from '../history/generator.js';
import { databaseUrl } from './env.js';

/**
 * Dane historyczne do demonstracji (ADR 0075), tylko na świeżej bazie po migracjach i danych startowych:
 *   pnpm db:history [--days 90] [--rides-per-day 200] [--seed 2026]
 * Usunięcie danych to nowa baza (migracje, `SEED_SAMPLE_RENTALS=0 pnpm db:seed`, generator).
 */
async function main() {
  const { values } = parseArgs({
    options: {
      days: { type: 'string', default: '90' },
      'rides-per-day': { type: 'string', default: '200' },
      seed: { type: 'string', default: '2026' },
    },
  });
  const days = Number(values.days);
  const ridesPerDay = Number(values['rides-per-day']);
  const seed = Number(values.seed);
  if (!Number.isInteger(days) || !Number.isFinite(ridesPerDay) || !Number.isInteger(seed)) {
    console.error('Użycie: pnpm db:history [--days 90] [--rides-per-day 200] [--seed 2026]');
    process.exit(1);
  }
  const url = new URL(databaseUrl());
  console.log(`Baza: ${url.host}${url.pathname}; ${days} dób, ok. ${ridesPerDay} przejazdów na dobę, ziarno ${seed}.`);
  const pool = new Pool({ connectionString: url.toString() });
  try {
    const summary = await generateHistory(pool, {
      days,
      ridesPerDay,
      seed,
      nodeEnv: process.env.NODE_ENV,
      onDay: ({ day, index, total, rides }) => {
        if (index % 10 === 9 || index === total - 1)
          console.log(`  doba ${index + 1}/${total} (${day}): ${rides} przejazdów`);
      },
    });
    const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16);
    console.log(`\nOkno: ${fmt(summary.windowFrom)} – ${fmt(summary.windowTo)} UTC (${summary.days} dób).`);
    if (summary.tariff) {
      console.log(
        `Cennik: wersja ${summary.tariff.version} obowiązuje od ${fmt(summary.tariff.validFrom)} (było ${fmt(summary.tariff.previousValidFrom)}).`,
      );
    }
    console.log('\nWstawione wiersze:');
    for (const [table, count] of Object.entries(summary.rows).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${table.padEnd(24)} ${String(count).padStart(8)}`);
    }
    console.log('\nSymulacja:');
    for (const [key, count] of Object.entries(summary.stats).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${key.padEnd(32)} ${String(count).padStart(8)}`);
    }
    console.log(`\nCzas generowania: ${(summary.elapsedMs / 1000).toFixed(1)} s.`);

    const checks = await checkHistory(pool);
    console.log('\nKontrola spójności:');
    for (const check of checks)
      console.log(
        `  ${check.violations === 0 ? 'OK ' : 'BŁĄD'} ${check.name}${check.violations ? ` (${check.violations})` : ''}`,
      );
    if (checks.some((c) => c.violations > 0)) process.exitCode = 1;
  } catch (error) {
    if (error instanceof HistoryRefusedError) {
      console.error(`Nie wygenerowano danych: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
