/**
 * Polecenie `pnpm --filter @hulajnogi/simulator control` (ADR 0039, ADR 0046, ADR 0059): zmienia plik
 * sterujący, który uruchomiony symulator sprawdza co sekundę i zamienia na polecenia scenariuszy, te same
 * co z panelu. Na hulajnodze działa jeden scenariusz naraz; odrzucone polecenie (np. `SCENARIO_ACTIVE`)
 * widać w logu symulatora i w stanie na `simulator/status`. Bez argumentów wypisuje bieżący stan pliku.
 *
 *   control offline 0142 7      rozłącza hulajnogi (broker publikuje Last Will)
 *   control silent 27           hulajnoga wykonuje komendy, ale nie wysyła potwierdzeń
 *   control online 0142 27      usuwa numery z list offline i silent (powrót łączności, potwierdzenia)
 *   control goto 0142 Z-01      hulajnoga jedzie do anchor strefy o kodzie (od razu albo po odblokowaniu)
 *   control goto 0142 50.1,18.6 jazda do punktu (lat,lon), np. poza obszar działania
 */
import { loadConfig, loadRootEnv } from './config.js';
import { applyControl, applyGoto, parseTarget, readControl, writeControl, type ControlState } from './control.js';

const actions = ['offline', 'silent', 'online'] as const;
type Action = (typeof actions)[number];

const usage = [
  'Użycie:',
  '  control                                   bieżący stan',
  '  control offline|silent|online <numer...>  awarie, np. control offline 0142',
  '  control goto <numer> <kod strefy|lat,lon> jazda do celu (jednorazowo), np. control goto 0142 Z-01',
].join('\n');

loadRootEnv();
const path = loadConfig().SIM_CONTROL_FILE;
const [action, ...args] = process.argv.slice(2);
const print = (state: ControlState) => {
  const targets = Object.entries(state.goto).map(([n, target]) => `${n} → ${target}`);
  console.log(
    `Offline: ${state.offline.join(', ') || 'brak'}\nBez potwierdzeń: ${state.silent.join(', ') || 'brak'}\n` +
      `Cele do wykonania: ${targets.join(', ') || 'brak'}\n(${path}; wynik w logu symulatora)`,
  );
};
const fail = (): never => {
  console.error(usage);
  process.exit(1);
};
const scooterNumber = (arg: string | undefined) => (arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : NaN);

if (action === undefined) {
  print(readControl(path));
} else if (action === 'goto') {
  const [id, ...rest] = args;
  const number = scooterNumber(id);
  // „50.1, 18.6” ze spacją przychodzi jako dwa argumenty.
  const target = rest.join('');
  if (!Number.isInteger(number) || number < 1 || !parseTarget(target)) fail();
  const next = applyGoto(readControl(path), number, target);
  writeControl(path, next);
  print(next);
} else {
  const ids = args.map(scooterNumber);
  if (!actions.includes(action as Action) || !ids.length || ids.some((n) => !Number.isInteger(n) || n < 1)) fail();
  const next = applyControl(readControl(path), action as Action, ids);
  writeControl(path, next);
  print(next);
}
