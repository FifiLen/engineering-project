// Konfiguracja ESLint dla Expo; główny eslint.config.mjs pomija apps/mobile.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Etykiety tylko z pliku tłumaczeń (ADR 0027, ADR 0032). Kopia reguł z głównego eslint.config.mjs:
// aplikacja mobilna ma osobny ESLint 9 (eslint-config-expo nie działa z ESLint 10).
const LETTER = '/\\p{L}/u';
const MESSAGE = 'Tekst w JSX: użyj klucza z pliku tłumaczeń (t(...)).';
const jsxLiteralRules = [
  { selector: `JSXText[value=${LETTER}]`, message: MESSAGE },
  {
    selector: `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[value=${LETTER}]`,
    message: MESSAGE,
  },
  {
    selector: `:matches(JSXElement, JSXFragment) > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=${LETTER}]`,
    message: MESSAGE,
  },
  {
    selector: `JSXAttribute[name.name=/^(placeholder|title|alt|label|aria-label|accessibilityLabel|accessibilityHint)$/] > Literal[value=${LETTER}]`,
    message: 'Etykieta dostępności lub podpowiedź: użyj klucza z pliku tłumaczeń.',
  },
];

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*'] },
  { files: ['src/**/*.tsx'], rules: { 'no-restricted-syntax': ['error', ...jsxLiteralRules] } },
]);
