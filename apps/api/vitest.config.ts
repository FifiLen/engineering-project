import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
