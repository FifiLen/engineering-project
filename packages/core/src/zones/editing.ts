import { DomainError } from '../errors.js';
import type { ZoneType } from './zones.js';

/** Zakres limitu w strefie wolnej jazdy, który może ustawić operator (pytanie 1 w planie iteracji 4). */
export const ZONE_SPEED_LIMIT_MIN_KMH = 5;
export const ZONE_SPEED_LIMIT_MAX_KMH = 15;
/** Najmniejsza powierzchnia strefy (ADR 0047): mniejszy wielokąt to zwykle przypadkowe kliknięcie. */
export const MIN_ZONE_AREA_M2 = 100;

/** Pierścień wielokąta w GeoJSON: [lon, lat], pierwszy punkt równy ostatniemu. */
export type Ring = ReadonlyArray<readonly [number, number]>;

export interface ZoneInput {
  code: string;
  name: string;
  type: ZoneType;
  speedLimitKmh: number | null;
  capacity: number | null;
  visibleInApp: boolean;
  /** Jedna strefa to jeden wielokąt bez otworów (decyzja D1). */
  ring: Ring;
}

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Powierzchnia pierścienia na sferze (wzór dla wielokąta sferycznego); dla stref miejskich dokładna do ułamka %. */
export function ringAreaM2(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i]!;
    const [lon2, lat2] = ring[i + 1]!;
    sum += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

type Point = readonly [number, number];

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return value === 0 ? 0 : value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a[0], c[0]) <= b[0] &&
    b[0] <= Math.max(a[0], c[0]) &&
    Math.min(a[1], c[1]) <= b[1] &&
    b[1] <= Math.max(a[1], c[1])
  );
}

function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(p1, p2, q1)) ||
    (o2 === 0 && onSegment(p1, q2, q1)) ||
    (o3 === 0 && onSegment(p2, p1, q2)) ||
    (o4 === 0 && onSegment(p2, q1, q2))
  );
}

/** Pierścień bez samoprzecięć: niesąsiednie krawędzie nie mają punktów wspólnych. */
export function isSimpleRing(ring: Ring): boolean {
  const edges = ring.length - 1;
  for (let i = 0; i < edges; i++) {
    for (let j = i + 1; j < edges; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === edges - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false;
    }
  }
  return true;
}

function ensureGeometry(ring: Ring): void {
  const closed = ring.length >= 4 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1];
  const distinct = new Set(ring.slice(0, -1).map(([lon, lat]) => `${lon},${lat}`)).size;
  const inRange = ring.every(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
  if (!closed || distinct < 3 || !inRange) throw new DomainError('ZONE_INVALID_GEOMETRY', { reason: 'TOO_FEW_POINTS' });
  if (!isSimpleRing(ring)) throw new DomainError('ZONE_INVALID_GEOMETRY', { reason: 'SELF_INTERSECTION' });
  if (ringAreaM2(ring) < MIN_ZONE_AREA_M2) throw new DomainError('ZONE_INVALID_GEOMETRY', { reason: 'TOO_SMALL' });
}

/**
 * Reguły formularza strefy (ADR 0047). Baza pilnuje reguł zależnych od innych stref: położenia w obszarze
 * działania i nakładania stref parkowania (migracja 0006); tu jest to, co da się sprawdzić bez nich.
 */
export function validateZoneInput(input: ZoneInput): void {
  const fields: string[] = [];
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(input.code)) fields.push('code');
  if (input.name.trim().length === 0) fields.push('name');
  if (input.type === 'SLOW') {
    const limit = input.speedLimitKmh;
    if (
      limit === null ||
      !Number.isInteger(limit) ||
      limit < ZONE_SPEED_LIMIT_MIN_KMH ||
      limit > ZONE_SPEED_LIMIT_MAX_KMH
    )
      fields.push('speedLimitKmh');
  } else if (input.speedLimitKmh !== null) fields.push('speedLimitKmh');
  if (input.type === 'PARKING') {
    if (input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 1)) fields.push('capacity');
  } else if (input.capacity !== null) fields.push('capacity');
  if (fields.length > 0) throw new DomainError('VALIDATION_FAILED', { fields });
  ensureGeometry(input.ring);
}

/** Zmiana istniejącej strefy: typ ustala się przy tworzeniu (ADR 0047), obszar działania nie znika. */
export function ensureZoneUpdateAllowed(existing: { type: ZoneType }, input: { type: ZoneType }): void {
  if (existing.type !== input.type) throw new DomainError('ZONE_TYPE_IMMUTABLE');
}

export function ensureZoneCanDeactivate(zone: { type: ZoneType; active: boolean }): void {
  if (zone.type === 'SERVICE_AREA') throw new DomainError('SERVICE_AREA_REQUIRED');
  if (!zone.active) throw new DomainError('ZONE_ALREADY_INACTIVE');
}
