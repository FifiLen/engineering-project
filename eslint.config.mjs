import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/node_modules/**',
      'apps/mobile/**',
      '**/*.config.*',
      '**/next-env.d.ts',
    ],
  },
  {
    // Generowane przez `pnpm db:pull` (ADR 0021); telemetry.ts jest pisany ręcznie i podlega lintowi.
    ignores: ['packages/db/src/schema/schema.ts', 'packages/db/src/schema/relations.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
