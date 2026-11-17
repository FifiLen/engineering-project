/**
 * Polecenie `pnpm --filter @hulajnogi/simulator control` (ADR 0039): zmienia plik sterujący, który
 * uruchomiony symulator sprawdza co sekundę. Bez argumentów wypisuje bieżący stan.
 *
 *   control offline 0142 7   rozłącza hulajnogi (broker publikuje Last Will)
 *   control silent 27        hulajnoga wykonuje komendy, ale nie wysyła potwierdzeń
 *   control online 0142 27   usuwa numery z obu list
 */
import { loadConfig, loadRootEnv } from './config.js';
import { applyControl, readControl, writeControl, type ControlState } from './control.js';

const actions = ['offline', 'silent', 'online'] as const;
type Action = (typeof actions)[number];

const usage = 'Użycie: control [offline|silent|online] <numer hulajnogi...>, np. control offline 0142';

loadRootEnv();
const path = loadConfig().SIM_CONTROL_FILE;
const [action, ...args] = process.argv.slice(2);
const print = (state: ControlState) =>
  console.log(
    `Offline: ${state.offline.join(', ') || 'brak'}\nBez potwierdzeń: ${state.silent.join(', ') || 'brak'}\n(${path})`,
  );

if (action === undefined) {
  print(readControl(path));
} else {
  const ids = args.map((a) => (/^\d+$/.test(a) ? Number(a) : NaN));
  if (!actions.includes(action as Action) || !ids.length || ids.some((n) => !Number.isInteger(n) || n < 1)) {
    console.error(usage);
    process.exit(1);
  }
  const next = applyControl(readControl(path), action as Action, ids);
  writeControl(path, next);
  print(next);
}
