/**
 * Uzupełnia współrzędne miejsc z seed/rybnik-places.json przez Nominatim (OpenStreetMap).
 * Zasady Nominatim: maksymalnie jedno zapytanie na sekundę i identyfikujący User-Agent.
 * Użycie: pnpm db:places [--force]
 */
import { readPlaces, writePlaces } from '../places.js';

const USER_AGENT = 'hulajnogi-projekt-inzynierski/0.1 (seed danych deweloperskich)';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

async function geocode(query: string): Promise<NominatimResult | undefined> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'pl');
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pl' } });
  if (!response.ok) throw new Error(`Nominatim: HTTP ${response.status} dla „${query}”`);
  const results = (await response.json()) as NominatimResult[];
  return results[0];
}

async function main() {
  const force = process.argv.includes('--force');
  const data = readPlaces();
  for (const place of data.places) {
    if (!force && place.lat !== undefined && place.lon !== undefined) continue;
    const result = await geocode(place.query);
    if (!result) {
      console.warn(`✗ ${place.code} ${place.name}: brak wyniku dla „${place.query}”. Popraw zapytanie.`);
    } else {
      place.lat = Number(Number(result.lat).toFixed(6));
      place.lon = Number(Number(result.lon).toFixed(6));
      place.osmDisplayName = result.display_name;
      console.log(`✓ ${place.code} ${place.name}: ${place.lat}, ${place.lon}\n    ${result.display_name}`);
    }
    await sleep(1100);
  }
  writePlaces(data);
  console.log('Zapisano seed/rybnik-places.json. Sprawdź nazwy powyżej przed uruchomieniem pnpm db:seed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
