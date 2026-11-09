import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config, { logger: config.NODE_ENV !== 'test' });
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
console.log(`API: http://localhost:${config.API_PORT}  dokumentacja: http://localhost:${config.API_PORT}/docs`);
