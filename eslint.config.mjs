import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Teksty w JSX: węzły tekstowe, literały i szablony w wyrażeniach oraz atrybuty widoczne dla użytkownika.
 * Wspólne dla panelu (apps/web) i aplikacji mobilnej (apps/mobile/eslint.config.js ma kopię).
 */
const LETTER = '/\\p{L}/u';
export const jsxLiteralRules = [
  { selector: `JSXText[value=${LETTER}]`, message: 'Tekst w JSX: użyj klucza z pliku tłumaczeń (t(...)).' },
  {
    selector: `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[value=${LETTER}]`,
    message: 'Tekst w JSX: użyj klucza z pliku tłumaczeń (t(...)).',
  },
  {
    selector: `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=${LETTER}]`,
    message: 'Tekst w JSX: użyj klucza z pliku tłumaczeń (t(...)).',
  },
  {
    selector: `JSXAttribute[name.name=/^(placeholder|title|alt|label|aria-label|aria-description|accessibilityLabel|accessibilityHint)$/] > Literal[value=${LETTER}]`,
    message: 'Etykieta dostępności lub podpowiedź: użyj klucza z pliku tłumaczeń.',
  },
];

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
    // Etykiety interfejsu tylko z plików tłumaczeń (ADR 0027, ADR 0032): w JSX nie ma tekstów wpisanych wprost.
    files: ['apps/web/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...jsxLiteralRules] },
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
