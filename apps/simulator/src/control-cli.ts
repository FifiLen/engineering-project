/**
 * Polecenie `pnpm --filter @hulajnogi/simulator control` (ADR 0039, ADR 0046): zmienia plik sterujący,
 * który uruchomiony symulator sprawdza co sekundę. Bez argumentów wypisuje bieżący stan.
 *
 *   control offline 0142 7      rozłącza hulajnogi (broker publikuje Last Will)
 *   control silent 27           hulajnoga wykonuje komendy, ale nie wysyła potwierdzeń
 *   control online 0142 27      usuwa numery z list offline i silent
 *   control goto 0142 Z-01      następna trasa hulajnogi prowadzi do anchor strefy o kodzie
 *   control goto 0142 50.1,18.6 następna trasa prowadzi do punktu (lat,lon), np. poza obszar działania
 */
import { loadConfig, loadRootEnv } from './config.js';
import { applyControl, applyGoto, parseTarget, readControl, writeControl, type ControlState } from './control.js';

const actions = ['offline', 'silent', 'online'] as const;
type Action = (typeof actions)[number];

const usage = [
  'Użycie:',
  '  control                                   bieżący stan',
  '  control offline|silent|online <numer...>  awarie, np. control offline 0142',
  '  control goto <numer> <kod strefy|lat,lon> cel następnej trasy (jednorazowy), np. control goto 0142 Z-01',
].join('\n');

loadRootEnv();
const path = loadConfig().SIM_CONTROL_FILE;
const [action, ...args] = process.argv.slice(2);
const print = (state: ControlState) => {
  const targets = Object.entries(state.goto).map(([n, target]) => `${n} → ${target}`);
  console.log(
    `Offline: ${state.offline.join(', ') || 'brak'}\nBez potwierdzeń: ${state.silent.join(', ') || 'brak'}\n` +
      `Cele następnej trasy: ${targets.join(', ') || 'brak'}\n(${path})`,
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
