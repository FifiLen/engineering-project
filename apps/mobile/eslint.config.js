// Konfiguracja ESLint dla Expo; główny eslint.config.mjs pomija apps/mobile.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([expoConfig, { ignores: ['dist/*', '.expo/*'] }]);
