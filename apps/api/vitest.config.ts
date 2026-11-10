import { join } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Testy bazy czytają DATABASE_URL także z .env w katalogu głównym; zmienna z powłoki ma pierwszeństwo.
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '..', '.env'));
} catch {
  // Brak .env: testy bazy zostaną pominięte, jeśli DATABASE_URL nie jest ustawiona.
}

// SWC zachowuje metadane dekoratorów potrzebne do wstrzykiwania zależności w NestJS.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'es6' },
    }),
  ],
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
