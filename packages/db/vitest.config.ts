import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Testy bazy czytają DATABASE_URL także z .env w katalogu głównym; zmienna z powłoki ma pierwszeństwo.
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  // Brak .env: testy bazy zostaną pominięte, jeśli DATABASE_URL nie jest ustawiona.
}

export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
