import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type PlaceType = 'PARKING' | 'SLOW' | 'NO_RIDE';

export interface Place {
  code: string;
  name: string;
  query: string;
  type: PlaceType;
  radiusM: number;
  capacity?: number;
  speedLimitKmh?: number;
  lat?: number;
  lon?: number;
  osmDisplayName?: string;
}

export interface PlacesFile {
  city: string;
  note: string;
  serviceArea: { code: string; name: string; centerPlace: string; radiusM: number };
  places: Place[];
}

export const placesPath = join(import.meta.dirname, '..', 'seed', 'rybnik-places.json');

export const readPlaces = (path = placesPath): PlacesFile => JSON.parse(readFileSync(path, 'utf8')) as PlacesFile;

export const writePlaces = (data: PlacesFile, path = placesPath): void =>
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');

export const missingCoordinates = (data: PlacesFile): string[] =>
  data.places.filter((p) => p.lat === undefined || p.lon === undefined).map((p) => p.code);
