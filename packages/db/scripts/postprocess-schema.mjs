// Poprawki po `drizzle-kit pull` (ADR 0021):
// - znaczniki czasu jako obiekty Date zamiast tekstu,
// - rozszerzenia .js w importach (ESM),
// - usunięcie plików migracji generowanych przez drizzle-kit (migracje piszemy ręcznie w migrations/).
import { readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../src/schema/', import.meta.url).pathname;
const schemaPath = join(dir, 'schema.ts');
const schema = readFileSync(schemaPath, 'utf8').replaceAll("mode: 'string'", "mode: 'date'");
writeFileSync(
  schemaPath,
  '// Plik generowany przez `pnpm db:pull` na podstawie bazy. Nie edytuj ręcznie.\n' + schema,
);
// Moduły ESM wymagają rozszerzeń w importach względnych.
const relationsPath = join(dir, 'relations.ts');
writeFileSync(
  relationsPath,
  readFileSync(relationsPath, 'utf8').replace(/from (["'])\.\/schema\1/g, 'from $1./schema.js$1'),
);
for (const name of readdirSync(dir)) {
  if (name.endsWith('.sql') || name === 'meta') rmSync(join(dir, name), { recursive: true, force: true });
}
console.log('Schemat Drizzle przetworzony.');
