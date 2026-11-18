/**
 * Plik sterujący do demo z CLI (ADR 0039, ADR 0046, ADR 0059): `offline` rozłącza wybrane hulajnogi
 * (broker publikuje Last Will), `silent` zostawia je połączone, ale bez potwierdzeń komend, a `goto` to
 * jednorazowy cel jazdy hulajnogi (kod strefy albo „lat,lon”). Symulator sprawdza plik co sekundę i zamienia
 * zmiany na polecenia scenariuszy (`controlCommands`), te same co z `simulator/control` z panelu; brak pliku
 * albo błędna treść oznacza brak awarii i celów.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Point } from './geo.js';
import type { ScenarioCommand } from './scenarios.js';

export interface ControlState {
  offline: number[];
  silent: number[];
  /** Cel następnej trasy według numeru hulajnogi, w zapisie z polecenia (`S-01`, `50.1,18.5`). */
  goto: Record<number, string>;
}

/** Cel z `control goto`: `anchor` strefy o kodzie albo punkt. */
export type ControlTarget = { code: string } | { point: Point };

export const CONTROL_POLL_MS = 1000;

export const emptyControl = (): ControlState => ({ offline: [], silent: [], goto: {} });

/** Cel z polecenia: „lat,lon” w stopniach albo kod strefy (litery, cyfry, „-” i „_”). */
export function parseTarget(text: string): ControlTarget | null {
  const value = text.trim();
  const point = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(value);
  if (point) {
    const lat = Number(point[1]);
    const lon = Number(point[2]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { point: { lat, lon } } : null;
  }
  return /^[A-Za-z0-9][\w-]*$/.test(value) ? { code: value } : null;
}

/** Cele według numerów hulajnóg; pomija błędne numery i cele. */
function targets(value: unknown): Record<number, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<number, string> = {};
  for (const [key, target] of Object.entries(value)) {
    const number = /^\d+$/.test(key) ? Number(key) : NaN;
    if (number > 0 && typeof target === 'string' && parseTarget(target)) result[number] = target.trim();
  }
  return result;
}

/** Numery hulajnóg z listy; przyjmuje liczby i napisy z zerami wiodącymi (np. "0142"), resztę pomija. */
function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map((v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v))
    .filter((v): v is number => Number.isInteger(v) && v > 0);
  return [...new Set(parsed)].sort((a, b) => a - b);
}

export function parseControl(text: string): ControlState {
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) return emptyControl();
    return { offline: numbers(raw.offline), silent: numbers(raw.silent), goto: targets(raw.goto) };
  } catch {
    return emptyControl();
  }
}

export function readControl(path: string): ControlState {
  try {
    return parseControl(readFileSync(path, 'utf8'));
  } catch {
    return emptyControl();
  }
}

export function writeControl(path: string, state: ControlState): void {
  mkdirSync(dirname(path), { recursive: true });
  const content = { offline: numbers(state.offline), silent: numbers(state.silent), goto: targets(state.goto) };
  writeFileSync(path, JSON.stringify(content) + '\n');
}

/** Zmiana stanu poleceniem `control`: `offline` i `silent` dopisują numery, `online` usuwa je z obu list. */
export function applyControl(
  state: ControlState,
  action: 'offline' | 'silent' | 'online',
  ids: number[],
): ControlState {
  const without = (list: number[]) => list.filter((n) => !ids.includes(n));
  if (action === 'online') return { ...state, offline: without(state.offline), silent: without(state.silent) };
  return { ...state, [action]: numbers([...state[action], ...ids]) };
}

/**
 * Polecenia scenariuszy ze zmiany list w pliku: dopisany numer włącza scenariusz (`disconnect`, `silence`),
 * usunięty go kończy (`restore`, `unsilence`). Plik opisuje tylko zmiany, więc polecenie z panelu wydane
 * później (np. `restore` hulajnogi z listy `offline`) obowiązuje, dopóki plik znowu się nie zmieni.
 */
export function controlCommands(previous: ControlState, next: ControlState): ScenarioCommand[] {
  const added = (from: number[], to: number[]) => to.filter((n) => !from.includes(n));
  const commands = (
    from: number[],
    to: number[],
    start: 'disconnect' | 'silence',
    stop: 'restore' | 'unsilence',
  ): ScenarioCommand[] => [
    ...added(from, to).map((scooter) => ({ scooter, action: start })),
    ...added(to, from).map((scooter) => ({ scooter, action: stop })),
  ];
  return [
    ...commands(previous.offline, next.offline, 'disconnect', 'restore'),
    ...commands(previous.silent, next.silent, 'silence', 'unsilence'),
  ];
}

/** `control goto`: jednorazowy cel jazdy hulajnogi; zastępuje poprzedni, jeszcze niewykorzystany. */
export function applyGoto(state: ControlState, number: number, target: string): ControlState {
  return { ...state, goto: { ...state.goto, [number]: target.trim() } };
}

/** Odczyt jednorazowego celu przez symulator: zwraca go i usuwa z pliku (polecenie `goto` scenariusza). */
export function takeGoto(path: string, number: number): ControlTarget | null {
  const state = readControl(path);
  const target = state.goto[number];
  if (target === undefined) return null;
  const rest = { ...state.goto };
  delete rest[number];
  writeControl(path, { ...state, goto: rest });
  return parseTarget(target);
}

/** Obserwacja pliku przez odpytywanie (działa też, gdy plik powstaje albo znika); wywołuje `onChange` przy zmianie. */
export function watchControl(path: string, onChange: (state: ControlState) => void): () => void {
  let last = '';
  const check = () => {
    const state = readControl(path);
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    onChange(state);
  };
  check();
  const timer = setInterval(check, CONTROL_POLL_MS);
  return () => clearInterval(timer);
}
