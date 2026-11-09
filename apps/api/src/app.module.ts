import { type DynamicModule, Module } from '@nestjs/common';
import { CONFIG, type AppConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { ZonesModule } from './zones/zones.module.js';

@Module({})
export class AppModule {
  /** Moduł główny dostaje gotową konfigurację, co ułatwia testy z inną bazą. */
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DatabaseModule, ZonesModule],
      controllers: [HealthController],
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
