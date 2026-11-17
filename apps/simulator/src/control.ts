/**
 * Plik sterujący awariami do demo (ADR 0039): `offline` rozłącza wybrane hulajnogi (broker publikuje
 * Last Will), `silent` zostawia je połączone, ale bez potwierdzeń komend. Symulator sprawdza plik co
 * sekundę; brak pliku albo błędna treść oznacza brak awarii. Ekran symulatora w panelu (iteracja 6)
 * zastąpi plik.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ControlState {
  offline: number[];
  silent: number[];
}

export const CONTROL_POLL_MS = 1000;

const emptyControl = (): ControlState => ({ offline: [], silent: [] });

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
    return { offline: numbers(raw.offline), silent: numbers(raw.silent) };
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
  writeFileSync(path, JSON.stringify({ offline: numbers(state.offline), silent: numbers(state.silent) }) + '\n');
}

/** Zmiana stanu poleceniem `control`: `offline` i `silent` dopisują numery, `online` usuwa je z obu list. */
export function applyControl(
  state: ControlState,
  action: 'offline' | 'silent' | 'online',
  ids: number[],
): ControlState {
  const without = (list: number[]) => list.filter((n) => !ids.includes(n));
  if (action === 'online') return { offline: without(state.offline), silent: without(state.silent) };
  return { ...state, [action]: numbers([...state[action], ...ids]) };
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
