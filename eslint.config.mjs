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
  {
    // packages/core: logika biznesowa bez frameworka, bazy i wejścia-wyjścia (ADR 0025).
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', 'drizzle-orm', 'drizzle-orm/*', 'pg', '@hulajnogi/db', 'node:*'],
              message: 'packages/core nie zależy od frameworka ani bazy; dane dostaje przez porty (ADR 0025).',
            },
          ],
        },
      ],
    },
  },
  {
    // API sięga do danych tylko przez packages/db; surowy pg zostaje w migratorze i testach.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'pg', message: 'Dostęp do danych tylko przez @hulajnogi/db (ADR 0025).' }] },
      ],
    },
  },
);
