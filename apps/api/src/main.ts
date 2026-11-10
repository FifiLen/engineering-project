import 'reflect-metadata';
import { join } from 'node:path';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

/** Wczytuje .env z katalogu głównego repozytorium; zmienne ustawione w powłoce mają pierwszeństwo. */
function loadRootEnv(path: string) {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

loadRootEnv(join(import.meta.dirname, '..', '..', '..', '.env'));

const config = loadConfig();
const app = await createApp(config, { logger: config.NODE_ENV !== 'test' });
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
console.log(`API: http://localhost:${config.API_PORT}  dokumentacja: http://localhost:${config.API_PORT}/docs`);
